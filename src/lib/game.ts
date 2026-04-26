// ─── Game / Store Utility Functions ──────────────────────────────────────────
// Store path helpers, ownership grouping, and provider label functions
// extracted from App.tsx.

import type { Game, GameCustomization, GameMetadata } from "../types";
import { STEAM_PLACEHOLDER_PREFIX, EPIC_PLACEHOLDER_PREFIX, STORE_PROVIDER_LABELS } from "../types";
import { normalizePathForMatch } from "./helpers";
import type { GameAchievementItem } from "./gameAchievements";

// ─── Placeholder path helpers ─────────────────────────────────────────────────

export function steamPlaceholderPath(appId: string) {
  return `${STEAM_PLACEHOLDER_PREFIX}${appId.trim()}`;
}

export function epicPlaceholderPath(appName: string) {
  return `${EPIC_PLACEHOLDER_PREFIX}${appName.trim()}`;
}

export function isSteamPlaceholderPath(path: string) {
  return normalizePathForMatch(path).startsWith(STEAM_PLACEHOLDER_PREFIX);
}

export function isEpicPlaceholderPath(path: string) {
  return normalizePathForMatch(path).startsWith(EPIC_PLACEHOLDER_PREFIX);
}

// ─── Store / provider labels ──────────────────────────────────────────────────

export function storeProviderLabel(source?: string | null) {
  if (!source) return "Store";
  return STORE_PROVIDER_LABELS[source] ?? source;
}

export function resolvedGameDisplayName(
  game: Game,
  customizations: Record<string, GameCustomization>,
  metadata: Record<string, GameMetadata>,
) {
  return customizations[game.path]?.displayName ?? metadata[game.path]?.title ?? game.name;
}

// ─── Ownership / grouping ─────────────────────────────────────────────────────

export function normalizeOwnershipToken(value?: string | null) {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/["'`']/g, "")
    .replace(/\b(the|edition|complete|definitive|ultimate|goty|game of the year)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function ownershipDeveloperToken(customization?: GameCustomization, meta?: GameMetadata) {
  return normalizeOwnershipToken(
    customization?.manualDeveloper
    ?? meta?.developer
    ?? meta?.circle
    ?? meta?.author
    ?? null
  );
}

export function ownershipGroupingKey(
  game: Game,
  customizations: Record<string, GameCustomization>,
  metadata: Record<string, GameMetadata>,
) {
  const meta = metadata[game.path];
  const customization = customizations[game.path];
  const sourceUrl = normalizeOwnershipToken(meta?.source_url);
  if (sourceUrl) return `url:${sourceUrl}`;
  const title = normalizeOwnershipToken(resolvedGameDisplayName(game, customizations, metadata));
  const developer = ownershipDeveloperToken(customization, meta);
  if (title) {
    return developer ? `title:${title}::dev:${developer}` : `title:${title}`;
  }
  return `path:${normalizePathForMatch(game.path)}`;
}

// ─── Launch / install labels ──────────────────────────────────────────────────

export function launchProviderLabelForGame(game: Game, customization?: GameCustomization) {
  if (customization?.steamAppId) return "Steam";
  if (customization?.epicAppName) return "Epic Games Store";
  if (customization?.itchGameId || customization?.itchCaveId) return "itch.io";
  if (customization?.storeProvider) return storeProviderLabel(customization.storeProvider);
  if (game.uninstalled) return "Library";
  return "Local";
}

export function remoteInstallLabelForCustomization(customization?: GameCustomization) {
  if (!customization) return null;
  if (customization.steamAppId?.trim()) return "Install via Steam";
  if (customization.epicAppName?.trim()) return "Install via Epic Games Store";
  if (customization.storeProvider === "ubisoft-connect" && customization.storeGameId?.trim()) {
    return `Install via ${storeProviderLabel(customization.storeProvider)}`;
  }
  return null;
}

export function openStoreLabelForCustomization(customization?: GameCustomization) {
  if (!customization?.storeLaunchUri?.trim()) return null;
  if (customization.storeProvider) {
    return `Open in ${storeProviderLabel(customization.storeProvider)}`;
  }
  return "Open in Launcher";
}

export function ownershipPrimaryRank(
  game: Game,
  customization: GameCustomization | undefined,
  meta: GameMetadata | undefined,
) {
  let score = 0;
  if (!game.uninstalled && !isSteamPlaceholderPath(game.path) && !isEpicPlaceholderPath(game.path)) score += 40;
  if (!game.uninstalled) score += 20;
  if (customization?.coverUrl || meta?.cover_url) score += 10;
  if (customization?.displayName || meta?.title) score += 6;
  if (meta?.overview || meta?.developer || meta?.version) score += 4;
  if (customization?.steamAppId || customization?.epicAppName || customization?.storeLaunchUri || customization?.itchGameId) score += 2;
  return score;
}

// ─── Achievement UI state ─────────────────────────────────────────────────────

export function achievementTrackerUiState(items: GameAchievementItem[] | undefined): { summary: string | null; openGoals: boolean } {
  const list = items ?? [];
  const total = list.length;
  if (total === 0) return { summary: null, openGoals: false };
  const done = list.filter((i) => i.done).length;
  return { summary: `${done}/${total}`, openGoals: done < total };
}
