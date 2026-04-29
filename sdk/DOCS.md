# Libmaly — Third-Party Developer Documentation

This document covers everything you need to build fan-made tools, scripts, overlays, or dashboards that integrate with a running **Libmaly** instance.

> **Libmaly ≥ 1.9.0 required.** The API server is an optional feature that must be enabled by the user.

---

## Table of Contents

1. [Overview](#overview)
2. [Setup (User Side)](#setup-user-side)
3. [Authentication](#authentication)
4. [Base URL & Configuration](#base-url--configuration)
5. [REST API Reference](#rest-api-reference)
   - [GET /api/status](#get-apistatus)
   - [GET /api/library](#get-apilibrary)
   - [GET /api/library/game](#get-apilibrarygame)
   - [POST /api/launch](#post-apilaunch)
   - [POST /api/kill](#post-apikill)
   - [GET /api/volume](#get-apivolume)
   - [POST /api/volume](#post-apivolume)
   - [GET /api/metadata](#get-apimetadata)
   - [GET /api/stats](#get-apistats)
   - [GET /api/notes](#get-apinotes)
   - [POST /api/notify](#post-apinotify)
   - [POST /api/overlay/widget](#post-apioverlaywidget)
   - [DELETE /api/overlay/widget/:id](#delete-apioverlaywidgetid)
6. [WebSocket Reference](#websocket-reference)
   - [Connecting](#connecting)
   - [Message Format](#message-format)
   - [Event: connected](#event-connected)
   - [Event: game-started](#event-game-started)
   - [Event: game-finished](#event-game-finished)
   - [Event: telemetry](#event-telemetry)
   - [Event: library-updated](#event-library-updated)
   - [Event: notification](#event-notification)
   - [Event: overlay-widget-push](#event-overlay-widget-push)
   - [Event: overlay-widget-remove](#event-overlay-widget-remove)
   - [Event: volume-requested](#event-volume-requested)
7. [TypeScript / JavaScript SDK](#typescript--javascript-sdk)
   - [Installation](#installation)
   - [Quick Start](#quick-start)
   - [Constructor Options](#constructor-options)
   - [REST Methods](#rest-methods)
   - [WebSocket Methods & Events](#websocket-methods--events)
   - [Utilities](#utilities)
8. [Integration Patterns & Recipes](#integration-patterns--recipes)
9. [Error Handling](#error-handling)
10. [Security Considerations](#security-considerations)
11. [Example Files Reference](#example-files-reference)

---

## Overview

The **Libmaly API Server** is a local HTTP + WebSocket server that runs on `127.0.0.1` (loopback only) at a configurable port. Third-party apps can:

| Capability | What you can do |
|---|---|
| **Remote Control** | Launch games, kill the running game, set system volume |
| **State Access** | Read the full library, per-game metadata, stats, and notes |
| **Extension Hooks** | Push notification toasts and HTML widgets into the overlay |
| **Real-time Events** | Subscribe to game lifecycle, telemetry, and library changes via WebSocket |

The server is designed to be used by **local tools only** — it binds to loopback and requires a bearer token that only the user can see. Cross-origin access from web pages is controlled by a per-origin CORS allowlist.

---

## Setup (User Side)

The user must enable the API server before your tool can connect.

1. Open Libmaly
2. Go to **Settings → 🌐 API**
3. Toggle **Enable API Server** → ON
4. Note the **Port** (default: `39510`)
5. Copy the **Bearer Token** — this is what your tool needs to authenticate
6. Click **Apply & Restart** to apply changes

The bearer token is generated once and stored in the OS keychain. The user can regenerate it at any time (which invalidates your existing token). You should prompt the user to paste the token into your tool's configuration UI or config file — never embed a hardcoded token.

---

## Authentication

Every request — both REST and WebSocket — must be authenticated with a **Bearer token**.

### REST requests

Include the token in the `Authorization` header:

```
Authorization: Bearer <token>
```

**Example (curl):**
```sh
curl -H "Authorization: Bearer abc123def456" http://127.0.0.1:39510/api/status
```

**Example (fetch):**
```js
const res = await fetch("http://127.0.0.1:39510/api/status", {
  headers: { "Authorization": "Bearer abc123def456" }
});
```

### WebSocket connections

Browsers cannot send custom headers when opening a WebSocket. Pass the token as a **query parameter** instead:

```
ws://127.0.0.1:39510/ws?token=abc123def456
```

**Example:**
```js
const ws = new WebSocket("ws://127.0.0.1:39510/ws?token=abc123def456");
```

### Unauthorized responses

Any request with a missing or invalid token returns:

```
HTTP 401 Unauthorized
{ "error": "Unauthorized" }
```

---

## Base URL & Configuration

| Setting | Default | Notes |
|---|---|---|
| Host | `127.0.0.1` | Loopback only — not reachable from outside the machine |
| Port | `39510` | Configurable in Settings → 🌐 API |
| Protocol | HTTP / WS | TLS not supported (local loopback only) |
| Base URL | `http://127.0.0.1:39510` | |
| WebSocket URL | `ws://127.0.0.1:39510/ws` | |

**CORS** — By default, only `http://localhost:*` origins are allowed. The user can change this in Settings or set it to `*` to allow all origins. This only affects browser-based tools; Node.js and other non-browser clients are unaffected.

---

## REST API Reference

All responses are **JSON**. Request bodies must use `Content-Type: application/json`.

### GET /api/status

Returns the current app version, server uptime, the active game (if any), and system telemetry.

**Response:**
```jsonc
{
  "version": "1.9.0",
  "uptimeSecs": 3742,
  "activeGame": {                // null when no game is running
    "exe": "C:\\Games\\game.exe",
    "pid": 12345,
    "rootPid": 12340
  },
  "telemetry": {
    "cpuUsage": 23.4,            // percent, 0–100
    "ramUsedMb": 8192,
    "ramTotalMb": 16384,
    "gpuUsage": 67.0,            // null on unsupported platforms
    "gpuName": "NVIDIA RTX 4070" // null on unsupported platforms
  }
}
```

**Example:**
```sh
curl -H "Authorization: Bearer <token>" http://127.0.0.1:39510/api/status
```

---

### GET /api/library

Returns the complete game library with metadata and stats for every entry.

**Response:**
```jsonc
{
  "games": [
    {
      "path": "C:\\Games\\SomeGame\\game.exe",
      "name": "Some Game",        // null if not set
      "meta": {                   // null if no metadata fetched
        "title": "Some Game",
        "developer": "Studio X",
        "version": "1.2.3",
        "coverUrl": "https://...",
        "tags": ["rpg", "fantasy"],
        // ... other metadata fields
      },
      "stats": {                  // null if never played
        "totalSecs": 7200,        // total playtime in seconds
        "sessionCount": 12,
        "lastPlayedMs": 1714300800000 // Unix timestamp ms, or null
      }
    }
    // ... more entries
  ]
}
```

**Performance note:** For large libraries (500+ games), this call may take a few hundred milliseconds as it reads from disk. Cache the result client-side and invalidate on `library-updated` WebSocket events.

---

### GET /api/library/game

Returns a single game entry by its executable path.

**Query parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `path` | string | ✓ | URL-encoded path to the game executable |

**Response:** A single `GameEntry` object (same shape as array items in `/api/library`).

**Example:**
```sh
curl -H "Authorization: Bearer <token>" \
  "http://127.0.0.1:39510/api/library/game?path=C%3A%5CGames%5CGame%5Cgame.exe"
```

Returns `null` fields for unknown games (the path was never tracked).

---

### POST /api/launch

Asks Libmaly to launch a game by its executable path. The launch uses the per-game configuration from Libmaly (launch arguments, Wine/Proton settings, etc.).

**Request body:**
```json
{ "path": "C:\\Games\\SomeGame\\game.exe" }
```

**Response:**
```json
{ "ok": true }
```

**Notes:**
- The response is returned immediately — it does not wait for the game to actually start.
- Listen to the `game-started` WebSocket event to confirm the launch.
- If a game is already running, the request is forwarded to the frontend, which may show a confirmation dialog.

**Example:**
```sh
curl -X POST -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"path":"C:\\Games\\Game\\game.exe"}' \
  http://127.0.0.1:39510/api/launch
```

---

### POST /api/kill

Kills the currently running game. Sends a graceful kill signal via the Libmaly frontend.

**Request body:** none (or `{}`)

**Response:**
```json
{ "ok": true }
```

**Notes:**
- Always returns `{ "ok": true }` even if no game is running.
- Listen to `game-finished` to confirm the game stopped.

---

### GET /api/volume

Returns the current master volume level. Due to platform limitations, the server cannot directly read the OS audio level — the response will have `level: null` with an explanatory note.

**Response:**
```jsonc
{
  "level": null,
  "note": "Volume read not supported server-side; subscribe to ws volume-changed events from the frontend"
}
```

**Workaround:** Subscribe to the `volume-requested` WebSocket event to track the last volume value set via the API.

---

### POST /api/volume

Requests a master volume change. The request is forwarded to the Libmaly frontend, which applies it via platform audio APIs.

**Request body:**
```json
{ "level": 75 }
```

| Field | Type | Range | Description |
|---|---|---|---|
| `level` | number | `0`–`100` | Target volume percentage. Clamped automatically. |

**Response:**
```json
{ "ok": true, "level": 75 }
```

A `volume-requested` WebSocket event is also broadcast to all WS clients.

---

### GET /api/metadata

Returns the raw metadata record for a game as fetched from linked sources (F95zone, DLsite, etc.).

**Query parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `path` | string | ✓ | URL-encoded executable path |

**Response:** The raw metadata object (structure varies by source), or `null` if no metadata exists.

```jsonc
{
  "title": "Some Game",
  "developer": "Studio X",
  "version": "1.2.3",
  "coverUrl": "https://example.com/cover.jpg",
  "tags": ["rpg", "fantasy"],
  "description": "...",
  // ... source-specific fields
}
```

---

### GET /api/stats

Returns the play-session statistics for a game.

**Query parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `path` | string | ✓ | URL-encoded executable path |

**Response:** The stats object or `null` if the game has never been tracked.

```jsonc
{
  "totalSecs": 7200,
  "sessionCount": 12,
  "lastPlayedMs": 1714300800000
}
```

---

### GET /api/notes

Returns the markdown notes text for a game.

**Query parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `path` | string | ✓ | URL-encoded executable path |

**Response:**
```jsonc
{
  "path": "C:\\Games\\SomeGame\\game.exe",
  "notes": "## Playthrough Notes\n\nBest ending: pick option A at chapter 3..." // null if empty
}
```

---

### POST /api/notify

Pushes a notification toast into the Libmaly overlay (the transparent window shown over the game).

**Request body:**
```jsonc
{
  "title": "Achievement Unlocked",   // required
  "body": "Completed all routes!",   // required
  "icon": "🏆",                      // optional — emoji or short text prefix
  "source": "MyAchievementTracker"   // optional — shown as origin in the UI
}
```

**Response:**
```json
{ "ok": true }
```

**Notes:**
- The overlay must be visible (i.e., a game must be running) for the notification to show.
- A `notification` WebSocket event is broadcast to all WS clients as well.

---

### POST /api/overlay/widget

Injects or updates an **HTML widget** in the in-game overlay.

Widgets are rendered in positioned `<div>` containers inside the overlay window. Use the `id` field as a stable key — posting the same `id` again replaces the existing widget in place.

**Request body:**
```jsonc
{
  "id": "my-timer",                  // required — stable identifier
  "html": "<b style='color:white'>Session: 01:23</b>", // required — raw HTML
  "position": "top-right",           // optional — see positions below
  "width": 200,                      // optional — px, default 300
  "height": 60                       // optional — px, default auto
}
```

**`position` values:**

| Value | Location |
|---|---|
| `"top-left"` (default) | Top-left corner of the overlay |
| `"top-right"` | Top-right corner |
| `"bottom-left"` | Bottom-left corner |
| `"bottom-right"` | Bottom-right corner |

**Response:**
```json
{ "ok": true }
```

**Security note:** HTML is rendered via `dangerouslySetInnerHTML`. Only trusted local tools should push widgets. Do not render HTML from untrusted or remote sources.

---

### DELETE /api/overlay/widget/:id

Removes an overlay widget by its `id`.

**Path parameter:** `:id` — the widget identifier (URL-encoded if it contains special characters).

**Response:**
```json
{ "ok": true }
```

Returns `{ "ok": true }` even if the widget didn't exist.

**Example:**
```sh
curl -X DELETE -H "Authorization: Bearer <token>" \
  http://127.0.0.1:39510/api/overlay/widget/my-timer
```

---

## WebSocket Reference

### Connecting

Connect to the WebSocket endpoint with the token as a query parameter:

```
ws://127.0.0.1:39510/ws?token=<bearer-token>
```

The connection is rejected with HTTP `401` if the token is missing or wrong.

Once connected, you will receive a `connected` event confirming the handshake. The connection stays open until you close it or until Libmaly shuts down.

**Reconnection:** You should implement reconnect logic in your client. Libmaly will close the WebSocket when the app exits; reconnecting when it restarts allows seamless operation.

### Message Format

All messages sent by the server are JSON objects with the following structure:

```jsonc
{
  "type": "<event-name>",
  "payload": { /* event-specific data */ }
}
```

**Parsing example (JavaScript):**
```js
ws.onmessage = (event) => {
  const { type, payload } = JSON.parse(event.data);
  switch (type) {
    case "game-started":   handleGameStarted(payload);  break;
    case "game-finished":  handleGameFinished(payload); break;
    case "telemetry":      handleTelemetry(payload);    break;
    // ...
  }
};
```

---

### Event: `connected`

Sent immediately after the WebSocket handshake is accepted.

```jsonc
{
  "type": "connected",
  "payload": {
    "version": "1.9.0"   // Libmaly version
  }
}
```

---

### Event: `game-started`

Sent when a game launch is detected.

```jsonc
{
  "type": "game-started",
  "payload": {
    "path": "C:\\Games\\SomeGame\\game.exe"
  }
}
```

**Use this to:**
- Start a session timer
- Show a session overlay widget
- Update your tool's "now playing" status

---

### Event: `game-finished`

Sent when the running game process exits.

```jsonc
{
  "type": "game-finished",
  "payload": {
    "path": "C:\\Games\\SomeGame\\game.exe",
    "durationSecs": 3600     // session duration in seconds
  }
}
```

**Use this to:**
- Stop and save session timers
- Post a "just finished" status
- Remove session overlay widgets
- Trigger end-of-session summaries

---

### Event: `telemetry`

Sent periodically (approximately every 5 seconds) while a game is running, and at a lower rate when idle.

```jsonc
{
  "type": "telemetry",
  "payload": {
    "cpuUsage": 45.2,          // percent
    "ramUsedMb": 9500,
    "ramTotalMb": 16384,
    "gpuUsage": 78.1,          // null on unsupported platforms
    "activeGame": {             // null when no game is running
      "exe": "C:\\Games\\SomeGame\\game.exe",
      "pid": 12345
    }
  }
}
```

**Use this to:**
- Drive live CPU/GPU/RAM graphs
- Monitor performance during sessions
- Track whether a game is still running (check `activeGame`)

---

### Event: `library-updated`

Sent after the library is rescanned and the game list changes.

```jsonc
{
  "type": "library-updated",
  "payload": {}
}
```

On receiving this event, re-fetch `/api/library` to get the current state.

---

### Event: `notification`

Sent whenever a notification is pushed (either from your tool via `POST /api/notify` or from internal Libmaly triggers).

```jsonc
{
  "type": "notification",
  "payload": {
    "title": "Achievement Unlocked",
    "body": "Completed all routes!",
    "icon": "🏆",
    "source": "MyAchievementTracker"  // may be null
  }
}
```

---

### Event: `overlay-widget-push`

Sent whenever an overlay widget is pushed or updated.

```jsonc
{
  "type": "overlay-widget-push",
  "payload": {
    "id": "my-timer",
    "html": "<b>01:23</b>",
    "position": "top-right",
    "width": 200,
    "height": null
  }
}
```

---

### Event: `overlay-widget-remove`

Sent whenever an overlay widget is removed.

```jsonc
{
  "type": "overlay-widget-remove",
  "payload": {
    "id": "my-timer"
  }
}
```

---

### Event: `volume-requested`

Sent when a volume change is requested via `POST /api/volume`.

```jsonc
{
  "type": "volume-requested",
  "payload": {
    "level": 75.0
  }
}
```

---

## TypeScript / JavaScript SDK

The SDK is a single TypeScript file (`libmaly-sdk.ts`) that works in **Node.js ≥ 22** and modern browsers. It wraps all REST calls and the WebSocket connection with full TypeScript types.

### Installation

Copy `libmaly-sdk.ts` (and optionally `package.json` + `tsconfig.json`) into your project:

```
your-project/
  libmaly-sdk.ts      ← copy this
  my-tool.ts
  package.json
  tsconfig.json
```

Or import it directly in a script:

```ts
import { LibmalyClient } from "./libmaly-sdk.js";
```

**Node.js < 22:** Install `ws` for native WebSocket support:
```sh
npm install ws
npm install --save-dev @types/ws
```
Then pass it via the constructor option (see below).

### Quick Start

```ts
import { LibmalyClient } from "./libmaly-sdk.js";

const client = new LibmalyClient({
  token: "paste-token-from-settings-here",
});

// ── One-shot REST call ───────────────────────────────────────────────────────
const status = await client.getStatus();
console.log("Libmaly", status.version);
console.log("Active game:", status.activeGame?.exe ?? "none");
console.log("CPU:", status.telemetry.cpuUsage.toFixed(1) + "%");

// ── Subscribe to real-time events ───────────────────────────────────────────
client.on("game-started",  ({ path }) => console.log("Started:", path));
client.on("game-finished", ({ path, durationSecs }) =>
  console.log("Finished:", path, "→", LibmalyClient.formatDuration(durationSecs)));
client.on("telemetry",     (t) => process.stdout.write(`\rCPU: ${t.cpuUsage.toFixed(1)}%`));

client.connect(); // opens WebSocket, auto-reconnects on disconnect
```

### Constructor Options

```ts
new LibmalyClient(options: LibmalyClientOptions)
```

| Option | Type | Default | Description |
|---|---|---|---|
| `token` | `string` | — | **Required.** Bearer token from Settings → 🌐 API |
| `host` | `string` | `"127.0.0.1"` | API server host |
| `port` | `number` | `39510` | API server port |
| `WebSocketImpl` | `new(url) => WebSocket` | built-in | Custom WebSocket class (for Node < 22) |
| `autoReconnect` | `boolean` | `true` | Reconnect on WebSocket close |
| `reconnectDelayMs` | `number` | `3000` | Delay between reconnect attempts (ms) |

**Node.js < 22 example:**
```ts
import WebSocket from "ws";

const client = new LibmalyClient({
  token: "...",
  WebSocketImpl: WebSocket as unknown as typeof globalThis.WebSocket,
});
```

### REST Methods

All methods return a `Promise` that rejects with `LibmalyApiError` on HTTP errors.

#### Status & Library

| Method | HTTP | Description |
|---|---|---|
| `getStatus()` | `GET /api/status` | App version, uptime, active game, telemetry |
| `getLibrary()` | `GET /api/library` | Full library with metadata and stats |
| `getGame(path)` | `GET /api/library/game?path=…` | Single game entry |

#### Remote Control

| Method | HTTP | Description |
|---|---|---|
| `launch(path)` | `POST /api/launch` | Launch game by exe path |
| `kill()` | `POST /api/kill` | Kill the running game |
| `getVolume()` | `GET /api/volume` | Get master volume (always null server-side) |
| `setVolume(level)` | `POST /api/volume` | Set master volume (0–100) |

#### State Access

| Method | HTTP | Description |
|---|---|---|
| `getMetadata(path)` | `GET /api/metadata?path=…` | Raw metadata record |
| `getStats(path)` | `GET /api/stats?path=…` | Play statistics |
| `getNotes(path)` | `GET /api/notes?path=…` | Markdown notes text |

#### Extension Hooks

| Method | HTTP | Description |
|---|---|---|
| `notify(options)` | `POST /api/notify` | Push overlay notification |
| `pushWidget(id, html, opts?)` | `POST /api/overlay/widget` | Inject/update HTML overlay widget |
| `removeWidget(id)` | `DELETE /api/overlay/widget/:id` | Remove overlay widget |

### WebSocket Methods & Events

```ts
client.connect()           // open WebSocket (call after setting up handlers)
client.disconnect()        // close WebSocket and stop reconnect
client.isConnected         // boolean getter
```

**Registering handlers:**
```ts
client.on("game-started",  (payload) => { ... })
client.off("game-started", handler)
client.removeAllListeners("game-started")  // remove all for one event
client.removeAllListeners()                // remove all for all events
```

**Wildcard handler** — receives every event:
```ts
client.on("*", ({ type, payload }) => {
  console.log(type, JSON.stringify(payload));
});
```

**All typed events:**

| Event name | Payload type | When fired |
|---|---|---|
| `connected` | `{ version: string }` | After WS handshake accepted |
| `game-started` | `{ path: string }` | When a game starts |
| `game-finished` | `{ path: string, durationSecs: number }` | When a game exits |
| `telemetry` | `{ cpuUsage, ramUsedMb, ramTotalMb, gpuUsage, activeGame }` | Periodic (~5s) |
| `library-updated` | `{}` | After library rescan |
| `notification` | `{ title, body, icon?, source? }` | When a notification is pushed |
| `overlay-widget-push` | `{ id, html, position?, width?, height? }` | When widget is pushed |
| `overlay-widget-remove` | `{ id }` | When widget is removed |
| `volume-requested` | `{ level: number }` | When volume change is requested |

### Utilities

```ts
// Format seconds into a human-readable string
LibmalyClient.formatDuration(7200)     // "2h"
LibmalyClient.formatDuration(3661)     // "1h 1m 1s"
LibmalyClient.formatDuration(90)       // "1m 30s"

// Poll until the API server responds (useful at startup)
// Rejects after timeout (default: 10 000 ms)
await LibmalyClient.waitForReady({ host: "127.0.0.1", port: 39510, token, timeoutMs: 15000 });
```

---

## Integration Patterns & Recipes

### 1. Discord Rich Presence

Listen to `game-started` / `game-finished` to toggle "Now Playing" activity:

```ts
import { setActivity, clearActivity } from "./discord-rpc.js"; // your discord-rpc wrapper

client.on("game-started", async ({ path }) => {
  const game = await client.getGame(path);
  await setActivity({
    details: game.meta?.title ?? game.name ?? "Unknown game",
    state: "Playing",
    largeImageKey: game.meta?.coverUrl,
    startTimestamp: Date.now(),
  });
});

client.on("game-finished", () => clearActivity());
client.connect();
```

### 2. Live Session Timer Widget

Push a widget on start, update it every second, remove it when done:

```ts
let timer: ReturnType<typeof setInterval> | null = null;
let start = 0;

client.on("game-started", async () => {
  start = Date.now();
  timer = setInterval(async () => {
    const elapsed = LibmalyClient.formatDuration((Date.now() - start) / 1000);
    await client.pushWidget("session-timer",
      `<span style="color:#fff;font-size:14px;font-family:monospace">⏱ ${elapsed}</span>`,
      { position: "top-right", width: 140 }
    );
  }, 1000);
});

client.on("game-finished", async () => {
  if (timer) { clearInterval(timer); timer = null; }
  await client.removeWidget("session-timer");
});

client.connect();
```

### 3. Achievement Tracker Integration

After detecting an achievement unlock (from your own tracker logic), notify the overlay:

```ts
async function onAchievementUnlocked(name: string, description: string) {
  await client.notify({
    title: `🏆 Achievement Unlocked`,
    body: `${name} — ${description}`,
    icon: "🏆",
    source: "MyAchievementTracker",
  });
}
```

### 4. Playtime Export to CSV

```ts
import { writeFileSync } from "fs";

const { games } = await client.getLibrary();
const rows = games
  .filter(g => g.stats)
  .sort((a, b) => (b.stats!.totalSecs - a.stats!.totalSecs))
  .map(g => [
    `"${(g.meta?.title ?? g.name ?? g.path).replace(/"/g, '""')}"`,
    LibmalyClient.formatDuration(g.stats!.totalSecs),
    g.stats!.sessionCount,
    g.stats?.lastPlayedMs ? new Date(g.stats.lastPlayedMs).toLocaleDateString() : "Never",
  ].join(","));

writeFileSync("playtime.csv", ["Title,Playtime,Sessions,Last Played", ...rows].join("\n"));
```

### 5. Discord Webhook — Session Summary

Post a message to a Discord channel when a session ends:

```ts
const WEBHOOK = "https://discord.com/api/webhooks/...";

client.on("game-finished", async ({ path, durationSecs }) => {
  const game = await client.getGame(path).catch(() => null);
  const title = game?.meta?.title ?? game?.name ?? path.split(/[/\\]/).pop();
  await fetch(WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      embeds: [{
        title: `🎮 Session ended — ${title}`,
        description: `Played for **${LibmalyClient.formatDuration(durationSecs)}**`,
        color: 0x37a5d8,
        timestamp: new Date().toISOString(),
      }]
    }),
  });
});

client.connect();
```

### 6. CPU Alert Overlay Widget

Show a warning widget if CPU usage exceeds a threshold:

```ts
let alertActive = false;
const CPU_THRESHOLD = 90;

client.on("telemetry", async (t) => {
  if (t.cpuUsage > CPU_THRESHOLD && !alertActive) {
    alertActive = true;
    await client.pushWidget("cpu-alert",
      `<div style="background:rgba(255,60,60,.85);color:#fff;padding:6px 10px;border-radius:6px;font-size:13px">
         ⚠️ CPU ${t.cpuUsage.toFixed(0)}% — high load
       </div>`,
      { position: "bottom-right", width: 260 }
    );
  } else if (t.cpuUsage <= CPU_THRESHOLD - 5 && alertActive) {
    alertActive = false;
    await client.removeWidget("cpu-alert");
  }
});

client.connect();
```

### 7. Browser-based Dashboard (No Build Step)

Open `sdk/examples/dashboard.html` in any browser. It includes an inline copy of the SDK client — no `npm install` required. Enter your host, port, and token to connect.

---

## Error Handling

### HTTP errors

The SDK throws `LibmalyApiError` on non-2xx responses:

```ts
import { LibmalyApiError } from "./libmaly-sdk.js";

try {
  await client.launch("/nonexistent/path.exe");
} catch (e) {
  if (e instanceof LibmalyApiError) {
    console.error(`API error ${e.status}:`, e.body);
  } else {
    throw e; // network error
  }
}
```

### Common HTTP status codes

| Code | Meaning |
|---|---|
| `200` | Success |
| `401` | Missing or invalid bearer token |
| `404` | Endpoint does not exist |
| `500` | Internal server error (Libmaly-side) |

### WebSocket disconnects

The SDK automatically reconnects by default. You can listen for internal disconnect/reconnect events:

```ts
// These are internal SDK events (not broadcast by the server)
client.on("_connected",    () => console.log("WS connected"));
client.on("_disconnected", () => console.log("WS disconnected, will retry..."));
```

To disable auto-reconnect and handle it yourself:

```ts
const client = new LibmalyClient({ token, autoReconnect: false });

client.on("_disconnected", () => {
  setTimeout(() => client.connect(), 5000); // custom backoff
});
```

### Checking if Libmaly is running

Use `LibmalyClient.waitForReady()` at startup:

```ts
try {
  await LibmalyClient.waitForReady({ token, timeoutMs: 15000 });
  console.log("Libmaly is ready");
  client.connect();
} catch {
  console.error("Libmaly is not running or API is not enabled");
  process.exit(1);
}
```

---

## Security Considerations

**The API server only binds to `127.0.0.1` (loopback).** It is not reachable from other machines on the network.

However, because it runs locally, any process on the machine can attempt to connect. Therefore:

- **Never hardcode tokens** in your tool's source code or distribute them.
- **Prompt the user to paste the token** from Settings → 🌐 API.
- **Store the token securely** — use your OS keychain (e.g., `keytar` for Node.js), not a plaintext config file.
- **Regenerate the token** if you suspect it has been compromised (Settings → 🌐 API → Regenerate).
- **Keep CORS restrictive** — only add origins you control; avoid `*` unless you're building a local browser dashboard that opens from `file://`.
- **Validate HTML before injecting widgets** — the overlay renders HTML from your tool. Do not pipe unsanitized user input or remote content directly into `pushWidget()`.

---

## Example Files Reference

All examples live in `sdk/examples/` and can be run with `ts-node --esm` or compiled with `tsc`.

| File | What it demonstrates |
|---|---|
| [`01-status.ts`](examples/01-status.ts) | Fetch and print version, uptime, active game, CPU/RAM |
| [`02-library.ts`](examples/02-library.ts) | Load full library, sort by playtime, print as a table |
| [`03-launch.ts`](examples/03-launch.ts) | Fuzzy-search library by name fragment, launch the best match |
| [`04-notify.ts`](examples/04-notify.ts) | Push a custom notification toast to the overlay |
| [`05-widget.ts`](examples/05-widget.ts) | Live session timer as an overlay widget (updates every second, Ctrl+C to remove) |
| [`06-events.ts`](examples/06-events.ts) | Subscribe to all WebSocket events and print them with timestamps |
| [`dashboard.html`](examples/dashboard.html) | Self-contained HTML+JS dashboard — open in browser, no build step |

**Running an example:**
```sh
cd sdk
npm install          # only for ts-node + ws (not needed for Node 22+)
npx ts-node --esm examples/01-status.ts
```

Set `LIBMALY_TOKEN` as an environment variable or edit the `TOKEN` constant at the top of each example file.
