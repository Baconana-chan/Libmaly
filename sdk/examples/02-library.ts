/**
 * Example 02 — Library listing
 *
 * Print all games in the library with their playtime.
 *
 * Usage:
 *   LIBMALY_TOKEN=your-token-here npx ts-node --esm 02-library.ts
 */

import { LibmalyClient } from "../libmaly-sdk.js";

const TOKEN = process.env.LIBMALY_TOKEN ?? "";
const PORT = Number(process.env.LIBMALY_PORT ?? 39510);

if (!TOKEN) {
  console.error("Set LIBMALY_TOKEN to your bearer token.");
  process.exit(1);
}

const client = new LibmalyClient({ token: TOKEN, port: PORT });
const { games } = await client.getLibrary();

if (games.length === 0) {
  console.log("Library is empty.");
  process.exit(0);
}

// Sort by playtime descending
const sorted = [...games].sort(
  (a, b) => (b.stats?.totalSecs ?? 0) - (a.stats?.totalSecs ?? 0),
);

const nameWidth = Math.min(
  40,
  Math.max(...sorted.map((g) => (g.name ?? g.path).length)),
);

console.log(
  `${"Game".padEnd(nameWidth)}  ${"Playtime".padStart(10)}  Sessions`,
);
console.log("-".repeat(nameWidth + 24));

for (const game of sorted) {
  const name = (game.name ?? game.path).slice(0, nameWidth).padEnd(nameWidth);
  const playtime = LibmalyClient.formatDuration(
    game.stats?.totalSecs ?? 0,
  ).padStart(10);
  const sessions = String(game.stats?.sessionCount ?? 0).padStart(8);
  console.log(`${name}  ${playtime}  ${sessions}`);
}

console.log();
console.log(
  `${games.length} game(s) — total ${LibmalyClient.formatDuration(
    games.reduce((acc, g) => acc + (g.stats?.totalSecs ?? 0), 0),
  )}`,
);
