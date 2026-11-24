'use strict';

/*
 * Krishi Voice - tiny Node proxy (no dependencies).
 *
 *   GET  /             -> public/ (the PWA)
 *   GET  /api/health   -> { ok, llm }
 *   POST /api/extract  -> { text, lang } -> structured fields + KB match ids
 *
 * The LLM API key lives only in this process (env or .env).
 * The LLM may EXTRACT fields and pick knowledge-base ids.
 * It is never asked for, and never trusted with, advice.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 8080);

loadEnv();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8'
};

const LANG_CODES = ['te', 'hi', 'en'];

function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    let value = m[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(m[1] in process.env)) process.env[m[1]] = value;
  }
}

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(PUBLIC, 'data', name), 'utf8'));
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(payload)
  });
  res.end(payload);
}

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function serveStatic(req, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    return sendText(res, 400, 'Bad request');
  }
  let relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  let file = path.join(PUBLIC, relative);
  if (!file.startsWith(PUBLIC)) return sendText(res, 403, 'Forbidden');

  let exists = fs.existsSync(file) && fs.statSync(file).isFile();
  if (!exists && !path.extname(relative)) {
    file = path.join(PUBLIC, 'index.html');
    exists = true;
  }
  if (!exists) return sendText(res, 404, 'Not found');

  const ext = path.extname(file).toLowerCase();
  const noCache = ext === '.html' || file.endsWith('sw.js');
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': noCache ? 'no-cache' : 'public, max-age=3600'
  });
  res.end(fs.readFileSync(file));
}

async function handleExtract(req, res) {
  let raw = '';
  try {
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 64 * 1024) return sendJson(res, 413, { error: 'payload_too_large' });
    }
  } catch {
    return sendJson(res, 400, { error: 'read_failed' });
  }

  let body;
  try {
    body = JSON.parse(raw || '{}');
  } catch {
    return sendJson(res, 400, { error: 'bad_json' });
  }

  const text = String(body.text || '').slice(0, 1200).trim();
  if (!text) return sendJson(res, 400, { error: 'empty_text' });
  const lang = LANG_CODES.includes(body.lang) ? body.lang : 'te';

  if (!process.env.OPENAI_API_KEY) {
    return sendJson(res, 503, {
      error: 'llm_not_configured',
      message: 'Set OPENAI_API_KEY in .env to enable the LLM extractor. The app keeps working with the local matcher.'
    });
  }

  try {
    const result = await callLLM(text, lang);
    return sendJson(res, 200, result);
  } catch (err) {
    console.warn('[extract] LLM call failed:', err && err.message);
    return sendJson(res, 502, { error: 'llm_failed' });
  }
}

async function callLLM(text, lang) {
  const kb = readJson('kb.json');
  const syn = readJson('synonyms.json');

  const symptomKeys = Object.keys(syn.symptoms || {});
  const context = kb.entries.map((entry) => ({
    id: entry.id,
    crop: entry.crop,
    localNames: entry.localNames,
    symptomKeys: entry.symptomKeys,
    symptoms: entry.symptoms
  }));

  const system = [
    "You extract structured fields from a smallholder farmer's spoken description of a chilli crop problem.",
    'You NEVER give advice, and you NEVER name pesticides, chemicals, doses or brands.',
    'Return ONLY compact JSON, no markdown, with this exact shape:',
    '{"language":"te|hi|en","crop":"chilli|other|unknown","stage":"seedling|flowering|fruiting|unknown","symptoms":["one of the allowed symptom keys"],"weather":"rain|dry|heat|cold|unknown","district":"district name or unknown","matches":[{"id":"kb id","confidence":0.0}]}',
    'Allowed symptom keys: ' + symptomKeys.join(', ') + '.',
    'language = the language of most words in the input. Farmers mix Telugu, Hindi and English in one sentence; that is normal.',
    'matches = 0 to 3 knowledge-base ids, best first. Use an empty array when nothing fits with confidence >= 0.55.',
    'Knowledge base entries (context only): ' + JSON.stringify(context)
  ].join('\n');

  const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  const response = await fetch(base + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + process.env.OPENAI_API_KEY
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 320,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: 'Farmer language button: ' + lang + '\nSpoken text: ' + text }
      ]
    }),
    signal: AbortSignal.timeout(6000)
  });

  if (!response.ok) throw new Error('provider_status_' + response.status);

  const data = await response.json();
  const content = data && data.choices && data.choices[0] && data.choices[0].message
    ? String(data.choices[0].message.content || '')
    : '';
  const parsed = parseJsonObject(content);
  if (!parsed) throw new Error('provider_bad_json');
  return validate(parsed, kb, syn);
}

function parseJsonObject(content) {
  const cleaned = content.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/* Keep only ids and keys that exist in our JSON, so nothing model-invented
   can reach the UI. Advice is never taken from the model. */
function validate(out, kb, syn) {
  const ids = new Set(kb.entries.map((entry) => entry.id));
  const keys = new Set(Object.keys(syn.symptoms || {}));
  const stages = new Set(['seedling', 'flowering', 'fruiting']);
  const weather = new Set(['rain', 'dry', 'heat', 'cold']);

  const matches = Array.isArray(out.matches)
    ? out.matches
        .filter((m) => m && typeof m.id === 'string' && ids.has(m.id))
        .map((m) => ({ id: m.id, confidence: clamp01(Number(m.confidence)) }))
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 3)
    : [];

  return {
    source: 'llm',
    language: LANG_CODES.includes(out.language) ? out.language : null,
    crop: out.crop === 'chilli' ? 'chilli' : out.crop ? 'other' : 'unknown',
    stage: stages.has(out.stage) ? out.stage : 'unknown',
    symptoms: Array.isArray(out.symptoms) ? out.symptoms.filter((s) => keys.has(s)).slice(0, 8) : [],
    weather: weather.has(out.weather) ? out.weather : 'unknown',
    district: typeof out.district === 'string' ? out.district.slice(0, 40) : 'unknown',
    matches
  };
}

const server = http.createServer((req, res) => {
  const url = req.url || '/';

  if (url === '/api/health') {
    return sendJson(res, 200, { ok: true, llm: Boolean(process.env.OPENAI_API_KEY) });
  }
  if (url.startsWith('/api/extract')) {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'method_not_allowed' });
    return handleExtract(req, res).catch((err) => {
      console.error('[extract]', err);
      sendJson(res, 500, { error: 'server_error' });
    });
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'Method not allowed');
  return serveStatic(req, res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('Krishi Voice running at http://127.0.0.1:' + PORT);
  console.log('LLM extractor: ' + (process.env.OPENAI_API_KEY ? 'enabled' : 'not configured (local matcher only)'));
});
