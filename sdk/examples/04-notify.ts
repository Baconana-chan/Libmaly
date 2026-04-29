/**
 * Example 04 — Push a notification into the Libmaly overlay
 *
 * Sends a notification toast to the Libmaly in-game overlay.
 * Works whether or not a game is currently running.
 *
 * Usage:
 *   LIBMALY_TOKEN=your-token npx ts-node --esm 04-notify.ts
 */

import { LibmalyClient } from "../libmaly-sdk.js";

const TOKEN = process.env.LIBMALY_TOKEN ?? "";
const PORT = Number(process.env.LIBMALY_PORT ?? 39510);

if (!TOKEN) {
  console.error("Set LIBMALY_TOKEN to your bearer token.");
  process.exit(1);
}

const client = new LibmalyClient({ token: TOKEN, port: PORT });

await client.notify({
  title: "Build finished ✅",
  body: "Your project compiled successfully. Time to test it in-game!",
  icon: "🚀",
});

console.log("Notification sent to Libmaly overlay.");
