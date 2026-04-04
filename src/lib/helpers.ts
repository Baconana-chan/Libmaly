// ─── Path Helpers ─────────────────────────────────────────────────────────────

export function normalizePathForMatch(path: string) {
  return path.trim().replace(/\\/g, "/").toLowerCase();
}

export function normalizePathNoCase(path: string) {
  return path.trim().replace(/\\/g, "/").replace(/\/+$/, "");
}

export function pathDirname(path: string) {
  const norm = path.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  const idx = norm.lastIndexOf("/");
  if (idx <= 0) return idx === 0 ? "/" : "";
  return norm.slice(0, idx);
}

export function remapPathByRoot(path: string, oldRoot: string, newRoot: string): string | null {
  const src = normalizePathNoCase(path);
  const oldN = normalizePathNoCase(oldRoot);
  const newN = normalizePathNoCase(newRoot);
  const srcL = src.toLowerCase();
  const oldL = oldN.toLowerCase();
  if (!(srcL === oldL || srcL.startsWith(`${oldL}/`))) return null;
  const suffix = src.slice(oldN.length);
  const mappedUnix = `${newN}${suffix}`;
  const preferBackslash = newRoot.includes("\\") && !newRoot.includes("/");
  return preferBackslash ? mappedUnix.replace(/\//g, "\\") : mappedUnix;
}

export function remapPathByPrefix(path: string, oldPrefix: string, newPrefix: string): string | null {
  const src = normalizePathNoCase(path);
  const oldN = normalizePathNoCase(oldPrefix);
  const newN = normalizePathNoCase(newPrefix);
  const srcL = src.toLowerCase();
  const oldL = oldN.toLowerCase();
  if (!(srcL === oldL || srcL.startsWith(`${oldL}/`))) return null;
  const suffix = src.slice(oldN.length);
  const mappedUnix = `${newN}${suffix}`;
  const preferBackslash = newPrefix.includes("\\") && !newPrefix.includes("/");
  return preferBackslash ? mappedUnix.replace(/\//g, "\\") : mappedUnix;
}

export function pathSegmentsRelativeToRoot(path: string, roots: { path: string }[]) {
  const normalizedPath = normalizePathNoCase(path);
  const matchedRoot = roots
    .slice()
    .sort((a, b) => normalizePathNoCase(b.path).length - normalizePathNoCase(a.path).length)
    .find((root) => {
      const normalizedRoot = normalizePathNoCase(root.path);
      const pathLower = normalizedPath.toLowerCase();
      const rootLower = normalizedRoot.toLowerCase();
      return pathLower === rootLower || pathLower.startsWith(`${rootLower}/`);
    });
  if (!matchedRoot) return [];
  const rootNormalized = normalizePathNoCase(matchedRoot.path);
  const suffix = normalizedPath.slice(rootNormalized.length).replace(/^\/+/, "");
  return suffix ? suffix.split("/").filter(Boolean) : [];
}

// ─── Game Name Derivation ─────────────────────────────────────────────────────

import { GENERIC_EXE_NAMES } from "./constants";

export function deriveGameName(exePath: string): string {
  const parts = exePath.replace(/\\/g, "/").split("/");
  const fileName = parts[parts.length - 1] ?? exePath;
  const stem = fileName.replace(/\.[^.]+$/, "");
  if (GENERIC_EXE_NAMES.has(stem.toLowerCase()) && parts.length >= 2) {
    return parts[parts.length - 2]; // parent folder name
  }
  return stem;
}

// ─── Deep Link Parsing ────────────────────────────────────────────────────────

export function parseDeepLinkUrl(rawUrl: string): { mode: "path" | "name"; value: string } | null {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== "libmaly:") return null;
    if (u.hostname === "launch") {
      const path = decodeURIComponent(u.pathname.slice(1));
      if (path) return { mode: "path", value: path };
    }
    if (u.hostname === "launch-name") {
      const name = decodeURIComponent(u.pathname.slice(1));
      if (name) return { mode: "name", value: name };
    }
    return null;
  } catch {
    const pathMatch = rawUrl.match(/^libmaly:\/\/launch\/(.+)$/i);
    if (pathMatch?.[1]) return { mode: "path", value: decodeURIComponent(pathMatch[1]) };
    const nameMatch = rawUrl.match(/^libmaly:\/\/launch-name\/(.+)$/i);
    if (nameMatch?.[1]) return { mode: "name", value: decodeURIComponent(nameMatch[1]) };
    return null;
  }
}

// ─── Season Detection ─────────────────────────────────────────────────────────

export function resolveSeasonFromDate(date: Date): "winter" | "summer" | "halloween" | "none" {
  const m = date.getMonth(); // 0-11
  if (m === 9) return "halloween";
  if (m === 11 || m === 0 || m === 1) return "winter";
  if (m >= 5 && m <= 7) return "summer";
  return "none";
}

// ─── Metadata Source Helpers ──────────────────────────────────────────────────

export function isF95Url(url: string) { return url.includes("f95zone.to"); }
export function isDLsiteUrl(url: string) { return url.includes("dlsite.com"); }
export function isVNDBUrl(url: string) { return /vndb\.org\/v\d+/i.test(url); }
export function isMangaGamerUrl(url: string) { return /mangagamer\.com/i.test(url); }
export function isJohrenUrl(url: string) { return /johren\.net/i.test(url); }
export function isFakkuUrl(url: string) { return /fakku\.net/i.test(url); }

export function detectMetadataSourceFromUrl(url: string): string | null {
  if (isF95Url(url)) return "f95";
  if (isDLsiteUrl(url)) return "dlsite";
  if (isVNDBUrl(url)) return "vndb";
  if (isMangaGamerUrl(url)) return "mangagamer";
  if (isJohrenUrl(url)) return "johren";
  if (isFakkuUrl(url)) return "fakku";
  return null;
}

export function metadataFetchCommand(source: string) {
  if (source === "f95") return "fetch_f95_metadata";
  if (source === "dlsite") return "fetch_dlsite_metadata";
  if (source === "vndb") return "fetch_vndb_metadata";
  if (source === "mangagamer") return "fetch_mangagamer_metadata";
  if (source === "johren") return "fetch_johren_metadata";
  if (source === "fakku") return "fetch_fakku_metadata";
  return null;
}

export function metadataSourceLabel(source?: string) {
  if (source === "f95") return "F95zone";
  if (source === "dlsite") return "DLsite";
  if (source === "vndb") return "VNDB";
  if (source === "mangagamer") return "MangaGamer";
  if (source === "johren") return "Johren";
  if (source === "fakku") return "FAKKU";
  return "Unknown";
}

// ─── Color Helpers ────────────────────────────────────────────────────────────

export function normalizeHexColor(input: string, fallback: string) {
  const x = (input || "").trim();
  const hex = x.startsWith("#") ? x : `#${x}`;
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.toLowerCase() : fallback;
}

export function shiftHexColor(hex: string, amount: number) {
  const safe = normalizeHexColor(hex, "#66c0f4");
  const r = parseInt(safe.slice(1, 3), 16);
  const g = parseInt(safe.slice(3, 5), 16);
  const b = parseInt(safe.slice(5, 7), 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const toHex = (v: number) => clamp(v).toString(16).padStart(2, "0");
  const factor = amount >= 0 ? 1 + amount : 1 - Math.abs(amount);
  return `#${toHex(r * factor)}${toHex(g * factor)}${toHex(b * factor)}`;
}

// ─── Rating Helpers ───────────────────────────────────────────────────────────

import { RATING_CATEGORIES } from "./constants";

export function clampScore100(v: number) {
  return Math.max(0, Math.min(100, Math.round(v)));
}

export function formatScoreForScale(score100: number, scale: string) {
  const s = clampScore100(score100);
  if (scale === "10") return `${Math.round(s / 10)}/10`;
  if (scale === "10_decimal") return `${(s / 10).toFixed(1)}/10`;
  if (scale === "100") return `${s}/100`;
  if (scale === "5_star") return `${(s / 20).toFixed(1)}/5`;
  if (s <= 40) return "😞";
  if (s <= 75) return "😐";
  return "😄";
}

export function categoryAverageScore100(custom?: { categoryRatings?: Record<string, number> }) {
  if (!custom?.categoryRatings) return undefined;
  const values = RATING_CATEGORIES
    .map((c) => custom.categoryRatings?.[c.key])
    .filter((v): v is number => typeof v === "number" && !Number.isNaN(v))
    .map(clampScore100);
  if (values.length === 0) return undefined;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

export function resolveOverallScore100(custom?: {
  ratingMode?: string;
  overallScore100?: number;
  personalRating?: number;
  categoryRatings?: Record<string, number>;
}) {
  if (!custom) return undefined;
  if (custom.ratingMode === "categories") {
    const avg = categoryAverageScore100(custom);
    if (typeof avg === "number") return avg;
  }
  if (typeof custom.overallScore100 === "number") return clampScore100(custom.overallScore100);
  if (typeof custom.personalRating === "number") return clampScore100(custom.personalRating * 10);
  return categoryAverageScore100(custom);
}

// ─── RSS Feed Helpers ─────────────────────────────────────────────────────────

import { DEFAULT_SETTINGS } from "./constants";

export function mergeDefaultRssFeeds(existing: { url: string; name: string; enabled?: boolean }[] | undefined) {
  const base = (existing || []).map((f) => ({ ...f, enabled: f.enabled !== false }));
  const seen = new Set(base.map((f) => f.url.trim().toLowerCase()));
  for (const def of DEFAULT_SETTINGS.rssFeeds) {
    const key = def.url.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    base.push({ ...def, enabled: def.enabled !== false });
    seen.add(key);
  }
  return base;
}

// ─── Time Formatting ──────────────────────────────────────────────────────────

export function formatTime(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h} hrs ${m} mins`;
  if (m > 0) return `${m} mins`;
  return "< 1 min";
}

// ─── Hero Gradient ────────────────────────────────────────────────────────────

export function heroGradient(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  const hue = Math.abs(h) % 360;
  return `linear-gradient(135deg,hsl(${hue},40%,15%) 0%,hsl(${(hue + 50) % 360},55%,25%) 100%)`;
}

// ─── Context Menu Helper ──────────────────────────────────────────────────────

export function allowsNativeContextMenu(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const editable = target.closest(
    'input, textarea, select, [contenteditable=""], [contenteditable="true"], [data-allow-native-context-menu="true"]',
  );
  return !!editable || (target instanceof HTMLElement && target.isContentEditable);
}

// ─── Background Job Helpers ───────────────────────────────────────────────────

import { BACKGROUND_JOB_BUSY_STATUSES } from "./constants";

export function isBackgroundJobBusy(status: string) {
  return BACKGROUND_JOB_BUSY_STATUSES.includes(status as any);
}

export function backgroundJobButtonLabel(job: { status: string; detail?: string | null } | null | undefined, fallback: string) {
  if (!job) return fallback;
  if (job.detail?.trim()) return job.detail.trim();
  switch (job.status) {
    case "queued": return "Queued";
    case "running": return "Running";
    case "retrying": return "Retrying";
    case "failed": return "Failed";
    case "permanent_failed": return "Stopped";
    default: return fallback;
  }
}

// ─── Sleep Helper ─────────────────────────────────────────────────────────────

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
