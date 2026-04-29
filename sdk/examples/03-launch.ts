/**
 * Example 03 — Launch a game by name
 *
 * Fuzzy-search the library and launch the best match.
 *
 * Usage:
 *   LIBMALY_TOKEN=your-token npx ts-node --esm 03-launch.ts "game name"
 */

import { LibmalyClient } from "../libmaly-sdk.js";

const TOKEN = process.env.LIBMALY_TOKEN ?? "";
const PORT = Number(process.env.LIBMALY_PORT ?? 39510);
const query = process.argv[2] ?? "";

if (!TOKEN) {
  console.error("Set LIBMALY_TOKEN to your bearer token.");
  process.exit(1);
}
if (!query) {
  console.error("Usage: 03-launch.ts <game-name-fragment>");
  process.exit(1);
}

const client = new LibmalyClient({ token: TOKEN, port: PORT });
const { games } = await client.getLibrary();

// Simple substring match, case-insensitive
const q = query.toLowerCase();
const matches = games.filter(
  (g) =>
    (g.name ?? g.path).toLowerCase().includes(q) ||
    g.path.toLowerCase().includes(q),
);

if (matches.length === 0) {
  console.error(`No games match "${query}".`);
  process.exit(1);
}

const game = matches[0];
console.log(`Launching: ${game.name ?? game.path}`);
console.log(`  Path: ${game.path}`);

await client.launch(game.path);
console.log("Launch request sent. Libmaly will start the game.");
