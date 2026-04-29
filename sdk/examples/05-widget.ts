/**
 * Example 05 — Overlay widget: live session timer
 *
 * Injects a small HTML widget into the in-game overlay that counts up
 * the elapsed session time, updating every second.
 *
 * The widget is injected via POST /api/overlay/widget and re-pushed every
 * second with updated HTML. Call removeWidget() to clean up.
 *
 * Usage:
 *   LIBMALY_TOKEN=your-token npx ts-node --esm 05-widget.ts
 *   Press Ctrl+C to remove the widget and exit.
 */

import { LibmalyClient } from "../libmaly-sdk.js";

const TOKEN = process.env.LIBMALY_TOKEN ?? "";
const PORT = Number(process.env.LIBMALY_PORT ?? 39510);

if (!TOKEN) {
  console.error("Set LIBMALY_TOKEN to your bearer token.");
  process.exit(1);
}

const client = new LibmalyClient({ token: TOKEN, port: PORT });
const WIDGET_ID = "sdk-session-timer";

const startedAt = Date.now();

function buildHtml(elapsedMs: number): string {
  const secs = Math.floor(elapsedMs / 1000);
  const h = String(Math.floor(secs / 3600)).padStart(2, "0");
  const m = String(Math.floor((secs % 3600) / 60)).padStart(2, "0");
  const s = String(secs % 60).padStart(2, "0");
  return `
    <div style="
      font-family: monospace;
      font-size: 13px;
      color: #d0e8ff;
      background: rgba(8,14,24,0.85);
      border: 1px solid rgba(100,160,220,0.3);
      border-radius: 8px;
      padding: 6px 12px;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    ">
      <span style="opacity:0.6; font-size:10px;">SESSION</span>
      <span style="font-size:16px; font-weight:bold; letter-spacing:0.08em;">${h}:${m}:${s}</span>
    </div>
  `;
}

// Push widget immediately
await client.pushWidget(WIDGET_ID, buildHtml(0), {
  position: "top-right",
  width: 200,
});
console.log(`Widget "${WIDGET_ID}" pushed to overlay (top-right).`);
console.log("Press Ctrl+C to remove it.");

// Update every second
const interval = setInterval(async () => {
  try {
    await client.pushWidget(WIDGET_ID, buildHtml(Date.now() - startedAt), {
      position: "top-right",
      width: 200,
    });
  } catch {
    // Game may not be running — ignore silently
  }
}, 1000);

// Clean up on exit
process.on("SIGINT", async () => {
  clearInterval(interval);
  await client.removeWidget(WIDGET_ID).catch(() => {});
  console.log("\nWidget removed.");
  process.exit(0);
});
