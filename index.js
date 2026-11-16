const express = require('express');
const multer = require('multer');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');
const { execFileSync } = require('child_process');
const { createHmac, randomUUID } = require('crypto');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 7877;
const AGY_BIN = '/usr/local/bin/agy';
const CLAUDE_BIN = '/usr/bin/claude';
const SESSIONS_FILE = path.join(__dirname, 'sessions.json');
const CLAUDE_SESSIONS_FILE = path.join(__dirname, 'sessions-claude.json');
const USAGE_FILE = path.join(__dirname, 'usage.json');

app.use(express.json());
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} ${res.statusCode} ${ms}ms`);
  });
  next();
});
const upload = multer({ dest: os.tmpdir() });

// ── Constants ─────────────────────────────────────────────────────────────────

const MODEL_ENUM = [
  'flash_lite', 'flash', 'pro',
  'gemini-3.8-flash-high', 'gemini-3.8-flash-medium', 'gemini-3.8-flash-low',
  'claude-sonnet-4-6', 'claude-opus-4-6-thinking', 'gpt-oss-120b-medium',
];

const EFFORT_SUPPORTED_MODELS = new Set([
  'pro', 'gemini-3.8-flash-high', 'claude-sonnet-4-6', 'claude-opus-4-6-thinking',
]);

const EFFORT_ENUM = ['low', 'medium', 'high', 'xhigh', 'max'];

const CLAUDE_MODEL_ENUM = [
  'claude-fable-5',
  'claude-opus-4-8',
  'claude-sonnet-4-6',
  'claude-haiku-4-5-20251001',
];

const CLAUDE_EFFORT_ENUM = ['low', 'medium', 'high'];

const WEBHOOK_EVENTS = ['message.completed', 'session.created', 'session.deleted'];

// ── Usage tracking ────────────────────────────────────────────────────────────

function loadUsage() {
  try { return JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8')); }
  catch { return []; }
}

function trackUsage(entry) {
  const usage = loadUsage();
  usage.push({ ...entry, timestamp: new Date().toISOString() });
  // keep last 10,000 entries
  if (usage.length > 10000) usage.splice(0, usage.length - 10000);
  fs.writeFileSync(USAGE_FILE, JSON.stringify(usage));
}

// ── Session store ─────────────────────────────────────────────────────────────
/*
  Session shape:
  {
    conversationId: string | null,
    model: string | null,
    effort: string | null,
    metadata: object,
    webhooks: [ { url, events, hmac, retries, customHeaders } ],
    createdAt: ISO string,
    lastUsedAt: ISO string,
  }
*/

function loadSessions() {
  try { return JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8')); }
  catch { return {}; }
}

function saveSessions(s) {
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(s, null, 2));
}

// ── Webhook fire ──────────────────────────────────────────────────────────────

function buildWebhookPayload(event, sessionId, session, data) {
  return {
    id: `evt_${randomUUID().replace(/-/g, '').slice(0, 26)}`,
    timestamp: Date.now(),
    session: sessionId,
    metadata: session.metadata || {},
    event,
    payload: data,
    environment: { version: '1.0.0', engine: 'AGY' },
  };
}

function signPayload(body, secret) {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

async function fireWebhook(url, payload, webhookConfig) {
  const body = JSON.stringify(payload);
  const headers = { 'Content-Type': 'application/json' };

  if (webhookConfig.hmac?.key) {
    headers['X-Hub-Signature-256'] = signPayload(body, webhookConfig.hmac.key);
  }

  if (webhookConfig.customHeaders) {
    for (const h of webhookConfig.customHeaders) {
      headers[h.name] = h.value;
    }
  }

  const retries = webhookConfig.retries || { attempts: 1, delaySeconds: 2, policy: 'constant' };
  const maxAttempts = retries.attempts || 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, { method: 'POST', headers, body });
      if (res.ok) return;
      console.warn(`[webhook] ${url} → ${res.status} (attempt ${attempt}/${maxAttempts})`);
    } catch (err) {
      console.warn(`[webhook] ${url} error: ${err.message} (attempt ${attempt}/${maxAttempts})`);
    }

    if (attempt < maxAttempts) {
      const delay = calcDelay(retries, attempt) * 1000;
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

function calcDelay({ delaySeconds = 2, policy = 'constant' }, attempt) {
  if (policy === 'exponential') return delaySeconds * Math.pow(2, attempt - 1);
  if (policy === 'linear') return delaySeconds * attempt;
  return delaySeconds;
}

function emitEvent(event, sessionId, session, data) {
  if (!session.webhooks?.length) return;
  const payload = buildWebhookPayload(event, sessionId, session, data);
  for (const wh of session.webhooks) {
    if (!wh.events.includes(event) && !wh.events.includes('*')) continue;
    fireWebhook(wh.url, payload, wh).catch(() => {});
  }
}

// ── Swagger ───────────────────────────────────────────────────────────────────

/**
 * @swagger
 * components:
 *   schemas:
 *     HmacConfig:
 *       type: object
 *       properties:
 *         key:
 *           type: string
 *           example: your-secret-key
 *           description: Secret key for HMAC-SHA256 signing (X-Hub-Signature-256 header)
 *
 *     RetriesConfig:
 *       type: object
 *       properties:
 *         delaySeconds:
 *           type: number
 *           example: 2
 *         attempts:
 *           type: number
 *           example: 5
 *         policy:
 *           type: string
 *           enum: [constant, linear, exponential]
 *           example: linear
 *
 *     WebhookConfig:
 *       type: object
 *       required: [url, events]
 *       properties:
 *         url:
 *           type: string
 *           example: https://webhook.site/your-id
 *         events:
 *           type: array
 *           items:
 *             type: string
 *             enum: [message.completed, session.created, session.deleted, "*"]
 *           example: [message.completed, session.status]
 *         hmac:
 *           $ref: '#/components/schemas/HmacConfig'
 *         retries:
 *           $ref: '#/components/schemas/RetriesConfig'
 *         customHeaders:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               value:
 *                 type: string
 *           example: [{ "name": "Authorization", "value": "Bearer token123" }]
 *
 *     ChatParams:
 *       type: object
 *       required: [prompt]
 *       properties:
 *         prompt:
 *           type: string
 *           example: "Halo, siapa kamu?"
 *         model:
 *           type: string
 *           enum: [flash_lite, flash, pro, gemini-3.8-flash-high, gemini-3.8-flash-medium, gemini-3.8-flash-low, claude-sonnet-4-6, claude-opus-4-6-thinking, gpt-oss-120b-medium]
 *           description: "Effort hanya berlaku untuk: pro, gemini-3.8-flash-high, claude-sonnet-4-6, claude-opus-4-6-thinking"
 *         effort:
 *           type: string
 *           enum: [low, medium, high, xhigh, max]
 *
 *     WebhookPayload:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           example: evt_01aaaaaaaaaaaaaaaaaaaaaaaa
 *         timestamp:
 *           type: number
 *           example: 1734567890123
 *         session:
 *           type: string
 *         metadata:
 *           type: object
 *         event:
 *           type: string
 *           enum: [message.completed, session.created, session.deleted]
 *         payload:
 *           type: object
 *         environment:
 *           type: object
 */

const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'AGY API',
      version: '1.0.0',
      description: `REST API wrapper untuk AGY CLI (Antigravity)

**Webhook Events:**
- \`message.completed\` — AGY selesai memproses pesan
- \`session.created\` — session baru dibuat
- \`session.deleted\` — session dihapus

**Webhook Payload:**
\`\`\`json
{
  "id": "evt_01aaaaaaaaaaaaaaaaaaaaa",
  "timestamp": 1734567890123,
  "session": "user-123",
  "metadata": {},
  "event": "message.completed",
  "payload": { "output": "...", "conversationId": "...", "model": "...", "effort": "..." },
  "environment": { "version": "1.0.0", "engine": "AGY" }
}
\`\`\``,
    },
    tags: [
      { name: 'Sessions', description: 'AGY — 1 session = 1 conversation' },
      { name: 'Webhooks', description: 'AGY — webhook per session' },
      { name: 'Chat', description: 'AGY — single-turn tanpa session' },
      { name: 'Models', description: 'AGY — model yang tersedia' },
      { name: 'Claude', description: 'Claude CLI — sessions, chat, webhooks, file upload' },
    ],
  },
  apis: [__filename],
});

app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get('/openapi.json', (req, res) => res.json(swaggerSpec));
app.use('/', express.static(path.join(__dirname, 'public')));

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildArgs(base, { model, effort }) {
  const args = [...base];
  if (model) args.push('--model', model);
  if (effort && EFFORT_SUPPORTED_MODELS.has(model)) args.push('--effort', effort);
  return args;
}

const AGY_ENV = {
  ...process.env,
  DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS || 'unix:path=/run/user/1000/bus',
  XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || '/run/user/1000',
};

function runAgy(args) {
  console.log(`[agy] ${args.join(' ').slice(0, 120)}`);
  const model = args[args.indexOf('--model') + 1] || null;
  const effort = args[args.indexOf('--effort') + 1] || null;
  const start = Date.now();
  try {
    const output = execFileSync(AGY_BIN, args, {
      encoding: 'utf8', timeout: 120000, env: AGY_ENV,
    });
    trackUsage({ provider: 'agy', model, effort, status: 'success', ms: Date.now() - start });
    return { output: output.trim() };
  } catch (err) {
    const msg = err.stderr?.trim() || err.stdout?.trim() || err.message;
    console.error(`[agy] ERROR: ${msg.slice(0, 200)}`);
    const isQuota = msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED');
    trackUsage({ provider: 'agy', model, effort, status: isQuota ? 'quota' : 'error', ms: Date.now() - start });
    const error = new Error(msg);
    error.status = 500;
    throw error;
  }
}

// agy --output-format json returns: {"type":"result","result":"...","conversationId":"..."}
function runAgyJson(args) {
  const raw = runAgy(args);
  try {
    const lines = raw.output.trim().split('\n');
    // ambil baris JSON terakhir yang valid
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (line.startsWith('{')) {
        const parsed = JSON.parse(line);
        return {
          output: parsed.result || parsed.output || raw.output,
          conversationId: parsed.conversationId || parsed.conversation_id || null,
        };
      }
    }
  } catch {}
  return { output: raw.output, conversationId: null };
}

function errorHandler(err, req, res, next) {
  res.status(err.status || 500).json({ error: err.message });
}

function cleanupFile(p) { try { fs.unlinkSync(p); } catch {} }

function parseConversationId(output) {
  const jsonMatch = output.match(/\{.*\}/s);
  if (jsonMatch) {
    try {
      const p = JSON.parse(jsonMatch[0]);
      return p.id || p.conversation_id || p.conversationId || null;
    } catch {}
  }
  const lines = output.trim().split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (t && !t.includes(' ') && t.length > 8) return t;
  }
  return null;
}

function chatInSession(sessionId, prompt, model, effort, addDir = null) {
  const sessions = loadSessions();
  const session = sessions[sessionId];
  const now = new Date().toISOString();
  let result, conversationId, isNew;

  if (session) {
    const resolvedModel = model || session.model || null;
    const resolvedEffort = effort || session.effort || null;
    conversationId = session.conversationId;
    const base = conversationId
      ? (addDir ? ['-p', prompt, '--conversation', conversationId, '--add-dir', addDir] : ['-p', prompt, '--conversation', conversationId])
      : (addDir ? ['-p', prompt, '--add-dir', addDir] : ['-p', prompt]);
    base.push('--output-format', 'json');
    result = runAgyJson(buildArgs(base, { model: resolvedModel, effort: resolvedEffort }));
    if (model) sessions[sessionId].model = model;
    if (effort) sessions[sessionId].effort = effort;
    if (result.conversationId) sessions[sessionId].conversationId = result.conversationId;
    conversationId = sessions[sessionId].conversationId;
    isNew = false;
  } else {
    // Session baru: pakai agy -p biasa (BUKAN agentapi yang butuh LS)
    const base = addDir ? ['-p', prompt, '--add-dir', addDir] : ['-p', prompt];
    base.push('--output-format', 'json');
    result = runAgyJson(buildArgs(base, { model, effort }));
    conversationId = result.conversationId || null;
    sessions[sessionId] = {
      conversationId,
      model: model || null,
      effort: effort || null,
      metadata: {},
      webhooks: [],
      createdAt: now,
      lastUsedAt: now,
    };
    isNew = true;
    emitEvent('session.created', sessionId, sessions[sessionId], { conversationId });
  }

  sessions[sessionId].lastUsedAt = now;
  saveSessions(sessions);

  const finalModel = sessions[sessionId].model;
  const finalEffort = sessions[sessionId].effort;
  const responseData = { output: result.output, sessionId, conversationId, isNew, model: finalModel, effort: finalEffort };

  emitEvent('message.completed', sessionId, sessions[sessionId], {
    output: result.output, conversationId, model: finalModel, effort: finalEffort,
  });

  return responseData;
}

// ── Usage Endpoint ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /usage:
 *   get:
 *     summary: Statistik penggunaan API
 *     tags: [Models]
 *     parameters:
 *       - in: query
 *         name: provider
 *         schema:
 *           type: string
 *           enum: [agy, claude]
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *           default: 7
 *       - in: query
 *         name: raw
 *         schema:
 *           type: boolean
 *     responses:
 *       200:
 *         description: Statistik penggunaan
 */
app.get('/usage', (req, res) => {
  let entries = loadUsage();
  const days = parseInt(req.query.days) || 7;
  const since = new Date(Date.now() - days * 86400000).toISOString();

  entries = entries.filter(e => e.timestamp >= since);
  if (req.query.provider) entries = entries.filter(e => e.provider === req.query.provider);
  if (req.query.raw === 'true') return res.json(entries);

  const byStatus = {}, byProvider = {}, byModel = {}, byDay = {};

  for (const e of entries) {
    byStatus[e.status] = (byStatus[e.status] || 0) + 1;
    byProvider[e.provider] = (byProvider[e.provider] || 0) + 1;
    if (e.model) byModel[e.model] = (byModel[e.model] || 0) + 1;
    const day = e.timestamp.slice(0, 10);
    if (!byDay[day]) byDay[day] = { total: 0, success: 0, error: 0, quota: 0 };
    byDay[day].total++;
    byDay[day][e.status] = (byDay[day][e.status] || 0) + 1;
  }

  const msEntries = entries.filter(e => e.ms);
  const avgMs = msEntries.length
    ? Math.round(msEntries.reduce((s, e) => s + e.ms, 0) / msEntries.length)
    : 0;

  res.json({
    period: `last ${days} days`,
    total: entries.length,
    avgResponseMs: avgMs,
    byStatus,
    byProvider,
    byModel,
    byDay,
  });
});

// ── Models ────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /models:
 *   get:
 *     summary: List model yang tersedia
 *     tags: [Models]
 *     responses:
 *       200:
 *         description: Daftar model dan effort levels
 */
app.get('/models', (req, res, next) => {
  try {
    const raw = execFileSync(AGY_BIN, ['models'], { encoding: 'utf8', timeout: 10000, env: AGY_ENV });
    const models = raw.trim().split('\n').map(line => {
      const [id, ...nameParts] = line.trim().split('\t');
      return { id, name: nameParts.join(' ').trim(), supportsEffort: EFFORT_SUPPORTED_MODELS.has(id) };
    }).filter(m => m.id);
    res.json({ models, effortLevels: EFFORT_ENUM });
  } catch (err) { next(err); }
});

// ── Sessions ──────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /sessions:
 *   get:
 *     summary: List semua session
 *     tags: [Sessions]
 *     responses:
 *       200:
 *         description: Daftar session
 */
app.get('/sessions', (req, res) => res.json(loadSessions()));

/**
 * @swagger
 * /sessions/{sessionId}:
 *   get:
 *     summary: Get info session (termasuk webhook config)
 *     tags: [Sessions]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *         example: user-123
 *     responses:
 *       200:
 *         description: Info session
 *       404:
 *         description: Session tidak ditemukan
 */
app.get('/sessions/:sessionId', (req, res) => {
  const session = loadSessions()[req.params.sessionId];
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(session);
});

/**
 * @swagger
 * /sessions/{sessionId}:
 *   delete:
 *     summary: Hapus session (reset conversation)
 *     tags: [Sessions]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Session dihapus
 */
app.delete('/sessions/:sessionId', (req, res) => {
  const sessions = loadSessions();
  const session = sessions[req.params.sessionId];
  if (!session) return res.status(404).json({ error: 'Session not found' });
  emitEvent('session.deleted', req.params.sessionId, session, {});
  delete sessions[req.params.sessionId];
  saveSessions(sessions);
  res.json({ message: 'Session deleted' });
});

// ── Webhooks ──────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /sessions/{sessionId}/webhooks:
 *   get:
 *     summary: Get webhook config session ini
 *     tags: [Webhooks]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Daftar webhook
 *       404:
 *         description: Session tidak ditemukan
 */
app.get('/sessions/:sessionId/webhooks', (req, res) => {
  const session = loadSessions()[req.params.sessionId];
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(session.webhooks || []);
});

/**
 * @swagger
 * /sessions/{sessionId}/webhooks:
 *   put:
 *     summary: Set webhook untuk session (replace semua)
 *     description: |
 *       Set webhook config. Payload dikirim ke URL yang dikonfigurasi saat event terjadi.
 *
 *       **Contoh payload yang diterima webhook:**
 *       ```json
 *       {
 *         "id": "evt_01aaaaaaaaaaaaaaaaaaaaaaaa",
 *         "timestamp": 1734567890123,
 *         "session": "user-123",
 *         "metadata": {},
 *         "event": "message.completed",
 *         "payload": { "output": "Halo!", "conversationId": "abc", "model": "claude-sonnet-4-6", "effort": "high" },
 *         "environment": { "version": "1.0.0", "engine": "AGY" }
 *       }
 *       ```
 *     tags: [Webhooks]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: array
 *             items:
 *               $ref: '#/components/schemas/WebhookConfig'
 *           example:
 *             - url: https://webhook.site/your-id
 *               events: [message.completed, session.created, session.deleted]
 *               hmac:
 *                 key: your-secret
 *               retries:
 *                 attempts: 3
 *                 delaySeconds: 2
 *                 policy: linear
 *     responses:
 *       200:
 *         description: Webhook disimpan
 */
app.put('/sessions/:sessionId/webhooks', (req, res) => {
  const sessions = loadSessions();
  if (!sessions[req.params.sessionId]) return res.status(404).json({ error: 'Session not found' });
  sessions[req.params.sessionId].webhooks = req.body;
  saveSessions(sessions);
  res.json({ message: 'Webhooks updated', webhooks: req.body });
});

/**
 * @swagger
 * /sessions/{sessionId}/webhooks:
 *   delete:
 *     summary: Hapus semua webhook dari session
 *     tags: [Webhooks]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Webhook dihapus
 */
app.delete('/sessions/:sessionId/webhooks', (req, res) => {
  const sessions = loadSessions();
  if (!sessions[req.params.sessionId]) return res.status(404).json({ error: 'Session not found' });
  sessions[req.params.sessionId].webhooks = [];
  saveSessions(sessions);
  res.json({ message: 'Webhooks cleared' });
});

/**
 * @swagger
 * /sessions/{sessionId}/webhooks/test:
 *   post:
 *     summary: Test webhook — kirim dummy payload ke semua webhook
 *     tags: [Webhooks]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Test payload dikirim
 */
app.post('/sessions/:sessionId/webhooks/test', async (req, res) => {
  const sessions = loadSessions();
  const session = sessions[req.params.sessionId];
  if (!session) return res.status(404).json({ error: 'Session not found' });
  emitEvent('message.completed', req.params.sessionId, session, {
    output: 'Test webhook dari AGY API',
    conversationId: session.conversationId,
    model: session.model,
    effort: session.effort,
  });
  res.json({ message: 'Test event fired', webhooks: session.webhooks?.length || 0 });
});

// ── Session Chat ──────────────────────────────────────────────────────────────

/**
 * @swagger
 * /sessions/{sessionId}/chat:
 *   post:
 *     summary: Chat dalam session — baru otomatis dibuat, lama dilanjutkan
 *     description: Session baru → buat conversation. Session lama → resume. Setelah selesai, event `message.completed` dikirim ke webhook.
 *     tags: [Sessions]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *         example: user-123
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ChatParams'
 *     responses:
 *       200:
 *         description: Response dari AGY
 */
app.post('/sessions/:sessionId/chat', (req, res, next) => {
  try {
    const { prompt, model, effort } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt required' });
    res.json(chatInSession(req.params.sessionId, prompt, model, effort));
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /sessions/{sessionId}/chat/file:
 *   post:
 *     summary: Chat dalam session dengan file atau image
 *     tags: [Sessions]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [prompt, file]
 *             properties:
 *               prompt:
 *                 type: string
 *               model:
 *                 type: string
 *                 enum: [flash_lite, flash, pro, gemini-3.8-flash-high, gemini-3.8-flash-medium, gemini-3.8-flash-low, claude-sonnet-4-6, claude-opus-4-6-thinking, gpt-oss-120b-medium]
 *               effort:
 *                 type: string
 *                 enum: [low, medium, high, xhigh, max]
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Response dari AGY
 */
app.post('/sessions/:sessionId/chat/file', upload.single('file'), (req, res, next) => {
  try {
    const { prompt, model, effort } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt required' });
    if (!req.file) return res.status(400).json({ error: 'file required' });

    const destPath = path.join(os.tmpdir(), req.file.originalname);
    fs.renameSync(req.file.path, destPath);
    try {
      const filePrompt = `${prompt}\n\nFile tersedia di: ${destPath}`;
      res.json(chatInSession(req.params.sessionId, filePrompt, model, effort, os.tmpdir()));
    } finally {
      cleanupFile(destPath);
    }
  } catch (err) { next(err); }
});

// ── Stateless Chat ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /chat:
 *   post:
 *     summary: Single-turn chat tanpa session
 *     tags: [Chat]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ChatParams'
 *     responses:
 *       200:
 *         description: Response dari AGY
 */
app.post('/chat', (req, res, next) => {
  try {
    const { prompt, model, effort } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt required' });
    res.json(runAgy(buildArgs(['-p', prompt], { model, effort })));
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /chat/file:
 *   post:
 *     summary: Single-turn chat dengan file atau image
 *     tags: [Chat]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [prompt, file]
 *             properties:
 *               prompt:
 *                 type: string
 *               model:
 *                 type: string
 *               effort:
 *                 type: string
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Response dari AGY
 */
app.post('/chat/file', upload.single('file'), (req, res, next) => {
  try {
    const { prompt, model, effort } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt required' });
    if (!req.file) return res.status(400).json({ error: 'file required' });

    const destPath = path.join(os.tmpdir(), req.file.originalname);
    fs.renameSync(req.file.path, destPath);
    try {
      res.json(runAgy(buildArgs(['-p', prompt, '--add-dir', os.tmpdir()], { model, effort })));
    } finally {
      cleanupFile(destPath);
    }
  } catch (err) { next(err); }
});

// ════════════════════════════════════════════════════════════════════════════
// CLAUDE CLI
// ════════════════════════════════════════════════════════════════════════════

function loadClaudeSessions() {
  try { return JSON.parse(fs.readFileSync(CLAUDE_SESSIONS_FILE, 'utf8')); }
  catch { return {}; }
}

function saveClaudeSessions(s) {
  fs.writeFileSync(CLAUDE_SESSIONS_FILE, JSON.stringify(s, null, 2));
}

function runClaude(args) {
  console.log(`[claude] ${args.join(' ').slice(0, 120)}`);
  const model = args[args.indexOf('--model') + 1] || null;
  const effort = args[args.indexOf('--effort') + 1] || null;
  const start = Date.now();
  try {
    const output = execFileSync(CLAUDE_BIN, args, {
      encoding: 'utf8', timeout: 120000, env: { ...process.env },
    });
    trackUsage({ provider: 'claude', model, effort, status: 'success', ms: Date.now() - start });
    return { output: output.trim() };
  } catch (err) {
    const msg = err.stderr?.trim() || err.stdout?.trim() || err.message;
    console.error(`[claude] ERROR: ${msg.slice(0, 200)}`);
    trackUsage({ provider: 'claude', model, effort, status: 'error', ms: Date.now() - start });
    const error = new Error(msg);
    error.status = 500;
    throw error;
  }
}

function runClaudeJson(args) {
  const raw = runClaude(args);
  try {
    const lines = raw.output.trim().split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (line.startsWith('{')) {
        const parsed = JSON.parse(line);
        // Claude JSON output: { type, subtype, result, session_id, ... }
        const output = parsed.result ?? parsed.output ?? raw.output;
        const sessionId = parsed.session_id ?? parsed.sessionId ?? null;
        return { output, sessionId };
      }
    }
  } catch {}
  return { output: raw.output, sessionId: null };
}

function buildClaudeArgs(base, { model, effort }) {
  const args = [...base];
  if (model) args.push('--model', model);
  if (effort) args.push('--effort', effort);
  return args;
}

function emitClaudeEvent(event, sessionId, session, data) {
  if (!session.webhooks?.length) return;
  const payload = buildWebhookPayload(event, sessionId, session, data);
  for (const wh of session.webhooks) {
    if (!wh.events.includes(event) && !wh.events.includes('*')) continue;
    fireWebhook(wh.url, payload, wh).catch(() => {});
  }
}

function chatInClaudeSession(sessionId, prompt, model, effort, addDir = null) {
  const sessions = loadClaudeSessions();
  const session = sessions[sessionId];
  const now = new Date().toISOString();
  let result, claudeSessionId, isNew;

  if (session) {
    const resolvedModel = model || session.model || null;
    const resolvedEffort = effort || session.effort || null;
    claudeSessionId = session.sessionId;
    const base = claudeSessionId
      ? (addDir ? ['-p', prompt, '--resume', claudeSessionId, '--add-dir', addDir] : ['-p', prompt, '--resume', claudeSessionId])
      : (addDir ? ['-p', prompt, '--add-dir', addDir] : ['-p', prompt]);
    base.push('--output-format', 'json');
    result = runClaudeJson(buildClaudeArgs(base, { model: resolvedModel, effort: resolvedEffort }));
    if (result.sessionId) sessions[sessionId].sessionId = result.sessionId;
    if (model) sessions[sessionId].model = model;
    if (effort) sessions[sessionId].effort = effort;
    claudeSessionId = sessions[sessionId].sessionId;
    isNew = false;
  } else {
    const base = addDir ? ['-p', prompt, '--add-dir', addDir] : ['-p', prompt];
    base.push('--output-format', 'json');
    result = runClaudeJson(buildClaudeArgs(base, { model, effort }));
    claudeSessionId = result.sessionId || null;
    sessions[sessionId] = {
      sessionId: claudeSessionId,
      model: model || null,
      effort: effort || null,
      metadata: {},
      webhooks: [],
      createdAt: now,
      lastUsedAt: now,
    };
    isNew = true;
    emitClaudeEvent('session.created', sessionId, sessions[sessionId], { sessionId: claudeSessionId });
  }

  sessions[sessionId].lastUsedAt = now;
  saveClaudeSessions(sessions);

  const finalModel = sessions[sessionId].model;
  const finalEffort = sessions[sessionId].effort;
  const responseData = { output: result.output, sessionId: claudeSessionId, appSessionId: sessionId, isNew, model: finalModel, effort: finalEffort };

  emitClaudeEvent('message.completed', sessionId, sessions[sessionId], {
    output: result.output, sessionId: claudeSessionId, model: finalModel, effort: finalEffort,
  });

  return responseData;
}

// ── Claude Models ─────────────────────────────────────────────────────────────

/**
 * @swagger
 * /claude/models:
 *   get:
 *     summary: List model Claude yang tersedia
 *     tags: [Claude]
 *     responses:
 *       200:
 *         description: Daftar model Claude
 */
app.get('/claude/models', (req, res) => {
  res.json({
    models: CLAUDE_MODEL_ENUM.map(id => ({
      id,
      name: id.replace('claude-', '').replace(/-\d{8}$/, '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    })),
    effortLevels: CLAUDE_EFFORT_ENUM,
  });
});

// ── Claude Sessions ───────────────────────────────────────────────────────────

/**
 * @swagger
 * /claude/sessions:
 *   get:
 *     summary: List semua Claude session
 *     tags: [Claude]
 *     responses:
 *       200:
 *         description: Daftar session
 */
app.get('/claude/sessions', (req, res) => res.json(loadClaudeSessions()));

/**
 * @swagger
 * /claude/sessions/{sessionId}:
 *   get:
 *     summary: Get info Claude session
 *     tags: [Claude]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *         example: user-123
 *     responses:
 *       200:
 *         description: Info session
 *       404:
 *         description: Session tidak ditemukan
 */
app.get('/claude/sessions/:sessionId', (req, res) => {
  const session = loadClaudeSessions()[req.params.sessionId];
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(session);
});

/**
 * @swagger
 * /claude/sessions/{sessionId}:
 *   delete:
 *     summary: Hapus Claude session
 *     tags: [Claude]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Session dihapus
 */
app.delete('/claude/sessions/:sessionId', (req, res) => {
  const sessions = loadClaudeSessions();
  const session = sessions[req.params.sessionId];
  if (!session) return res.status(404).json({ error: 'Session not found' });
  emitClaudeEvent('session.deleted', req.params.sessionId, session, {});
  delete sessions[req.params.sessionId];
  saveClaudeSessions(sessions);
  res.json({ message: 'Session deleted' });
});

// ── Claude Webhooks ───────────────────────────────────────────────────────────

/**
 * @swagger
 * /claude/sessions/{sessionId}/webhooks:
 *   get:
 *     summary: Get webhook config Claude session
 *     tags: [Claude]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Daftar webhook
 */
app.get('/claude/sessions/:sessionId/webhooks', (req, res) => {
  const session = loadClaudeSessions()[req.params.sessionId];
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(session.webhooks || []);
});

/**
 * @swagger
 * /claude/sessions/{sessionId}/webhooks:
 *   put:
 *     summary: Set webhook untuk Claude session
 *     tags: [Claude]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: array
 *             items:
 *               $ref: '#/components/schemas/WebhookConfig'
 *     responses:
 *       200:
 *         description: Webhook disimpan
 */
app.put('/claude/sessions/:sessionId/webhooks', (req, res) => {
  const sessions = loadClaudeSessions();
  if (!sessions[req.params.sessionId]) return res.status(404).json({ error: 'Session not found' });
  sessions[req.params.sessionId].webhooks = req.body;
  saveClaudeSessions(sessions);
  res.json({ message: 'Webhooks updated', webhooks: req.body });
});

/**
 * @swagger
 * /claude/sessions/{sessionId}/webhooks:
 *   delete:
 *     summary: Hapus semua webhook Claude session
 *     tags: [Claude]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Webhook dihapus
 */
app.delete('/claude/sessions/:sessionId/webhooks', (req, res) => {
  const sessions = loadClaudeSessions();
  if (!sessions[req.params.sessionId]) return res.status(404).json({ error: 'Session not found' });
  sessions[req.params.sessionId].webhooks = [];
  saveClaudeSessions(sessions);
  res.json({ message: 'Webhooks cleared' });
});

/**
 * @swagger
 * /claude/sessions/{sessionId}/webhooks/test:
 *   post:
 *     summary: Test webhook Claude session
 *     tags: [Claude]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Test payload dikirim
 */
app.post('/claude/sessions/:sessionId/webhooks/test', (req, res) => {
  const sessions = loadClaudeSessions();
  const session = sessions[req.params.sessionId];
  if (!session) return res.status(404).json({ error: 'Session not found' });
  emitClaudeEvent('message.completed', req.params.sessionId, session, {
    output: 'Test webhook dari Claude API', sessionId: session.sessionId,
    model: session.model, effort: session.effort,
  });
  res.json({ message: 'Test event fired', webhooks: session.webhooks?.length || 0 });
});

// ── Claude Chat ───────────────────────────────────────────────────────────────

/**
 * @swagger
 * /claude/sessions/{sessionId}/chat:
 *   post:
 *     summary: Chat dengan Claude dalam session
 *     description: Session baru otomatis dibuat, lama dilanjutkan via `--resume`. Setelah selesai event `message.completed` dikirim ke webhook.
 *     tags: [Claude]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *         example: user-123
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [prompt]
 *             properties:
 *               prompt:
 *                 type: string
 *                 example: "Halo Claude!"
 *               model:
 *                 type: string
 *                 enum: [claude-fable-5, claude-opus-4-8, claude-sonnet-4-6, claude-haiku-4-5-20251001]
 *               effort:
 *                 type: string
 *                 enum: [low, medium, high]
 *     responses:
 *       200:
 *         description: Response dari Claude
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 output:
 *                   type: string
 *                 sessionId:
 *                   type: string
 *                   description: Claude internal session ID (untuk --resume)
 *                 appSessionId:
 *                   type: string
 *                   description: Session ID yang kamu tentukan
 *                 isNew:
 *                   type: boolean
 *                 model:
 *                   type: string
 *                 effort:
 *                   type: string
 */
app.post('/claude/sessions/:sessionId/chat', (req, res, next) => {
  try {
    const { prompt, model, effort } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt required' });
    res.json(chatInClaudeSession(req.params.sessionId, prompt, model, effort));
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /claude/sessions/{sessionId}/chat/file:
 *   post:
 *     summary: Chat dengan Claude dalam session + file atau image
 *     tags: [Claude]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [prompt, file]
 *             properties:
 *               prompt:
 *                 type: string
 *               model:
 *                 type: string
 *                 enum: [claude-fable-5, claude-opus-4-8, claude-sonnet-4-6, claude-haiku-4-5-20251001]
 *               effort:
 *                 type: string
 *                 enum: [low, medium, high]
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Response dari Claude
 */
app.post('/claude/sessions/:sessionId/chat/file', upload.single('file'), (req, res, next) => {
  try {
    const { prompt, model, effort } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt required' });
    if (!req.file) return res.status(400).json({ error: 'file required' });
    const destPath = path.join(os.tmpdir(), req.file.originalname);
    fs.renameSync(req.file.path, destPath);
    try {
      const filePrompt = `${prompt}\n\nFile tersedia di: ${destPath}`;
      res.json(chatInClaudeSession(req.params.sessionId, filePrompt, model, effort, os.tmpdir()));
    } finally {
      cleanupFile(destPath);
    }
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /claude/chat:
 *   post:
 *     summary: Single-turn chat dengan Claude tanpa session
 *     tags: [Claude]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [prompt]
 *             properties:
 *               prompt:
 *                 type: string
 *               model:
 *                 type: string
 *                 enum: [claude-fable-5, claude-opus-4-8, claude-sonnet-4-6, claude-haiku-4-5-20251001]
 *               effort:
 *                 type: string
 *                 enum: [low, medium, high]
 *     responses:
 *       200:
 *         description: Response dari Claude
 */
app.post('/claude/chat', (req, res, next) => {
  try {
    const { prompt, model, effort } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt required' });
    res.json(runClaude(buildClaudeArgs(['-p', prompt], { model, effort })));
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /claude/chat/file:
 *   post:
 *     summary: Single-turn chat dengan Claude + file atau image
 *     tags: [Claude]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [prompt, file]
 *             properties:
 *               prompt:
 *                 type: string
 *               model:
 *                 type: string
 *               effort:
 *                 type: string
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Response dari Claude
 */
app.post('/claude/chat/file', upload.single('file'), (req, res, next) => {
  try {
    const { prompt, model, effort } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt required' });
    if (!req.file) return res.status(400).json({ error: 'file required' });
    const destPath = path.join(os.tmpdir(), req.file.originalname);
    fs.renameSync(req.file.path, destPath);
    try {
      res.json(runClaude(buildClaudeArgs(['-p', prompt, '--add-dir', os.tmpdir()], { model, effort })));
    } finally {
      cleanupFile(destPath);
    }
  } catch (err) { next(err); }
});

// ── Quota ─────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /quota:
 *   get:
 *     summary: Quota status AGY dan Claude CLI
 *     description: |
 *       Mengembalikan sisa quota mingguan per model group untuk AGY (Antigravity),
 *       dan quota sesi/mingguan untuk Claude CLI.
 *
 *       **AGY groups:**
 *       - `Gemini Models` — Gemini 3.8 Flash
 *       - `Claude and GPT models` — Claude Sonnet 4.6, Claude Opus 4.6, GPT-OSS 120B
 *
 *       **Claude:**
 *       - `sessionPercentUsed` — % terpakai di sesi Claude CLI aktif
 *       - `weeklyPercentUsed` — % terpakai minggu ini (semua model)
 *       - `totalCostUsd` — total biaya (subscription plan → $0)
 *     tags: [Models]
 *     responses:
 *       200:
 *         description: Quota status berhasil diambil
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 agy:
 *                   type: object
 *                   properties:
 *                     account:
 *                       type: string
 *                       example: kikil.cmh@gmail.com
 *                     description:
 *                       type: string
 *                     groups:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           name:
 *                             type: string
 *                             example: Gemini Models
 *                           description:
 *                             type: string
 *                             example: "Models within this group: Gemini 3.8 Flash"
 *                           buckets:
 *                             type: array
 *                             items:
 *                               type: object
 *                               properties:
 *                                 id:
 *                                   type: string
 *                                   example: gemini-weekly
 *                                 name:
 *                                   type: string
 *                                   example: Weekly Limit Remaining
 *                                 window:
 *                                   type: string
 *                                   example: weekly
 *                                 percentRemaining:
 *                                   type: number
 *                                   example: 8.41
 *                                   description: Persentase quota yang tersisa (0–100)
 *                                 remainingFraction:
 *                                   type: number
 *                                   example: 0.0841
 *                                   description: Fraction 0–1
 *                                 resetTime:
 *                                   type: string
 *                                   format: date-time
 *                                   example: "2026-11-22T18:15:30Z"
 *                                 description:
 *                                   type: string
 *                                   example: "You have used some of your weekly limit, it will fully refresh in 6 days, 7 hours."
 *                 claude:
 *                   type: object
 *                   properties:
 *                     sessionPercentUsed:
 *                       type: number
 *                       example: 23
 *                       description: Persen terpakai di sesi Claude CLI saat ini
 *                     weeklyPercentUsed:
 *                       type: number
 *                       example: 21
 *                       description: Persen terpakai minggu ini (semua model)
 *                     weeklyFablePercentUsed:
 *                       type: number
 *                       nullable: true
 *                       example: 0
 *                       description: Persen terpakai minggu ini untuk model Fable (null jika tidak ada data)
 *                     totalCostUsd:
 *                       type: number
 *                       example: 0.81
 *                     raw:
 *                       type: string
 *                       description: Teks mentah dari Claude /usage
 *                 errors:
 *                   type: object
 *                   description: Ada jika salah satu provider gagal diambil
 *                   properties:
 *                     agy:
 *                       type: string
 *                     claude:
 *                       type: string
 *             example:
 *               agy:
 *                 account: kikil.cmh@gmail.com
 *                 groups:
 *                   - name: Gemini Models
 *                     description: "Models within this group: Gemini 3.8 Flash"
 *                     buckets:
 *                       - id: gemini-weekly
 *                         name: Weekly Limit Remaining
 *                         window: weekly
 *                         percentRemaining: 0
 *                         remainingFraction: 0
 *                         resetTime: "2026-11-21T05:57:24Z"
 *                   - name: Claude and GPT models
 *                     description: "Models within this group: Claude Sonnet 4.6, Claude Opus 4.6, GPT-OSS 120B"
 *                     buckets:
 *                       - id: 3p-weekly
 *                         name: Weekly Limit Remaining
 *                         window: weekly
 *                         percentRemaining: 8.41
 *                         remainingFraction: 0.0841
 *                         resetTime: "2026-11-22T18:15:30Z"
 *               claude:
 *                 sessionPercentUsed: 23
 *                 weeklyPercentUsed: 21
 *                 weeklyFablePercentUsed: null
 *                 totalCostUsd: 0
 */
app.get('/quota', async (req, res, next) => {
  const result = { agy: null, claude: null, errors: {} };

  // AGY quota via /quota slash command
  try {
    const raw = execFileSync(AGY_BIN, ['--output-format', 'json', '-p=/quota'], {
      encoding: 'utf8', timeout: 15000, env: AGY_ENV,
    });
    const lines = raw.trim().split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (line.startsWith('{')) {
        const parsed = JSON.parse(line);
        const data = parsed?.command?.data;
        if (data?.groups) {
          result.agy = {
            account: 'kikil.cmh@gmail.com',
            description: data.description || '',
            groups: data.groups.map(g => ({
              name: g.name,
              description: g.description || '',
              buckets: (g.buckets || []).map(b => ({
                id: b.id,
                name: b.name,
                window: b.window,
                percentRemaining: Math.round((b.remaining_fraction || 0) * 10000) / 100,
                remainingFraction: b.remaining_fraction || 0,
                resetTime: b.reset_time || null,
                description: b.description || '',
              })),
            })),
          };
          break;
        }
      }
    }
  } catch (err) {
    result.errors.agy = err.message.slice(0, 200);
  }

  // Claude quota via /usage slash command
  try {
    const raw = execFileSync(CLAUDE_BIN, ['--output-format', 'json', '-p', '/usage'], {
      encoding: 'utf8', timeout: 15000, env: AGY_ENV,
    });
    const parsed = JSON.parse(raw.trim());
    const text = parsed.result || '';
    const totalCostUsd = parsed.total_cost_usd ?? null;

    const sessionMatch = text.match(/Current session:\s*([\d.]+)%\s+used/i);
    const weeklyMatch = text.match(/Current week \(all models\):\s*([\d.]+)%\s+used/i);
    const fableMatch = text.match(/Current week \(Fable\):\s*([\d.]+)%\s+used/i);

    result.claude = {
      sessionPercentUsed: sessionMatch ? parseFloat(sessionMatch[1]) : null,
      weeklyPercentUsed: weeklyMatch ? parseFloat(weeklyMatch[1]) : null,
      weeklyFablePercentUsed: fableMatch ? parseFloat(fableMatch[1]) : null,
      totalCostUsd,
      raw: text,
    };
  } catch (err) {
    result.errors.claude = err.message.slice(0, 200);
  }

  if (Object.keys(result.errors).length === 0) delete result.errors;
  res.json(result);
});

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`AGY API    : http://localhost:${PORT}`);
  console.log(`Swagger UI : http://localhost:${PORT}/docs`);
});
