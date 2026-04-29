import { invoke } from "@tauri-apps/api/core";
import type { SessionEntry } from "../types";

// ── Types ──────────────────────────────────────────────────────────────────────

/** Persisted trending configuration. */
export interface TrendingConfig {
  /** Whether the user has opted in. Default: false. */
  enabled: boolean;
  /** Unix timestamp (seconds) of the last successful contribution. */
  lastContributedAtSecs: number | null;
}

/** One game submitted in a contribution — all personal data stripped. */
export interface ContributionItem {
  /** Game title only — no paths. */
  title: string;
  /** Hours played this week, rounded to nearest 0.5 h. */
  hoursBucket: number;
}

/** One entry in the global trending list. */
export interface TrendingEntry {
  title: string;
  /** 1-based rank. */
  rank: number;
  /** Relay-aggregated approximate total hours. */
  totalHoursApprox: number;
  /** Number of contributors who reported this title. */
  contributorCount: number;
}

/** Full response from the relay's trending endpoint. */
export interface TrendingResult {
  entries: TrendingEntry[];
  /** ISO-8601 week start date (relay-provided, informational). */
  weekStart: string | null;
  /** Total contributor count for this week (informational). */
  totalContributors: number | null;
}

// ── Invoke wrappers ────────────────────────────────────────────────────────────

export const invokeGetTrendingConfig = (): Promise<TrendingConfig> =>
  invoke<TrendingConfig>("trending_get_config");

export const invokeSaveTrendingConfig = (config: TrendingConfig): Promise<void> =>
  invoke<void>("trending_save_config", { config });

export const invokeTrendingFetch = (
  relayUrl: string,
  limit = 20,
): Promise<TrendingResult> =>
  invoke<TrendingResult>("trending_fetch", { relayUrl, limit });

/**
 * Contribute anonymized weekly play stats to the relay.
 * The frontend computes `entries` from local session data — no paths or
 * identity fields are included.  Rate-limited to once per 24 h.
 */
export const invokeTrendingContribute = (
  relayUrl: string,
  entries: ContributionItem[],
): Promise<void> =>
  invoke<void>("trending_contribute", { relayUrl, entries });

/** Seconds until the next contribution is allowed (0 = can contribute now). */
export const invokeTrendingCooldownSecs = (): Promise<number> =>
  invoke<number>("trending_contribution_cooldown_secs");

// ── Client-side stats helpers ─────────────────────────────────────────────────

/** Current week start in Unix seconds (Monday 00:00 UTC). */
function weekStartSecs(): number {
  const now = Date.now() / 1000;
  // Days since Unix epoch, adjusted to Monday = 0
  const daysSinceEpoch = Math.floor(now / 86400);
  const dow = (daysSinceEpoch + 4) % 7; // Thursday 1970-01-01 = index 3 → Mon = 0
  return (daysSinceEpoch - dow) * 86400;
}

/**
 * Compute anonymized contribution entries from local session data.
 *
 * - Filters to sessions in the current 7-day week (Mon–Sun UTC).
 * - Groups by `gameTitle` (passed via `titleResolver`).
 * - Strips all paths — only titles are included.
 * - Rounds hours to the nearest 0.5 h.
 * - Excludes titles with < 0.5 h played this week.
 * - Sorts descending by hours.
 */
export function computeWeeklyContributions(
  sessions: SessionEntry[],
  /** Resolve a game path → display title.  Return null to skip. */
  titleResolver: (path: string) => string | null,
): ContributionItem[] {
  const weekStart = weekStartSecs() * 1000; // ms
  const weekEnd   = weekStart + 7 * 86400 * 1000;

  const hoursByTitle = new Map<string, number>();

  for (const s of sessions) {
    if (s.startedAt < weekStart || s.startedAt >= weekEnd) continue;
    const title = titleResolver(s.path);
    if (!title) continue;
    const key = title.trim();
    if (!key) continue;
    hoursByTitle.set(key, (hoursByTitle.get(key) ?? 0) + s.duration / 3600);
  }

  return Array.from(hoursByTitle.entries())
    .map(([title, rawHours]) => ({
      title,
      hoursBucket: Math.round(rawHours * 2) / 2,
    }))
    .filter((e) => e.hoursBucket >= 0.5)
    .sort((a, b) => b.hoursBucket - a.hoursBucket);
}

/** Human-readable cooldown string from seconds. */
export function formatCooldown(secs: number): string {
  if (secs <= 0) return "";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
