# AGY OpenAPI

> REST API wrapper for **AGY CLI** (Antigravity / Gemini) and **Claude CLI** — inspired by [Waha](https://waha.devlike.pro/).  
> Session-based conversations, file uploads, webhooks, quota monitoring, and a built-in dashboard.

---

## Features

| Feature | Description |
|---|---|
| **Session memory** | 1 session = 1 persistent conversation. Resume anytime via `--conversation` / `--resume`. |
| **Multi-provider** | AGY (Gemini, Claude via AGY, GPT) and Claude CLI on the same server. |
| **File / image upload** | Attach files to any chat message via multipart form. |
| **Webhooks** | Per-session webhooks with HMAC-SHA256 signing, retry policies, custom headers. |
| **Quota monitoring** | Real-time weekly quota from AGY and Claude CLI — via `/quota` endpoint. |
| **Usage tracking** | Rolling log of every API call with status, model, latency, aggregated by day. |
| **Swagger UI** | Full OpenAPI 3.0 docs at `/docs`. |
| **Dashboard** | Dark-themed SPA at `/` — Sessions, Usage, Quota pages. |

---

## Quick Start

```bash
# Install dependencies
cd /home/runia/agy-openapi
npm install

# Start server
node index.js

# API:       http://localhost:7877
# Dashboard: http://localhost:7877/
# Swagger:   http://localhost:7877/docs
```

**Requirements**
- `agy` binary at `/usr/local/bin/agy` (Antigravity CLI)
- `claude` binary at `/usr/bin/claude` (Claude Code CLI)
- `antigravity-cli-daemon.service` running (`systemctl --user start antigravity-cli-daemon`)
- Node.js 18+

---

## Dashboard

Access at **`http://localhost:7877/`**

Three pages via the top navigation:

| Page | Description |
|---|---|
| **Sessions** | Create, select, and chat with sessions. Provider switcher (AGY / Claude). Webhook config per session. |
| **Usage** | API call statistics — total calls, avg response, by status/model/provider, per-day table. |
| **Quota** | Weekly quota remaining for each AGY model group and Claude CLI. |

---

## API Reference

Base URL: `http://localhost:7877`

### AGY Sessions

```
GET    /sessions                       List all sessions
GET    /sessions/:id                   Get session info
DELETE /sessions/:id                   Delete session (resets conversation)

POST   /sessions/:id/chat              Chat in session
POST   /sessions/:id/chat/file         Chat with file attachment

GET    /sessions/:id/webhooks          Get webhook config
PUT    /sessions/:id/webhooks          Set webhook config
DELETE /sessions/:id/webhooks          Clear webhooks
POST   /sessions/:id/webhooks/test     Fire test webhook event
```

### Claude Sessions

Same endpoints under `/claude/`:

```
POST   /claude/sessions/:id/chat
POST   /claude/sessions/:id/chat/file
GET    /claude/sessions/:id/webhooks
PUT    /claude/sessions/:id/webhooks
...
```

### Models

```
GET    /models         AGY models + effort levels
GET    /claude/models  Claude models
```

### Stateless Chat

```
POST   /chat           Single-turn AGY (no session)
POST   /chat/file      Single-turn AGY with file
POST   /claude/chat    Single-turn Claude
POST   /claude/chat/file
```

### Monitoring

```
GET    /usage          Usage statistics (query: ?days=7&provider=agy&raw=true)
GET    /quota          Quota status — AGY model groups + Claude CLI
```

---

## Chat Request

```bash
curl -X POST http://localhost:7877/sessions/my-session/chat \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Halo! Siapa kamu?",
    "model": "gemini-3.8-flash-low",
    "effort": "low"
  }'
```

**Response:**
```json
{
  "output": "Halo! Aku adalah ...",
  "sessionId": "my-session",
  "conversationId": "abc-123-def",
  "isNew": true,
  "model": "gemini-3.8-flash-low",
  "effort": "low"
}
```

### File Upload

```bash
curl -X POST http://localhost:7877/sessions/my-session/chat/file \
  -F "prompt=Analisis gambar ini" \
  -F "file=@screenshot.png"
```

---

## Webhooks

Each session can have a webhook. Configure via API or the dashboard.

```bash
curl -X PUT http://localhost:7877/sessions/my-session/webhooks \
  -H "Content-Type: application/json" \
  -d '[{
    "url": "https://webhook.site/your-id",
    "events": ["message.completed"],
    "hmac": { "key": "your-secret" },
    "retries": { "attempts": 3, "delaySeconds": 2, "policy": "linear" },
    "customHeaders": [{ "name": "Authorization", "value": "Bearer token" }]
  }]'
```

### Events

| Event | Fired when |
|---|---|
| `message.completed` | AGY/Claude finishes generating a response |
| `session.created` | A new session is created |
| `session.deleted` | A session is deleted |
| `*` | All events |

### Webhook Payload

```json
{
  "id": "evt_01aaaaaaaaaaaaaaaaaaaaaaaa",
  "timestamp": 1734567890123,
  "session": "my-session",
  "metadata": {},
  "event": "message.completed",
  "payload": {
    "output": "Response dari AGY...",
    "conversationId": "abc-123",
    "model": "gemini-3.8-flash-low",
    "effort": "low"
  },
  "environment": { "version": "1.0.0", "engine": "AGY" }
}
```

HMAC signature is in the `X-Hub-Signature-256` header: `sha256=<hex>`.

---

## Models

### AGY

| ID | Name | Effort |
|---|---|---|
| `gemini-3.8-flash-low` | Gemini 3.8 Flash (Low) | — |
| `gemini-3.8-flash-medium` | Gemini 3.8 Flash (Medium) | — |
| `gemini-3.8-flash-high` | Gemini 3.8 Flash (High) | ✓ |
| `claude-sonnet-4-6` | Claude Sonnet 4.6 (Thinking) | ✓ |
| `claude-opus-4-6-thinking` | Claude Opus 4.6 (Thinking) | ✓ |
| `gpt-oss-120b-medium` | GPT-OSS 120B (Medium) | — |

Effort levels: `low` · `medium` · `high` · `xhigh` · `max`  
Default model: `gemini-3.8-flash-low`, default effort: `low`

### Claude CLI

| ID | Name |
|---|---|
| `claude-haiku-4-5-20251001` | Claude Haiku 4.5 |
| `claude-sonnet-4-6` | Claude Sonnet 4.6 |
| `claude-opus-4-8` | Claude Opus 4.8 |
| `claude-fable-5` | Claude Fable 5 |

---

## Quota

```bash
curl http://localhost:7877/quota
```

```json
{
  "agy": {
    "account": "kikil.cmh@gmail.com",
    "groups": [
      {
        "name": "Gemini Models",
        "description": "Models within this group: Gemini 3.8 Flash",
        "buckets": [{
          "id": "gemini-weekly",
          "name": "Weekly Limit Remaining",
          "window": "weekly",
          "percentRemaining": 0,
          "remainingFraction": 0,
          "resetTime": "2026-11-21T05:57:24Z",
          "description": "You have hit your weekly limit..."
        }]
      },
      {
        "name": "Claude and GPT models",
        "buckets": [{
          "id": "3p-weekly",
          "percentRemaining": 8.41,
          "resetTime": "2026-11-22T18:15:30Z"
        }]
      }
    ]
  },
  "claude": {
    "sessionPercentUsed": 23,
    "weeklyPercentUsed": 21,
    "weeklyFablePercentUsed": null,
    "totalCostUsd": 0
  }
}
```

---

## Usage Statistics

```bash
curl "http://localhost:7877/usage?days=7"
```

```json
{
  "period": "last 7 days",
  "total": 42,
  "avgResponseMs": 3200,
  "byStatus": { "success": 40, "quota": 1, "error": 1 },
  "byProvider": { "agy": 35, "claude": 7 },
  "byModel": { "gemini-3.8-flash-low": 20, "claude-haiku-4-5-20251001": 7 },
  "byDay": {
    "2026-11-16": { "total": 10, "success": 10, "error": 0, "quota": 0 }
  }
}
```

**Query params:**
- `days` — lookback window (default: 7)
- `provider` — filter by `agy` or `claude`
- `raw=true` — return raw log array

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `7877` | Server port |
| `DBUS_SESSION_BUS_ADDRESS` | `unix:path=/run/user/1000/bus` | DBus address for AGY |
| `XDG_RUNTIME_DIR` | `/run/user/1000` | XDG runtime dir for AGY |

---

## Systemd Service

```ini
# /etc/systemd/user/agy-openapi.service
[Unit]
Description=AGY OpenAPI Server
After=network.target antigravity-cli-daemon.service

[Service]
WorkingDirectory=/home/runia/agy-openapi
ExecStart=/usr/bin/node index.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
```

```bash
systemctl --user enable --now agy-openapi
journalctl --user -u agy-openapi -f
```

---

## Project Structure

```
agy-openapi/
├── index.js          # Express server — all routes, session store, webhook engine
├── public/
│   └── index.html    # Dashboard SPA (vanilla JS + Tailwind CDN)
├── sessions.json     # AGY session store
├── sessions-claude.json  # Claude session store
├── usage.json        # Rolling usage log (max 10,000 entries)
└── server.log        # Runtime log
```

---

*Dibuat oleh runia.id · Terinspirasi dari [Waha](https://waha.devlike.pro/)*
