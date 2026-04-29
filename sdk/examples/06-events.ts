/**
 * Example 06 — Subscribe to real-time WebSocket events
 *
 * Connects to Libmaly and logs all events as they arrive.
 * Demonstrates game-started, game-finished, telemetry, and custom events.
 *
 * Usage:
 *   LIBMALY_TOKEN=your-token npx ts-node --esm 06-events.ts
 *   Press Ctrl+C to disconnect.
 *
 * Node.js < 22: install `ws` and pass it as WebSocketImpl:
 *   npm install ws @types/ws
 *   Then change: import WebSocket from "ws"
 *             and add: WebSocketImpl: WebSocket
 */

import { LibmalyClient } from "../libmaly-sdk.js";

const TOKEN = process.env.LIBMALY_TOKEN ?? "";
const PORT = Number(process.env.LIBMALY_PORT ?? 39510);

if (!TOKEN) {
  console.error("Set LIBMALY_TOKEN to your bearer token.");
  process.exit(1);
}

const client = new LibmalyClient({
  token: TOKEN,
  port: PORT,
  autoReconnect: true,
  reconnectDelayMs: 3000,

  // Uncomment for Node.js < 22:
  // WebSocketImpl: (await import("ws")).default as unknown as typeof WebSocket,
});

client
  .on("connected", ({ version }) => {
    console.log(`✅  Connected to Libmaly ${version}`);
  })
  .on("game-started", ({ path }) => {
    console.log(`▶  Game started: ${path}`);
  })
  .on("game-finished", ({ path, durationSecs }) => {
    console.log(
      `⏹  Game finished: ${path}  (${LibmalyClient.formatDuration(durationSecs)})`,
    );
  })
  .on("telemetry", ({ cpuUsage, ramUsedMb, ramTotalMb, activeGame }) => {
    const game = activeGame ? `  game: ${activeGame.exe}` : "";
    process.stdout.write(
      `\r📊  CPU ${cpuUsage.toFixed(1).padStart(5)}%  RAM ${ramUsedMb}/${ramTotalMb} MB${game.slice(0, 40).padEnd(42)}`,
    );
  })
  .on("library-updated", () => {
    console.log("\n📚  Library updated");
  })
  .on("notification", ({ title, body }) => {
    console.log(`\n🔔  Notification: ${title} — ${body}`);
  })
  .on("overlay-widget-push", ({ id, position }) => {
    console.log(`\n🖼  Widget pushed: ${id} @ ${position ?? "bottom-right"}`);
  })
  .on("overlay-widget-remove", ({ id }) => {
    console.log(`\n🗑  Widget removed: ${id}`);
  });

client.connect();
console.log(`Connecting to ws://127.0.0.1:${PORT}/ws …`);

process.on("SIGINT", () => {
  client.disconnect();
  console.log("\nDisconnected.");
  process.exit(0);
});

// Keep process alive
setInterval(() => {}, 10_000);
