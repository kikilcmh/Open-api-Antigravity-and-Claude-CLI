<div align="center">

# AGY OpenAPI

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Version](https://img.shields.io/badge/version-1.0.0-orange)](https://github.com/kikilcmh/Open-api-Antigravity-and-Claude-CLI)
[![License](https://img.shields.io/badge/license-ISC-blue)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-linux-lightgrey?logo=linux&logoColor=white)](https://www.linux.org)
[![Express](https://img.shields.io/badge/Express-5.x-000000?logo=express&logoColor=white)](https://expressjs.com)

**REST API wrapper untuk [AGY CLI](https://antigravity.dev) (Gemini · Claude · GPT) dan [Claude CLI](https://claude.ai/code)**

Terinspirasi dari [Waha](https://waha.devlike.pro/) · Dibuat oleh [runia.id](https://runia.id)

---

**Pilih bahasa / Choose language:**

[Bahasa Indonesia](#bahasa-indonesia) &nbsp;|&nbsp; [English](#english)

</div>

---

<a name="bahasa-indonesia"></a>

## Bahasa Indonesia

### Daftar Isi

- [Tentang](#tentang)
- [Fitur](#fitur)
- [Mulai Cepat](#mulai-cepat)
- [Dashboard](#dashboard)
- [Referensi API](#referensi-api)
  - [Sesi AGY](#sesi-agy)
  - [Sesi Claude](#sesi-claude)
  - [Model](#model)
  - [Chat Stateless](#chat-stateless)
  - [Pemantauan](#pemantauan)
- [Contoh Penggunaan](#contoh-penggunaan)
  - [Chat](#chat)
  - [Upload File](#upload-file)
  - [Webhook](#webhook)
- [Daftar Model](#daftar-model)
- [Kuota](#kuota)
- [Statistik Penggunaan](#statistik-penggunaan)
- [Variabel Lingkungan](#variabel-lingkungan)
- [Systemd Service](#systemd-service)
- [Struktur Proyek](#struktur-proyek)

---

### Tentang

**AGY OpenAPI** adalah REST API wrapper yang membungkus [AGY CLI](https://antigravity.dev) dan [Claude CLI](https://claude.ai/code) menjadi HTTP endpoints yang siap pakai — lengkap dengan manajemen sesi, webhook, monitoring kuota, dan dashboard bawaan.

> Konsep serupa dengan [Waha](https://waha.devlike.pro/) untuk WhatsApp, tapi untuk model AI.

---

### Fitur

| Fitur | Deskripsi |
|---|---|
| [**Session memory**](#sesi-agy) | 1 sesi = 1 percakapan persisten. Lanjutkan kapan saja via `--conversation` / `--resume`. |
| [**Multi-provider**](#daftar-model) | AGY (Gemini, Claude via AGY, GPT) dan Claude CLI dalam satu server. |
| [**File / image upload**](#upload-file) | Lampirkan file ke pesan chat via multipart form. |
| [**Webhooks**](#webhook) | Webhook per sesi dengan HMAC-SHA256, kebijakan retry, header kustom. |
| [**Quota monitoring**](#kuota) | Kuota mingguan real-time dari AGY dan Claude CLI via `/quota`. |
| [**Usage tracking**](#statistik-penggunaan) | Log bergulir setiap panggilan API — status, model, latensi, per hari. |
| [**Swagger UI**](http://localhost:7877/docs) | Dokumentasi OpenAPI 3.0 lengkap di `/docs`. |
| [**Dashboard**](#dashboard) | SPA bertema gelap di `/` — halaman Sessions, Usage, Quota. |

---

### Mulai Cepat

```bash
# Clone dan instal dependensi
git clone https://github.com/kikilcmh/Open-api-Antigravity-and-Claude-CLI.git
cd Open-api-Antigravity-and-Claude-CLI
npm install

# Jalankan server
node index.js
```

Server berjalan di:

| Layanan | URL |
|---|---|
| REST API | [http://localhost:7877](http://localhost:7877) |
| Dashboard | [http://localhost:7877/](http://localhost:7877/) |
| Swagger UI | [http://localhost:7877/docs](http://localhost:7877/docs) |
| OpenAPI JSON | [http://localhost:7877/openapi.json](http://localhost:7877/openapi.json) |

**Prasyarat:**
- Binary [`agy`](https://antigravity.dev) di `/usr/local/bin/agy`
- Binary [`claude`](https://claude.ai/code) di `/usr/bin/claude`
- Service `antigravity-cli-daemon` berjalan: `systemctl --user start antigravity-cli-daemon`
- [Node.js](https://nodejs.org) 18+

---

### Dashboard

Akses di **[http://localhost:7877/](http://localhost:7877/)**

| Halaman | Deskripsi |
|---|---|
| **Sessions** | Buat, pilih, dan chat dengan sesi. Pemilih provider (AGY / Claude). Konfigurasi webhook per sesi. |
| **Usage** | Statistik panggilan API — total, avg respons, per status/model/provider, tabel per hari. |
| **Quota** | Sisa kuota mingguan untuk setiap grup model AGY dan Claude CLI. |

---

### Referensi API

Base URL: `http://localhost:7877`

#### Sesi AGY

```
GET    /sessions                       Daftar semua sesi
GET    /sessions/:id                   Info sesi
DELETE /sessions/:id                   Hapus sesi (reset percakapan)

POST   /sessions/:id/chat              Chat dalam sesi
POST   /sessions/:id/chat/file         Chat dengan lampiran file

GET    /sessions/:id/webhooks          Ambil konfigurasi webhook
PUT    /sessions/:id/webhooks          Atur konfigurasi webhook
DELETE /sessions/:id/webhooks          Hapus semua webhook
POST   /sessions/:id/webhooks/test     Kirim test event webhook
```

#### Sesi Claude

Endpoint yang sama, di bawah prefix `/claude/`:

```
GET    /claude/sessions
GET    /claude/sessions/:id
DELETE /claude/sessions/:id

POST   /claude/sessions/:id/chat
POST   /claude/sessions/:id/chat/file

GET    /claude/sessions/:id/webhooks
PUT    /claude/sessions/:id/webhooks
DELETE /claude/sessions/:id/webhooks
POST   /claude/sessions/:id/webhooks/test
```

#### Model

```
GET    /models         Model AGY + effort levels
GET    /claude/models  Model Claude
```

#### Chat Stateless

```
POST   /chat              Single-turn AGY (tanpa sesi)
POST   /chat/file         Single-turn AGY dengan file
POST   /claude/chat       Single-turn Claude
POST   /claude/chat/file  Single-turn Claude dengan file
```

#### Pemantauan

```
GET    /usage    Statistik penggunaan  (?days=7&provider=agy&raw=true)
GET    /quota    Status kuota AGY + Claude CLI
```

Lihat dokumentasi lengkap di **[Swagger UI](http://localhost:7877/docs)**.

---

### Contoh Penggunaan

#### Chat

```bash
curl -X POST http://localhost:7877/sessions/my-session/chat \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Halo! Siapa kamu?",
    "model": "gemini-3.8-flash-low",
    "effort": "low"
  }'
```

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

#### Upload File

```bash
curl -X POST http://localhost:7877/sessions/my-session/chat/file \
  -F "prompt=Analisis gambar ini" \
  -F "file=@screenshot.png"
```

#### Webhook

Konfigurasi webhook untuk menerima notifikasi real-time setiap kali sesi selesai memproses pesan:

```bash
curl -X PUT http://localhost:7877/sessions/my-session/webhooks \
  -H "Content-Type: application/json" \
  -d '[{
    "url": "https://webhook.site/your-id",
    "events": ["message.completed", "session.created", "session.deleted"],
    "hmac": { "key": "your-secret" },
    "retries": { "attempts": 3, "delaySeconds": 2, "policy": "linear" },
    "customHeaders": [{ "name": "Authorization", "value": "Bearer token" }]
  }]'
```

**Event yang tersedia:**

| Event | Kapan dikirim |
|---|---|
| `message.completed` | AGY/Claude selesai menghasilkan respons |
| `session.created` | Sesi baru dibuat |
| `session.deleted` | Sesi dihapus |
| `*` | Semua event |

**Contoh payload webhook:**

```json
{
  "id": "evt_01aaaaaaaaaaaaaaaaaaaaaaaa",
  "timestamp": 1734567890123,
  "session": "my-session",
  "event": "message.completed",
  "payload": {
    "output": "Respons dari AGY...",
    "conversationId": "abc-123",
    "model": "gemini-3.8-flash-low",
    "effort": "low"
  },
  "environment": { "version": "1.0.0", "engine": "AGY" }
}
```

Tanda tangan HMAC dikirim di header `X-Hub-Signature-256`: `sha256=<hex>`.

---

### Daftar Model

#### AGY

| ID | Nama | Effort |
|---|---|---|
| `gemini-3.8-flash-low` | Gemini 3.8 Flash (Low) | — |
| `gemini-3.8-flash-medium` | Gemini 3.8 Flash (Medium) | — |
| `gemini-3.8-flash-high` | Gemini 3.8 Flash (High) | ✓ |
| `claude-sonnet-4-6` | Claude Sonnet 4.6 (Thinking) | ✓ |
| `claude-opus-4-6-thinking` | Claude Opus 4.6 (Thinking) | ✓ |
| `gpt-oss-120b-medium` | GPT-OSS 120B (Medium) | — |

Effort: `low` · `medium` · `high` · `xhigh` · `max` &nbsp;·&nbsp; Default: `gemini-3.8-flash-low` + `low`

#### Claude CLI

| ID | Nama |
|---|---|
| `claude-haiku-4-5-20251001` | Claude Haiku 4.5 |
| `claude-sonnet-4-6` | Claude Sonnet 4.6 |
| `claude-opus-4-8` | Claude Opus 4.8 |
| `claude-fable-5` | Claude Fable 5 |

---

### Kuota

```bash
curl http://localhost:7877/quota
```

```json
{
  "agy": {
    "account": "user@gmail.com",
    "groups": [
      {
        "name": "Gemini Models",
        "buckets": [{ "id": "gemini-weekly", "percentRemaining": 0, "resetTime": "2026-11-21T05:57:24Z" }]
      },
      {
        "name": "Claude and GPT models",
        "buckets": [{ "id": "3p-weekly", "percentRemaining": 8.41, "resetTime": "2026-11-22T18:15:30Z" }]
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

### Statistik Penggunaan

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
  "byDay": { "2026-11-16": { "total": 10, "success": 10, "error": 0, "quota": 0 } }
}
```

| Parameter | Default | Deskripsi |
|---|---|---|
| `days` | `7` | Jendela lookback (hari) |
| `provider` | — | Filter: `agy` atau `claude` |
| `raw` | `false` | `true` = kembalikan array log mentah |

---

### Variabel Lingkungan

| Variabel | Default | Deskripsi |
|---|---|---|
| `PORT` | `7877` | Port server |
| `DBUS_SESSION_BUS_ADDRESS` | `unix:path=/run/user/1000/bus` | Alamat DBus untuk AGY daemon |
| `XDG_RUNTIME_DIR` | `/run/user/1000` | Direktori runtime XDG |

---

### Systemd Service

Jalankan sebagai service agar otomatis berjalan saat boot:

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

### Struktur Proyek

```
agy-openapi/
├── index.js              # Server Express — semua route, session store, webhook engine
├── public/
│   └── index.html        # Dashboard SPA (vanilla JS + Tailwind CDN)
├── sessions.json         # Penyimpanan sesi AGY
├── sessions-claude.json  # Penyimpanan sesi Claude
├── usage.json            # Log penggunaan bergulir (maks 10.000 entri)
└── server.log            # Log runtime
```

<div align="right">

[Baca dalam Bahasa Inggris ↓](#english) &nbsp;·&nbsp; [Kembali ke atas ↑](#agyopenapi)

</div>

---

<a name="english"></a>

## English

### Table of Contents

- [About](#about)
- [Features](#features)
- [Quick Start](#quick-start)
- [Dashboard](#dashboard-1)
- [API Reference](#api-reference)
  - [AGY Sessions](#agy-sessions)
  - [Claude Sessions](#claude-sessions)
  - [Models](#models)
  - [Stateless Chat](#stateless-chat)
  - [Monitoring](#monitoring)
- [Usage Examples](#usage-examples)
  - [Chat](#chat-1)
  - [File Upload](#file-upload)
  - [Webhooks](#webhooks)
- [Model List](#model-list)
- [Quota](#quota)
- [Usage Statistics](#usage-statistics)
- [Environment Variables](#environment-variables)
- [Systemd Service](#systemd-service-1)
- [Project Structure](#project-structure)

---

### About

**AGY OpenAPI** is a REST API wrapper that wraps [AGY CLI](https://antigravity.dev) and [Claude CLI](https://claude.ai/code) into ready-to-use HTTP endpoints — complete with session management, webhooks, quota monitoring, and a built-in dashboard.

> Similar concept to [Waha](https://waha.devlike.pro/) for WhatsApp, but for AI models.

---

### Features

| Feature | Description |
|---|---|
| [**Session memory**](#agy-sessions) | 1 session = 1 persistent conversation. Resume anytime via `--conversation` / `--resume`. |
| [**Multi-provider**](#model-list) | AGY (Gemini, Claude via AGY, GPT) and Claude CLI on the same server. |
| [**File / image upload**](#file-upload) | Attach files to any chat message via multipart form. |
| [**Webhooks**](#webhooks) | Per-session webhooks with HMAC-SHA256 signing, retry policies, custom headers. |
| [**Quota monitoring**](#quota) | Real-time weekly quota from AGY and Claude CLI — via `/quota`. |
| [**Usage tracking**](#usage-statistics) | Rolling log of every API call with status, model, latency, aggregated by day. |
| [**Swagger UI**](http://localhost:7877/docs) | Full OpenAPI 3.0 docs at `/docs`. |
| [**Dashboard**](#dashboard-1) | Dark-themed SPA at `/` — Sessions, Usage, Quota pages. |

---

### Quick Start

```bash
# Clone and install dependencies
git clone https://github.com/kikilcmh/Open-api-Antigravity-and-Claude-CLI.git
cd Open-api-Antigravity-and-Claude-CLI
npm install

# Start server
node index.js
```

Server runs at:

| Service | URL |
|---|---|
| REST API | [http://localhost:7877](http://localhost:7877) |
| Dashboard | [http://localhost:7877/](http://localhost:7877/) |
| Swagger UI | [http://localhost:7877/docs](http://localhost:7877/docs) |
| OpenAPI JSON | [http://localhost:7877/openapi.json](http://localhost:7877/openapi.json) |

**Requirements:**
- [`agy`](https://antigravity.dev) binary at `/usr/local/bin/agy`
- [`claude`](https://claude.ai/code) binary at `/usr/bin/claude`
- `antigravity-cli-daemon` running: `systemctl --user start antigravity-cli-daemon`
- [Node.js](https://nodejs.org) 18+

---

### Dashboard

Access at **[http://localhost:7877/](http://localhost:7877/)**

| Page | Description |
|---|---|
| **Sessions** | Create, select, and chat with sessions. Provider switcher (AGY / Claude). Webhook config per session. |
| **Usage** | API call statistics — total calls, avg response, by status/model/provider, per-day table. |
| **Quota** | Weekly quota remaining for each AGY model group and Claude CLI. |

---

### API Reference

Base URL: `http://localhost:7877`

#### AGY Sessions

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

#### Claude Sessions

Same endpoints under `/claude/` prefix:

```
GET    /claude/sessions
GET    /claude/sessions/:id
DELETE /claude/sessions/:id

POST   /claude/sessions/:id/chat
POST   /claude/sessions/:id/chat/file

GET    /claude/sessions/:id/webhooks
PUT    /claude/sessions/:id/webhooks
DELETE /claude/sessions/:id/webhooks
POST   /claude/sessions/:id/webhooks/test
```

#### Models

```
GET    /models         AGY models + effort levels
GET    /claude/models  Claude models
```

#### Stateless Chat

```
POST   /chat              Single-turn AGY (no session)
POST   /chat/file         Single-turn AGY with file
POST   /claude/chat       Single-turn Claude
POST   /claude/chat/file  Single-turn Claude with file
```

#### Monitoring

```
GET    /usage    Usage statistics  (?days=7&provider=agy&raw=true)
GET    /quota    Quota status — AGY model groups + Claude CLI
```

See the full documentation at **[Swagger UI](http://localhost:7877/docs)**.

---

### Usage Examples

#### Chat

```bash
curl -X POST http://localhost:7877/sessions/my-session/chat \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Hello! Who are you?",
    "model": "gemini-3.8-flash-low",
    "effort": "low"
  }'
```

```json
{
  "output": "Hello! I am ...",
  "sessionId": "my-session",
  "conversationId": "abc-123-def",
  "isNew": true,
  "model": "gemini-3.8-flash-low",
  "effort": "low"
}
```

#### File Upload

```bash
curl -X POST http://localhost:7877/sessions/my-session/chat/file \
  -F "prompt=Analyze this image" \
  -F "file=@screenshot.png"
```

#### Webhooks

Configure a webhook to receive real-time notifications whenever a session finishes processing a message:

```bash
curl -X PUT http://localhost:7877/sessions/my-session/webhooks \
  -H "Content-Type: application/json" \
  -d '[{
    "url": "https://webhook.site/your-id",
    "events": ["message.completed", "session.created", "session.deleted"],
    "hmac": { "key": "your-secret" },
    "retries": { "attempts": 3, "delaySeconds": 2, "policy": "linear" },
    "customHeaders": [{ "name": "Authorization", "value": "Bearer token" }]
  }]'
```

**Available events:**

| Event | Fired when |
|---|---|
| `message.completed` | AGY/Claude finishes generating a response |
| `session.created` | A new session is created |
| `session.deleted` | A session is deleted |
| `*` | All events |

**Example webhook payload:**

```json
{
  "id": "evt_01aaaaaaaaaaaaaaaaaaaaaaaa",
  "timestamp": 1734567890123,
  "session": "my-session",
  "event": "message.completed",
  "payload": {
    "output": "Response from AGY...",
    "conversationId": "abc-123",
    "model": "gemini-3.8-flash-low",
    "effort": "low"
  },
  "environment": { "version": "1.0.0", "engine": "AGY" }
}
```

HMAC signature is in the `X-Hub-Signature-256` header: `sha256=<hex>`.

---

### Model List

#### AGY

| ID | Name | Effort |
|---|---|---|
| `gemini-3.8-flash-low` | Gemini 3.8 Flash (Low) | — |
| `gemini-3.8-flash-medium` | Gemini 3.8 Flash (Medium) | — |
| `gemini-3.8-flash-high` | Gemini 3.8 Flash (High) | ✓ |
| `claude-sonnet-4-6` | Claude Sonnet 4.6 (Thinking) | ✓ |
| `claude-opus-4-6-thinking` | Claude Opus 4.6 (Thinking) | ✓ |
| `gpt-oss-120b-medium` | GPT-OSS 120B (Medium) | — |

Effort levels: `low` · `medium` · `high` · `xhigh` · `max` &nbsp;·&nbsp; Default: `gemini-3.8-flash-low` + `low`

#### Claude CLI

| ID | Name |
|---|---|
| `claude-haiku-4-5-20251001` | Claude Haiku 4.5 |
| `claude-sonnet-4-6` | Claude Sonnet 4.6 |
| `claude-opus-4-8` | Claude Opus 4.8 |
| `claude-fable-5` | Claude Fable 5 |

---

### Quota

```bash
curl http://localhost:7877/quota
```

```json
{
  "agy": {
    "account": "user@gmail.com",
    "groups": [
      {
        "name": "Gemini Models",
        "buckets": [{ "id": "gemini-weekly", "percentRemaining": 0, "resetTime": "2026-11-21T05:57:24Z" }]
      },
      {
        "name": "Claude and GPT models",
        "buckets": [{ "id": "3p-weekly", "percentRemaining": 8.41, "resetTime": "2026-11-22T18:15:30Z" }]
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

### Usage Statistics

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
  "byDay": { "2026-11-16": { "total": 10, "success": 10, "error": 0, "quota": 0 } }
}
```

| Query Param | Default | Description |
|---|---|---|
| `days` | `7` | Lookback window (days) |
| `provider` | — | Filter by: `agy` or `claude` |
| `raw` | `false` | `true` = return raw log array |

---

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `7877` | Server port |
| `DBUS_SESSION_BUS_ADDRESS` | `unix:path=/run/user/1000/bus` | DBus address for AGY daemon |
| `XDG_RUNTIME_DIR` | `/run/user/1000` | XDG runtime directory |

---

### Systemd Service

Run as a system service to auto-start on boot:

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

### Project Structure

```
agy-openapi/
├── index.js              # Express server — all routes, session store, webhook engine
├── public/
│   └── index.html        # Dashboard SPA (vanilla JS + Tailwind CDN)
├── sessions.json         # AGY session store
├── sessions-claude.json  # Claude session store
├── usage.json            # Rolling usage log (max 10,000 entries)
└── server.log            # Runtime log
```

<div align="right">

[Baca dalam Bahasa Indonesia ↑](#bahasa-indonesia) &nbsp;·&nbsp; [Back to top ↑](#agyopenapi)

</div>

---

<div align="center">

Made by [runia.id](https://runia.id) &nbsp;·&nbsp; Inspired by [Waha](https://waha.devlike.pro/)

</div>
