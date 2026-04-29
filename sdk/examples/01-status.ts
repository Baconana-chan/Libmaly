/**
 * Example 01 — Status check
 *
 * Print the current Libmaly status: version, active game, and system telemetry.
 *
 * Usage:
 *   LIBMALY_TOKEN=your-token-here npx ts-node --esm 01-status.ts
 */

import { LibmalyClient } from "../libmaly-sdk.js";

const TOKEN = process.env.LIBMALY_TOKEN ?? "";
const PORT = Number(process.env.LIBMALY_PORT ?? 39510);

if (!TOKEN) {
  console.error("Set LIBMALY_TOKEN to your bearer token (Settings → 🌐 API)");
  process.exit(1);
}

const client = new LibmalyClient({ token: TOKEN, port: PORT });

const status = await client.getStatus();

console.log(`Libmaly ${status.version}  (uptime ${LibmalyClient.formatDuration(status.uptimeSecs)})`);
console.log();

if (status.activeGame) {
  console.log(`▶  Running: ${status.activeGame.exe}  (pid ${status.activeGame.pid})`);
} else {
  console.log("   No game running.");
}

console.log();
console.log("System telemetry:");
console.log(`  CPU  ${status.telemetry.cpuUsage.toFixed(1)} %`);
console.log(
  `  RAM  ${status.telemetry.ramUsedMb} MB / ${status.telemetry.ramTotalMb} MB`,
);
if (status.telemetry.gpuName) {
  console.log(
    `  GPU  ${status.telemetry.gpuUsage?.toFixed(1) ?? "?"} %  (${status.telemetry.gpuName})`,
  );
}
