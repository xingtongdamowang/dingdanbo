const fs = require('fs/promises');
const express = require('express');
const multer = require('multer');
const config = require('../config');
const HttpError = require('../httpError');
const sampleTicket = require('../sampleTicket');
const records = require('../repositories/records');

const router = express.Router();
const upload = multer({
  dest: config.uploadDir,
  limits: {
    fileSize: config.upload.maxBytes
  }
});

function normalizeTicketPayload(payload) {
  if (!payload) return null;
  if (Array.isArray(payload.legs)) return payload;
  if (Array.isArray(payload.matches)) {
    return {
      ticketType: payload.ticketType || payload.passType,
      amount: payload.amount || payload.unitAmount,
      multiple: payload.multiple || payload.times,
      note: payload.note,
      legs: payload.matches.map(item => ({
        league: item.league,
        match: item.match || `${item.home || 'home'} vs ${item.away || 'away'}`,
        play: item.play || item.market,
        pick: item.pick || item.selection
      }))
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
    source: config.ai.ticketParseUrl ? 'server' : clientEndpoint ? 'client' : 'missing',
    allowClientEndpoint: config.ai.allowClientEndpoint
  };
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

async function probeTicketParser(endpoint, apiKey) {
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(endpoint, {
      method: 'HEAD',
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
      signal: controller.signal
    });

    return {
      ok: response.status < 500,
      reachable: true,
      status: response.status,
      elapsedMs: Date.now() - started,
      message:
        response.status < 400
          ? 'Parser endpoint is reachable.'
          : `Parser endpoint is reachable, but returned HTTP ${response.status}. Check API key or method requirements.`
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

async function callTicketParser(file, endpoint, apiKey) {
  if (!endpoint) return null;
  if (typeof fetch !== 'function' || typeof FormData !== 'function' || typeof Blob !== 'function') {
    throw new Error('Node 20+ is required for built-in fetch/FormData.');
  }

  const bytes = await fs.readFile(file.path);
  const form = new FormData();
  form.append('image', new Blob([bytes], { type: file.mimetype }), file.originalname);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
    body: form
  });

  if (!response.ok) throw new Error(`Parser endpoint returned HTTP ${response.status}`);
  return normalizeTicketPayload(await response.json());
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
      throw new HttpError(
        400,
        parser.allowClientEndpoint
          ? 'Parser endpoint is missing. Fill AI API URL or set TICKET_PARSE_API_URL in .env.'
          : 'TICKET_PARSE_API_URL is missing and client endpoint input is disabled by ALLOW_CLIENT_AI_ENDPOINT=false.'
      );
    }

    const result = await probeTicketParser(parser.endpoint, parser.apiKey);
    res.json({
      ...result,
      endpoint: maskEndpoint(parser.endpoint),
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
    let ticket = null;
    let usedFallback = false;
    let parserError = '';

    try {
      ticket = await callTicketParser(req.file, parser.endpoint, parser.apiKey);
    } catch (error) {
      usedFallback = true;
      parserError = error.message;
    }

    if (!ticket) {
      ticket = sampleTicket;
      usedFallback = true;
    }

    res.json({
      ticket,
      usedFallback,
      parserError,
      endpoint: maskEndpoint(parser.endpoint),
      source: parser.source,
      allowClientEndpoint: parser.allowClientEndpoint,
      imagePath: req.file.path.replace(/\\/g, '/')
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
