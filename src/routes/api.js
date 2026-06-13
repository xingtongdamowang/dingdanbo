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
  const toText = value => {
    if (Array.isArray(value)) {
      return value.map(item => toText(item)).filter(Boolean).join(' / ');
    }
    if (value && typeof value === 'object') {
      return toText(value.pick || value.selection || value.value || value.name || value.label);
    }
    return String(value || '').trim();
  };
  const toLegs = legs =>
    Array.isArray(legs)
      ? legs.map(item => ({
          league: item.league || item.matchNo || item.game || '',
          match: item.match || `${item.home || 'home'} vs ${item.away || 'away'}`,
          play: toText(item.play || item.market || item.playType || item.betType || item.gameType),
          pick: toText(item.pick || item.selection || item.selections || item.options || item.selected)
        }))
      : [];
  const canonicalTicketType = (value, note, legs) => {
    const source = `${value || ''} ${note || ''}`;
    if (/混合过关/.test(source)) return '混合过关';
    const playTypes = new Set(
      (Array.isArray(legs) ? legs : [])
        .map(leg => String(leg.play || '').replace(/[（(].*?[）)]/g, '').trim())
        .filter(Boolean)
    );
    if (playTypes.size > 1) return '混合过关';

    const exact = source.match(/([1-4])\s*(?:x|X|×|串)\s*1/);
    if (exact) return `${exact[1]} 串 1`;
    if (/二\s*串\s*一|两\s*场\s*二\s*串\s*一/.test(source)) return '2 串 1';
    if (/三\s*串\s*一/.test(source)) return '3 串 1';
    if (/四\s*串\s*一/.test(source)) return '4 串 1';
    if (/单关/.test(source)) return '单关';

    const legCount = Array.isArray(legs) ? legs.length : 0;
    if (legCount === 1) return '单关';
    if (legCount >= 2 && legCount <= 4) return `${legCount} 串 1`;
    return value || '混合过关';
  };

  if (!payload) return null;

  if (Array.isArray(payload.legs)) {
    const legs = toLegs(payload.legs);
    return {
      ticketType: canonicalTicketType(payload.ticketType || payload.passType, payload.note, legs),
      amount: toNumber(payload.amount || payload.unitAmount),
      multiple: toNumber(payload.multiple || payload.times),
      note: payload.note,
      legs
    };
  }

  if (Array.isArray(payload.matches)) {
    const legs = toLegs(payload.matches);
    return {
      ticketType: canonicalTicketType(payload.ticketType || payload.passType, payload.note, legs),
      amount: toNumber(payload.amount || payload.unitAmount),
      multiple: toNumber(payload.multiple || payload.times),
      note: payload.note,
      legs
    };
  }

  if (payload.ticketType || payload.amount || payload.multiple) {
    const legs = Array.isArray(payload.legs) ? toLegs(payload.legs) : [];
    return {
      ticketType: canonicalTicketType(payload.ticketType || payload.passType, payload.note, legs),
      amount: toNumber(payload.amount || payload.unitAmount),
      multiple: toNumber(payload.multiple || payload.times),
      note: payload.note,
      legs
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

function parserHttpErrorMessage(status, raw) {
  let message = String(raw || '').trim();
  try {
    const payload = JSON.parse(message);
    message = payload.error?.message || payload.message || message;
  } catch (error) {
    if (/^<!doctype html/i.test(message)) {
      message = '识别服务网关异常，请稍后重试或切换模型。';
    }
  }

  if (/No endpoints found that support image input/i.test(message)) {
    return '当前识别服务模型不支持图片输入，请在 .env 中切换到支持视觉的 TICKET_PARSE_MODEL 后重试。';
  }

  return `识别服务返回 HTTP ${status}: ${message.slice(0, 200)}`;
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
          'You extract Chinese sports lottery football ticket data. Return only one JSON object with exactly these keys: ticketType, amount, multiple, note, legs. ticketType must be one of: 单关, 2 串 1, 3 串 1, 4 串 1, 混合过关. If the ticket says 竞彩足球混合过关 or 混合过关, return ticketType as 混合过关, even if pass type says 2x1. Put pass type such as 2x1/2×1 in note. legs must be an array of objects with exactly these keys: league, match, play, pick. amount and multiple must be numbers. IMPORTANT: amount is the base stake before multiplier, so app stake = amount * multiple. If the ticket shows total/合计 and multiplier/倍, set amount = total / multiple. Put the visible total in note if useful. If the image is not a sports lottery ticket, return {"ticketType":"","amount":0,"multiple":1,"note":"not a ticket","legs":[]}.'
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              'Parse this football lottery ticket image into the required JSON schema. Match should look like "home vs away". Do not include explanations or extra fields.'
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

  if (!response.ok) {
    throw new HttpError(502, parserHttpErrorMessage(response.status, raw));
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (error) {
    throw new HttpError(502, '识别服务返回的不是有效 JSON。');
  }
  const content = payload.choices?.[0]?.message?.content;
  let parsed;
  try {
    parsed = extractJsonObject(content);
  } catch (error) {
    throw new HttpError(422, 'AI 没有返回票据 JSON，请换一张更清晰的票据图片。');
  }

  const ticket = normalizeTicketPayload(parsed);
  if (!ticket || !Array.isArray(ticket.legs) || ticket.legs.length === 0) {
    throw new HttpError(422, 'AI 未识别出票据场次，请确认上传的是清晰的体彩足球票据。');
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

  if (!response.ok) throw new HttpError(502, `识别服务返回 HTTP ${response.status}`);

  const ticket = normalizeTicketPayload(await response.json());
  if (!ticket) throw new HttpError(422, '识别服务返回的数据结构不符合票据格式。');
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
