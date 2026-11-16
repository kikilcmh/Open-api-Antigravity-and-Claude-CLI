# AGY OpenAPI

> REST API wrapper untuk **AGY CLI** (Antigravity / Gemini) dan **Claude CLI** — terinspirasi dari [Waha](https://waha.devlike.pro/).  
> Percakapan berbasis sesi, upload file, webhook, pemantauan kuota, dan dashboard bawaan.

> REST API wrapper for **AGY CLI** (Antigravity / Gemini) and **Claude CLI** — inspired by [Waha](https://waha.devlike.pro/).  
> Session-based conversations, file uploads, webhooks, quota monitoring, and a built-in dashboard.

---

## Fitur / Features

| Fitur / Feature | Indonesia | English |
|---|---|---|
| **Session memory** | 1 sesi = 1 percakapan persisten. Lanjutkan kapan saja via `--conversation` / `--resume`. | 1 session = 1 persistent conversation. Resume anytime via `--conversation` / `--resume`. |
| **Multi-provider** | AGY (Gemini, Claude via AGY, GPT) dan Claude CLI dalam satu server. | AGY (Gemini, Claude via AGY, GPT) and Claude CLI on the same server. |
| **File / image upload** | Lampirkan file ke pesan chat via multipart form. | Attach files to any chat message via multipart form. |
| **Webhooks** | Webhook per sesi dengan penandatanganan HMAC-SHA256, kebijakan retry, header kustom. | Per-session webhooks with HMAC-SHA256 signing, retry policies, custom headers. |
| **Quota monitoring** | Kuota mingguan real-time dari AGY dan Claude CLI — via endpoint `/quota`. | Real-time weekly quota from AGY and Claude CLI — via `/quota` endpoint. |
| **Usage tracking** | Log bergulir setiap panggilan API dengan status, model, latensi, dikelompokkan per hari. | Rolling log of every API call with status, model, latency, aggregated by day. |
| **Swagger UI** | Dokumentasi OpenAPI 3.0 lengkap di `/docs`. | Full OpenAPI 3.0 docs at `/docs`. |
| **Dashboard** | SPA bertema gelap di `/` — halaman Sessions, Usage, Quota. | Dark-themed SPA at `/` — Sessions, Usage, Quota pages. |

---

## Mulai Cepat / Quick Start

```bash
# Instal dependensi / Install dependencies
cd /home/runia/agy-openapi
npm install

# Jalankan server / Start server
node index.js

# API:       http://localhost:7877
# Dashboard: http://localhost:7877/
# Swagger:   http://localhost:7877/docs
```

**Prasyarat / Requirements**
- Binary `agy` di `/usr/local/bin/agy` (Antigravity CLI)
- Binary `claude` di `/usr/bin/claude` (Claude Code CLI)
- `antigravity-cli-daemon.service` berjalan (`systemctl --user start antigravity-cli-daemon`)
- Node.js 18+

---

## Dashboard

Akses di / Access at **`http://localhost:7877/`**

Tiga halaman via navigasi atas / Three pages via the top navigation:

| Halaman / Page | Indonesia | English |
|---|---|---|
| **Sessions** | Buat, pilih, dan chat dengan sesi. Pemilih provider (AGY / Claude). Konfigurasi webhook per sesi. | Create, select, and chat with sessions. Provider switcher (AGY / Claude). Webhook config per session. |
| **Usage** | Statistik panggilan API — total panggilan, avg respons, per status/model/provider, tabel per hari. | API call statistics — total calls, avg response, by status/model/provider, per-day table. |
| **Quota** | Sisa kuota mingguan untuk setiap grup model AGY dan Claude CLI. | Weekly quota remaining for each AGY model group and Claude CLI. |

---

## Referensi API / API Reference

Base URL: `http://localhost:7877`

### Sesi AGY / AGY Sessions

```
GET    /sessions                       Daftar semua sesi / List all sessions
GET    /sessions/:id                   Info sesi / Get session info
DELETE /sessions/:id                   Hapus sesi (reset percakapan) / Delete session (resets conversation)

POST   /sessions/:id/chat              Chat dalam sesi / Chat in session
POST   /sessions/:id/chat/file         Chat dengan lampiran file / Chat with file attachment

GET    /sessions/:id/webhooks          Ambil konfigurasi webhook / Get webhook config
PUT    /sessions/:id/webhooks          Atur konfigurasi webhook / Set webhook config
DELETE /sessions/:id/webhooks          Hapus semua webhook / Clear webhooks
POST   /sessions/:id/webhooks/test     Kirim test webhook / Fire test webhook event
```

### Sesi Claude / Claude Sessions

Endpoint yang sama di bawah `/claude/` / Same endpoints under `/claude/`:

```
POST   /claude/sessions/:id/chat
POST   /claude/sessions/:id/chat/file
GET    /claude/sessions/:id/webhooks
PUT    /claude/sessions/:id/webhooks
...
```

### Model

```
GET    /models         Model AGY + effort levels
GET    /claude/models  Model Claude
```

### Chat Stateless / Stateless Chat

```
POST   /chat           Single-turn AGY (tanpa sesi / no session)
POST   /chat/file      Single-turn AGY dengan file
POST   /claude/chat    Single-turn Claude
POST   /claude/chat/file
```

### Pemantauan / Monitoring

```
GET    /usage          Statistik penggunaan / Usage statistics (query: ?days=7&provider=agy&raw=true)
GET    /quota          Status kuota — grup model AGY + Claude CLI / Quota status — AGY model groups + Claude CLI
```

---

## Contoh Permintaan Chat / Chat Request

```bash
curl -X POST http://localhost:7877/sessions/my-session/chat \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Halo! Siapa kamu?",
    "model": "gemini-3.8-flash-low",
    "effort": "low"
  }'
```

**Respons / Response:**
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

### Upload File / File Upload

```bash
curl -X POST http://localhost:7877/sessions/my-session/chat/file \
  -F "prompt=Analisis gambar ini" \
  -F "file=@screenshot.png"
```

---

## Webhook

Setiap sesi dapat memiliki webhook. Konfigurasi via API atau dashboard.  
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

### Event

| Event | Indonesia | English |
|---|---|---|
| `message.completed` | AGY/Claude selesai menghasilkan respons | AGY/Claude finishes generating a response |
| `session.created` | Sesi baru dibuat | A new session is created |
| `session.deleted` | Sesi dihapus | A session is deleted |
| `*` | Semua event | All events |

### Payload Webhook / Webhook Payload

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

Tanda tangan HMAC ada di header `X-Hub-Signature-256`: `sha256=<hex>`.  
HMAC signature is in the `X-Hub-Signature-256` header: `sha256=<hex>`.

---

## Model

### AGY

| ID | Nama / Name | Effort |
|---|---|---|
| `gemini-3.8-flash-low` | Gemini 3.8 Flash (Low) | — |
| `gemini-3.8-flash-medium` | Gemini 3.8 Flash (Medium) | — |
| `gemini-3.8-flash-high` | Gemini 3.8 Flash (High) | ✓ |
| `claude-sonnet-4-6` | Claude Sonnet 4.6 (Thinking) | ✓ |
| `claude-opus-4-6-thinking` | Claude Opus 4.6 (Thinking) | ✓ |
| `gpt-oss-120b-medium` | GPT-OSS 120B (Medium) | — |

Tingkat effort / Effort levels: `low` · `medium` · `high` · `xhigh` · `max`  
Model default: `gemini-3.8-flash-low`, effort default: `low`

### Claude CLI

| ID | Nama / Name |
|---|---|
| `claude-haiku-4-5-20251001` | Claude Haiku 4.5 |
| `claude-sonnet-4-6` | Claude Sonnet 4.6 |
| `claude-opus-4-8` | Claude Opus 4.8 |
| `claude-fable-5` | Claude Fable 5 |

---

## Kuota / Quota

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

## Statistik Penggunaan / Usage Statistics

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

**Parameter query / Query params:**
- `days` — jendela lookback (default: 7) / lookback window (default: 7)
- `provider` — filter by `agy` atau/or `claude`
- `raw=true` — kembalikan array log mentah / return raw log array

---

## Variabel Lingkungan / Environment Variables

| Variabel / Variable | Default | Indonesia | English |
|---|---|---|---|
| `PORT` | `7877` | Port server | Server port |
| `DBUS_SESSION_BUS_ADDRESS` | `unix:path=/run/user/1000/bus` | Alamat DBus untuk AGY | DBus address for AGY |
| `XDG_RUNTIME_DIR` | `/run/user/1000` | Direktori runtime XDG untuk AGY | XDG runtime dir for AGY |

---

## Layanan Systemd / Systemd Service

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

## Struktur Proyek / Project Structure

```
agy-openapi/
├── index.js              # Server Express — semua route, session store, webhook engine
├── public/
│   └── index.html        # Dashboard SPA (vanilla JS + Tailwind CDN)
├── sessions.json         # Penyimpanan sesi AGY / AGY session store
├── sessions-claude.json  # Penyimpanan sesi Claude / Claude session store
├── usage.json            # Log penggunaan bergulir (maks 10.000 entri) / Rolling usage log (max 10,000 entries)
└── server.log            # Log runtime / Runtime log
```

---

*Dibuat oleh runia.id · Terinspirasi dari [Waha](https://waha.devlike.pro/)*  
*Created by runia.id · Inspired by [Waha](https://waha.devlike.pro/)*
