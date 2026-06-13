const fs = require('fs/promises');
const express = require('express');
const multer = require('multer');
const config = require('../config');
const HttpError = require('../httpError');
const records = require('../repositories/records');

const router = express.Router();
const upload = multer({
  dest: config.uploadDir,
  limits: {
    fileSize: config.upload.maxBytes
  }
});

function normalizeTicketPayload(payload) {
  const toNumber = value => {
    if (typeof value === 'number') return value;
    const match = String(value || '').match(/\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : undefined;
  };
  const toLegs = legs =>
    Array.isArray(legs)
      ? legs.map(item => ({
          league: item.league || '',
          match: item.match || `${item.home || 'home'} vs ${item.away || 'away'}`,
          play: item.play || item.market || '',
          pick: item.pick || item.selection || ''
        }))
      : [];

  if (!payload) return null;

  if (Array.isArray(payload.legs)) {
    return {
      ticketType: payload.ticketType || payload.passType,
      amount: toNumber(payload.amount || payload.unitAmount),
      multiple: toNumber(payload.multiple || payload.times),
      note: payload.note,
      legs: toLegs(payload.legs)
    };
  }

  if (Array.isArray(payload.matches)) {
    return {
      ticketType: payload.ticketType || payload.passType,
      amount: toNumber(payload.amount || payload.unitAmount),
      multiple: toNumber(payload.multiple || payload.times),
      note: payload.note,
      legs: toLegs(payload.matches)
    };
  }

  if (payload.ticketType || payload.amount || payload.multiple) {
    return {
      ticketType: payload.ticketType || payload.passType,
      amount: toNumber(payload.amount || payload.unitAmount),
      multiple: toNumber(payload.multiple || payload.times),
      note: payload.note,
      legs: Array.isArray(payload.legs) ? payload.legs : []
    };
  }

  return null;
}

function resolveTicketParser(body = {}) {
  const clientEndpoint = config.ai.allowClientEndpoint ? String(body.endpoint || '').trim() : '';
  const clientKey = config.ai.allowClientEndpoint ? String(body.apiKey || '').trim() : '';
  const endpoint = config.ai.ticketParseUrl || clientEndpoint;
  const apiKey = config.ai.ticketParseApiKey || clientKey;

  return {
    endpoint,
    apiKey,
    mode: config.ai.ticketParseMode,
    model: config.ai.ticketParseModel,
    source: config.ai.ticketParseUrl ? 'server' : clientEndpoint ? 'client' : 'missing',
    allowClientEndpoint: config.ai.allowClientEndpoint
  };
}

function missingParserMessage() {
  return 'TICKET_PARSE_API_URL is missing. Configure it in the server .env file and restart the app.';
}

function maskEndpoint(endpoint) {
  if (!endpoint) return '';
  try {
    const url = new URL(endpoint);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch (error) {
    return endpoint;
  }
}

function isOpenAiParser(endpoint, mode) {
  if (mode === 'openai') return true;
  if (mode === 'multipart') return false;
  return /\/v1\/?$/.test(endpoint) || /\/chat\/completions\/?$/.test(endpoint);
}

function openAiChatUrl(endpoint) {
  const trimmed = endpoint.replace(/\/+$/, '');
  if (/\/chat\/completions$/.test(trimmed)) return trimmed;
  if (/\/v1$/.test(trimmed)) return `${trimmed}/chat/completions`;
  return `${trimmed}/chat/completions`;
}

function extractJsonObject(text) {
  const cleaned = String(text || '')
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error('Model did not return a JSON object.');
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function probeTicketParser(parser) {
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const openaiMode = isOpenAiParser(parser.endpoint, parser.mode);
    const response = await fetch(openaiMode ? openAiChatUrl(parser.endpoint) : parser.endpoint, {
      method: openaiMode ? 'POST' : 'HEAD',
      headers: openaiMode
        ? {
            Authorization: `Bearer ${parser.apiKey}`,
            'Content-Type': 'application/json'
          }
        : parser.apiKey
          ? { Authorization: `Bearer ${parser.apiKey}` }
          : undefined,
      body: openaiMode
        ? JSON.stringify({
            model: parser.model,
            messages: [{ role: 'user', content: 'ping' }],
            max_tokens: 1,
            temperature: 0
          })
        : undefined,
      signal: controller.signal
    });

    const unauthorized = response.status === 401 || response.status === 403;
    return {
      ok: response.status < 400 && !unauthorized,
      reachable: true,
      status: response.status,
      elapsedMs: Date.now() - started,
      message:
        response.status < 400
          ? 'Parser endpoint is reachable.'
          : unauthorized
            ? `Parser endpoint rejected the API key with HTTP ${response.status}.`
            : `Parser endpoint is reachable, but returned HTTP ${response.status}. Check API path or method requirements.`
    };
  } catch (error) {
    return {
      ok: false,
      reachable: false,
      status: 0,
      elapsedMs: Date.now() - started,
      message: error.name === 'AbortError' ? 'Parser endpoint test timed out.' : `Parser endpoint is not reachable: ${error.message}`
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function callOpenAiTicketParser(file, parser) {
  const bytes = await fs.readFile(file.path);
  const imageUrl = `data:${file.mimetype};base64,${bytes.toString('base64')}`;
  const requestBody = {
    model: parser.model,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'You extract Chinese sports lottery football ticket data. Return only JSON with keys: ticketType, amount, multiple, note, legs. legs is an array of {league, match, play, pick}. Use numbers for amount and multiple. If uncertain, use empty strings, but keep valid JSON.'
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              'Parse this ticket image into JSON. Match should look like "home vs away". Do not include explanations.'
          },
          {
            type: 'image_url',
            image_url: { url: imageUrl }
          }
        ]
      }
    ]
  };

  const sendRequest = body =>
    fetch(openAiChatUrl(parser.endpoint), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${parser.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

  let response = await sendRequest(requestBody);
  let raw = await response.text();
  if (!response.ok && /response_format/i.test(raw)) {
    const { response_format, ...retryBody } = requestBody;
    response = await sendRequest(retryBody);
    raw = await response.text();
  }

  if (!response.ok) throw new Error(`OpenAI-compatible parser returned HTTP ${response.status}: ${raw.slice(0, 200)}`);

  const payload = JSON.parse(raw);
  const content = payload.choices?.[0]?.message?.content;
  const ticket = normalizeTicketPayload(extractJsonObject(content));
  if (!ticket || !Array.isArray(ticket.legs) || ticket.legs.length === 0) {
    throw new Error('Model response did not contain ticket legs.');
  }
  return ticket;
}

async function callMultipartTicketParser(file, parser) {
  if (typeof fetch !== 'function' || typeof FormData !== 'function' || typeof Blob !== 'function') {
    throw new Error('Node 20+ is required for built-in fetch/FormData.');
  }

  const bytes = await fs.readFile(file.path);
  const form = new FormData();
  form.append('image', new Blob([bytes], { type: file.mimetype }), file.originalname);

  const response = await fetch(parser.endpoint, {
    method: 'POST',
    headers: parser.apiKey ? { Authorization: `Bearer ${parser.apiKey}` } : undefined,
    body: form
  });

  if (!response.ok) throw new Error(`Parser endpoint returned HTTP ${response.status}`);

  const ticket = normalizeTicketPayload(await response.json());
  if (!ticket) throw new Error('Parser endpoint returned an unsupported payload shape.');
  return ticket;
}

async function callTicketParser(file, parser) {
  if (!parser.endpoint) return null;
  if (isOpenAiParser(parser.endpoint, parser.mode)) return callOpenAiTicketParser(file, parser);
  return callMultipartTicketParser(file, parser);
}

router.get('/health', (req, res) => {
  res.json({ ok: true });
});

router.get('/records', async (req, res, next) => {
  try {
    const list = await records.listRecords(req.query.status || 'all');
    res.json({ records: list });
  } catch (error) {
    next(error);
  }
});

router.post('/records', async (req, res, next) => {
  try {
    const record = await records.createRecord(req.body || {});
    res.status(201).json({ record });
  } catch (error) {
    next(error);
  }
});

router.patch('/records/:id/settle', async (req, res, next) => {
  try {
    const record = await records.settleRecord(req.params.id, req.body || {});
    res.json({ record });
  } catch (error) {
    next(error);
  }
});

router.get('/stats', async (req, res, next) => {
  try {
    const payload = await records.stats(req.query.range || 'recent');
    res.json(payload);
  } catch (error) {
    next(error);
  }
});

router.post('/tickets/recognize/test', async (req, res, next) => {
  try {
    const parser = resolveTicketParser(req.body || {});
    if (!parser.endpoint) {
      throw new HttpError(400, missingParserMessage());
    }

    const result = await probeTicketParser(parser);
    res.json({
      ...result,
      endpoint: maskEndpoint(parser.endpoint),
      mode: isOpenAiParser(parser.endpoint, parser.mode) ? 'openai' : 'multipart',
      model: parser.model,
      source: parser.source,
      allowClientEndpoint: parser.allowClientEndpoint
    });
  } catch (error) {
    next(error);
  }
});

router.post('/tickets/recognize', upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) throw new HttpError(400, 'Ticket image is required.');

    const parser = resolveTicketParser(req.body || {});
    if (!parser.endpoint) {
      throw new HttpError(400, missingParserMessage());
    }

    const ticket = await callTicketParser(req.file, parser);

    res.json({
      ticket,
      usedFallback: false,
      parserError: '',
      endpoint: maskEndpoint(parser.endpoint),
      mode: isOpenAiParser(parser.endpoint, parser.mode) ? 'openai' : 'multipart',
      model: parser.model,
      source: parser.source,
      allowClientEndpoint: parser.allowClientEndpoint,
      imagePath: req.file.path.replace(/\\/g, '/')
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
