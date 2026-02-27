import { useState, useEffect, useRef, useMemo, useCallback } from "preact/hooks";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getVersion } from "@tauri-apps/api/app";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { listen } from "@tauri-apps/api/event";
import { register as registerGlobalShortcut, unregister as unregisterGlobalShortcut } from "@tauri-apps/plugin-global-shortcut";
import { getCurrent as getCurrentDeepLinks, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { getMatches } from "@tauri-apps/plugin-cli";
import { enable as enableAutostart, disable as disableAutostart, isEnabled as isAutostartEnabled } from "@tauri-apps/plugin-autostart";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { marked } from "marked";
import { CommandPalette } from "./components/CommandPalette";
import { NsfwOverlay } from "./components/common/NsfwOverlay";
import { GameDetail } from "./components/game/GameDetail";
import { AppUpdateModal } from "./components/modals/AppUpdateModal";
import { CrashReportModal, LogViewerModal } from "./components/modals/DiagnosticsModals";
import { MigrationWizardModal, SettingsModal } from "./components/modals/SettingsModal";
import { ScreenshotAnnotateModal } from "./components/modals/ScreenshotAnnotateModal";
import { FeedView } from "./components/views/FeedView";
import { HomeView } from "./components/views/HomeView";
import { StatsView } from "./components/views/StatsView";
import { mergeFolderGames, mergeFolderMtimes } from "./lib/scanner";
import { appStorageGetItem, appStorageSetItem } from "./lib/appStorage";
import "./App.css";

// ─── Virtual list hook ────────────────────────────────────────────────────────
/** Renders only the visible slice of a list, dramatically reducing DOM nodes for
 *  large libraries. Each item declares its own height for accurate positioning. */
function useVirtualList<T>(
  items: T[],
  getHeight: (item: T) => number,
  overscan = 5,
) {
  const [scrollTop, setScrollTop] = useState(0);
  const [containerH, setContainerH] = useState(600);
  const [containerEl, setContainerEl] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!containerEl) return;
    const onScroll = () => setScrollTop(containerEl.scrollTop);
    const ro = new ResizeObserver(() => setContainerH(containerEl.clientHeight));
    containerEl.addEventListener("scroll", onScroll, { passive: true });
    ro.observe(containerEl);
    setContainerH(containerEl.clientHeight);
    return () => { containerEl.removeEventListener("scroll", onScroll); ro.disconnect(); };
  }, [containerEl]);

  const state = useMemo(() => {
    if (items.length === 0) return { virtualItems: [], totalHeight: 0, offsetTop: 0 };

    // Build cumulative offsets
    const offsets = new Array<number>(items.length + 1);
    offsets[0] = 0;
    for (let i = 0; i < items.length; i++) {
      offsets[i + 1] = offsets[i] + getHeight(items[i]);
    }
    const totalHeight = offsets[items.length];

    // Find visible range
    const top = Math.max(0, scrollTop);
    const bottom = top + containerH;

    let start = 0;
    let end = items.length - 1;
    // Binary search for start
    let lo = 0, hi = items.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (offsets[mid + 1] < top) lo = mid + 1;
      else hi = mid - 1;
    }
    start = Math.max(0, lo - overscan);
    // Find end
    lo = start; hi = items.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (offsets[mid] < bottom) lo = mid + 1;
      else hi = mid - 1;
    }
    end = Math.min(items.length - 1, lo + overscan);

    return {
      virtualItems: items.slice(start, end + 1).map((item, i) => ({
        item,
        index: start + i,
        offsetTop: offsets[start + i],
      })),
      totalHeight,
      offsetTop: offsets[start],
    };
  }, [items, getHeight, scrollTop, containerH, overscan]); // eslint-disable-line

  const scrollToIndex = useCallback((index: number) => {
    if (!containerEl || index < 0 || index >= items.length) return;
    // We recreate the offsets here (cheap enough)
    const offsets = new Array<number>(items.length + 1);
    offsets[0] = 0;
    for (let i = 0; i < items.length; i++) offsets[i + 1] = offsets[i] + getHeight(items[i]);

    const top = offsets[index];
    const bottom = offsets[index + 1];
    if (top < containerEl.scrollTop) {
      containerEl.scrollTop = top;
    } else if (bottom > containerEl.scrollTop + containerEl.clientHeight) {
      containerEl.scrollTop = bottom - containerEl.clientHeight;
    }
  }, [items, getHeight, containerEl]);

  return { ...state, scrollToIndex, containerRef: setContainerEl };
}


// ─── Types ────────────────────────────────────────────────────────────────────

interface Game { name: string; path: string; uninstalled?: boolean; }
interface DirMtime { path: string; mtime: number; }
interface GameStats { totalTime: number; lastPlayed: number; lastSession: number; launchCount: number; }
/** One recorded play session */
interface SessionEntry {
  id: string;        // unique: timestamp string
  path: string;      // game path (key into other maps)
  startedAt: number; // Unix ms — when the session began
  duration: number;  // seconds
  note: string;      // optional session note, empty string if none
}
interface SteamEntry { app_id: string; name: string; played_minutes: number; }
interface GameMetadata {
  source: string;
  source_url: string;
  fetchedAt?: number;
  title?: string;
  version?: string;
  developer?: string;
  overview?: string;
  /** For DLsite: HTML with possible inline images. For F95: plain paragraphs. */
  overview_html?: string;
  cover_url?: string;
  screenshots: string[];
  tags: string[];
  relations?: string[];
  engine?: string;
  os?: string;
  language?: string;
  censored?: string;
  release_date?: string;
  last_updated?: string;
  rating?: string;
  price?: string;
  // DLsite-specific
  circle?: string;
  series?: string;
  author?: string;
  illustration?: string;
  voice_actor?: string;
  music?: string;
  age_rating?: string;
  product_format?: string;
  file_format?: string;
  file_size?: string;
}

interface UpdatePreview {
  game_dir: string;
  source_is_zip: boolean;
  files_to_update: number;
  new_files: number;
  zip_entry_count?: number;
  protected_dirs: string[];
}
interface UpdateResult {
  files_updated: number;
  files_skipped: number;
  protected_dirs: string[];
  backup_dir: string;
  warnings: string[];
}

interface Screenshot {
  path: string;
  filename: string;
  timestamp: number;
  tags: string[];
}

interface RustLogEntry {
  ts: number;
  level: string;
  message: string;
}

interface CrashReport {
  ts: number;
  thread: string;
  message: string;
  location: string;
  backtrace: string;
}
interface SaveBackupResult {
  zip_path: string;
  files: number;
  directories: string[];
}

type LogLevelFilter = "all" | "error" | "warn" | "info";

interface HistoryEntry {
  id: string;
  date: number;
  version: string;
  note: string;
}
type GameHistoryMap = Record<string, HistoryEntry[]>;
type NavEntry = {
  tab: "library" | "feed" | "stats";
  selectedPath: string | null;
};

interface GameCustomization {
  displayName?: string;
  coverUrl?: string;
  backgroundUrl?: string;
  /** Alternate executable to launch instead of the scanned game.path */
  exeOverride?: string;
  /** Command-line arguments for the primary or override executable */
  launchArgs?: string;
  /** Additional pinned executables to show in the UI for this game */
  pinnedExes?: { name: string; path: string }[];
  /** Per-game launch config override for Wine/Proton (non-Windows) */
  runnerOverrideEnabled?: boolean;
  runnerOverride?: RunnerOverrideConfig;
  /** Game completion status */
  status?: "Playing" | "Completed" | "On Hold" | "Dropped" | "Plan to Play";
  /** Daily/session time budget in minutes */
  timeLimitMins?: number;
  /** Free-form user tags */
  customTags?: string[];
  /** Legacy personal score (kept for backward compatibility) */
  personalRating?: number;
  /** Personal short review stored locally */
  personalReview?: string;
  /** 0..100 manual overall score */
  overallScore100?: number;
  /** Rating source mode */
  ratingMode?: "manual" | "categories";
  /** Category scores in 0..100 */
  categoryRatings?: Partial<Record<RatingCategoryKey, number>>;
}

type RatingScale = "10" | "10_decimal" | "100" | "5_star" | "3_smiley";
type RatingCategoryKey = "gameplay" | "story" | "soundtrack" | "visuals" | "characters" | "performance";
const RATING_CATEGORIES: { key: RatingCategoryKey; label: string }[] = [
  { key: "gameplay", label: "Gameplay" },
  { key: "story", label: "Story" },
  { key: "soundtrack", label: "Soundtrack" },
  { key: "visuals", label: "Visuals" },
  { key: "characters", label: "Characters" },
  { key: "performance", label: "Performance" },
];

interface SearchResultItem {
  title: string;
  url: string;
  cover_url: string | null;
  source: string;
}

// ─── Generic exe-name detection ──────────────────────────────────────────────
/** Exe stems that are engine/launcher names and give no info about the game. */
const GENERIC_EXE_NAMES = new Set([
  "game", "start", "play", "launch", "launcher",
  "nw", "nwjs", "app", "electron",
  "main", "run", "exec",
  "renpy", "lib", "engine",
  "ux", "client", "project",
  "visual_novel", "vn",
]);

/**
 * Given a full exe path, derive a human-readable game name:
 * - If the exe stem is a known generic name, return the parent folder name
 * - Otherwise return the stem
 * Mirrors the Rust logic in scan_dir_shallow / is_generic_name.
 */
function deriveGameName(exePath: string): string {
  const parts = exePath.replace(/\\/g, "/").split("/");
  const fileName = parts[parts.length - 1] ?? exePath;
  const stem = fileName.replace(/\.[^.]+$/, "");
  if (GENERIC_EXE_NAMES.has(stem.toLowerCase()) && parts.length >= 2) {
    return parts[parts.length - 2]; // parent folder name
  }
  return stem;
}

// ─── Storage keys ─────────────────────────────────────────────────────────────
const SK_GAMES = "games-list-v2";
const SK_MTIMES = "dir-mtimes-v2";
const SK_PATH = "scanned-path";        // legacy – single folder
const SK_FOLDERS = "library-folders-v1"; // v3: array of LibraryFolder
const SK_STATS = "game-stats";
const SK_META = "game-metadata";
const SK_HIDDEN = "hidden-games-v1";
const SK_FAVS = "fav-games-v1";
const SK_CUSTOM = "game-custom-v1";
const SK_NOTES = "game-notes-v1";
const SK_COLLECTIONS = "collections-v1";
const SK_LAUNCH = "launch-config-v1";
const SK_RECENT = "recent-games-v1";
const SK_ORDER = "custom-order-v1";
const SK_SESSION_LOG = "session-log-v1";
const SK_WISHLIST = "wishlist-v1";
const SK_HISTORY = "game-history-v1";

interface WishlistItem {
  id: string; // usually a URL
  title: string;
  source: string;
  releaseStatus: string;
  addedAt: number;
}

/** A library root directory that's been added by the user. */
interface LibraryFolder { path: string; }

interface RecentGame { name: string; path: string; }

type RunnerKind = "wine" | "proton" | "custom";

interface LaunchConfig {
  enabled: boolean;        // false = always run directly
  runner: RunnerKind;
  runnerPath: string;         // path to wine/proton binary
  prefixPath: string;         // WINEPREFIX / STEAM_COMPAT_DATA_PATH
}

const DEFAULT_LAUNCH_CONFIG: LaunchConfig = { enabled: false, runner: "wine", runnerPath: "", prefixPath: "" };

interface RunnerOverrideConfig {
  runner: RunnerKind;
  runnerPath: string;
  prefixPath: string;
}

interface PrefixInfo {
  name: string;
  path: string;
  kind: "wine" | "proton" | string;
  has_dxvk: boolean;
  has_vkd3d: boolean;
}

interface LutrisGameEntry {
  name: string;
  slug: string;
  exe: string;
  prefix?: string;
  runner?: string;
  args?: string;
  config_path: string;
}

interface InteropGameEntry {
  name: string;
  game_id: string;
  exe: string;
  args?: string;
  source: string;
}

const SK_SETTINGS = "libmaly_app_settings-v1";
interface AppSettings {
  updateCheckerEnabled: boolean;
  sessionToastEnabled: boolean;
  trayTooltipEnabled: boolean;
  startupWithWindows: boolean;
  themeMode: "dark" | "light" | "oled";
  ratingScale: RatingScale;
  themeScheduleMode: "manual" | "os" | "time";
  dayThemeMode: "light" | "dark";
  nightThemeMode: "dark" | "oled";
  lightStartHour: number;
  darkStartHour: number;
  accentColor: string;
  blurNsfwContent: boolean;
  rssFeeds: { url: string; name: string; enabled?: boolean }[];
  metadataAutoRefetchDays: number;
  autoScreenshotInterval: number;
  saveBackupOnExit: boolean;
  bossKeyEnabled?: boolean;
  bossKeyCode?: number;
  bossKeyAction?: "hide" | "kill";
  bossKeyMuteSystem?: boolean;
  bossKeyFallbackUrl?: string;
}

interface CloudSyncPayloadV1 {
  schema: "libmaly-cloud-sync-v1";
  exportedAt: string;
  appVersion?: string;
  data: Partial<{
    libraryFolders: LibraryFolder[];
    games: Game[];
    stats: Record<string, GameStats>;
    metadata: Record<string, GameMetadata>;
    hiddenGames: Record<string, boolean>;
    favGames: Record<string, boolean>;
    customizations: Record<string, GameCustomization>;
    notes: Record<string, string>;
    collections: Collection[];
    launchConfig: LaunchConfig;
    sessionLog: SessionEntry[];
    wishlist: WishlistItem[];
    history: GameHistoryMap;
    appSettings: AppSettings;
  }>;
}
const DEFAULT_SETTINGS: AppSettings = {
  updateCheckerEnabled: false,
  sessionToastEnabled: false,
  trayTooltipEnabled: false,
  startupWithWindows: false,
  themeMode: "dark",
  ratingScale: "10",
  themeScheduleMode: "manual",
  dayThemeMode: "light",
  nightThemeMode: "dark",
  lightStartHour: 7,
  darkStartHour: 19,
  accentColor: "#66c0f4",
  blurNsfwContent: true,
  rssFeeds: [
    { url: "https://f95zone.to/sam/latest_alpha/latest_data.php?cmd=rss&cat=games", name: "F95zone Latest", enabled: true },
    { url: "https://rss.tia-chan.top/official", name: "VNDB Official (via vndb-rss)", enabled: true },
    { url: "https://rss.tia-chan.top/unofficial", name: "VNDB Unofficial (via vndb-rss)", enabled: false },
    { url: "https://rss.tia-chan.top/offi-jp", name: "VNDB Official JP (via vndb-rss)", enabled: false },
  ],
  metadataAutoRefetchDays: 0,
  autoScreenshotInterval: 0,
  saveBackupOnExit: false,
  bossKeyEnabled: false,
  bossKeyCode: 0x7A, // F11
  bossKeyAction: "hide",
  bossKeyMuteSystem: false,
  bossKeyFallbackUrl: "",
};



const COLLECTION_COLORS = ["var(--color-accent)", "var(--color-warning)", "#a170c8", "#e8734a", "#5ba85b", "#d45252", "#4a8ee8", "#e85480"];

interface Collection {
  id: string;
  name: string;
  color: string;
  gamePaths: string[];
}

type SortMode = "name" | "lastPlayed" | "playtime" | "custom";
type FilterMode = "all" | "favs" | "hidden" | "f95" | "dlsite" | "vndb" | "mangagamer" | "johren" | "fakku" | "unlinked" | "Playing" | "Completed" | "On Hold" | "Dropped" | "Plan to Play" | string;
type LaunchRequest = { mode: "path" | "name"; value: string };

function loadCache<T>(key: string, fallback: T): T {
  try { const r = appStorageGetItem(key); return r ? JSON.parse(r) : fallback; }
  catch { return fallback; }
}
function saveCache(key: string, val: unknown) { appStorageSetItem(key, JSON.stringify(val)); }

function normalizeHexColor(input: string, fallback: string) {
  const x = (input || "").trim();
  const hex = x.startsWith("#") ? x : `#${x}`;
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.toLowerCase() : fallback;
}

function shiftHexColor(hex: string, amount: number) {
  const safe = normalizeHexColor(hex, "#66c0f4");
  const r = parseInt(safe.slice(1, 3), 16);
  const g = parseInt(safe.slice(3, 5), 16);
  const b = parseInt(safe.slice(5, 7), 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const toHex = (v: number) => clamp(v).toString(16).padStart(2, "0");
  const factor = amount >= 0 ? 1 + amount : 1 - Math.abs(amount);
  return `#${toHex(r * factor)}${toHex(g * factor)}${toHex(b * factor)}`;
}

function clampScore100(v: number) {
  return Math.max(0, Math.min(100, Math.round(v)));
}

function formatScoreForScale(score100: number, scale: RatingScale) {
  const s = clampScore100(score100);
  if (scale === "10") return `${Math.round(s / 10)}/10`;
  if (scale === "10_decimal") return `${(s / 10).toFixed(1)}/10`;
  if (scale === "100") return `${s}/100`;
  if (scale === "5_star") return `${(s / 20).toFixed(1)}/5`;
  if (s <= 40) return "😞";
  if (s <= 75) return "😐";
  return "😄";
}

function categoryAverageScore100(custom?: GameCustomization) {
  if (!custom?.categoryRatings) return undefined;
  const values = RATING_CATEGORIES
    .map((c) => custom.categoryRatings?.[c.key])
    .filter((v): v is number => typeof v === "number" && !Number.isNaN(v))
    .map(clampScore100);
  if (values.length === 0) return undefined;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

function resolveOverallScore100(custom?: GameCustomization) {
  if (!custom) return undefined;
  if (custom.ratingMode === "categories") {
    const avg = categoryAverageScore100(custom);
    if (typeof avg === "number") return avg;
  }
  if (typeof custom.overallScore100 === "number") return clampScore100(custom.overallScore100);
  if (typeof custom.personalRating === "number") return clampScore100(custom.personalRating * 10);
  return categoryAverageScore100(custom);
}

function mergeDefaultRssFeeds(existing: { url: string; name: string; enabled?: boolean }[] | undefined) {
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

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatTime(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h} hrs ${m} mins`;
  if (m > 0) return `${m} mins`;
  return "< 1 min";
}
function heroGradient(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  const hue = Math.abs(h) % 360;
  return `linear-gradient(135deg,hsl(${hue},40%,15%) 0%,hsl(${(hue + 50) % 360},55%,25%) 100%)`;
}
function isF95Url(url: string) { return url.includes("f95zone.to"); }
function isDLsiteUrl(url: string) { return url.includes("dlsite.com"); }
function isVNDBUrl(url: string) { return /vndb\.org\/v\d+/i.test(url); }
function isMangaGamerUrl(url: string) { return /mangagamer\.com/i.test(url); }
function isJohrenUrl(url: string) { return /johren\.net/i.test(url); }
function isFakkuUrl(url: string) { return /fakku\.net/i.test(url); }
function detectMetadataSourceFromUrl(url: string): GameMetadata["source"] | null {
  if (isF95Url(url)) return "f95";
  if (isDLsiteUrl(url)) return "dlsite";
  if (isVNDBUrl(url)) return "vndb";
  if (isMangaGamerUrl(url)) return "mangagamer";
  if (isJohrenUrl(url)) return "johren";
  if (isFakkuUrl(url)) return "fakku";
  return null;
}
function metadataFetchCommand(source: GameMetadata["source"]) {
  if (source === "f95") return "fetch_f95_metadata";
  if (source === "dlsite") return "fetch_dlsite_metadata";
  if (source === "vndb") return "fetch_vndb_metadata";
  if (source === "mangagamer") return "fetch_mangagamer_metadata";
  if (source === "johren") return "fetch_johren_metadata";
  if (source === "fakku") return "fetch_fakku_metadata";
  return null;
}
function metadataSourceLabel(source?: string) {
  if (source === "f95") return "F95zone";
  if (source === "dlsite") return "DLsite";
  if (source === "vndb") return "VNDB";
  if (source === "mangagamer") return "MangaGamer";
  if (source === "johren") return "Johren";
  if (source === "fakku") return "FAKKU";
  return "Unknown";
}
function normalizePathForMatch(path: string) {
  return path.trim().replace(/\\/g, "/").toLowerCase();
}
function normalizePathNoCase(path: string) {
  return path.trim().replace(/\\/g, "/").replace(/\/+$/, "");
}
function remapPathByRoot(path: string, oldRoot: string, newRoot: string): string | null {
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
function parseDeepLinkUrl(rawUrl: string): LaunchRequest | null {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== "libmaly:") return null;
    if (u.hostname === "launch") {
      const raw = u.pathname.replace(/^\/+/, "");
      if (!raw) return null;
      return { mode: "path", value: decodeURIComponent(raw) };
    }
    if (u.hostname === "launch-name") {
      const raw = u.pathname.replace(/^\/+/, "");
      if (!raw) return null;
      return { mode: "name", value: decodeURIComponent(raw) };
    }
    return null;
  } catch {
    const pathMatch = rawUrl.match(/^libmaly:\/\/launch\/(.+)$/i);
    if (pathMatch?.[1]) {
      return { mode: "path", value: decodeURIComponent(pathMatch[1]) };
    }
    const nameMatch = rawUrl.match(/^libmaly:\/\/launch-name\/(.+)$/i);
    if (nameMatch?.[1]) {
      return { mode: "name", value: decodeURIComponent(nameMatch[1]) };
    }
    return null;
  }
}

// ─── TagBadge ─────────────────────────────────────────────────────────────────

// ─── MetaRow ──────────────────────────────────────────────────────────────────

// ─── F95 Login Modal ──────────────────────────────────────────────────────────
function F95LoginModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const doLogin = async () => {
    if (!user || !pass) return;
    setLoading(true); setError("");
    try {
      const ok = await invoke<boolean>("f95_login", { username: user, password: pass });
      if (ok) { onSuccess(); onClose(); }
      else setError("Login failed — check credentials.");
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.8)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rounded-lg p-6 w-96 shadow-2xl" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded flex items-center justify-center font-bold text-sm"
            style={{ background: "var(--color-warning)", color: "var(--color-black-strong)" }}>F95</div>
          <h2 className="text-lg font-bold" style={{ color: "var(--color-white)" }}>Sign in to F95zone</h2>
        </div>
        <p className="text-xs mb-4" style={{ color: "var(--color-text-muted)" }}>
          Logging in allows fetching restricted metadata (adult content, spoilers, etc.).
        </p>
        <div className="space-y-3">
          <input type="text" placeholder="Username" value={user}
            onInput={(e) => setUser((e.target as HTMLInputElement).value)}
            className="w-full px-3 py-2 rounded text-sm outline-none"
            style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border)" }} />
          <input type="password" placeholder="Password" value={pass}
            onInput={(e) => setPass((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => e.key === "Enter" && doLogin()}
            className="w-full px-3 py-2 rounded text-sm outline-none"
            style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border)" }} />
        </div>
        {error && <p className="mt-2 text-xs" style={{ color: "var(--color-danger)" }}>{error}</p>}
        <div className="flex gap-3 justify-end mt-5">
          <button onClick={onClose}
            className="px-4 py-2 rounded text-sm"
            style={{ background: "var(--color-panel-2)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>Cancel</button>
          <button onClick={doLogin} disabled={loading || !user || !pass}
            className="px-5 py-2 rounded text-sm font-semibold disabled:opacity-50 flex items-center gap-2"
            style={{ background: "var(--color-warning)", color: "var(--color-black-strong)" }}>
            {loading && <span className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />}
            Sign In
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── DLsite Login Modal ────────────────────────────────────────────────────────
function DLsiteLoginModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [loginId, setLoginId] = useState("");
  const [pass, setPass] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const doLogin = async () => {
    if (!loginId || !pass) return;
    setLoading(true); setError("");
    try {
      const ok = await invoke<boolean>("dlsite_login", { loginId, password: pass });
      if (ok) { onSuccess(); onClose(); }
      else setError("Login failed — check your Login ID and password.");
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.8)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rounded-lg p-6 w-96 shadow-2xl" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded flex items-center justify-center font-bold text-[11px]"
            style={{ background: "var(--color-danger-strong)", color: "var(--color-white)" }}>DL</div>
          <h2 className="text-lg font-bold" style={{ color: "var(--color-white)" }}>Sign in to DLsite</h2>
        </div>
        <p className="text-xs mb-1" style={{ color: "var(--color-text-muted)" }}>
          Logging in unlocks age-gated product pages, so metadata can be fetched without the age-gate redirect.
        </p>
        <p className="text-xs mb-4" style={{ color: "var(--color-text-dim)" }}>
          Your credentials are sent directly to DLsite (login.dlsite.com) and are never stored by LIBMALY.
        </p>
        <div className="space-y-3">
          <div>
            <label className="text-[10px] uppercase tracking-widest block mb-1" style={{ color: "var(--color-text-dim)" }}>Login ID (email or username)</label>
            <input type="text" placeholder="Login ID" value={loginId}
              onInput={(e) => setLoginId((e.target as HTMLInputElement).value)}
              className="w-full px-3 py-2 rounded text-sm outline-none"
              style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border)" }} />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-widest block mb-1" style={{ color: "var(--color-text-dim)" }}>Password</label>
            <input type="password" placeholder="Password" value={pass}
              onInput={(e) => setPass((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => e.key === "Enter" && doLogin()}
              className="w-full px-3 py-2 rounded text-sm outline-none"
              style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border)" }} />
          </div>
        </div>
        {error && <p className="mt-2 text-xs" style={{ color: "var(--color-danger)" }}>{error}</p>}
        <div className="flex gap-3 justify-end mt-5">
          <button onClick={onClose}
            className="px-4 py-2 rounded text-sm"
            style={{ background: "var(--color-panel-2)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>Cancel</button>
          <button onClick={doLogin} disabled={loading || !loginId || !pass}
            className="px-5 py-2 rounded text-sm font-semibold disabled:opacity-50 flex items-center gap-2"
            style={{ background: "var(--color-danger-strong)", color: "var(--color-white)" }}>
            {loading && <span className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />}
            Sign In
          </button>
        </div>
      </div>
    </div>
  );
}

function FakkuLoginModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const doLogin = async () => {
    if (!email || !pass) return;
    setLoading(true); setError("");
    try {
      const ok = await invoke<boolean>("fakku_login", { email, password: pass });
      if (ok) { onSuccess(); onClose(); }
      else setError("Login failed — check your credentials.");
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.8)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rounded-lg p-6 w-96 shadow-2xl" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded flex items-center justify-center font-bold text-[10px]"
            style={{ background: "#da4c96", color: "var(--color-white)" }}>FK</div>
          <h2 className="text-lg font-bold" style={{ color: "var(--color-white)" }}>Sign in to FAKKU</h2>
        </div>
        <p className="text-xs mb-4" style={{ color: "var(--color-text-muted)" }}>
          Used to keep an authenticated session and reduce age-check interruptions while fetching metadata.
        </p>
        <div className="space-y-3">
          <input type="email" placeholder="Email" value={email}
            onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
            autoComplete="email"
            className="w-full px-3 py-2 rounded text-sm outline-none"
            style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border)" }} />
          <input type="password" placeholder="Password" value={pass}
            onInput={(e) => setPass((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => e.key === "Enter" && doLogin()}
            autoComplete="current-password"
            className="w-full px-3 py-2 rounded text-sm outline-none"
            style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border)" }} />
        </div>
        {error && <p className="mt-2 text-xs" style={{ color: "var(--color-danger)" }}>{error}</p>}
        <div className="flex gap-3 justify-end mt-5">
          <button onClick={onClose}
            className="px-4 py-2 rounded text-sm"
            style={{ background: "var(--color-panel-2)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>Cancel</button>
          <button onClick={doLogin} disabled={loading || !email || !pass}
            className="px-5 py-2 rounded text-sm font-semibold disabled:opacity-50 flex items-center gap-2"
            style={{ background: "#da4c96", color: "var(--color-white)" }}>
            {loading && <span className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />}
            Sign In
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Metadata Diff Modal ──────────────────────────────────────────────────────
function MetadataDiffModal({ oldMeta, newMeta, onConfirm, onClose }: {
  oldMeta: GameMetadata;
  newMeta: GameMetadata;
  onConfirm: (logNote: string | null) => void;
  onClose: () => void;
}) {
  const versionChanged = oldMeta.version !== newMeta.version;
  const oldV = oldMeta.version || "Unknown";
  const newV = newMeta.version || "Unknown";
  const [note, setNote] = useState("");
  const [wantsToLog, setWantsToLog] = useState(versionChanged);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.8)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rounded-lg p-6 w-[480px] shadow-2xl" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
        <h2 className="text-lg font-bold mb-4" style={{ color: "var(--color-white)" }}>Metadata Update</h2>

        <div className="space-y-3 mb-6">
          {versionChanged ? (
            <div className="p-3 rounded" style={{ background: "var(--color-panel-3)" }}>
              <p className="text-sm" style={{ color: "var(--color-text)" }}>
                Version changed: <span className="font-mono text-[var(--color-danger)] line-through">{oldV}</span> → <span className="font-mono text-[var(--color-success)] font-bold">{newV}</span>
              </p>
            </div>
          ) : (
            <div className="p-3 rounded" style={{ background: "var(--color-panel-2)" }}>
              <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                No version change detected (remains <span className="font-mono">{newV}</span>). The metadata fields will be refreshed.
              </p>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-text)" }}>
            <input type="checkbox" checked={wantsToLog} onChange={(e) => setWantsToLog(e.currentTarget.checked)} />
            Log this update in the game's version history
          </label>

          {wantsToLog && (
            <textarea
              className="w-full h-20 p-2 rounded text-sm outline-none resize-none"
              style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
              placeholder={`Notes for version ${newV} update (e.g. "Downloaded from F95", "Added new route")...`}
              value={note}
              onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)}
            />
          )}
        </div>

        <div className="flex gap-3 justify-end">
          <button onClick={onClose}
            className="px-4 py-2 rounded text-sm hover:opacity-80 transition-opacity"
            style={{ background: "var(--color-panel-2)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>Cancel</button>
          <button onClick={() => onConfirm(wantsToLog ? note : null)}
            className="px-5 py-2 rounded text-sm font-semibold hover:opacity-80 transition-opacity"
            style={{ background: "var(--color-accent)", color: "var(--color-black-strong)" }}>
            Apply Update
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Link Page Modal ──────────────────────────────────────────────────────────
function LinkPageModal({ gameName, onClose, onFetched, f95LoggedIn, onOpenF95Login }: {
  gameName: string;
  onClose: () => void;
  onFetched: (meta: GameMetadata) => void;
  f95LoggedIn: boolean;
  onOpenF95Login: () => void;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const src = detectMetadataSourceFromUrl(url);

  const [suggestions, setSuggestions] = useState<SearchResultItem[] | null>(null);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [query, setQuery] = useState(gameName);

  const fetchSuggestions = () => {
    setIsLoadingSuggestions(true);
    invoke<SearchResultItem[]>("search_suggest_links", { query })
      .then((res) => setSuggestions(res))
      .catch((e) => { console.error("suggestions err", e); setSuggestions([]); })
      .finally(() => setIsLoadingSuggestions(false));
  };

  // Auto-fetch suggestions on mount
  useEffect(() => {
    fetchSuggestions();
    // eslint-disable-next-line
  }, [gameName]);

  const doFetch = async (targetUrl = url) => {
    if (!targetUrl) return;
    const targetSrc = detectMetadataSourceFromUrl(targetUrl);
    if (!targetSrc) { setError("Paste a valid F95zone, DLsite, VNDB, MangaGamer, Johren or FAKKU URL."); return; }
    setLoading(true); setError("");
    try {
      const cmd = metadataFetchCommand(targetSrc);
      if (!cmd) throw new Error(`Unsupported source: ${targetSrc}`);
      const meta = await invoke<GameMetadata>(cmd, { url: targetUrl.trim() });
      onFetched(meta); onClose();
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.8)" }}
      onClick={(e) => { if (e.target === e.currentTarget && !loading) onClose(); }}>
      <div className="rounded-lg p-6 w-[480px] shadow-2xl" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
        <h2 className="text-lg font-bold mb-1" style={{ color: "var(--color-white)" }}>Link a Game Page</h2>
        <p className="text-xs mb-4" style={{ color: "var(--color-text-muted)" }}>
          Paste an F95zone, DLsite, VNDB, MangaGamer, Johren or FAKKU URL to fetch cover art,
          description and tags for <b style={{ color: "var(--color-text)" }}>{gameName}</b>.
        </p>
        <div className="flex gap-2 mb-4">
          {(["f95", "dlsite", "vndb", "mangagamer", "johren", "fakku"] as const).map((s) => (
            <span key={s} className="px-2 py-0.5 rounded text-xs font-semibold"
              style={{
                background: src === s
                  ? (s === "f95"
                    ? "var(--color-warning)"
                    : s === "dlsite"
                      ? "var(--color-danger-strong)"
                      : s === "vndb"
                        ? "var(--color-accent-dark)"
                        : s === "mangagamer"
                          ? "#7c5cff"
                          : s === "johren"
                            ? "#5a6bff"
                            : "#da4c96")
                  : "var(--color-border-soft)",
                color: src === s ? (s === "f95" ? "var(--color-black-strong)" : "var(--color-white)") : "var(--color-text-muted)",
              }}>
              {metadataSourceLabel(s)}
            </span>
          ))}
        </div>
        <input type="text"
          placeholder="https://f95zone.to/...  /  https://www.dlsite.com/...  /  https://vndb.org/v...  /  https://www.mangagamer.com/...  /  https://www.johren.net/...  /  https://www.fakku.net/..."
          value={url}
          onInput={(e) => { setUrl((e.target as HTMLInputElement).value); setError(""); }}
          onKeyDown={(e) => e.key === "Enter" && doFetch()}
          className="w-full px-3 py-2 rounded text-sm outline-none mb-3"
          style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border)" }} />
        {src === "f95" && !f95LoggedIn && (
          <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded"
            style={{ background: "var(--color-warning-bg-2)", border: "1px solid var(--color-warning-border)" }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--color-warning)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span className="text-xs flex-1" style={{ color: "var(--color-warning)" }}>Some F95zone content requires login.</span>
            <button onClick={onOpenF95Login} className="text-xs underline" style={{ color: "var(--color-warning)" }}>Sign in</button>
          </div>
        )}
        {!url && (
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <p className="text-[10px] uppercase text-[var(--color-text-muted)] font-bold tracking-widest flex-1">Auto-Link Suggestions</p>
              <input type="text" value={query} onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
                className="bg-[var(--color-panel-2)] border border-[var(--color-border)] text-[11px] px-2 py-0.5 rounded outline-none text-[var(--color-text)]"
                placeholder="Search query..."
                onKeyDown={(e) => e.key === "Enter" && fetchSuggestions()} />
              <button onClick={fetchSuggestions} disabled={isLoadingSuggestions} className="bg-[var(--color-border)] hover:bg-[var(--color-border-strong)] text-[11px] px-2 py-0.5 rounded text-[var(--color-text)] disabled:opacity-50">
                {isLoadingSuggestions ? "Searching…" : "Search"}
              </button>
            </div>
            {isLoadingSuggestions ? (
              <p className="text-xs text-[var(--color-text-muted)]">Searching for matches...</p>
            ) : suggestions && suggestions.length > 0 ? (
              <div className="space-y-2 max-h-[160px] overflow-y-auto pr-1">
                {suggestions.map((s) => (
                  <div key={s.url} onClick={() => doFetch(s.url)}
                    className="group flex gap-3 p-2 rounded cursor-pointer transition-colors"
                    style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border-soft)" }}
                    onMouseEnter={e => e.currentTarget.style.background = "var(--color-bg)"}
                    onMouseLeave={e => e.currentTarget.style.background = "var(--color-panel-2)"}>
                    {s.cover_url ? (
                      <img src={s.cover_url} alt="" className="w-10 h-10 object-cover rounded" />
                    ) : (
                      <div className="w-10 h-10 rounded flex items-center justify-center font-bold" style={{ background: "var(--color-panel)", color: "var(--color-accent)" }}>
                        {s.source[0]}
                      </div>
                    )}
                    <div className="flex flex-col flex-1 min-w-0 justify-center">
                      <p className="text-xs text-[var(--color-text)] truncate font-medium group-hover:text-[var(--color-white)]" title={s.title}>{s.title}</p>
                      <p className="text-[10px] text-[var(--color-text-muted)] uppercase">{s.source}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : suggestions && suggestions.length === 0 ? (
              <p className="text-xs text-[var(--color-text-muted)]">No suggestions found.</p>
            ) : null}
          </div>
        )}
        {error && <p className="text-xs mb-2" style={{ color: "var(--color-danger)" }}>{error}</p>}
        <div className="flex gap-3 justify-end mt-2">
          <button onClick={onClose} disabled={loading}
            className="px-4 py-2 rounded text-sm"
            style={{ background: "var(--color-panel-2)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>Cancel</button>
          <button onClick={() => doFetch()} disabled={loading || !url.trim()}
            className="px-5 py-2 rounded text-sm font-semibold disabled:opacity-50 flex items-center gap-2"
            style={{ background: "var(--color-accent-dark)", color: "var(--color-white)" }}>
            {loading
              ? <><span className="w-3 h-3 rounded-full border-2 border-white border-t-transparent animate-spin" />Fetching…</>
              : "Fetch Metadata"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Update Modal ────────────────────────────────────────────────────────────
function UpdateModal({ game, onClose }: { game: Game; onClose: () => void }) {
  type Phase = "idle" | "previewing" | "ready" | "updating" | "done" | "error";
  const [phase, setPhase] = useState<Phase>("idle");
  const [sourcePath, setSourcePath] = useState("");
  const [preview, setPreview] = useState<UpdatePreview | null>(null);
  const [result, setResult] = useState<UpdateResult | null>(null);
  const [errMsg, setErrMsg] = useState("");

  const pickSource = async () => {
    const sel = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Game archive or folder", extensions: ["zip"] }],
    }).catch(() => null);
    if (sel && typeof sel === "string") {
      setSourcePath(sel);
      setPreview(null);
      setPhase("previewing");
      try {
        const p = await invoke<UpdatePreview>("preview_update", {
          gameExe: game.path,
          newSource: sel,
        });
        setPreview(p);
        setPhase("ready");
      } catch (e) {
        setErrMsg(String(e));
        setPhase("error");
      }
    }
  };

  const pickFolder = async () => {
    const sel = await open({ multiple: false, directory: true }).catch(() => null);
    if (sel && typeof sel === "string") {
      setSourcePath(sel);
      setPreview(null);
      setPhase("previewing");
      try {
        const p = await invoke<UpdatePreview>("preview_update", {
          gameExe: game.path,
          newSource: sel,
        });
        setPreview(p);
        setPhase("ready");
      } catch (e) {
        setErrMsg(String(e));
        setPhase("error");
      }
    }
  };

  const doUpdate = async () => {
    setPhase("updating");
    try {
      const r = await invoke<UpdateResult>("update_game", {
        gameExe: game.path,
        newSource: sourcePath,
      });
      setResult(r);
      setPhase("done");
    } catch (e) {
      setErrMsg(String(e));
      setPhase("error");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.85)" }}
      onClick={(e) => { if (e.target === e.currentTarget && phase !== "updating") onClose(); }}>
      <div className="rounded-lg shadow-2xl w-[520px] max-h-[90vh] overflow-y-auto"
        style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>

        {/* Header */}
        <div className="flex items-center gap-3 px-6 pt-5 pb-4 border-b" style={{ borderColor: "var(--color-border-card)" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="16 16 12 12 8 16" /><line x1="12" y1="12" x2="12" y2="21" />
            <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
          </svg>
          <div>
            <h2 className="font-bold text-base" style={{ color: "var(--color-white)" }}>Update Game</h2>
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>{game.name}</p>
          </div>
        </div>

        <div className="px-6 py-5 space-y-4">

          {/* Step 1: pick source */}
          {phase === "idle" && (
            <>
              <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                Point to the folder or <code>.zip</code> archive containing the new version.
                Save files and configs will be preserved automatically.
              </p>
              <div className="flex gap-3">
                <button onClick={pickFolder}
                  className="flex-1 py-2.5 rounded font-semibold text-sm"
                  style={{ background: "var(--color-border)", color: "var(--color-text)", border: "1px solid var(--color-accent-dark)" }}>
                  📁 Select Folder
                </button>
                <button onClick={pickSource}
                  className="flex-1 py-2.5 rounded font-semibold text-sm"
                  style={{ background: "var(--color-border)", color: "var(--color-text)", border: "1px solid var(--color-accent-dark)" }}>
                  🗜 Select ZIP
                </button>
              </div>
            </>
          )}

          {/* Previewing / loading */}
          {phase === "previewing" && (
            <div className="flex items-center gap-3 py-4">
              <span className="w-5 h-5 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
              <span className="text-sm" style={{ color: "var(--color-text-muted)" }}>Analysing…</span>
            </div>
          )}

          {/* Preview ready — show plan */}
          {phase === "ready" && preview && (
            <>
              <div className="rounded p-3 space-y-1 text-xs" style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-panel-3)" }}>
                <p className="text-xs font-mono break-all mb-2" style={{ color: "var(--color-accent)" }}>{sourcePath}</p>
                <div className="flex gap-4">
                  <span style={{ color: "var(--color-text-muted)" }}>Files to update</span>
                  <span className="font-semibold" style={{ color: "var(--color-text)" }}>
                    {preview.source_is_zip
                      ? `~${preview.zip_entry_count ?? "?"} (archive)`
                      : `${preview.files_to_update} existing + ${preview.new_files} new`}
                  </span>
                </div>
              </div>

              {preview.protected_dirs.length > 0 && (
                <div className="rounded p-3" style={{ background: "#1a2e1a", border: "1px solid #2a4a2a" }}>
                  <p className="text-xs font-semibold mb-2" style={{ color: "var(--color-success)" }}>🛡 Protected (will NOT be overwritten)</p>
                  <ul className="space-y-0.5">
                    {preview.protected_dirs.map((d) => (
                      <li key={d} className="text-xs font-mono" style={{ color: "#8bc48b" }}>↳ {d}</li>
                    ))}
                  </ul>
                  <p className="text-xs mt-2" style={{ color: "#5a8c5a" }}>
                    A backup of these directories will be saved to <code>.libmaly_backup</code> before updating.
                  </p>
                </div>
              )}

              {preview.protected_dirs.length === 0 && (
                <div className="rounded p-3" style={{ background: "var(--color-panel)", border: "1px solid #4a3a1a" }}>
                  <p className="text-xs" style={{ color: "var(--color-warning)" }}>
                    ⚠ No save directories detected. The update will overwrite all files.
                    Make sure you have a manual backup if needed.
                  </p>
                </div>
              )}

              <div className="flex gap-3 justify-end pt-1">
                <button onClick={() => { setPhase("idle"); setPreview(null); setSourcePath(""); }}
                  className="px-4 py-2 rounded text-sm"
                  style={{ background: "var(--color-panel-2)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>Back</button>
                <button onClick={doUpdate}
                  className="px-5 py-2 rounded text-sm font-bold"
                  style={{ background: "var(--color-play-bg)", color: "var(--color-play-text)" }}>Apply Update</button>
              </div>
            </>
          )}

          {/* Updating */}
          {phase === "updating" && (
            <div className="flex flex-col items-center gap-3 py-6">
              <span className="w-8 h-8 rounded-full border-4 border-blue-400 border-t-transparent animate-spin" />
              <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>Updating… please wait</p>
            </div>
          )}

          {/* Done */}
          {phase === "done" && result && (
            <>
              <div className="rounded p-4" style={{ background: "#1a2e1a", border: "1px solid #2a4a2a" }}>
                <p className="font-semibold mb-3" style={{ color: "var(--color-success)" }}>✓ Update complete</p>
                <div className="space-y-1 text-xs">
                  <p style={{ color: "#8bc48b" }}>Files updated: <b>{result.files_updated}</b></p>
                  <p style={{ color: "#8bc48b" }}>Files skipped (protected): <b>{result.files_skipped}</b></p>
                  {result.protected_dirs.length > 0 && (
                    <p style={{ color: "#8bc48b" }}>
                      Saved backup → <code className="break-all">{result.backup_dir}</code>
                    </p>
                  )}
                </div>
              </div>
              {result.warnings.length > 0 && (
                <div className="rounded p-3" style={{ background: "var(--color-warning-bg-2)", border: "1px solid var(--color-warning-border)" }}>
                  <p className="text-xs font-semibold mb-1" style={{ color: "var(--color-warning)" }}>Warnings</p>
                  {result.warnings.map((w, i) => <p key={i} className="text-xs font-mono" style={{ color: "#a08030" }}>{w}</p>)}
                </div>
              )}
              <div className="flex justify-end">
                <button onClick={onClose}
                  className="px-5 py-2 rounded text-sm font-semibold"
                  style={{ background: "var(--color-border)", color: "var(--color-text)" }}>Close</button>
              </div>
            </>
          )}

          {/* Error */}
          {phase === "error" && (
            <>
              <div className="rounded p-3" style={{ background: "var(--color-danger-bg)", border: "1px solid #8b2020" }}>
                <p className="text-xs font-semibold mb-1" style={{ color: "var(--color-danger)" }}>Error</p>
                <p className="text-xs font-mono break-all" style={{ color: "#c89090" }}>{errMsg}</p>
              </div>
              <div className="flex gap-3 justify-end">
                <button onClick={() => { setPhase("idle"); setErrMsg(""); setPreview(null); setSourcePath(""); }}
                  className="px-4 py-2 rounded text-sm"
                  style={{ background: "var(--color-panel-2)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>Back</button>
                <button onClick={onClose}
                  className="px-4 py-2 rounded text-sm"
                  style={{ background: "var(--color-panel-3)", color: "var(--color-text)" }}>Close</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Notes Modal ──────────────────────────────────────────────────────────────
function NotesModal({ displayTitle, initialNote, onSave, onClose }: {
  displayTitle: string; initialNote: string;
  onSave: (text: string) => void; onClose: () => void;
}) {
  const [text, setText] = useState(initialNote);
  const [preview, setPreview] = useState(false);
  const saveRef = useRef(onSave);
  saveRef.current = onSave;

  // Auto-save on every change (debounced 600 ms)
  useEffect(() => {
    const t = setTimeout(() => saveRef.current(text), 600);
    return () => clearTimeout(t);
  }, [text]);

  const renderedHtml = useMemo(() => marked.parse(text || "") as string, [text]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.85)" }}
      onClick={(e) => { if (e.target === e.currentTarget) { onSave(text); onClose(); } }}>
      <div className="rounded-lg shadow-2xl flex flex-col"
        style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)", width: "760px", height: "76vh" }}>

        {/* Header */}
        <div className="flex items-center gap-3 px-5 pt-4 pb-3 flex-shrink-0 border-b" style={{ borderColor: "var(--color-border-card)" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
          <span className="font-bold flex-1" style={{ color: "var(--color-white)" }}>Notes — {displayTitle}</span>
          <div className="flex rounded overflow-hidden" style={{ border: "1px solid var(--color-border)" }}>
            <button onClick={() => setPreview(false)}
              className="px-3 py-1 text-xs"
              style={{ background: !preview ? "var(--color-accent-dark)" : "var(--color-panel-2)", color: !preview ? "var(--color-white)" : "var(--color-text-muted)" }}>
              Edit
            </button>
            <button onClick={() => setPreview(true)}
              className="px-3 py-1 text-xs"
              style={{ background: preview ? "var(--color-accent-dark)" : "var(--color-panel-2)", color: preview ? "var(--color-white)" : "var(--color-text-muted)" }}>
              Preview
            </button>
          </div>
          <button onClick={() => { onSave(text); onClose(); }}
            className="ml-1 text-xs px-3 py-1.5 rounded"
            style={{ background: "var(--color-panel-3)", color: "var(--color-text)", border: "1px solid var(--color-border-strong)" }}>Close</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-hidden flex">
          {!preview ? (
            <textarea
              className="w-full h-full p-4 text-sm outline-none resize-none font-mono"
              style={{
                background: "var(--color-panel-deep)", color: "var(--color-text)",
                scrollbarWidth: "thin", scrollbarColor: "var(--color-border) transparent",
                lineHeight: "1.65",
              }}
              placeholder={"# Game Notes\n\nWrite anything here — Markdown is supported.\n\n- Quest progress\n- Tips & secrets\n- Save locations\n"}
              value={text}
              onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
            />
          ) : (
            <div
              className="w-full h-full overflow-y-auto p-5 text-sm markdown-body"
              style={{ background: "var(--color-panel-deep)", color: "var(--color-text)", scrollbarWidth: "thin", scrollbarColor: "var(--color-border) transparent" }}
              dangerouslySetInnerHTML={{ __html: renderedHtml || "<p style=\"opacity:0.3\">Nothing to preview yet.</p>" }}
            />
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center px-5 py-2 flex-shrink-0 border-t" style={{ borderColor: "var(--color-border-card)" }}>
          <span className="text-[10px]" style={{ color: "var(--color-text-dim)" }}>
            Supports Markdown · Auto-saved as you type · {text.length} chars
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Settings Mini-Menu ───────────────────────────────────────────────────────


// ─── Customise Modal ──────────────────────────────────────────────────────────
function CustomizeModal({ game, meta, custom, platform, globalLaunchConfig, onSave, onClose }: {
  game: Game; meta?: GameMetadata; custom: GameCustomization;
  platform: string;
  globalLaunchConfig: LaunchConfig;
  onSave: (c: GameCustomization) => void; onClose: () => void;
}) {
  const [displayName, setDisplayName] = useState(custom.displayName ?? meta?.title ?? game.name);
  const [coverUrl, setCoverUrl] = useState(custom.coverUrl ?? "");
  const [bgUrl, setBgUrl] = useState(custom.backgroundUrl ?? "");
  const [exeOverride, setExeOverride] = useState(custom.exeOverride ?? "");
  const [launchArgs, setLaunchArgs] = useState(custom.launchArgs ?? "");
  const [pinnedExes, setPinnedExes] = useState<{ name: string; path: string }[]>(custom.pinnedExes ?? []);
  const [siblingExes, setSiblingExes] = useState<string[]>([]);
  const [detectingExes, setDetectingExes] = useState(false);
  const [runnerOverrideEnabled, setRunnerOverrideEnabled] = useState(!!custom.runnerOverrideEnabled);
  const [runnerOverride, setRunnerOverride] = useState<RunnerOverrideConfig>(
    custom.runnerOverride ?? {
      runner: globalLaunchConfig.runner,
      runnerPath: globalLaunchConfig.runnerPath,
      prefixPath: globalLaunchConfig.prefixPath,
    }
  );
  const [detectedRunners, setDetectedRunners] = useState<{ name: string; path: string; kind: RunnerKind; flavor?: string }[]>([]);
  const [detectingRunners, setDetectingRunners] = useState(false);

  // Derive game folder from its exe path
  const gameFolder = game.path.replace(/[\\/][^\\/]+$/, "");

  useEffect(() => {
    if (platform === "windows") return;
    setDetectingRunners(true);
    invoke<{ name: string; path: string; kind: RunnerKind; flavor?: string }[]>("detect_wine_runners")
      .then(setDetectedRunners)
      .catch(() => setDetectedRunners([]))
      .finally(() => setDetectingRunners(false));
  }, [platform]);

  const pickImage = async (setter: (s: string) => void) => {
    const sel = await open({
      multiple: false, directory: false,
      filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
    }).catch(() => null);
    if (sel && typeof sel === "string") setter(convertFileSrc(sel));
  };

  const pickExe = async () => {
    const sel = await open({
      multiple: false, directory: false,
      defaultPath: gameFolder,
      filters: [{ name: "Executable", extensions: ["exe", "sh", "bin", "app"] }],
    }).catch(() => null);
    if (sel && typeof sel === "string") setExeOverride(sel);
  };

  /** Scan the game's folder for all .exe files other than the current one */
  const detectSiblings = async () => {
    setDetectingExes(true);
    try {
      const exes = await invoke<string[]>("list_executables_in_folder", {
        folder: gameFolder,
      });
      setSiblingExes(exes.filter((e) => e !== game.path));
    } catch {
      // Command may not exist in older builds — graceful no-op
      setSiblingExes([]);
    } finally {
      setDetectingExes(false);
    }
  };

  const doSave = () => {
    onSave({
      displayName: displayName.trim() || undefined,
      coverUrl: coverUrl.trim() || undefined,
      backgroundUrl: bgUrl.trim() || undefined,
      exeOverride: exeOverride.trim() && exeOverride.trim() !== game.path ? exeOverride.trim() : undefined,
      launchArgs: launchArgs.trim() || undefined,
      pinnedExes: pinnedExes.length > 0 ? pinnedExes : undefined,
      runnerOverrideEnabled: platform !== "windows" && runnerOverrideEnabled ? true : undefined,
      runnerOverride: platform !== "windows" && runnerOverrideEnabled ? {
        runner: runnerOverride.runner,
        runnerPath: runnerOverride.runnerPath.trim(),
        prefixPath: runnerOverride.prefixPath.trim(),
      } : undefined,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.85)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rounded-lg shadow-2xl w-[520px] max-h-[90vh] overflow-y-auto"
        style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
        <div className="flex items-center gap-3 px-6 pt-5 pb-4 border-b" style={{ borderColor: "var(--color-border-card)" }}>
          <span style={{ fontSize: "20px" }}>🎨</span>
          <div>
            <h2 className="font-bold text-base" style={{ color: "var(--color-white)" }}>Customise Game</h2>
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>{game.name}</p>
          </div>
        </div>
        <div className="px-6 py-5 space-y-5">
          {/* Display name */}
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: "var(--color-text-muted)" }}>
              Display Name <span style={{ fontWeight: "normal", color: "var(--color-text-dim)" }}>(used in list &amp; search)</span>
            </label>
            <div className="flex gap-2">
              <input type="text" value={displayName}
                onInput={(e) => setDisplayName((e.target as HTMLInputElement).value)}
                className="flex-1 px-3 py-2 rounded text-sm outline-none"
                style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border)" }} />
              {/* Quick-fill: use the parent folder name as the game title */}
              <button
                title="Use the parent folder name as the game title"
                onClick={() => {
                  const folder = game.path.replace(/[\\/][^\\/]+$/, "");
                  const folderName = folder.replace(/\\/g, "/").split("/").pop() ?? folder;
                  setDisplayName(folderName);
                }}
                className="px-2.5 py-2 rounded text-xs flex-shrink-0 flex items-center gap-1"
                style={{ background: "var(--color-panel-3)", color: "var(--color-text-muted)", border: "1px solid var(--color-border-strong)" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--color-accent-deep)"; e.currentTarget.style.color = "var(--color-accent)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "var(--color-panel-3)"; e.currentTarget.style.color = "var(--color-text-muted)"; }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
                Folder
              </button>
            </div>
            {/* Hint when the exe name is generic */}
            {GENERIC_EXE_NAMES.has((game.path.replace(/\\/g, "/").split("/").pop() ?? "").replace(/\.[^.]+$/, "").toLowerCase()) && (
              <p className="mt-1 text-[10px]" style={{ color: "var(--color-warning)" }}>
                ⚠ Generic exe detected — folder name was used as the title automatically during scan.
              </p>
            )}
          </div>

          {/* ── Executable Override ───────────────────────────────────── */}
          <div>
            <label className="block text-xs font-semibold mb-1" style={{ color: "var(--color-text-muted)" }}>
              Launch Executable
              <span style={{ fontWeight: "normal", color: "var(--color-text-dim)" }}> (override scanned .exe)</span>
            </label>
            {/* current / override path */}
            <div className="rounded px-3 py-2 mb-2 text-xs font-mono break-all"
              style={{ background: "var(--color-bg-code)", border: "1px solid var(--color-border-soft)", color: exeOverride ? "var(--color-warning)" : "var(--color-text-dim)" }}>
              {exeOverride || game.path}
              {exeOverride && (
                <span className="ml-2 font-sans"
                  style={{ color: "var(--color-text-dim)", fontSize: "10px" }}>
                  (override active)
                </span>
              )}
            </div>
            <div className="flex gap-2 mb-2">
              <button onClick={pickExe}
                className="flex-1 py-1.5 rounded text-xs flex items-center justify-center gap-1.5"
                style={{ background: "var(--color-panel-3)", color: "var(--color-text)", border: "1px solid var(--color-border-strong)" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--color-accent-deep)"; e.currentTarget.style.color = "var(--color-accent)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "var(--color-panel-3)"; e.currentTarget.style.color = "var(--color-text)"; }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                Browse…
              </button>
              <button onClick={detectSiblings} disabled={detectingExes}
                className="flex-1 py-1.5 rounded text-xs flex items-center justify-center gap-1.5 disabled:opacity-50"
                style={{ background: "var(--color-panel-3)", color: "var(--color-text)", border: "1px solid var(--color-border-strong)" }}
                onMouseEnter={(e) => { if (!detectingExes) { e.currentTarget.style.background = "var(--color-accent-deep)"; e.currentTarget.style.color = "var(--color-accent)"; } }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "var(--color-panel-3)"; e.currentTarget.style.color = "var(--color-text)"; }}>
                {detectingExes
                  ? <span className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
                  : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
                  </svg>}
                Detect others…
              </button>
              {exeOverride && (
                <button onClick={() => { setExeOverride(""); setSiblingExes([]); }}
                  className="px-3 py-1.5 rounded text-xs flex-shrink-0"
                  style={{ background: "transparent", color: "var(--color-danger)", border: "1px solid var(--color-danger-bg)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--color-danger-bg)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                  title="Clear override — use the originally scanned exe">
                  ✕ Clear
                </button>
              )}
            </div>
            {/* Sibling exe picker list */}
            {siblingExes.length > 0 && (
              <div className="rounded border overflow-hidden" style={{ borderColor: "var(--color-border-soft)" }}>
                <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest"
                  style={{ background: "var(--color-bg-code)", color: "var(--color-text-dim)" }}>
                  Executables found in game folder — click to select
                </p>
                {siblingExes.map((exe) => {
                  const fname = exe.replace(/\\/g, "/").split("/").pop() ?? exe;
                  const isActive = exeOverride === exe;
                  return (
                    <button key={exe} onClick={() => setExeOverride(exe)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left"
                      style={{
                        background: isActive ? "var(--color-accent-deeper)" : "var(--color-panel-deep)",
                        color: isActive ? "var(--color-accent)" : "var(--color-text-muted)",
                        borderTop: "1px solid var(--color-border-soft)",
                      }}
                      onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "var(--color-panel-alt)"; }}
                      onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "var(--color-panel-deep)"; }}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                        stroke={isActive ? "var(--color-accent)" : "var(--color-text-dim)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 12h4" /><path d="M8 10v4" /><circle cx="17" cy="12" r="1" />
                      </svg>
                      <span className="font-mono flex-1 truncate">{fname}</span>
                      {isActive && (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </button>
                  );
                })}
                {siblingExes.length === 0 && (
                  <p className="px-3 py-3 text-xs text-center" style={{ color: "var(--color-text-dim)", background: "var(--color-panel-deep)" }}>
                    No other executables found in this folder.
                  </p>
                )}
              </div>
            )}
            {!detectingExes && siblingExes.length === 0 && exeOverride === "" && (
              <p className="text-[10px]" style={{ color: "var(--color-text-dim)" }}>
                By default the game launches the scanned .exe above. Use this to pick a different launcher in the same folder.
              </p>
            )}

            <div className="mt-4">
              <label className="block text-xs font-semibold mb-1" style={{ color: "var(--color-text-muted)" }}>
                Launch Arguments
              </label>
              <input type="text" placeholder="e.g. -fullscreen -w 1920" value={launchArgs}
                onInput={(e) => setLaunchArgs((e.target as HTMLInputElement).value)}
                className="w-full px-3 py-2 rounded text-sm outline-none font-mono"
                style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border)" }} />
            </div>

            {platform !== "windows" && (
              <div className="mt-4 rounded-lg p-3" style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border)" }}>
                <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer" style={{ color: "var(--color-text-muted)" }}>
                  <input
                    type="checkbox"
                    checked={runnerOverrideEnabled}
                    onChange={(e) => setRunnerOverrideEnabled(e.currentTarget.checked)}
                  />
                  Per-game runner override
                </label>
                {!runnerOverrideEnabled && (
                  <p className="text-[10px] mt-1" style={{ color: "var(--color-text-dim)" }}>
                    Uses global Wine/Proton settings.
                  </p>
                )}

                {runnerOverrideEnabled && (
                  <div className="mt-3 space-y-2">
                    <div className="flex gap-2">
                      {(["wine", "proton", "custom"] as RunnerKind[]).map((r) => (
                        <button
                          key={r}
                          onClick={() => setRunnerOverride((prev) => ({ ...prev, runner: r }))}
                          className="flex-1 py-1.5 rounded text-xs capitalize"
                          style={{
                            background: runnerOverride.runner === r ? "var(--color-accent-dark)" : "var(--color-panel-alt)",
                            color: runnerOverride.runner === r ? "var(--color-white)" : "var(--color-text-muted)",
                            border: `1px solid ${runnerOverride.runner === r ? "var(--color-accent-mid)" : "var(--color-border)"}`,
                          }}
                        >
                          {r === "wine" ? "Wine" : r === "proton" ? "Proton" : "Custom"}
                        </button>
                      ))}
                    </div>

                    <input
                      type="text"
                      placeholder={runnerOverride.runner === "wine" ? "/usr/bin/wine" : runnerOverride.runner === "proton" ? "/path/to/proton" : "/path/to/runner"}
                      value={runnerOverride.runnerPath}
                      onInput={(e) => setRunnerOverride((prev) => ({ ...prev, runnerPath: (e.target as HTMLInputElement).value }))}
                      className="w-full px-2 py-1.5 rounded text-xs font-mono outline-none"
                      style={{ background: "var(--color-bg-code)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
                    />
                    <input
                      type="text"
                      placeholder={runnerOverride.runner === "proton" ? "STEAM_COMPAT_DATA_PATH" : "WINEPREFIX"}
                      value={runnerOverride.prefixPath}
                      onInput={(e) => setRunnerOverride((prev) => ({ ...prev, prefixPath: (e.target as HTMLInputElement).value }))}
                      className="w-full px-2 py-1.5 rounded text-xs font-mono outline-none"
                      style={{ background: "var(--color-bg-code)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
                    />
                    {detectedRunners.length > 0 && (
                      <div className="max-h-32 overflow-y-auto rounded border" style={{ borderColor: "var(--color-border)" }}>
                        {detectedRunners.map((d) => (
                          <button
                            key={d.path}
                            onClick={() =>
                              setRunnerOverride((prev) => ({
                                ...prev,
                                runnerPath: d.path,
                                runner: d.kind,
                              }))
                            }
                            className="w-full text-left px-2 py-1.5 text-[10px] border-b last:border-b-0 flex items-center gap-2"
                            style={{
                              background: runnerOverride.runnerPath === d.path ? "var(--color-accent-deeper)" : "var(--color-bg-code)",
                              borderColor: "var(--color-border-soft)",
                              color: runnerOverride.runnerPath === d.path ? "var(--color-accent)" : "var(--color-text-muted)",
                            }}
                          >
                            <span>{d.name}</span>
                            {d.flavor === "ge" && <span className="ml-auto text-[9px]" style={{ color: "var(--color-warning)" }}>GE</span>}
                          </button>
                        ))}
                      </div>
                    )}
                    {detectingRunners && <p className="text-[10px]" style={{ color: "var(--color-text-dim)" }}>Detecting runners…</p>}
                    <p className="text-[10px]" style={{ color: "var(--color-text-dim)" }}>
                      Tip: leave runner path empty with `Custom` to force direct launch for this game.
                    </p>
                  </div>
                )}
              </div>
            )}

            <div className="mt-4">
              <label className="block text-xs font-semibold mb-1" style={{ color: "var(--color-text-muted)" }}>
                Pinned Executables <span style={{ fontWeight: "normal", color: "var(--color-text-dim)" }}>(e.g. Server, Config)</span>
              </label>
              <div className="space-y-2">
                {pinnedExes.map((pe, i) => (
                  <div key={i} className="flex gap-2">
                    <input type="text" placeholder="Label" value={pe.name}
                      onInput={(e) => {
                        const next = [...pinnedExes];
                        next[i].name = (e.target as HTMLInputElement).value;
                        setPinnedExes(next);
                      }}
                      className="w-1/3 px-2 py-1.5 rounded text-xs outline-none bg-[var(--color-panel-2)] border border-[var(--color-border)] text-[var(--color-text)]" />
                    <input type="text" placeholder="Exe path" value={pe.path} readOnly
                      className="flex-1 px-2 py-1.5 rounded text-[10px] outline-none bg-[var(--color-bg-code)] border border-[var(--color-border-soft)] text-[var(--color-text-muted)] font-mono break-all" />
                    <button onClick={() => setPinnedExes(pinnedExes.filter((_, idx) => idx !== i))}
                      className="px-2 rounded text-xs text-[var(--color-danger)] hover:bg-[var(--color-danger-bg)]" title="Remove pin">✕</button>
                  </div>
                ))}
              </div>
              <button
                onClick={async () => {
                  const sel = await open({ multiple: false, directory: false, defaultPath: gameFolder, filters: [{ name: "Executable", extensions: ["exe", "bat", "sh"] }] }).catch(() => null);
                  if (sel && typeof sel === "string") {
                    const fname = sel.replace(/\\/g, "/").split("/").pop() ?? "New Pin";
                    setPinnedExes([...pinnedExes, { name: fname, path: sel }]);
                  }
                }}
                className="mt-2 px-3 py-1.5 rounded text-xs" style={{ background: "var(--color-panel-3)", color: "var(--color-accent)", border: "1px dashed var(--color-border-strong)" }}>
                + Add pinned executable
              </button>
            </div>
          </div>

          {/* Cover image */}
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: "var(--color-text-muted)" }}>
              Custom Cover <span style={{ fontWeight: "normal", color: "var(--color-text-dim)" }}>(thumbnail in sidebar)</span>
            </label>
            <div className="flex gap-2">
              <input type="text" placeholder="Paste URL or pick a file…" value={coverUrl}
                onInput={(e) => setCoverUrl((e.target as HTMLInputElement).value)}
                className="flex-1 px-3 py-2 rounded text-sm outline-none"
                style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border)" }} />
              <button onClick={() => pickImage(setCoverUrl)}
                className="px-3 py-2 rounded text-xs flex-shrink-0"
                style={{ background: "var(--color-border)", color: "var(--color-text)", border: "1px solid var(--color-border-strong)" }}>Browse</button>
            </div>
            {coverUrl && (
              <img src={coverUrl} alt="" className="mt-2 rounded h-20 w-auto object-cover"
                style={{ border: "1px solid var(--color-border)", maxWidth: "100%" }} />
            )}
          </div>
          {/* Hero background */}
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: "var(--color-text-muted)" }}>
              Hero Background <span style={{ fontWeight: "normal", color: "var(--color-text-dim)" }}>(banner on detail page)</span>
            </label>
            <div className="flex gap-2">
              <input type="text" placeholder="Paste URL or pick a file…" value={bgUrl}
                onInput={(e) => setBgUrl((e.target as HTMLInputElement).value)}
                className="flex-1 px-3 py-2 rounded text-sm outline-none"
                style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border)" }} />
              <button onClick={() => pickImage(setBgUrl)}
                className="px-3 py-2 rounded text-xs flex-shrink-0"
                style={{ background: "var(--color-border)", color: "var(--color-text)", border: "1px solid var(--color-border-strong)" }}>Browse</button>
            </div>
            {bgUrl && (
              <img src={bgUrl} alt="" className="mt-2 rounded h-20 w-full object-cover"
                style={{ border: "1px solid var(--color-border)" }} />
            )}
          </div>
        </div>
        <div className="flex items-center justify-between px-6 pb-5">
          <button onClick={() => { onSave({}); onClose(); }}
            className="px-4 py-2 rounded text-xs"
            style={{ background: "transparent", color: "var(--color-text-dim)", border: "1px solid var(--color-panel-3)" }}>
            Reset to defaults
          </button>
          <div className="flex gap-2">
            <button onClick={onClose}
              className="px-4 py-2 rounded text-sm"
              style={{ background: "var(--color-panel-2)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>Cancel</button>
            <button onClick={doSave}
              className="px-5 py-2 rounded text-sm font-semibold"
              style={{ background: "var(--color-accent-dark)", color: "var(--color-white)" }}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Wine / Proton Settings Modal ──────────────────────────────────────────────
function WineSettingsModal({ config, onSave, onClose }: {
  config: LaunchConfig;
  onSave: (c: LaunchConfig) => void;
  onClose: () => void;
}) {
  const [cfg, setCfg] = useState<LaunchConfig>(config);
  const [detected, setDetected] = useState<{ name: string; path: string; kind: RunnerKind; flavor?: string }[]>([]);
  const [detecting, setDetecting] = useState(false);
  const [prefixes, setPrefixes] = useState<PrefixInfo[]>([]);
  const [prefixLoading, setPrefixLoading] = useState(false);
  const [prefixError, setPrefixError] = useState("");
  const [newPrefixPath, setNewPrefixPath] = useState("");
  const [toolBusy, setToolBusy] = useState<string | null>(null);
  const [selectedVerb, setSelectedVerb] = useState("vcrun2019");
  const winetricksVerbs = ["vcrun2019", "d3dx9", "dotnet48", "corefonts", "xact", "xinput"];

  useEffect(() => {
    setDetecting(true);
    invoke<{ name: string; path: string; kind: RunnerKind; flavor?: string }[]>("detect_wine_runners")
      .then(setDetected).catch(() => { }).finally(() => setDetecting(false));
  }, []);

  const refreshPrefixes = useCallback(() => {
    setPrefixLoading(true);
    setPrefixError("");
    invoke<PrefixInfo[]>("list_wine_prefixes")
      .then((rows) => {
        setPrefixes(rows);
        if (!newPrefixPath && rows.length > 0) setNewPrefixPath(rows[0].path.replace(/[\\/][^\\/]+$/, ""));
      })
      .catch((e) => setPrefixError(String(e)))
      .finally(() => setPrefixLoading(false));
  }, [newPrefixPath]);

  useEffect(() => {
    refreshPrefixes();
  }, [refreshPrefixes]);

  const createPrefix = async () => {
    const target = newPrefixPath.trim();
    if (!target) return;
    setToolBusy("create");
    try {
      await invoke("create_wine_prefix", { path: target, runner: cfg.runnerPath || null });
      await refreshPrefixes();
    } catch (e) {
      alert("Failed to create prefix: " + e);
    } finally {
      setToolBusy(null);
    }
  };

  const deletePrefix = async (path: string) => {
    if (!confirm(`Delete prefix?\n${path}`)) return;
    setToolBusy(`del:${path}`);
    try {
      await invoke("delete_wine_prefix", { path });
      await refreshPrefixes();
    } catch (e) {
      alert("Failed to delete prefix: " + e);
    } finally {
      setToolBusy(null);
    }
  };

  const installGraphics = async (prefix: PrefixInfo) => {
    const needDxvk = !prefix.has_dxvk;
    const needVkd3d = !prefix.has_vkd3d;
    if (!needDxvk && !needVkd3d) return;
    setToolBusy(`gfx:${prefix.path}`);
    try {
      await invoke("install_dxvk_vkd3d", {
        prefix: prefix.path,
        installDxvk: needDxvk,
        installVkd3d: needVkd3d,
      });
      await refreshPrefixes();
    } catch (e) {
      alert("DXVK/VKD3D install failed: " + e);
    } finally {
      setToolBusy(null);
    }
  };

  const runVerb = async (prefix: PrefixInfo) => {
    setToolBusy(`verb:${prefix.path}`);
    try {
      await invoke("run_winetricks", { prefix: prefix.path, verbs: [selectedVerb] });
      alert(`Winetricks finished: ${selectedVerb}`);
      await refreshPrefixes();
    } catch (e) {
      alert("Winetricks failed: " + e);
    } finally {
      setToolBusy(null);
    }
  };

  const upd = (patch: Partial<LaunchConfig>) => setCfg((p) => ({ ...p, ...patch }));

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: "rgba(0,0,0,0.8)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rounded-xl shadow-2xl w-[500px] flex flex-col" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border-strong)", maxHeight: "80vh" }}>

        {/* Header */}
        <div className="flex items-center gap-2.5 px-5 py-4 border-b flex-shrink-0" style={{ borderColor: "var(--color-bg-deep)" }}>
          <span className="text-lg">🍷</span>
          <span className="font-bold flex-1" style={{ color: "var(--color-white)" }}>Wine / Proton Settings</span>
          <button onClick={onClose} style={{ color: "var(--color-text-muted)", fontSize: "18px" }}>✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Enable toggle */}
          <label className="flex items-center gap-3 cursor-pointer">
            <div className="relative w-10 h-5 flex-shrink-0">
              <input type="checkbox" className="sr-only" checked={cfg.enabled}
                onChange={(e) => upd({ enabled: e.currentTarget.checked })} />
              <div className="w-10 h-5 rounded-full transition-colors"
                style={{ background: cfg.enabled ? "var(--color-accent-dark)" : "var(--color-panel-3)", border: "1px solid var(--color-border-strong)" }} />
              <div className="absolute top-0.5 rounded-full w-4 h-4 transition-transform"
                style={{ background: "var(--color-white)", left: cfg.enabled ? "22px" : "2px", transition: "left 0.15s" }} />
            </div>
            <div>
              <p className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>Run via Wine / Proton</p>
              <p className="text-[11px]" style={{ color: "var(--color-text-dim)" }}>When disabled, games launch directly (use on Linux-native builds)</p>
            </div>
          </label>

          {cfg.enabled && (<>
            {/* Runner type */}
            <div>
              <p className="text-xs font-semibold mb-2" style={{ color: "var(--color-text-muted)" }}>Runner type</p>
              <div className="flex gap-2">
                {(["wine", "proton", "custom"] as const).map((r) => (
                  <button key={r} onClick={() => upd({ runner: r })}
                    className="flex-1 py-2 rounded text-xs font-semibold capitalize"
                    style={{
                      background: cfg.runner === r ? "var(--color-accent-dark)" : "var(--color-panel-alt)",
                      color: cfg.runner === r ? "var(--color-white)" : "var(--color-text-muted)",
                      border: `1px solid ${cfg.runner === r ? "var(--color-accent-mid)" : "var(--color-border-subtle)"}`,
                    }}>{r === "wine" ? "🍷 Wine" : r === "proton" ? "⚙ Proton" : "🔧 Custom"}</button>
                ))}
              </div>
            </div>

            {/* Auto-detected runners */}
            {detected.length > 0 && (
              <div>
                <p className="text-xs font-semibold mb-1.5" style={{ color: "var(--color-text-muted)" }}>Detected on this system</p>
                <div className="space-y-1">
                  {detected.map((d) => (
                    <button key={d.path}
                      onClick={() => upd({ runnerPath: d.path, runner: d.kind })}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded text-xs text-left"
                      style={{
                        background: cfg.runnerPath === d.path ? "var(--color-accent-deeper)" : "var(--color-panel-alt)",
                        border: `1px solid ${cfg.runnerPath === d.path ? "var(--color-accent-mid)" : "var(--color-border-subtle)"}`,
                        color: "var(--color-text)",
                      }}>
                      <span>{d.kind === "wine" ? "🍷" : "⚙"}</span>
                      <span className="font-semibold">{d.name}</span>
                      {d.flavor === "ge" && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold" style={{ background: "#3a2800", color: "var(--color-warning)" }}>
                          GE
                        </span>
                      )}
                      <span className="ml-auto font-mono text-[10px] truncate max-w-[220px]" style={{ color: "var(--color-text-dim)" }}>{d.path}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {detecting && <p className="text-xs" style={{ color: "var(--color-text-dim)" }}>Detecting runners…</p>}
            {!detecting && detected.length === 0 && (
              <p className="text-xs" style={{ color: "var(--color-text-dim)" }}>No Wine or Proton installations detected automatically.</p>
            )}

            {/* Runner path */}
            <div>
              <p className="text-xs font-semibold mb-1.5" style={{ color: "var(--color-text-muted)" }}>
                {cfg.runner === "wine" ? "Wine executable path" : cfg.runner === "proton" ? "Proton executable path" : "Runner executable path"}
              </p>
              <input
                placeholder={cfg.runner === "wine" ? "/usr/bin/wine" : cfg.runner === "proton" ? "/path/to/proton" : "/path/to/runner"}
                value={cfg.runnerPath}
                onInput={(e) => upd({ runnerPath: (e.target as HTMLInputElement).value })}
                className="w-full px-3 py-1.5 rounded text-xs font-mono outline-none"
                style={{ background: "var(--color-bg-code)", color: "var(--color-text)", border: "1px solid var(--color-panel-3)" }} />
              <p className="text-[10px] mt-0.5" style={{ color: "var(--color-text-dim)" }}>
                Leave blank to use system-wide binary from PATH
              </p>
            </div>

            {/* Prefix path */}
            <div>
              <p className="text-xs font-semibold mb-1.5" style={{ color: "var(--color-text-muted)" }}>
                {cfg.runner === "proton" ? "Steam Compat Data Path (STEAM_COMPAT_DATA_PATH)" : "Wine Prefix (WINEPREFIX)"}
              </p>
              <input
                placeholder={cfg.runner === "proton" ? "~/.steam/steam/steamapps/compatdata/custom" : "~/.wine"}
                value={cfg.prefixPath}
                onInput={(e) => upd({ prefixPath: (e.target as HTMLInputElement).value })}
                className="w-full px-3 py-1.5 rounded text-xs font-mono outline-none"
                style={{ background: "var(--color-bg-code)", color: "var(--color-text)", border: "1px solid var(--color-panel-3)" }} />
              <p className="text-[10px] mt-0.5" style={{ color: "var(--color-text-dim)" }}>
                Leave blank to use the default prefix
              </p>
            </div>

            {/* Proton hint */}
            {cfg.runner === "proton" && (
              <div className="rounded-lg px-3 py-2.5 text-xs" style={{ background: "#1a2636", border: "1px solid var(--color-panel-3)", color: "var(--color-text-muted)", lineHeight: 1.6 }}>
                <p className="font-semibold mb-1" style={{ color: "var(--color-accent)" }}>Proton notes</p>
                <p>The <code style={{ color: "var(--color-code-accent)" }}>proton</code> script requires <strong>python3</strong> and a Steam installation.</p>
                <p>Set the data path to a folder that will hold the Proton prefix (Wine bottle) for your games.</p>
              </div>
            )}

            <div className="rounded-lg p-3 space-y-3" style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border)" }}>
              <div className="flex items-center gap-2">
                <p className="text-xs font-semibold" style={{ color: "var(--color-text-muted)" }}>Wine Prefix Manager</p>
                <button
                  onClick={refreshPrefixes}
                  className="ml-auto px-2 py-1 rounded text-[10px]"
                  style={{ background: "var(--color-panel-3)", color: "var(--color-text-muted)" }}
                  disabled={prefixLoading}
                >
                  Refresh
                </button>
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={newPrefixPath}
                  onInput={(e) => setNewPrefixPath((e.target as HTMLInputElement).value)}
                  placeholder="New prefix path"
                  className="flex-1 px-2 py-1.5 rounded text-xs font-mono outline-none"
                  style={{ background: "var(--color-bg-code)", color: "var(--color-text)", border: "1px solid var(--color-panel-3)" }}
                />
                <button
                  onClick={createPrefix}
                  disabled={toolBusy === "create" || !newPrefixPath.trim()}
                  className="px-3 py-1.5 rounded text-xs disabled:opacity-50"
                  style={{ background: "var(--color-accent-dark)", color: "var(--color-white)" }}
                >
                  Create
                </button>
              </div>

              {prefixError && <p className="text-[10px]" style={{ color: "var(--color-danger)" }}>{prefixError}</p>}
              {prefixLoading && <p className="text-[10px]" style={{ color: "var(--color-text-dim)" }}>Loading prefixes…</p>}

              <div className="space-y-2 max-h-56 overflow-y-auto" style={{ scrollbarWidth: "thin", scrollbarColor: "var(--color-border) transparent" }}>
                {prefixes.length === 0 && !prefixLoading && (
                  <p className="text-[10px]" style={{ color: "var(--color-text-dim)" }}>No Wine/Proton prefixes found.</p>
                )}
                {prefixes.map((pfx) => (
                  <div key={pfx.path} className="rounded p-2" style={{ background: "var(--color-bg-code)", border: "1px solid var(--color-border-soft)" }}>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-semibold" style={{ color: "var(--color-text)" }}>{pfx.name}</span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: "var(--color-panel)", color: "var(--color-text-muted)" }}>{pfx.kind}</span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: pfx.has_dxvk ? "var(--color-success-bg)" : "var(--color-warning-bg)", color: pfx.has_dxvk ? "var(--color-success)" : "var(--color-warning)" }}>
                        DXVK {pfx.has_dxvk ? "ok" : "missing"}
                      </span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: pfx.has_vkd3d ? "var(--color-success-bg)" : "var(--color-warning-bg)", color: pfx.has_vkd3d ? "var(--color-success)" : "var(--color-warning)" }}>
                        VKD3D {pfx.has_vkd3d ? "ok" : "missing"}
                      </span>
                    </div>
                    <p className="text-[9px] mt-1 font-mono break-all" style={{ color: "var(--color-text-dim)" }}>{pfx.path}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <button
                        onClick={() => installGraphics(pfx)}
                        disabled={toolBusy === `gfx:${pfx.path}` || (pfx.has_dxvk && pfx.has_vkd3d)}
                        className="px-2.5 py-1 rounded text-[10px] disabled:opacity-40"
                        style={{ background: "var(--color-panel-3)", color: "var(--color-accent-soft)" }}
                      >
                        Install DXVK/VKD3D
                      </button>
                      <select
                        value={selectedVerb}
                        onChange={(e) => setSelectedVerb((e.target as HTMLSelectElement).value)}
                        className="px-2 py-1 rounded text-[10px] outline-none"
                        style={{ background: "var(--color-panel-alt)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
                      >
                        {winetricksVerbs.map((v) => (
                          <option key={v} value={v}>{v}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => runVerb(pfx)}
                        disabled={toolBusy === `verb:${pfx.path}`}
                        className="px-2.5 py-1 rounded text-[10px] disabled:opacity-40"
                        style={{ background: "var(--color-panel-3)", color: "var(--color-accent)" }}
                      >
                        Run Winetricks
                      </button>
                      <button
                        onClick={() => deletePrefix(pfx.path)}
                        disabled={toolBusy === `del:${pfx.path}`}
                        className="ml-auto px-2 py-1 rounded text-[10px] disabled:opacity-40"
                        style={{ background: "#3a2020", color: "var(--color-danger-soft)" }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>)}
        </div>

        {/* Footer */}
        <div className="flex gap-2 justify-end px-5 py-3 border-t flex-shrink-0" style={{ borderColor: "var(--color-bg-deep)" }}>
          <button onClick={onClose}
            className="px-4 py-2 rounded text-sm"
            style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border-strong)" }}>Cancel</button>
          <button onClick={() => { onSave(cfg); onClose(); }}
            className="px-5 py-2 rounded text-sm font-semibold"
            style={{ background: "var(--color-accent-dark)", color: "var(--color-white)" }}>Save</button>
        </div>
      </div>
    </div>
  );
}

// ─── Manage Collections Modal ───────────────────────────────────────────────
function ManageCollectionsModal({ gamePath, displayTitle, collections, onToggle, onCreate, onClose }: {
  gamePath: string; displayTitle: string;
  collections: Collection[];
  onToggle: (collectionId: string, gamePath: string, add: boolean) => void;
  onCreate: (name: string, color: string) => void;
  onClose: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(COLLECTION_COLORS[0]);
  const handleCreate = () => {
    if (!newName.trim()) return;
    onCreate(newName.trim(), newColor);
    setNewName(""); setCreating(false);
  };
  return (
    <div className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: "rgba(0,0,0,0.75)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rounded-xl shadow-2xl w-96 flex flex-col" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border-strong)", maxHeight: "72vh" }}>
        <div className="flex items-center gap-2 px-5 py-4 border-b flex-shrink-0" style={{ borderColor: "var(--color-bg-deep)" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          <span className="font-bold flex-1 text-sm truncate" style={{ color: "var(--color-white)" }}>Collections — {displayTitle}</span>
          <button onClick={onClose} className="text-lg leading-none" style={{ color: "var(--color-text-muted)" }}>✕</button>
        </div>
        <div className="flex-1 overflow-y-auto py-1" style={{ scrollbarWidth: "thin" }}>
          {collections.length === 0 && !creating && (
            <p className="px-5 py-5 text-sm text-center" style={{ color: "var(--color-text-muted)" }}>No collections yet.</p>
          )}
          {collections.map((col) => {
            const inCol = col.gamePaths.includes(gamePath);
            return (
              <label key={col.id} className="flex items-center gap-3 px-5 py-2.5 cursor-pointer"
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-border-subtle)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: col.color }} />
                <span className="flex-1 text-sm" style={{ color: "var(--color-text)" }}>{col.name}</span>
                <span className="text-[10px] mr-1" style={{ color: "var(--color-text-dim)" }}>{col.gamePaths.length}</span>
                <input type="checkbox" checked={inCol}
                  onChange={(e) => onToggle(col.id, gamePath, e.currentTarget.checked)}
                  style={{ accentColor: col.color, width: "14px", height: "14px", cursor: "pointer" }} />
              </label>
            );
          })}
        </div>
        <div className="px-5 py-3 border-t flex-shrink-0" style={{ borderColor: "var(--color-bg-deep)" }}>
          {creating ? (
            <div className="space-y-2">
              <input autoFocus placeholder="Collection name…" value={newName}
                onInput={(e) => setNewName((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") setCreating(false); }}
                className="w-full px-3 py-1.5 rounded text-xs outline-none"
                style={{ background: "var(--color-panel-3)", color: "var(--color-text)", border: "1px solid var(--color-border-strong)" }} />
              <div className="flex items-center gap-2">
                <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>Color:</span>
                {COLLECTION_COLORS.map((c) => (
                  <button key={c} onClick={() => setNewColor(c)}
                    className="w-4 h-4 rounded-full flex-shrink-0"
                    style={{
                      background: c, outline: newColor === c ? "2px solid var(--color-white)" : "none", outlineOffset: "1px",
                      transform: newColor === c ? "scale(1.25)" : "scale(1)", transition: "transform 0.1s"
                    }} />
                ))}
              </div>
              <div className="flex gap-2">
                <button onClick={handleCreate}
                  className="flex-1 py-1.5 rounded text-xs font-semibold"
                  style={{ background: "var(--color-accent-dark)", color: "var(--color-white)" }}>Create</button>
                <button onClick={() => setCreating(false)}
                  className="px-3 py-1.5 rounded text-xs"
                  style={{ background: "var(--color-panel-3)", color: "var(--color-text-muted)" }}>Cancel</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setCreating(true)}
              className="w-full py-1.5 rounded text-xs flex items-center justify-center gap-1.5"
              style={{ background: "var(--color-panel-alt)", color: "var(--color-text-muted)", border: "1px dashed var(--color-border-strong)" }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--color-accent)"; e.currentTarget.style.color = "var(--color-accent)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--color-border-strong)"; e.currentTarget.style.color = "var(--color-text-muted)"; }}>
              + New Collection
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── SessionTimeline ──────────────────────────────────────────────────────────

// ─── SessionNoteModal ─────────────────────────────────────────────────────────
/** Shown right after a session ends (or when editing a session note). */
function SessionNoteModal({ session, gameName, onSave, onDismiss }: {
  session: SessionEntry;
  gameName: string;
  onSave: (note: string) => void;
  onDismiss: () => void;
}) {
  const [note, setNote] = useState(session.note);
  return (
    <div className="fixed inset-0 z-[9999] flex items-end justify-end p-6"
      style={{ pointerEvents: "none" }}>
      <div className="rounded-xl shadow-2xl w-80"
        style={{
          background: "var(--color-panel)", border: "1px solid var(--color-border)",
          pointerEvents: "all",
          animation: "slideInUp 0.25s ease-out",
        }}>
        <div className="flex items-start gap-3 px-4 pt-4 pb-3 border-b" style={{ borderColor: "var(--color-border-card)" }}>
          <div className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0"
            style={{ background: "var(--color-bg-overlay)" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold" style={{ color: "var(--color-white)" }}>Session complete</p>
            <p className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
              {gameName} · {formatTime(session.duration)}
            </p>
          </div>
          <button onClick={onDismiss} style={{ color: "var(--color-text-dim)" }} className="text-sm">✕</button>
        </div>
        <div className="px-4 py-3">
          <p className="text-[10px] mb-1.5" style={{ color: "var(--color-text-muted)" }}>Add a session note (optional)</p>
          <textarea
            value={note}
            onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)}
            placeholder="e.g. finished chapter 3, found secret ending…"
            rows={2}
            className="w-full rounded px-2 py-1.5 text-xs resize-none"
            style={{
              background: "var(--color-bg-overlay)", border: "1px solid var(--color-border)", color: "var(--color-text)",
              outline: "none", fontFamily: "inherit",
            }}
          />
          <div className="flex gap-2 justify-end mt-2">
            <button onClick={onDismiss} className="px-3 py-1 rounded text-xs"
              style={{ background: "transparent", color: "var(--color-text-dim)" }}>Skip</button>
            <button onClick={() => onSave(note.trim())}
              className="px-4 py-1 rounded text-xs font-semibold"
              style={{ background: "var(--color-accent-dark)", color: "var(--color-white)" }}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── SteamImportModal ─────────────────────────────────────────────────────────
function SteamImportModal({ games, metadata, customizations, onImport, onClose }: {
  games: Game[];
  metadata: Record<string, GameMetadata>;
  customizations: Record<string, GameCustomization>;
  onImport: (matched: { path: string; addSecs: number }[]) => void;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [steamEntries, setSteamEntries] = useState<SteamEntry[]>([]);
  const [error, setError] = useState("");
  const [matched, setMatched] = useState<{ path: string; name: string; steamName: string; addSecs: number; checked: boolean }[]>([]);

  useEffect(() => {
    invoke<SteamEntry[]>("import_steam_playtime")
      .then((entries) => {
        setSteamEntries(entries);
        // Try to fuzzy-match by name
        const hits: typeof matched = [];
        for (const e of entries) {
          const steamLower = e.name.toLowerCase();
          for (const g of games) {
            const gName = (customizations[g.path]?.displayName ?? metadata[g.path]?.title ?? g.name).toLowerCase();
            if (gName === steamLower || steamLower.includes(gName) || gName.includes(steamLower)) {
              hits.push({
                path: g.path,
                name: customizations[g.path]?.displayName ?? metadata[g.path]?.title ?? g.name,
                steamName: e.name,
                addSecs: e.played_minutes * 60,
                checked: true,
              });
              break;
            }
          }
        }
        setMatched(hits);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  const toggle = (path: string) =>
    setMatched(prev => prev.map(m => m.path === path ? { ...m, checked: !m.checked } : m));

  const handleApply = () => {
    onImport(matched.filter(m => m.checked).map(m => ({ path: m.path, addSecs: m.addSecs })));
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.82)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rounded-xl shadow-2xl w-[480px] max-h-[80vh] flex flex-col"
        style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
        {/* Header */}
        <div className="flex items-center gap-3 px-6 pt-5 pb-4 border-b flex-shrink-0" style={{ borderColor: "var(--color-border-card)" }}>
          <div className="w-9 h-9 rounded flex items-center justify-center" style={{ background: "var(--color-panel-2)" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="var(--color-accent)">
              <path d="M12 2C6.48 2 2 6.48 2 12l5.84 2.41c.53-.32 1.14-.51 1.8-.51.07 0 .14 0 .21.01L12 10.5V10.42c0-2.52 2.04-4.58 4.56-4.58 2.52 0 4.56 2.04 4.56 4.58 0 2.52-2.04 4.56-4.56 4.56h-.1l-3.5 2.53c0 .06.01.12.01.18 0 1.89-1.53 3.42-3.42 3.42-1.67 0-3.07-1.2-3.36-2.79L2.17 14C3.14 18.55 7.15 22 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2z" />
            </svg>
          </div>
          <div>
            <h2 className="font-bold text-base" style={{ color: "var(--color-white)" }}>Import from Steam</h2>
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>Pre-fill playtime from localconfig.vdf</p>
          </div>
          <button onClick={onClose} className="ml-auto text-xl" style={{ color: "var(--color-text-dim)" }}>✕</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4"
          style={{ scrollbarWidth: "thin", scrollbarColor: "var(--color-border) transparent" }}>
          {loading && (
            <div className="flex items-center justify-center h-24 gap-3">
              <div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--color-accent)" }} />
              <span className="text-sm" style={{ color: "var(--color-text-muted)" }}>Reading Steam data…</span>
            </div>
          )}
          {error && <p className="text-sm" style={{ color: "var(--color-danger)" }}>{error}</p>}
          {!loading && !error && steamEntries.length === 0 && (
            <p className="text-sm text-center py-8" style={{ color: "var(--color-text-muted)" }}>
              No Steam data found. Make sure Steam is installed and you've launched at least one game.
            </p>
          )}
          {!loading && !error && matched.length > 0 && (
            <div>
              <p className="text-xs mb-3" style={{ color: "var(--color-text-muted)" }}>
                Found {matched.length} matching game{matched.length !== 1 ? "s" : ""}. Select which to import:
              </p>
              <div className="space-y-2">
                {matched.map(m => (
                  <label key={m.path} className="flex items-center gap-3 rounded-lg px-3 py-2 cursor-pointer"
                    style={{ background: "var(--color-panel-2)" }}>
                    <input type="checkbox" checked={m.checked} onChange={() => toggle(m.path)}
                      className="rounded" style={{ accentColor: "var(--color-accent)" }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate" style={{ color: "var(--color-text)" }}>{m.name}</p>
                      <p className="text-[10px]" style={{ color: "var(--color-text-dim)" }}>
                        Steam: "{m.steamName}" · {formatTime(m.addSecs)}
                      </p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}
          {!loading && !error && steamEntries.length > 0 && matched.length === 0 && (
            <p className="text-sm text-center py-4" style={{ color: "var(--color-text-muted)" }}>
              Found {steamEntries.length} Steam entries but none match your library by name.
            </p>
          )}
        </div>

        {/* Footer */}
        {!loading && matched.length > 0 && (
          <div className="flex gap-3 justify-end px-6 py-4 border-t flex-shrink-0" style={{ borderColor: "var(--color-border-card)" }}>
            <button onClick={onClose} className="px-4 py-2 rounded text-sm"
              style={{ background: "transparent", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>Cancel</button>
            <button onClick={handleApply}
              className="px-5 py-2 rounded text-sm font-semibold"
              style={{ background: "var(--color-accent-dark)", color: "var(--color-white)" }}>
              Apply {matched.filter(m => m.checked).length} import{matched.filter(m => m.checked).length !== 1 ? "s" : ""}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Lutris Import Modal ────────────────────────────────────────────────────
function LutrisImportModal({ games, onImport, onClose }: {
  games: Game[];
  onImport: (entries: LutrisGameEntry[]) => void;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<{ entry: LutrisGameEntry; checked: boolean; exists: boolean }[]>([]);

  useEffect(() => {
    invoke<LutrisGameEntry[]>("import_lutris_games")
      .then((entries) => {
        const normalized = entries
          .filter((e) => !!e.exe)
          .map((e) => {
            const exists = games.some((g) => normalizePathForMatch(g.path) === normalizePathForMatch(e.exe));
            return { entry: e, checked: true, exists };
          });
        setRows(normalized);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [games]);

  const toggle = (exe: string) => {
    setRows((prev) =>
      prev.map((r) => (r.entry.exe === exe ? { ...r, checked: !r.checked } : r))
    );
  };

  const apply = () => {
    onImport(rows.filter((r) => r.checked).map((r) => r.entry));
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.82)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rounded-xl shadow-2xl w-[680px] max-h-[82vh] flex flex-col"
        style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
        <div className="flex items-center gap-3 px-5 py-3 border-b" style={{ borderColor: "var(--color-border-card)" }}>
          <h2 className="font-bold text-sm" style={{ color: "var(--color-white)" }}>Import from Lutris</h2>
          <div className="flex-1" />
          <button onClick={onClose} className="text-sm" style={{ color: "var(--color-text-dim)" }}>✕</button>
        </div>
        <div className="px-5 py-3 text-xs" style={{ color: "var(--color-text-muted)" }}>
          Selected entries will be added to library (if missing) and receive per-game Wine/Proton override.
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-4"
          style={{ scrollbarWidth: "thin", scrollbarColor: "var(--color-border) transparent" }}>
          {loading && <p style={{ color: "var(--color-text-muted)" }}>Reading Lutris database…</p>}
          {error && <p style={{ color: "var(--color-danger)" }}>{error}</p>}
          {!loading && !error && rows.length === 0 && (
            <p style={{ color: "var(--color-text-muted)" }}>No Lutris games found.</p>
          )}
          {!loading && !error && rows.length > 0 && (
            <div className="space-y-2">
              {rows.map((r) => (
                <label key={r.entry.exe} className="block rounded p-2 cursor-pointer" style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border-soft)" }}>
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={r.checked}
                      onChange={() => toggle(r.entry.exe)}
                      className="mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm truncate" style={{ color: "var(--color-text)" }}>{r.entry.name}</p>
                        <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: r.exists ? "var(--color-success-bg)" : "var(--color-panel)", color: r.exists ? "var(--color-success)" : "var(--color-text-muted)" }}>
                          {r.exists ? "Exists" : "New"}
                        </span>
                        {r.entry.runner && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: "var(--color-panel-3)", color: "var(--color-accent-soft)" }}>
                            {r.entry.runner}
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] mt-0.5 break-all font-mono" style={{ color: "var(--color-text-dim)" }}>{r.entry.exe}</p>
                      {r.entry.prefix && (
                        <p className="text-[10px] mt-0.5 break-all font-mono" style={{ color: "var(--color-text-muted)" }}>prefix: {r.entry.prefix}</p>
                      )}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>
        {!loading && rows.length > 0 && (
          <div className="flex gap-3 justify-end px-5 py-3 border-t" style={{ borderColor: "var(--color-border-card)" }}>
            <button onClick={onClose} className="px-3 py-1.5 rounded text-xs" style={{ background: "transparent", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>
              Cancel
            </button>
            <button onClick={apply} className="px-4 py-1.5 rounded text-xs font-semibold" style={{ background: "var(--color-accent-dark)", color: "var(--color-white)" }}>
              Apply {rows.filter((r) => r.checked).length}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Playnite / GOG Import Modal ───────────────────────────────────────────
function InteropImportModal({
  games,
  command,
  title,
  subtitle,
  accent,
  onImport,
  onClose,
}: {
  games: Game[];
  command: "import_playnite_games" | "import_gog_galaxy_games";
  title: string;
  subtitle: string;
  accent: string;
  onImport: (entries: InteropGameEntry[]) => void;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<{ entry: InteropGameEntry; checked: boolean; exists: boolean }[]>([]);

  useEffect(() => {
    invoke<InteropGameEntry[]>(command)
      .then((entries) => {
        const normalized = entries
          .filter((e) => !!e.exe)
          .map((e) => {
            const exists = games.some((g) => normalizePathForMatch(g.path) === normalizePathForMatch(e.exe));
            return { entry: e, checked: true, exists };
          });
        setRows(normalized);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [command, games]);

  const toggle = (exe: string) => {
    setRows((prev) => prev.map((r) => (r.entry.exe === exe ? { ...r, checked: !r.checked } : r)));
  };

  const apply = () => {
    onImport(rows.filter((r) => r.checked).map((r) => r.entry));
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.82)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="rounded-xl shadow-2xl w-[700px] max-h-[82vh] flex flex-col"
        style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
        <div className="flex items-center gap-3 px-5 py-3 border-b" style={{ borderColor: "var(--color-border-card)" }}>
          <h2 className="font-bold text-sm" style={{ color: "var(--color-white)" }}>{title}</h2>
          <div className="flex-1" />
          <button onClick={onClose} className="text-sm" style={{ color: "var(--color-text-dim)" }}>✕</button>
        </div>
        <div className="px-5 py-3 text-xs" style={{ color: "var(--color-text-muted)" }}>
          {subtitle}
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-4"
          style={{ scrollbarWidth: "thin", scrollbarColor: "var(--color-border) transparent" }}>
          {loading && <p style={{ color: "var(--color-text-muted)" }}>Reading launcher database…</p>}
          {error && <p style={{ color: "var(--color-danger)" }}>{error}</p>}
          {!loading && !error && rows.length === 0 && (
            <p style={{ color: "var(--color-text-muted)" }}>No importable games found.</p>
          )}
          {!loading && !error && rows.length > 0 && (
            <div className="space-y-2">
              {rows.map((r) => (
                <label key={`${r.entry.source}:${r.entry.game_id}:${r.entry.exe}`} className="block rounded p-2 cursor-pointer"
                  style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border-soft)" }}>
                  <div className="flex items-start gap-2">
                    <input type="checkbox" checked={r.checked} onChange={() => toggle(r.entry.exe)} className="mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm truncate" style={{ color: "var(--color-text)" }}>{r.entry.name}</p>
                        <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: r.exists ? "var(--color-success-bg)" : "var(--color-panel)", color: r.exists ? "var(--color-success)" : "var(--color-text-muted)" }}>
                          {r.exists ? "Exists" : "New"}
                        </span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded uppercase" style={{ background: "var(--color-panel-3)", color: accent }}>
                          {r.entry.source}
                        </span>
                      </div>
                      <p className="text-[10px] mt-0.5 break-all font-mono" style={{ color: "var(--color-text-dim)" }}>{r.entry.exe}</p>
                      {r.entry.args && (
                        <p className="text-[10px] mt-0.5 break-all font-mono" style={{ color: "var(--color-text-muted)" }}>args: {r.entry.args}</p>
                      )}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>
        {!loading && rows.length > 0 && (
          <div className="flex gap-3 justify-end px-5 py-3 border-t" style={{ borderColor: "var(--color-border-card)" }}>
            <button onClick={onClose} className="px-3 py-1.5 rounded text-xs" style={{ background: "transparent", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>
              Cancel
            </button>
            <button onClick={apply} className="px-4 py-1.5 rounded text-xs font-semibold" style={{ background: accent, color: "var(--color-white)" }}>
              Apply {rows.filter((r) => r.checked).length}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Migration Wizard ────────────────────────────────────────────────────────
export default function App() {
  // ── Migrate legacy single-path storage to new multi-folder array ────────────
  const [libraryFolders, setLibraryFolders] = useState<LibraryFolder[]>(() => {
    const stored = loadCache<LibraryFolder[]>(SK_FOLDERS, []);
    if (stored.length > 0) return stored;
    // Backward compat: promote old single scanned-path
    const legacy = appStorageGetItem(SK_PATH);
    if (legacy) return [{ path: legacy }];
    return [];
  });

  const [games, setGames] = useState<Game[]>(() => loadCache<Game[]>(SK_GAMES, []));
  const [stats, setStats] = useState<Record<string, GameStats>>(() => loadCache(SK_STATS, {}));
  const [metadata, setMetadata] = useState<Record<string, GameMetadata>>(() => loadCache(SK_META, {}));
  const [selected, setSelected] = useState<Game | null>(null);
  const [activeMainTab, setActiveMainTab] = useState<"library" | "feed" | "stats">("library");
  const [navHistory, setNavHistory] = useState<NavEntry[]>([]);
  const [navIndex, setNavIndex] = useState(0);
  const navIndexRef = useRef(0);
  const isApplyingHistoryRef = useRef(false);
  const isHistoryBootstrappedRef = useRef(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [osPrefersDark, setOsPrefersDark] = useState<boolean>(() => {
    try {
      return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;
    } catch {
      return true;
    }
  });
  const [themeClockTick, setThemeClockTick] = useState(Date.now());
  const [search, setSearch] = useState("");
  const [syncState, setSyncState] = useState<"idle" | "syncing" | "full-scan">("idle");
  const [deleteTarget, setDeleteTarget] = useState<Game | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [keepDataOnDelete, setKeepDataOnDelete] = useState(true);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [showF95Login, setShowF95Login] = useState(false);
  const [f95LoggedIn, setF95LoggedIn] = useState(false);
  const [showDLsiteLogin, setShowDLsiteLogin] = useState(false);
  const [dlsiteLoggedIn, setDlsiteLoggedIn] = useState(false);
  const [showFakkuLogin, setShowFakkuLogin] = useState(false);
  const [fakkuLoggedIn, setFakkuLoggedIn] = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "compact" | "grid">(() => loadCache("libmaly_view_mode", "list"));
  const [isAppReady, setIsAppReady] = useState(false);

  useEffect(() => saveCache("libmaly_view_mode", viewMode), [viewMode]);

  const [isKioskMode, setIsKioskMode] = useState(false);
  useEffect(() => {
    if (!isKioskMode) return;
    const keydown = async (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsKioskMode(false);
        const w = getCurrentWindow();
        if (await w.isFullscreen()) await w.setFullscreen(false);
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [isKioskMode]);

  const handleToggleKiosk = async () => {
    const w = getCurrentWindow();
    const isFull = await w.isFullscreen();
    await w.setFullscreen(!isFull);
    setIsKioskMode(!isFull);
  };

  const handleExportCSV = async () => {
    let csv = "Name,Path,Source,Tags,Playtime (s),Overall Rating,Rating Scale,Gameplay,Story,Soundtrack,Visuals,Characters,Performance,Review,Uninstalled\n";
    for (const g of games) {
      const name = customizations[g.path]?.displayName || metadata[g.path]?.title || g.name;
      const src = metadata[g.path]?.source || "";
      const tags = (metadata[g.path]?.tags || []).join(";");
      const pt = stats[g.path]?.totalTime || 0;
      const custom = customizations[g.path];
      const overall100 = resolveOverallScore100(custom);
      const overall = typeof overall100 === "number" ? formatScoreForScale(overall100, appSettings.ratingScale) : "";
      const c = custom?.categoryRatings || {};
      const gameplay = typeof c.gameplay === "number" ? formatScoreForScale(c.gameplay, appSettings.ratingScale) : "";
      const story = typeof c.story === "number" ? formatScoreForScale(c.story, appSettings.ratingScale) : "";
      const soundtrack = typeof c.soundtrack === "number" ? formatScoreForScale(c.soundtrack, appSettings.ratingScale) : "";
      const visuals = typeof c.visuals === "number" ? formatScoreForScale(c.visuals, appSettings.ratingScale) : "";
      const characters = typeof c.characters === "number" ? formatScoreForScale(c.characters, appSettings.ratingScale) : "";
      const performance = typeof c.performance === "number" ? formatScoreForScale(c.performance, appSettings.ratingScale) : "";
      const review = (customizations[g.path]?.personalReview || "").replace(/\r?\n/g, "\\n");
      csv += `"${name.replace(/"/g, '""')}","${g.path.replace(/"/g, '""')}","${src}","${tags}",${pt},"${overall}","${appSettings.ratingScale}","${gameplay}","${story}","${soundtrack}","${visuals}","${characters}","${performance}","${review.replace(/"/g, '""')}",${g.uninstalled ? "yes" : "no"}\n`;
    }
    const savePath = await save({ defaultPath: "libmaly_export.csv", filters: [{ name: "CSV", extensions: ["csv"] }] });
    if (savePath) {
      await invoke("save_string_to_file", { path: savePath, contents: csv });
    }
  };

  const handleExportCloudState = async () => {
    const payload: CloudSyncPayloadV1 = {
      schema: "libmaly-cloud-sync-v1",
      exportedAt: new Date().toISOString(),
      appVersion,
      data: {
        libraryFolders,
        games,
        stats,
        metadata,
        hiddenGames,
        favGames,
        customizations,
        notes,
        collections,
        launchConfig,
        sessionLog,
        wishlist,
        history,
        appSettings,
      },
    };
    const savePath = await save({
      defaultPath: `libmaly-cloud-sync-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    }).catch(() => null);
    if (!savePath || typeof savePath !== "string") return;
    await invoke("save_string_to_file", { path: savePath, contents: JSON.stringify(payload, null, 2) }).catch((e) => {
      alert("Failed to export cloud config: " + e);
    });
  };

  const handleImportCloudState = async () => {
    const selectedPath = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "JSON", extensions: ["json"] }],
    }).catch(() => null);
    if (!selectedPath || typeof selectedPath !== "string") return;

    let parsed: any;
    try {
      const raw = await invoke<string>("read_string_from_file", { path: selectedPath });
      parsed = JSON.parse(raw);
    } catch (e) {
      alert("Could not read/parse JSON: " + e);
      return;
    }

    const data: CloudSyncPayloadV1["data"] = parsed?.schema === "libmaly-cloud-sync-v1"
      ? (parsed.data || {})
      : (parsed?.data || parsed || {});

    if (!data || typeof data !== "object") {
      alert("Invalid cloud sync file.");
      return;
    }

    if (!confirm("Import will replace current local library state for included sections. Continue?")) return;

    if (Array.isArray(data.libraryFolders)) {
      setLibraryFolders(data.libraryFolders);
      saveCache(SK_FOLDERS, data.libraryFolders);
    }
    if (Array.isArray(data.games)) {
      setGames(data.games);
      saveCache(SK_GAMES, data.games);
      if (selected && !data.games.some((g) => g.path === selected.path)) setSelected(null);
    }
    if (data.stats && typeof data.stats === "object") {
      setStats(data.stats);
      saveCache(SK_STATS, data.stats);
    }
    if (data.metadata && typeof data.metadata === "object") {
      setMetadata(data.metadata);
      saveCache(SK_META, data.metadata);
    }
    if (data.hiddenGames && typeof data.hiddenGames === "object") {
      setHiddenGames(data.hiddenGames);
      saveCache(SK_HIDDEN, data.hiddenGames);
    }
    if (data.favGames && typeof data.favGames === "object") {
      setFavGames(data.favGames);
      saveCache(SK_FAVS, data.favGames);
    }
    if (data.customizations && typeof data.customizations === "object") {
      setCustomizations(data.customizations);
      saveCache(SK_CUSTOM, data.customizations);
    }
    if (data.notes && typeof data.notes === "object") {
      setNotes(data.notes);
      saveCache(SK_NOTES, data.notes);
    }
    if (Array.isArray(data.collections)) {
      setCollections(data.collections);
      saveCache(SK_COLLECTIONS, data.collections);
    }
    if (data.launchConfig && typeof data.launchConfig === "object") {
      setLaunchConfig({ ...DEFAULT_LAUNCH_CONFIG, ...data.launchConfig });
      saveCache(SK_LAUNCH, { ...DEFAULT_LAUNCH_CONFIG, ...data.launchConfig });
    }
    if (Array.isArray(data.sessionLog)) {
      setSessionLog(data.sessionLog);
      saveCache(SK_SESSION_LOG, data.sessionLog);
    }
    if (Array.isArray(data.wishlist)) {
      setWishlist(data.wishlist);
      saveCache(SK_WISHLIST, data.wishlist);
    }
    if (data.history && typeof data.history === "object") {
      setHistory(data.history);
      saveCache(SK_HISTORY, data.history);
    }
    if (data.appSettings && typeof data.appSettings === "object") {
      const nextSettings: AppSettings = {
        ...DEFAULT_SETTINGS,
        ...data.appSettings,
        rssFeeds: mergeDefaultRssFeeds((data.appSettings as Partial<AppSettings>).rssFeeds),
      };
      setAppSettings(nextSettings);
      saveCache(SK_SETTINGS, nextSettings);
    }

    alert("Cloud config imported.");
  };

  const handleExportHTML = async () => {
    let html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
      body { background: var(--color-bg); color: var(--color-text); font-family: sans-serif; }
      .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 20px; padding: 20px; }
      .card { background: var(--color-panel); padding: 10px; border-radius: 8px; text-align: center; }
      img { width: 100%; aspect-ratio: 2/3; object-fit: cover; border-radius: 4px; }
      h3 { font-size: 14px; margin: 10px 0 0 0; }
    </style></head><body><h1>LIBMALY Library</h1><div class="grid">`;
    for (const g of games) {
      const name = customizations[g.path]?.displayName || metadata[g.path]?.title || g.name;
      const cvr = customizations[g.path]?.coverUrl || metadata[g.path]?.cover_url || "";
      const pt = stats[g.path]?.totalTime || 0;
      const custom = customizations[g.path];
      const overall100 = resolveOverallScore100(custom);
      const review = custom?.personalReview || "";
      const hours = pt >= 3600 ? Math.floor(pt / 3600) + "h " : "";
      const mins = Math.floor((pt % 3600) / 60) + "m";
      const ptStr = pt > 0 ? `<div style="font-size: 11px; color: var(--color-text-muted); margin-top: 5px;">🕓 ${hours}${mins}</div>` : "";
      const ratingStr = typeof overall100 === "number"
        ? `<div style="font-size: 11px; color: #e8c35a; margin-top: 4px;">★ ${formatScoreForScale(overall100, appSettings.ratingScale)}</div>`
        : "";
      const categoryStr = custom?.categoryRatings
        ? `<div style="font-size: 10px; color: var(--color-text-muted); margin-top: 4px;">${RATING_CATEGORIES.map((cat) => {
          const v = custom.categoryRatings?.[cat.key];
          return typeof v === "number" ? `${cat.label}: ${formatScoreForScale(v, appSettings.ratingScale)}` : "";
        }).filter(Boolean).join(" · ")}</div>`
        : "";
      const reviewStr = review ? `<p style="font-size: 11px; color: var(--color-text-muted); margin: 6px 0 0 0; white-space: pre-wrap;">${review.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>` : "";

      const src = metadata[g.path]?.source;
      const url = metadata[g.path]?.source_url;
      const sourceStr = src && url ? `<a href="${url}" target="_blank" style="display: inline-block; font-size: 10px; margin-top: 5px; color: var(--color-accent); text-decoration: none; border: 1px solid var(--color-border); padding: 2px 6px; border-radius: 4px;">↗ ${src}</a>` : "";

      const img = cvr ? `<img src="${cvr}" />` : `<div style="aspect-ratio: 2/3; background: var(--color-border); display: flex; align-items: center; justify-content: center; border-radius: 4px; font-size: 12px; font-weight: bold; color: rgba(255,255,255,0.5);">NO COVER</div>`;
      html += `<div class="card">${img}<h3>${name}</h3>${sourceStr}${ptStr}${ratingStr}${categoryStr}${reviewStr}</div>`;
    }
    html += `</div></body></html>`;
    const savePath = await save({ defaultPath: "libmaly_library.html", filters: [{ name: "HTML", extensions: ["html"] }] });
    if (savePath) {
      await invoke("save_string_to_file", { path: savePath, contents: html });
    }
  };

  const [screenshots, setScreenshots] = useState<Record<string, Screenshot[]>>({});
  const [pendingAnnotatedShot, setPendingAnnotatedShot] = useState<{ gamePath: string; shot: Screenshot } | null>(null);
  const [hiddenGames, setHiddenGames] = useState<Record<string, boolean>>(() => loadCache(SK_HIDDEN, {}));
  const [favGames, setFavGames] = useState<Record<string, boolean>>(() => loadCache(SK_FAVS, {}));
  const [customizations, setCustomizations] = useState<Record<string, GameCustomization>>(() => loadCache(SK_CUSTOM, {}));
  const [notes, setNotes] = useState<Record<string, string>>(() => loadCache(SK_NOTES, {}));
  const [collections, setCollections] = useState<Collection[]>(() => loadCache(SK_COLLECTIONS, []));
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null);
  const [showManageCollections, setShowManageCollections] = useState(false);
  const [creatingCollection, setCreatingCollection] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState("");
  const [newCollectionColor, setNewCollectionColor] = useState(COLLECTION_COLORS[0]);
  const [renamingCollectionId, setRenamingCollectionId] = useState<string | null>(null);
  const [renamingCollectionName, setRenamingCollectionName] = useState("");
  const [showCustomizeModal, setShowCustomizeModal] = useState(false);
  const [showNotesModal, setShowNotesModal] = useState(false);
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [showFilters, setShowFilters] = useState(false);
  const [showCollections, setShowCollections] = useState(false);
  const [showDevelopers, setShowDevelopers] = useState(false);
  const [showWishlist, setShowWishlist] = useState(false);
  const [showLogViewer, setShowLogViewer] = useState(false);
  const [rustLogs, setRustLogs] = useState<RustLogEntry[]>([]);
  const [crashReport, setCrashReport] = useState<CrashReport | null>(null);
  const [logLevelFilter, setLogLevelFilter] = useState<LogLevelFilter>("all");
  const [appVersion, setAppVersion] = useState<string>("unknown");
  const [isUiActive, setIsUiActive] = useState<boolean>(true);
  const [liveSessionExtraSec, setLiveSessionExtraSec] = useState<number>(0);
  const [batchRefreshStatus, setBatchRefreshStatus] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("lastPlayed");
  /** custom-order map: contextKey -> ordered array of game paths */
  const [customOrder, setCustomOrder] = useState<Record<string, string[]>>(
    () => loadCache(SK_ORDER, {})
  );
  /** path currently being dragged in the sidebar */
  const dragPath = useRef<string | null>(null);

  // ── UI states ──
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => loadCache("libmaly_sidebar_w", 256));
  const isDraggingSidebar = useRef(false);
  const sbWidthRef = useRef(sidebarWidth);
  useEffect(() => { sbWidthRef.current = sidebarWidth; }, [sidebarWidth]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingSidebar.current) return;
      document.body.style.cursor = "col-resize";
      let newW = e.clientX;
      if (newW < 200) newW = 200;
      if (newW > 600) newW = 600;
      setSidebarWidth(newW);
    };
    const onMouseUp = () => {
      if (isDraggingSidebar.current) {
        isDraggingSidebar.current = false;
        document.body.style.cursor = "";
        saveCache("libmaly_sidebar_w", sbWidthRef.current);
      }
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  /**
   * Key that identifies the current "view context" for custom ordering.
   * Global view  ->  "global"
   * Collection   ->  "col:" + collectionId
   */
  const orderKey = activeCollectionId ? `col:${activeCollectionId}` : "global";

  /** Reorder customOrder[orderKey] by moving `fromPath` before `toPath`. */
  const applyDrop = (fromPath: string, toPath: string) => {
    setCustomOrder((prev) => {
      // Start from the current custom order for this context, or build one from `filtered`
      const base: string[] = prev[orderKey] ?? filtered.map((g) => g.path);
      const without = base.filter((p) => p !== fromPath);
      const idx = without.indexOf(toPath);
      const next = idx === -1
        ? [...without, fromPath]
        : [...without.slice(0, idx), fromPath, ...without.slice(idx)];
      const updated = { ...prev, [orderKey]: next };
      saveCache(SK_ORDER, updated);
      return updated;
    });
  };
  const [appSettings, setAppSettings] = useState<AppSettings>(() => {
    const cached = loadCache(SK_SETTINGS, DEFAULT_SETTINGS) as Partial<AppSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...cached,
      rssFeeds: mergeDefaultRssFeeds(cached.rssFeeds),
    };
  });
  const appSettingsRef = useRef(appSettings);
  useEffect(() => { appSettingsRef.current = appSettings; }, [appSettings]);
  useEffect(() => {
    navIndexRef.current = navIndex;
  }, [navIndex]);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const apply = () => setOsPrefersDark(mq.matches);
    apply();
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, []);
  useEffect(() => {
    if (appSettings.themeScheduleMode !== "time") return;
    const t = setInterval(() => setThemeClockTick(Date.now()), 60_000);
    return () => clearInterval(t);
  }, [appSettings.themeScheduleMode]);
  const effectiveThemeMode = useMemo<"dark" | "light" | "oled">(() => {
    if (appSettings.themeScheduleMode === "os") {
      return osPrefersDark ? "dark" : "light";
    }
    if (appSettings.themeScheduleMode === "time") {
      const lightStart = Math.max(0, Math.min(23, appSettings.lightStartHour ?? DEFAULT_SETTINGS.lightStartHour));
      const darkStart = Math.max(0, Math.min(23, appSettings.darkStartHour ?? DEFAULT_SETTINGS.darkStartHour));
      const h = new Date(themeClockTick).getHours();
      const isLight = lightStart === darkStart
        ? true
        : lightStart < darkStart
          ? h >= lightStart && h < darkStart
          : !(h >= darkStart && h < lightStart);
      return isLight
        ? (appSettings.dayThemeMode || "light")
        : (appSettings.nightThemeMode || "dark");
    }
    return appSettings.themeMode || "dark";
  }, [
    appSettings.themeScheduleMode,
    appSettings.themeMode,
    appSettings.dayThemeMode,
    appSettings.nightThemeMode,
    appSettings.lightStartHour,
    appSettings.darkStartHour,
    osPrefersDark,
    themeClockTick,
  ]);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = effectiveThemeMode;
    const accent = normalizeHexColor(appSettings.accentColor, DEFAULT_SETTINGS.accentColor);
    root.style.setProperty("--color-accent", accent);
    root.style.setProperty("--color-accent-dark", shiftHexColor(accent, -0.42));
    root.style.setProperty("--color-accent-mid", shiftHexColor(accent, -0.28));
    root.style.setProperty("--color-accent-soft", shiftHexColor(accent, -0.08));
    root.style.setProperty("--color-accent-deep", shiftHexColor(accent, -0.62));
    root.style.setProperty("--color-accent-deeper", shiftHexColor(accent, -0.68));
    root.style.setProperty("--color-accent-muted", shiftHexColor(accent, -0.46));
  }, [effectiveThemeMode, appSettings.accentColor]);

  const [revealedNsfw, setRevealedNsfw] = useState<Record<string, boolean>>({});
  const revealNsfwPath = useCallback((path: string) => setRevealedNsfw(p => ({ ...p, [path]: true })), []);

  const gamesRef = useRef(games);
  useEffect(() => { gamesRef.current = games; }, [games]);
  const metadataRef = useRef(metadata);
  useEffect(() => { metadataRef.current = metadata; }, [metadata]);
  const customizationsRef = useRef(customizations);
  useEffect(() => { customizationsRef.current = customizations; }, [customizations]);

  const statsRef = useRef(stats);
  useEffect(() => { statsRef.current = stats; }, [stats]);
  useEffect(() => {
    if (!isHistoryBootstrappedRef.current) {
      isHistoryBootstrappedRef.current = true;
      setNavHistory([{ tab: activeMainTab, selectedPath: selected?.path ?? null }]);
      setNavIndex(0);
      navIndexRef.current = 0;
      return;
    }
    if (isApplyingHistoryRef.current) {
      isApplyingHistoryRef.current = false;
      return;
    }
    const entry: NavEntry = { tab: activeMainTab, selectedPath: selected?.path ?? null };
    setNavHistory((prev) => {
      const idx = navIndexRef.current;
      const current = prev[idx];
      if (current && current.tab === entry.tab && current.selectedPath === entry.selectedPath) return prev;
      const base = prev.slice(0, idx + 1);
      const next = [...base, entry];
      let nextIdx = next.length - 1;
      if (next.length > 120) {
        next.shift();
        nextIdx = next.length - 1;
      }
      navIndexRef.current = nextIdx;
      setNavIndex(nextIdx);
      return next;
    });
  }, [activeMainTab, selected?.path]);
  const currentLocationTitle = useMemo(() => {
    if (selected) {
      return customizations[selected.path]?.displayName ?? metadata[selected.path]?.title ?? selected.name;
    }
    if (activeMainTab === "feed") return "News & Updates";
    if (activeMainTab === "stats") return "All-Time Stats";
    return "Library";
  }, [selected, activeMainTab, metadata, customizations]);
  useEffect(() => {
    const title = `libmaly - ${currentLocationTitle}`;
    document.title = title;
    getCurrentWindow().setTitle(title).catch(() => { });
  }, [currentLocationTitle]);
  useEffect(() => {
    const w = getCurrentWindow();
    w.isMaximized().then(setIsMaximized).catch(() => { });
    const unlisten = w.onResized(async () => {
      try {
        setIsMaximized(await w.isMaximized());
      } catch { }
    });
    return () => {
      unlisten.then((f) => f()).catch(() => { });
    };
  }, []);

  const [runningGamePath, setRunningGamePath] = useState<string | null>(null);
  const [platform, setPlatform] = useState<string>("windows");
  const [launchConfig, setLaunchConfig] = useState<LaunchConfig>(() => loadCache(SK_LAUNCH, DEFAULT_LAUNCH_CONFIG));
  const [, setRecentGames] = useState<RecentGame[]>(() => loadCache(SK_RECENT, []));
  const [availableGameUpdates, setAvailableGameUpdates] = useState<Record<string, string>>({});
  const [showWineSettings, setShowWineSettings] = useState(false);
  const [appUpdate, setAppUpdate] = useState<{ version: string; url: string; downloadUrl: string } | null>(null);
  const [showAppUpdateModal, setShowAppUpdateModal] = useState(false);
  const [showCmdPalette, setShowCmdPalette] = useState(false);
  const [pendingLaunchRequest, setPendingLaunchRequest] = useState<LaunchRequest | null>(null);
  /** Controls the "+ Add" dropdown in the sidebar */
  const [showAddMenu, setShowAddMenu] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const isSyncing = useRef(false);
  /** ms timestamp of when the currently-running game was started */
  const sessionStartRef = useRef<number>(0);
  /** Accumulated play sessions log */
  const [sessionLog, setSessionLog] = useState<SessionEntry[]>(() => loadCache(SK_SESSION_LOG, []));
  /** Session waiting for a note after finishing */
  const [pendingNoteSession, setPendingNoteSession] = useState<SessionEntry | null>(null);
  /** Show the Steam import modal */
  const [showSteamImport, setShowSteamImport] = useState(false);
  /** Show the Lutris import modal */
  const [showLutrisImport, setShowLutrisImport] = useState(false);
  /** Show the Playnite import modal */
  const [showPlayniteImport, setShowPlayniteImport] = useState(false);
  /** Show the GOG Galaxy import modal */
  const [showGogImport, setShowGogImport] = useState(false);
  /** Wishlisted unowned games */
  const [wishlist, setWishlist] = useState<WishlistItem[]>(() => loadCache(SK_WISHLIST, []));

  /** Game version history */
  const [history, setHistory] = useState<GameHistoryMap>(() => loadCache(SK_HISTORY, {}));
  /** Pending metadata update requiring confirmation */
  const [pendingMetaUpdate, setPendingMetaUpdate] = useState<{
    path: string;
    oldMeta: GameMetadata;
    newMeta: GameMetadata;
  } | null>(null);
  const openGameView = useCallback((game: Game | null) => {
    if (!game) return;
    setActiveMainTab("library");
    setSelected(game);
  }, []);

  const handleToggleWishlist = useCallback((item: Omit<WishlistItem, 'addedAt'>) => {
    setWishlist(prev => {
      const exists = prev.find(w => w.id === item.id);
      const n = exists ? prev.filter(w => w.id !== item.id) : [...prev, { ...item, addedAt: Date.now() }];
      saveCache(SK_WISHLIST, n);
      return n;
    });
  }, []);

  const handleRemoveWishlist = useCallback((id: string) => {
    setWishlist(prev => {
      const n = prev.filter(w => w.id !== id);
      saveCache(SK_WISHLIST, n);
      return n;
    });
  }, []);

  // No auto-select: show HomeView when nothing is selected

  useEffect(() => {
    invoke<boolean>("f95_is_logged_in").then(setF95LoggedIn).catch(() => { });
    invoke<boolean>("dlsite_is_logged_in").then(setDlsiteLoggedIn).catch(() => { });
    invoke<boolean>("fakku_is_logged_in").then(setFakkuLoggedIn).catch(() => { });
    invoke<string>("get_platform").then(setPlatform).catch(() => { });
    getVersion().then(setAppVersion).catch(() => { });
    // Check for a newer release on GitHub (once per startup, never again)
    invoke<{ version: string; url: string; download_url: string } | null>("check_app_update")
      .then((u) => { if (u) setAppUpdate({ version: u.version, url: u.url, downloadUrl: u.download_url }); })
      .catch(() => { });
    // Push stored recent games into the tray on startup
    const storedRecent = loadCache<RecentGame[]>(SK_RECENT, []);
    if (storedRecent.length > 0) {
      invoke("set_recent_games", { games: storedRecent }).catch(() => { });
    }
    // Initial incremental sync for all known library folders
    const folders = loadCache<LibraryFolder[]>(SK_FOLDERS, []);
    const legacyPath = appStorageGetItem(SK_PATH);
    const roots = folders.length > 0 ? folders : (legacyPath ? [{ path: legacyPath }] : []);
    if (roots.length > 0) {
      runIncrementalSyncAll(roots).finally(() => setIsAppReady(true));
    } else {
      setIsAppReady(true);
    }
    getMatches().then((matches: any) => {
      const sub = matches?.subcommand;
      if (sub?.name !== "launch") return;
      const nameArg = sub?.matches?.args?.name?.value;
      const value = typeof nameArg === "string" ? nameArg : Array.isArray(nameArg) ? nameArg[0] : null;
      if (value && value.trim()) setPendingLaunchRequest({ mode: "name", value: value.trim() });
    }).catch(() => { });
    getCurrentDeepLinks().then((urls) => {
      const arr = Array.isArray(urls) ? urls : [];
      for (const rawUrl of arr) {
        const req = parseDeepLinkUrl(rawUrl);
        if (req) {
          setPendingLaunchRequest(req);
          break;
        }
      }
    }).catch(() => { });
    invoke<RustLogEntry[]>("get_recent_logs", { limit: 300 }).then(setRustLogs).catch(() => { });
    invoke<CrashReport | null>("get_last_crash_report").then((r) => {
      if (r) setCrashReport(r);
    }).catch(() => { });

    const unlistenFinished = listen("game-finished", (ev: any) => {
      const p = ev.payload as { path: string; duration_secs: number };
      updateStats(p.path, p.duration_secs);
      setRunningGamePath(null);
      if (appSettingsRef.current.saveBackupOnExit) {
        backupSaveFilesForPath(p.path, true).catch((e) => {
          console.error("Save backup on exit failed:", e);
        });
      }
      if (appSettingsRef.current.sessionToastEnabled) {
        isPermissionGranted().then(granted => {
          if (!granted) {
            return requestPermission()
              .then(r => r === "granted" || r === "default" ? true : false)
              .catch(() => false);
          }
          return true;
        }).then(granted => {
          if (granted) {
            const title = customizationsRef.current[p.path]?.displayName ?? metadataRef.current[p.path]?.title ?? gamesRef.current.find(g => g.path === p.path)?.name ?? "Game";
            sendNotification({ title: "Session Ended", body: `Played ${title} for ${formatTime(p.duration_secs)}` });
          }
        }).catch(() => { });
      }
      if (appSettingsRef.current.trayTooltipEnabled) {
        invoke("set_tray_tooltip", { tooltip: "LIBMALY" }).catch(() => null);
      }
    });
    const unlistenStarted = listen<string>("game-started", (ev) => {
      setRunningGamePath(ev.payload);
      sessionStartRef.current = Date.now();
    });
    const unlistenShot = listen<{ game_exe: string; screenshot: Screenshot }>("screenshot-taken", (ev) => {
      const { game_exe, screenshot } = ev.payload;
      setScreenshots((prev) => ({
        ...prev,
        [game_exe]: [screenshot, ...(prev[game_exe] ?? [])],
      }));
    });
    const unlistenBoss = listen("boss-key-pressed", async () => {
      // 1. Un-focus and minimize the main app window
      try { await getCurrentWindow().minimize(); } catch (e) { console.error("minimize err", e); }
      // 2. Clear running state (if it was killed, native toast will also fire but we can preempt)
      if (appSettingsRef.current.bossKeyAction === "kill") {
        setRunningGamePath(null);
      }
      // 3. Open fallback url / app if specified
      const fallback = appSettingsRef.current.bossKeyFallbackUrl;
      if (fallback && fallback.trim() !== "") {
        openUrl(fallback).catch(console.error);
      }
    });
    const unlistenDeepLink = onOpenUrl((urls) => {
      for (const rawUrl of urls) {
        const req = parseDeepLinkUrl(rawUrl);
        if (req) {
          setPendingLaunchRequest(req);
          break;
        }
      }
    });
    const unlistenRustLog = listen<RustLogEntry>("rust-log", (ev) => {
      const entry = ev.payload;
      setRustLogs((prev) => {
        const next = [...prev, entry];
        return next.length > 500 ? next.slice(next.length - 500) : next;
      });
    });

    return () => {
      unlistenFinished.then((f) => f());
      unlistenStarted.then((f) => f());
      unlistenShot.then((f) => f());
      unlistenBoss.then((f) => f());
      unlistenDeepLink.then((f) => f());
      unlistenRustLog.then((f) => f());
    };
  }, []);

  // Synchronise autostart plugin state
  useEffect(() => {
    isAutostartEnabled().then(enabled => {
      if (enabled !== appSettings.startupWithWindows) {
        if (appSettings.startupWithWindows) enableAutostart().catch(() => null);
        else disableAutostart().catch(() => null);
      }
    }).catch(() => null);
  }, [appSettings.startupWithWindows]);

  // Live tray tooltip update loop
  useEffect(() => {
    if (!appSettings.trayTooltipEnabled || !runningGamePath) return;
    const updateTooltip = () => {
      const elapsed = Math.floor((Date.now() - sessionStartRef.current) / 1000);
      const title = customizations[runningGamePath]?.displayName ?? metadata[runningGamePath]?.title ?? games.find(g => g.path === runningGamePath)?.name ?? "Game";
      invoke("set_tray_tooltip", { tooltip: `${title} - ${formatTime(elapsed)}` }).catch(() => null);
    };
    updateTooltip(); // initial
    const iv = setInterval(updateTooltip, 60000); // 1 minute
    return () => clearInterval(iv);
  }, [appSettings.trayTooltipEnabled, runningGamePath, games, metadata, customizations]);

  // UI activity detection (focused + visible) to freeze live counters when app is in background.
  useEffect(() => {
    let alive = true;
    const recompute = async () => {
      try {
        const focused = await getCurrentWindow().isFocused();
        if (alive) setIsUiActive(document.visibilityState === "visible" && focused);
      } catch {
        if (alive) setIsUiActive(document.visibilityState === "visible");
      }
    };
    const onFocus = () => { recompute(); };
    const onBlur = () => { recompute(); };
    const onVisibility = () => { recompute(); };
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);
    recompute();
    return () => {
      alive = false;
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // Live total playtime updater, frozen when app is not actively focused.
  useEffect(() => {
    if (!runningGamePath) {
      setLiveSessionExtraSec(0);
      return;
    }
    const update = () => {
      if (!isUiActive) return;
      const elapsed = Math.max(0, Math.floor((Date.now() - sessionStartRef.current) / 1000));
      setLiveSessionExtraSec(elapsed);
    };
    update();
    const iv = setInterval(update, 15000);
    return () => clearInterval(iv);
  }, [runningGamePath, isUiActive]);

  const totalPlaytimeBaseSecs = useMemo(
    () => Object.values(stats).reduce((s, v) => s + v.totalTime, 0),
    [stats]
  );
  const totalPlaytimeLiveSecs = totalPlaytimeBaseSecs + (runningGamePath ? liveSessionExtraSec : 0);

  // Auto-screenshot timer
  useEffect(() => {
    const mins = appSettings.autoScreenshotInterval;
    if (!mins || mins <= 0 || !runningGamePath) return;

    const intervalId = setInterval(async () => {
      try {
        await captureScreenshotForPath(runningGamePath, false);
      } catch (e) {
        console.error("Auto-screenshot failed:", e);
      }
    }, mins * 60_000);

    return () => clearInterval(intervalId);
  }, [appSettings.autoScreenshotInterval, runningGamePath]);

  // Global F12 screenshot hotkey on non-Windows (Linux X11/Wayland + macOS).
  useEffect(() => {
    if (platform === "windows") return;
    let active = true;
    registerGlobalShortcut("F12", async () => {
      if (!active) return;
      try {
        const gamePath = runningGamePath || selected?.path;
        if (!gamePath) return;
        await captureScreenshotForPath(gamePath, false);
      } catch {
        // Ignore when no active game is running.
      }
    }).catch(() => { });
    return () => {
      active = false;
      unregisterGlobalShortcut("F12").catch(() => { });
    };
  }, [platform, runningGamePath, selected?.path]);

  // Secondary global hotkey: capture + annotate before saving.
  useEffect(() => {
    let active = true;
    registerGlobalShortcut("F10", async () => {
      if (!active) return;
      try {
        const gamePath = runningGamePath || selected?.path;
        if (!gamePath) return;
        await captureScreenshotForPath(gamePath, true);
      } catch {
        // Ignore when no active game is running.
      }
    }).catch(() => { });
    return () => {
      active = false;
      unregisterGlobalShortcut("F10").catch(() => { });
    };
  }, [runningGamePath, selected?.path]);

  // Background game update checker
  useEffect(() => {
    if (!appSettings.updateCheckerEnabled || games.length === 0) return;
    const checkUpdates = async () => {
      for (const g of games) {
        const m = metadata[g.path];
        if (m && m.source_url) {
          try {
            const cmd = metadataFetchCommand(m.source);
            if (!cmd) continue;
            const res = await invoke<GameMetadata | null>(cmd, { url: m.source_url });
            if (res && res.version && m.version && res.version !== m.version) {
              setAvailableGameUpdates(prev => ({ ...prev, [g.path]: res.version! }));
            }
          } catch { }
          // delay 2 seconds between requests to avoid rate limits
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    };
    // Debounce initial run so it doesn't block startup
    const timer = setTimeout(checkUpdates, 5000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line
  }, [appSettings.updateCheckerEnabled]);

  // Close the Add dropdown when clicking outside
  useEffect(() => {
    if (!showAddMenu) return;
    const h = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) setShowAddMenu(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [showAddMenu]);

  // Load on-disk screenshots whenever the selected game changes
  useEffect(() => {
    if (!selected) return;
    invoke<Screenshot[]>("get_screenshots", { gameExe: selected.path })
      .then((shots) => setScreenshots((prev) => ({ ...prev, [selected.path]: shots })))
      .catch(() => { });
  }, [selected?.path]);

  const updateStats = (path: string, dur: number) => {
    const startedAt = sessionStartRef.current || (Date.now() - dur * 1000);
    const entry: SessionEntry = {
      id: String(startedAt),
      path,
      startedAt,
      duration: dur,
      note: "",
    };
    setSessionLog((prev) => {
      const next = [entry, ...prev];
      saveCache(SK_SESSION_LOG, next);
      return next;
    });
    // Show session note modal for sessions longer than 30 seconds
    if (dur >= 30) setPendingNoteSession(entry);
    setStats((prev) => {
      const cur = prev[path] || { totalTime: 0, lastPlayed: 0, lastSession: 0, launchCount: 0 };
      const next = {
        ...prev,
        [path]: {
          totalTime: cur.totalTime + dur,
          lastPlayed: Date.now(),
          lastSession: dur,
          launchCount: (cur.launchCount ?? 0) + 1,
        },
      };
      saveCache(SK_STATS, next); return next;
    });
  };

  /** Save or dismiss the note for the pending session */
  const handleSaveSessionNote = (note: string) => {
    if (!pendingNoteSession) return;
    const updated = { ...pendingNoteSession, note };
    setSessionLog((prev) => {
      const next = prev.map(s => s.id === updated.id ? updated : s);
      saveCache(SK_SESSION_LOG, next);
      return next;
    });
    setPendingNoteSession(null);
  };

  /** Edit a note for an existing session entry (inline from timeline) */
  const handleEditSessionNote = (entry: SessionEntry) => {
    setPendingNoteSession(entry);
  };

  /** Apply Steam playtime to matching library games */
  const handleSteamImport = (matches: { path: string; addSecs: number }[]) => {
    setStats((prev) => {
      const next = { ...prev };
      for (const m of matches) {
        const cur = next[m.path] || { totalTime: 0, lastPlayed: 0, lastSession: 0, launchCount: 0 };
        // Only add if steam time is MORE than what we already have
        if (m.addSecs > cur.totalTime) {
          next[m.path] = { ...cur, totalTime: m.addSecs };
        }
      }
      saveCache(SK_STATS, next);
      return next;
    });
  };

  const handleLutrisImport = (entries: LutrisGameEntry[]) => {
    if (entries.length === 0) return;

    // Add missing games to library.
    setGames((prev) => {
      const next = [...prev];
      const seen = new Set(prev.map((g) => normalizePathForMatch(g.path)));
      for (const e of entries) {
        if (!e.exe) continue;
        const key = normalizePathForMatch(e.exe);
        if (seen.has(key)) continue;
        next.push({ name: e.name || deriveGameName(e.exe), path: e.exe });
        seen.add(key);
      }
      saveCache(SK_GAMES, next);
      return next;
    });

    // Apply per-game runner override from Lutris config.
    setCustomizations((prev) => {
      const next = { ...prev };
      for (const e of entries) {
        if (!e.exe) continue;
        const prevCustom = next[e.exe] ?? {};
        const runnerLower = (e.runner || "").toLowerCase();
        const runnerKind: RunnerKind =
          runnerLower.includes("proton") ? "proton" : runnerLower.includes("wine") ? "wine" : "custom";
        next[e.exe] = {
          ...prevCustom,
          displayName: prevCustom.displayName ?? e.name ?? deriveGameName(e.exe),
          launchArgs: prevCustom.launchArgs ?? e.args,
          runnerOverrideEnabled: true,
          runnerOverride: {
            runner: runnerKind,
            runnerPath: prevCustom.runnerOverride?.runnerPath ?? "",
            prefixPath: e.prefix ?? prevCustom.runnerOverride?.prefixPath ?? "",
          },
        };
      }
      saveCache(SK_CUSTOM, next);
      return next;
    });
  };

  const handleInteropImport = (entries: InteropGameEntry[]) => {
    if (entries.length === 0) return;

    setGames((prev) => {
      const next = [...prev];
      const seen = new Set(prev.map((g) => normalizePathForMatch(g.path)));
      for (const e of entries) {
        if (!e.exe) continue;
        const key = normalizePathForMatch(e.exe);
        if (seen.has(key)) continue;
        next.push({ name: e.name || deriveGameName(e.exe), path: e.exe });
        seen.add(key);
      }
      saveCache(SK_GAMES, next);
      return next;
    });

    setCustomizations((prev) => {
      const next = { ...prev };
      for (const e of entries) {
        if (!e.exe) continue;
        const prevCustom = next[e.exe] ?? {};
        next[e.exe] = {
          ...prevCustom,
          displayName: prevCustom.displayName ?? e.name ?? deriveGameName(e.exe),
          launchArgs: prevCustom.launchArgs ?? e.args,
        };
      }
      saveCache(SK_CUSTOM, next);
      return next;
    });
  };


  // ── Persist helpers ─────────────────────────────────────────────────────────
  const applySingleScanResult = (
    currentGames: Game[],
    currentMtimes: DirMtime[],
    scannedGames: Game[],
    scannedMtimes: DirMtime[],
    folderPath: string,
  ): { games: Game[]; mtimes: DirMtime[] } => {
    const nextGames = mergeFolderGames(
      currentGames,
      scannedGames,
      folderPath,
      (path) => (statsRef.current[path]?.totalTime ?? 0) > 0 || !!metadataRef.current[path],
    );
    const nextMtimes = mergeFolderMtimes(currentMtimes, scannedMtimes, folderPath);
    return { games: nextGames, mtimes: nextMtimes };
  };

  const persistScanState = (nextGames: Game[], nextMtimes: DirMtime[]) => {
    setGames(nextGames);
    saveCache(SK_GAMES, nextGames);
    saveCache(SK_MTIMES, nextMtimes);
  };

  const persistFolders = (folders: LibraryFolder[]) => {
    setLibraryFolders(folders);
    saveCache(SK_FOLDERS, folders);
  };

  // ── Scanning ────────────────────────────────────────────────────────────────
  const runIncrementalSyncAll = async (folders: LibraryFolder[]) => {
    if (isSyncing.current) return;
    isSyncing.current = true; setSyncState("syncing");
    try {
      let workingGames = gamesRef.current;
      let workingMtimes = loadCache<DirMtime[]>(SK_MTIMES, []);
      for (const f of folders) {
        let ng: Game[] = [];
        let nm: DirMtime[] = [];
        try {
          [ng, nm] = await invoke<[Game[], DirMtime[]]>("scan_games_incremental", {
            path: f.path,
            cachedGames: workingGames,
            cachedMtimes: workingMtimes,
          });
        } catch {
          // Fall back to full scan for this folder
          [ng, nm] = await invoke<[Game[], DirMtime[]]>("scan_games", { path: f.path }).catch(() => [[], []] as [Game[], DirMtime[]]);
        }
        const merged = applySingleScanResult(workingGames, workingMtimes, ng, nm, f.path);
        workingGames = merged.games;
        workingMtimes = merged.mtimes;
        // Yield to the event loop between folders to keep UI responsive.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      persistScanState(workingGames, workingMtimes);
    } finally {
      isSyncing.current = false; setSyncState("idle");
    }
  };

  const runFullScanAll = async (folders: LibraryFolder[]) => {
    setSyncState("full-scan");
    try {
      let workingGames = gamesRef.current;
      let workingMtimes = loadCache<DirMtime[]>(SK_MTIMES, []);
      for (const f of folders) {
        const [ng, nm] = await invoke<[Game[], DirMtime[]]>("scan_games", { path: f.path }).catch(() => [[], []] as [Game[], DirMtime[]]);
        const merged = applySingleScanResult(workingGames, workingMtimes, ng, nm, f.path);
        workingGames = merged.games;
        workingMtimes = merged.mtimes;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      persistScanState(workingGames, workingMtimes);
    } finally {
      setSyncState("idle");
    }
  };

  // Add a new library folder (scan it fresh and register it)
  const handleAddFolder = async () => {
    setShowAddMenu(false);
    const sel = await open({ directory: true, multiple: false }).catch(() => null);
    if (!sel || typeof sel !== "string") return;
    // Skip if already registered
    if (libraryFolders.some((f) => f.path === sel)) return;
    const newFolders = [...libraryFolders, { path: sel }];
    persistFolders(newFolders);
    setSyncState("full-scan");
    try {
      const [ng, nm] = await invoke<[Game[], DirMtime[]]>("scan_games", { path: sel });
      const merged = applySingleScanResult(gamesRef.current, loadCache<DirMtime[]>(SK_MTIMES, []), ng, nm, sel);
      persistScanState(merged.games, merged.mtimes);
    } catch (e) { alert("Failed to scan: " + e); }
    finally { setSyncState("idle"); }
  };

  // Add a game manually by pointing at its .exe
  const handleAddGameManually = async () => {
    setShowAddMenu(false);
    const sel = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Executable", extensions: ["exe", "sh", "bin", "app"] }],
    }).catch(() => null);
    if (!sel || typeof sel !== "string") return;
    const name = deriveGameName(sel);
    const newGame: Game = { name, path: sel };
    setGames((prev) => {
      if (prev.some((g) => g.path === sel)) return prev; // already exists
      const next = [...prev, newGame];
      saveCache(SK_GAMES, next);
      return next;
    });
    openGameView(newGame);
  };

  // Remove a library folder (and its games from the list)
  const handleRemoveFolder = (folderPath: string) => {
    const newFolders = libraryFolders.filter((f) => f.path !== folderPath);
    persistFolders(newFolders);
    setGames((prev) => {
      const kept = prev.filter(
        (g) =>
          !g.path.startsWith(folderPath + "\\") &&
          !g.path.startsWith(folderPath + "/") &&
          g.path !== folderPath
      );
      saveCache(SK_GAMES, kept);
      return kept;
    });
  };

  const handleMigrateGameFolder = async (oldRoot: string, newRoot: string): Promise<number> => {
    const oldN = normalizePathNoCase(oldRoot);
    const newN = normalizePathNoCase(newRoot);
    if (!oldN || !newN) return 0;

    const remap = (p: string) => remapPathByRoot(p, oldN, newN);
    const remapOrSelf = (p: string) => remap(p) ?? p;
    const remapRecord = <T,>(src: Record<string, T>): Record<string, T> => {
      const out: Record<string, T> = {};
      for (const [k, v] of Object.entries(src)) out[remapOrSelf(k)] = v;
      return out;
    };

    const movedOldPaths = new Set<string>();
    const nextGamesRaw = games.map((g) => {
      const mapped = remap(g.path);
      if (!mapped) return g;
      movedOldPaths.add(g.path);
      return { ...g, path: mapped };
    });
    const seenGamePaths = new Set<string>();
    const nextGames = nextGamesRaw.filter((g) => {
      const key = normalizePathForMatch(g.path);
      if (seenGamePaths.has(key)) return false;
      seenGamePaths.add(key);
      return true;
    });

    const nextStats = remapRecord(stats);
    const nextMetadata = remapRecord(metadata);
    const nextHidden = remapRecord(hiddenGames);
    const nextFavs = remapRecord(favGames);
    const nextNotes = remapRecord(notes);
    const nextHistory = remapRecord(history);
    const nextCollections = collections.map((c) => ({
      ...c,
      gamePaths: Array.from(new Set(c.gamePaths.map(remapOrSelf))),
    }));
    const nextSessionLog = sessionLog.map((s) => ({ ...s, path: remapOrSelf(s.path) }));
    const nextCustomOrder: Record<string, string[]> = Object.fromEntries(
      Object.entries(customOrder).map(([k, arr]) => [k, Array.from(new Set(arr.map(remapOrSelf)))])
    );
    const nextFolders = libraryFolders.map((f) => ({ path: remapOrSelf(f.path) }));
    const nextMtimes = loadCache<DirMtime[]>(SK_MTIMES, []).map((d) => ({ ...d, path: remapOrSelf(d.path) }));
    const nextRecent = loadCache<RecentGame[]>(SK_RECENT, []).map((r) => ({ ...r, path: remapOrSelf(r.path) }));

    const nextCustomizations: Record<string, GameCustomization> = {};
    for (const [path, custom] of Object.entries(customizations)) {
      const nextPath = remapOrSelf(path);
      nextCustomizations[nextPath] = {
        ...custom,
        exeOverride: custom.exeOverride ? remapOrSelf(custom.exeOverride) : custom.exeOverride,
        pinnedExes: custom.pinnedExes?.map((p) => ({ ...p, path: remapOrSelf(p.path) })),
        runnerOverride: custom.runnerOverride
          ? {
            ...custom.runnerOverride,
            prefixPath: custom.runnerOverride.prefixPath ? remapOrSelf(custom.runnerOverride.prefixPath) : custom.runnerOverride.prefixPath,
            runnerPath: custom.runnerOverride.runnerPath ? remapOrSelf(custom.runnerOverride.runnerPath) : custom.runnerOverride.runnerPath,
          }
          : custom.runnerOverride,
      };
    }

    setGames(nextGames); saveCache(SK_GAMES, nextGames);
    setStats(nextStats); saveCache(SK_STATS, nextStats);
    setMetadata(nextMetadata); saveCache(SK_META, nextMetadata);
    setHiddenGames(nextHidden); saveCache(SK_HIDDEN, nextHidden);
    setFavGames(nextFavs); saveCache(SK_FAVS, nextFavs);
    setNotes(nextNotes); saveCache(SK_NOTES, nextNotes);
    setHistory(nextHistory); saveCache(SK_HISTORY, nextHistory);
    setCollections(nextCollections); saveCache(SK_COLLECTIONS, nextCollections);
    setSessionLog(nextSessionLog); saveCache(SK_SESSION_LOG, nextSessionLog);
    setCustomOrder(nextCustomOrder); saveCache(SK_ORDER, nextCustomOrder);
    setCustomizations(nextCustomizations); saveCache(SK_CUSTOM, nextCustomizations);
    setLibraryFolders(nextFolders); saveCache(SK_FOLDERS, nextFolders);
    saveCache(SK_MTIMES, nextMtimes);
    setRecentGames(nextRecent); saveCache(SK_RECENT, nextRecent);
    invoke("set_recent_games", { games: nextRecent }).catch(() => { });

    if (selected) {
      const mapped = remap(selected.path);
      if (mapped) {
        const nextSelected = nextGames.find((g) => normalizePathForMatch(g.path) === normalizePathForMatch(mapped)) || null;
        setSelected(nextSelected);
      }
    }
    setRunningGamePath((prev) => (prev ? remapOrSelf(prev) : prev));
    setDeleteTarget((prev) => (prev ? { ...prev, path: remapOrSelf(prev.path) } : prev));
    setPendingMetaUpdate((prev) => (prev ? { ...prev, path: remapOrSelf(prev.path) } : prev));
    setScreenshots((prev) => {
      const next: Record<string, Screenshot[]> = {};
      for (const [k, v] of Object.entries(prev)) next[remapOrSelf(k)] = v;
      return next;
    });
    setNavHistory((prev) => prev.map((n) => ({
      ...n,
      selectedPath: n.selectedPath ? remapOrSelf(n.selectedPath) : null,
    })));

    return movedOldPaths.size;
  };

  const backupSaveFilesForPath = async (gamePath: string, silent = false) => {
    try {
      const res = await invoke<SaveBackupResult>("backup_save_files", { gamePath });
      if (!silent) {
        alert(`Save backup created:\n${res.zip_path}\nFiles: ${res.files}`);
      }
      return res;
    } catch (e) {
      if (!silent) {
        alert("Save-file backup failed: " + e);
      }
      throw e;
    }
  };

  const launchGame = async (path: string, overridePath?: string, overrideArgs?: string) => {
    const gameCustom = customizations[path];

    let runner: string | null = null;
    let prefix: string | null = null;

    if (platform !== "windows") {
      if (gameCustom?.runnerOverrideEnabled) {
        const ov = gameCustom.runnerOverride;
        runner = ov
          ? (ov.runnerPath || (ov.runner !== "custom" ? ov.runner : null))
          : null;
        prefix = ov?.prefixPath?.trim() ? ov.prefixPath.trim() : null;
      } else if (launchConfig.enabled) {
        runner = launchConfig.runnerPath || (launchConfig.runner !== "custom" ? launchConfig.runner : null);
        prefix = launchConfig.prefixPath ? launchConfig.prefixPath : null;
      }
    }

    // Honour per-game executable override (keeps original `path` as the cache key)
    const actualPath = overridePath ?? gameCustom?.exeOverride ?? path;
    const args = overrideArgs !== undefined ? overrideArgs : (gameCustom?.launchArgs ?? null);
    try {
      await invoke("launch_game", { path: actualPath, runner, prefix, args: args || null });
      // ── Track recent games (last 5, deduplicated) ────────────────────────
      const game = games.find((g) => g.path === path);
      if (game) {
        const displayName =
          customizations[path]?.displayName ?? metadata[path]?.title ?? game.name;
        setRecentGames((prev) => {
          const filtered = prev.filter((r) => r.path !== path);
          const updated = [{ name: displayName, path }, ...filtered].slice(0, 5);
          saveCache(SK_RECENT, updated);
          invoke("set_recent_games", { games: updated }).catch(() => { });
          return updated;
        });
      }
    } catch (e) { alert("Failed to launch: " + e); }
  };

  const killGame = async () => {
    try { await invoke("kill_game"); }
    catch (e) { alert("Failed to stop game: " + e); }
  };

  useEffect(() => {
    if (!pendingLaunchRequest || !isAppReady || games.length === 0) return;

    const launchByPath = (requestedPath: string) => {
      const wanted = normalizePathForMatch(requestedPath);
      const game = games.find((g) => normalizePathForMatch(g.path) === wanted);
      if (!game) return false;
      openGameView(game);
      setActiveMainTab("library");
      launchGame(game.path);
      return true;
    };

    const launchByName = (rawName: string) => {
      const q = rawName.trim().toLowerCase();
      if (!q) return false;
      const ranked = games
        .map((g) => {
          const display = (customizations[g.path]?.displayName ?? metadata[g.path]?.title ?? g.name).toLowerCase();
          const plain = g.name.toLowerCase();
          const score =
            display === q || plain === q ? 0 :
              display.startsWith(q) || plain.startsWith(q) ? 1 :
                (display.includes(q) || plain.includes(q) ? 2 : 99);
          return { g, score };
        })
        .filter((r) => r.score < 99)
        .sort((a, b) => a.score - b.score || a.g.name.localeCompare(b.g.name));
      if (ranked.length === 0) return false;
      const game = ranked[0].g;
      openGameView(game);
      setActiveMainTab("library");
      launchGame(game.path);
      return true;
    };

    const ok = pendingLaunchRequest.mode === "path"
      ? launchByPath(pendingLaunchRequest.value)
      : launchByName(pendingLaunchRequest.value);

    if (!ok) {
      const target = pendingLaunchRequest.mode === "path" ? "path" : "name";
      alert(`Could not launch game by ${target}: ${pendingLaunchRequest.value}`);
    }
    setPendingLaunchRequest(null);
  }, [pendingLaunchRequest, isAppReady, games, customizations, metadata]);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await invoke("delete_game", { path: deleteTarget.path });
      if (keepDataOnDelete) {
        setGames(prev => {
          const updated = prev.map(g => g.path === deleteTarget.path ? { ...g, uninstalled: true } : g);
          saveCache(SK_GAMES, updated);
          return updated;
        });
      } else {
        const updated = games.filter((g) => g.path !== deleteTarget.path);
        saveCache(SK_GAMES, updated); setGames(updated);
        const nm = { ...metadata }; delete nm[deleteTarget.path];
        saveCache(SK_META, nm); setMetadata(nm);
        const ns = { ...stats }; delete ns[deleteTarget.path];
        saveCache(SK_STATS, ns); setStats(ns);
        const nc = { ...customizations }; delete nc[deleteTarget.path];
        saveCache(SK_CUSTOM, nc); setCustomizations(nc);
        if (selected?.path === deleteTarget.path) setSelected(updated[0] ?? null);
      }
    } catch (e) { alert("Failed to delete: " + e); }
    finally { setIsDeleting(false); setDeleteTarget(null); setKeepDataOnDelete(true); }
  };

  const handleMetaFetched = (meta: GameMetadata) => {
    if (!selected) return;
    const oldMeta = metadata[selected.path];
    if (oldMeta) {
      setPendingMetaUpdate({ path: selected.path, oldMeta, newMeta: meta });
    } else {
      const next = { ...metadata, [selected.path]: { ...meta, fetchedAt: Date.now() } };
      setMetadata(next);
      saveCache(SK_META, next);

      if (meta.version) {
        setHistory(prev => {
          const list = prev[selected.path] || [];
          if (list.length === 0) {
            const nextList = [{ id: String(Date.now()), date: Date.now(), version: meta.version!, note: "Initial link" }];
            const n = { ...prev, [selected.path]: nextList };
            saveCache(SK_HISTORY, n);
            return n;
          }
          return prev;
        });
      }
    }
  };

  const handleBatchMetadataRefresh = async () => {
    if (batchRefreshStatus) return;
    const paths = Object.keys(metadata).filter(p => metadata[p]?.source_url);
    if (paths.length === 0) return;
    let count = 0;

    for (const p of paths) {
      count++;
      setBatchRefreshStatus(`Updating ${count} / ${paths.length} ...`);
      const m = metadata[p];
      try {
        let newMeta: GameMetadata | undefined;
        const cmd = metadataFetchCommand(m.source);
        if (cmd) {
          newMeta = await invoke<GameMetadata>(cmd, { url: m.source_url });
        }
        if (newMeta) {
          const finalMeta = { ...newMeta, fetchedAt: Date.now() };
          setMetadata(prev => {
            const next = { ...prev, [p]: finalMeta };
            saveCache(SK_META, next);
            return next;
          });
        }
      } catch (e) { console.error(`Failed to update metadata for ${p}`, e); }
      await new Promise(r => setTimeout(r, 2000));
    }
    setBatchRefreshStatus(null);
  };

  const handleUpdateScreenshotTags = async (filename: string, tags: string[]) => {
    if (!selected) return;
    try {
      await invoke("save_screenshot_tags", {
        gameExe: selected.path,
        filename,
        tags
      });
      // Optionally update local state if needed (though InGameGallery handles its own UI state for speed)
      setScreenshots(prev => {
        const list = prev[selected.path] || [];
        const nextList = list.map(s => s.filename === filename ? { ...s, tags } : s);
        return { ...prev, [selected.path]: nextList };
      });
    } catch (e) {
      console.error("Failed to save screenshot tags:", e);
    }
  };

  const handleExportScreenshotZip = async () => {
    if (!selected) return;
    const displayName = customizations[selected.path]?.displayName ?? metadata[selected.path]?.title ?? selected.name;
    const safeName = displayName.replace(/[<>:"/\\|?*]+/g, "_").trim() || "screenshots";
    const savePath = await save({
      defaultPath: `${safeName}-screenshots.zip`,
      filters: [{ name: "ZIP Archive", extensions: ["zip"] }],
    }).catch(() => null);
    if (!savePath || typeof savePath !== "string") return;
    try {
      await invoke("export_screenshots_zip", { gameExe: selected.path, outputPath: savePath });
    } catch (e) {
      alert("Export failed: " + e);
    }
  };

  const captureScreenshotForPath = async (gamePath: string, annotate: boolean) => {
    const shot = await invoke<Screenshot>("take_screenshot_manual");
    if (annotate) {
      setPendingAnnotatedShot({ gamePath, shot });
      return;
    }
    setScreenshots((prev) => ({
      ...prev,
      [gamePath]: [shot, ...(prev[gamePath] ?? [])],
    }));
  };

  const handleSaveAnnotatedShot = async (dataUrl: string) => {
    if (!pendingAnnotatedShot) return;
    const { gamePath, shot } = pendingAnnotatedShot;
    try {
      await invoke("overwrite_screenshot_png", { path: shot.path, dataUrl });
      setScreenshots((prev) => ({
        ...prev,
        [gamePath]: [shot, ...(prev[gamePath] ?? [])],
      }));
    } catch (e) {
      alert("Failed to save annotated screenshot: " + e);
      await invoke("delete_screenshot_file", { path: shot.path }).catch(() => { });
    } finally {
      setPendingAnnotatedShot(null);
    }
  };

  const handleCancelAnnotatedShot = async () => {
    if (!pendingAnnotatedShot) return;
    await invoke("delete_screenshot_file", { path: pendingAnnotatedShot.shot.path }).catch(() => { });
    setPendingAnnotatedShot(null);
  };

  const refreshRustLogs = async () => {
    const logs = await invoke<RustLogEntry[]>("get_recent_logs", { limit: 300 }).catch(() => []);
    setRustLogs(logs);
  };

  const clearRustLogs = async () => {
    await invoke("clear_recent_logs").catch(() => { });
    setRustLogs([]);
  };

  const buildDiagnosticsPayload = () => {
    const levelMatches = (l: RustLogEntry) => {
      const x = l.level.toLowerCase();
      const norm: "error" | "warn" | "info" = x.startsWith("err") ? "error" : x.startsWith("warn") ? "warn" : "info";
      return logLevelFilter === "all" ? true : norm === logLevelFilter;
    };
    return {
      exportedAt: new Date().toISOString(),
      app: {
        version: appVersion,
        platform,
        userAgent: navigator.userAgent,
      },
      levelFilter: logLevelFilter,
      crashReport,
      logs: rustLogs.filter(levelMatches),
    };
  };

  const handleCopyDiagnosticJson = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(buildDiagnosticsPayload(), null, 2));
      alert("Diagnostics JSON copied.");
    } catch {
      alert("Could not copy diagnostics JSON.");
    }
  };

  const handleExportDiagnosticLog = async () => {
    const payload = buildDiagnosticsPayload();
    const savePath = await save({
      defaultPath: `libmaly-diagnostics-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    }).catch(() => null);
    if (!savePath || typeof savePath !== "string") return;
    await invoke("save_string_to_file", { path: savePath, contents: JSON.stringify(payload, null, 2) }).catch((e) => {
      alert("Failed to export logs: " + e);
    });
  };

  useEffect(() => {
    if (!appSettings.metadataAutoRefetchDays) return;
    let active = true;
    const run = async () => {
      const now = Date.now();
      const expiryAge = appSettings.metadataAutoRefetchDays * 24 * 60 * 60 * 1000;

      const paths = Object.keys(metadata).filter(p => {
        const m = metadata[p];
        if (!m.source_url) return false;
        if (!m.fetchedAt) return true;
        return now - m.fetchedAt > expiryAge;
      });

      for (const p of paths) {
        if (!active) break;
        const m = metadata[p];
        try {
          let newMeta: GameMetadata | undefined;
          const cmd = metadataFetchCommand(m.source);
          if (cmd) newMeta = await invoke<GameMetadata>(cmd, { url: m.source_url });

          if (newMeta) {
            const finalMeta = { ...newMeta, fetchedAt: Date.now() };
            setMetadata(prev => {
              const next = { ...prev, [p]: finalMeta };
              saveCache(SK_META, next);
              return next;
            });
          }
        } catch (e) { console.error(`Auto-update failed for ${p}`, e); }
        await new Promise(r => setTimeout(r, 2000));
      }
    };
    run();
    return () => { active = false; };
  }, [appSettings.metadataAutoRefetchDays]); // eslint-disable-line

  const handleClearMeta = () => {
    if (!selected) return;
    const next = { ...metadata }; delete next[selected.path];
    setMetadata(next); saveCache(SK_META, next);
  };

  const toggleHide = () => {
    if (!selected) return;
    const next = { ...hiddenGames };
    if (next[selected.path]) delete next[selected.path]; else next[selected.path] = true;
    setHiddenGames(next); saveCache(SK_HIDDEN, next);
  };

  const toggleFav = () => {
    if (!selected) return;
    const next = { ...favGames };
    if (next[selected.path]) delete next[selected.path]; else next[selected.path] = true;
    setFavGames(next); saveCache(SK_FAVS, next);
  };

  const handleSaveCustomization = (c: GameCustomization) => {
    if (!selected) return;
    const next = { ...customizations };
    if (
      !c.displayName &&
      !c.coverUrl &&
      !c.backgroundUrl &&
      !c.exeOverride &&
      !c.launchArgs &&
      !(c.pinnedExes && c.pinnedExes.length > 0) &&
      !c.status &&
      !c.timeLimitMins &&
      !(c.customTags && c.customTags.length > 0) &&
      !c.runnerOverrideEnabled &&
      !c.runnerOverride
    ) delete next[selected.path];
    else next[selected.path] = c;
    setCustomizations(next); saveCache(SK_CUSTOM, next);
  };

  const handleSaveNote = (text: string) => {
    if (!selected) return;
    const next = { ...notes, [selected.path]: text };
    setNotes(next); saveCache(SK_NOTES, next);
  };

  const handleCreateCollection = (name: string, color: string): Collection => {
    const col: Collection = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name, color, gamePaths: [],
    };
    const next = [...collections, col];
    setCollections(next); saveCache(SK_COLLECTIONS, next);
    return col;
  };

  const handleDeleteCollection = (id: string) => {
    const next = collections.filter((c) => c.id !== id);
    setCollections(next); saveCache(SK_COLLECTIONS, next);
    if (activeCollectionId === id) setActiveCollectionId(null);
  };

  const handleRenameCollection = (id: string, name: string) => {
    const next = collections.map((c) => (c.id === id ? { ...c, name } : c));
    setCollections(next); saveCache(SK_COLLECTIONS, next);
  };

  const handleToggleGameInCollection = (collectionId: string, gamePath: string, add: boolean) => {
    const next = collections.map((c) => {
      if (c.id !== collectionId) return c;
      const paths = add
        ? [...new Set([...c.gamePaths, gamePath])]
        : c.gamePaths.filter((p) => p !== gamePath);
      return { ...c, gamePaths: paths };
    });
    setCollections(next); saveCache(SK_COLLECTIONS, next);
  };

  const gameDisplayName = (g: Game) =>
    customizations[g.path]?.displayName ?? metadata[g.path]?.title ?? g.name;

  // ── Context menu state ──────────────────────────────────────────────────────
  interface CtxMenu { x: number; y: number; game: Game; }
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ctxMenu) return;
    const h = (e: MouseEvent) => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node)) setCtxMenu(null);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [ctxMenu]);

  /** Re-scan just the game's immediate parent folder, merging results. */
  const rescanGameFolder = async (game: Game) => {
    setCtxMenu(null);
    const folder = game.path.replace(/[\\/][^\\/]+$/, "");
    setSyncState("full-scan");
    try {
      const [ng, nm] = await invoke<[Game[], DirMtime[]]>("scan_games", { path: folder });
      const merged = applySingleScanResult(gamesRef.current, loadCache<DirMtime[]>(SK_MTIMES, []), ng, nm, folder);
      persistScanState(merged.games, merged.mtimes);
    } catch (e) { alert("Rescan failed: " + e); }
    finally { setSyncState("idle"); }
  };

  // ── Subfolder grouping ──────────────────────────────────────────────────────
  /** Collapsed sub-folder groups (set of parent-dir paths) */
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (dir: string) =>
    setCollapsedGroups((prev) => {
      const s = new Set(prev);
      if (s.has(dir)) s.delete(dir); else s.add(dir);
      return s;
    });

  /**
   * Build the grouped structure from `filtered`.
   * A "group" exists when ≥2 filtered games share the same immediate-parent dir.
   * Single-game dirs are flattened (rendered ungrouped).
   */
  type SidebarItem =
    | { kind: "game"; game: Game }
    | { kind: "group-header"; dir: string; label: string; count: number }
    | { kind: "group-game"; game: Game; dir: string };


  const allCustomTags = useMemo(() => {
    const tags = new Set<string>();
    for (const c of Object.values(customizations)) {
      if (c.customTags) c.customTags.forEach(t => tags.add(t));
    }
    return Array.from(tags).sort();
  }, [customizations]);

  const developerBuckets = useMemo(() => {
    const counts = new Map<string, number>();
    for (const g of games) {
      const meta = metadata[g.path];
      const dev = (meta?.circle || meta?.developer || "").trim() || "Unknown";
      counts.set(dev, (counts.get(dev) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [games, metadata]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const activeCol = activeCollectionId ? collections.find((c) => c.id === activeCollectionId) : null;
    return games
      .filter((g) => {
        const name = gameDisplayName(g).toLowerCase();
        if (!name.includes(q)) return false;
        if (activeCol && !activeCol.gamePaths.includes(g.path)) return false;
        const isHid = !!hiddenGames[g.path];
        if (filterMode === "all") { if (isHid && !search && !activeCol) return false; }
        else if (filterMode === "favs") return !!favGames[g.path];
        else if (filterMode === "hidden") return isHid;
        else if (filterMode === "f95") return metadata[g.path]?.source === "f95";
        else if (filterMode === "dlsite") return metadata[g.path]?.source === "dlsite";
        else if (filterMode === "vndb") return metadata[g.path]?.source === "vndb";
        else if (filterMode === "mangagamer") return metadata[g.path]?.source === "mangagamer";
        else if (filterMode === "johren") return metadata[g.path]?.source === "johren";
        else if (filterMode === "fakku") return metadata[g.path]?.source === "fakku";
        else if (filterMode === "unlinked") return !metadata[g.path];
        else if (filterMode === "Playing" || filterMode === "Completed" || filterMode === "On Hold" || filterMode === "Dropped" || filterMode === "Plan to Play") {
          return customizations[g.path]?.status === filterMode;
        }
        else if (filterMode.startsWith("dev:")) {
          const dev = filterMode.slice(4);
          const gameDev = (metadata[g.path]?.circle || metadata[g.path]?.developer || "").trim() || "Unknown";
          return gameDev === dev;
        }
        else if (filterMode.startsWith("tag:")) {
          const t = filterMode.slice(4);
          return customizations[g.path]?.customTags?.includes(t) ?? false;
        }
        return true;
      })
      .sort((a, b) => {
        if (sortMode === "lastPlayed") {
          return (stats[b.path]?.lastPlayed ?? 0) - (stats[a.path]?.lastPlayed ?? 0);
        }
        if (sortMode === "playtime") {
          return (stats[b.path]?.totalTime ?? 0) - (stats[a.path]?.totalTime ?? 0);
        }
        // name A-Z — favs first
        const af = favGames[a.path] ? 0 : 1, bf = favGames[b.path] ? 0 : 1;
        if (af !== bf) return af - bf;
        return gameDisplayName(a).localeCompare(gameDisplayName(b));
      })
      // custom sort: re-sort by saved order (unknown paths go to the end)
      .sort((a, b) => {
        if (sortMode !== "custom") return 0; // already sorted above
        const order = customOrder[orderKey] ?? [];
        const ai = order.indexOf(a.path);
        const bi = order.indexOf(b.path);
        return (ai === -1 ? 9999 : ai) - (bi === -1 ? 9999 : bi);
      });
  }, [games, search, hiddenGames, favGames, customizations, metadata, filterMode, sortMode, stats, collections, activeCollectionId, customOrder, orderKey]); // eslint-disable-line

  // When entering custom sort mode, seed the order from the current sorted list
  // so the user's first drag starts from a sensible baseline.
  useEffect(() => {
    if (sortMode !== "custom") return;
    setCustomOrder((prev) => {
      if (prev[orderKey]) return prev; // already seeded
      const seeded = { ...prev, [orderKey]: filtered.map((g) => g.path) };
      saveCache(SK_ORDER, seeded);
      return seeded;
    });
  }, [sortMode, orderKey]); // eslint-disable-line

  const sidebarItems = useMemo<SidebarItem[]>(() => {
    // Count games per parent dir
    const dirCount = new Map<string, number>();
    for (const g of filtered) {
      const dir = g.path.replace(/[\\/][^\\/]+$/, "");
      dirCount.set(dir, (dirCount.get(dir) ?? 0) + 1);
    }
    const items: SidebarItem[] = [];
    const seenDirs = new Set<string>();
    for (const g of filtered) {
      const dir = g.path.replace(/[\\/][^\\/]+$/, "");
      const count = dirCount.get(dir) ?? 1;
      if (count < 2) {
        items.push({ kind: "game", game: g });
      } else {
        if (!seenDirs.has(dir)) {
          seenDirs.add(dir);
          const label = dir.replace(/\\/g, "/").split("/").pop() ?? dir;
          items.push({ kind: "group-header", dir, label, count });
        }
        items.push({ kind: "group-game", game: g, dir });
      }
    }
    return items;
  }, [filtered]);

  // ── Virtual list for sidebar (handles 1000+ games smoothly) ──────────────
  /** Items actually visible (excludes group-game rows whose group is collapsed) */
  const visibleSidebarItems = useMemo(() =>
    sidebarItems.filter((item) => {
      if (item.kind === "group-game") return !collapsedGroups.has(item.dir);
      return true;
    }),
    [sidebarItems, collapsedGroups]
  );

  const getSidebarItemHeight = useCallback((item: SidebarItem) =>
    item.kind === "group-header" ? 28 : (viewMode === "compact" ? 28 : 52)
    , [viewMode]);
  const { virtualItems: vItems, totalHeight: vTotalH, scrollToIndex, containerRef: sidebarListRefCb } = useVirtualList(
    visibleSidebarItems,
    getSidebarItemHeight,
    5,
  );

  // ── Keyboard Navigation & Scroll-to-selected ──
  useEffect(() => {
    if (!selected) return;
    const idx = visibleSidebarItems.findIndex(
      (item) => (item.kind === "game" || item.kind === "group-game") && item.game.path === selected.path
    );
    if (idx !== -1) scrollToIndex(idx);
  }, [selected, visibleSidebarItems, scrollToIndex]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Toggle Command Palette with Ctrl+K
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setShowCmdPalette(prev => !prev);
        return;
      }

      // Close popups on Escape
      if (e.key === "Escape") {
        setShowCmdPalette(false);
      }

      if (document.activeElement?.tagName === "INPUT" || document.activeElement?.tagName === "TEXTAREA") return;

      const actionable = visibleSidebarItems.filter(i => i.kind === "game" || i.kind === "group-game").map(i => (i as any).game as Game);
      if (actionable.length === 0) return;

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        let idx = selected ? actionable.findIndex(g => g.path === selected.path) : -1;

        if (e.key === "ArrowDown") {
          const next = idx === -1 ? 0 : Math.min(idx + 1, actionable.length - 1);
          openGameView(actionable[next]);
        } else {
          const prev = idx === -1 ? actionable.length - 1 : Math.max(idx - 1, 0);
          openGameView(actionable[prev]);
        }
      } else if (e.key === " ") {
        if (selected && !runningGamePath && syncState !== "syncing") {
          e.preventDefault();
          launchGame(selected.path);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [visibleSidebarItems, selected]);

  /** path that is currently a drop target (for highlight) */
  const dragOverPath = useRef<string | null>(null);
  const [dragOverPathState, setDragOverPathState] = useState<string | null>(null);

  /** Settings modal */
  const [showSettings, setShowSettings] = useState(false);
  const [showMigrationWizard, setShowMigrationWizard] = useState(false);
  const canGoBack = navIndex > 0;
  const canGoForward = navIndex < navHistory.length - 1;
  const goBack = useCallback(() => {
    if (navIndexRef.current <= 0) return;
    const targetIndex = navIndexRef.current - 1;
    const target = navHistory[targetIndex];
    if (!target) return;
    navIndexRef.current = targetIndex;
    setNavIndex(targetIndex);
    isApplyingHistoryRef.current = true;
    setActiveMainTab(target.tab);
    if (target.selectedPath) {
      const g = gamesRef.current.find((x) => x.path === target.selectedPath) ?? null;
      setSelected(g);
    } else {
      setSelected(null);
    }
  }, [navHistory]);
  const goForward = useCallback(() => {
    if (navIndexRef.current >= navHistory.length - 1) return;
    const targetIndex = navIndexRef.current + 1;
    const target = navHistory[targetIndex];
    if (!target) return;
    navIndexRef.current = targetIndex;
    setNavIndex(targetIndex);
    isApplyingHistoryRef.current = true;
    setActiveMainTab(target.tab);
    if (target.selectedPath) {
      const g = gamesRef.current.find((x) => x.path === target.selectedPath) ?? null;
      setSelected(g);
    } else {
      setSelected(null);
    }
  }, [navHistory]);
  const handleMinimizeWindow = () => {
    getCurrentWindow().minimize().catch(() => { });
  };
  const handleToggleMaximizeWindow = () => {
    const w = getCurrentWindow();
    w.isMaximized().then((maxed) => {
      if (maxed) return w.unmaximize().then(() => setIsMaximized(false));
      return w.maximize().then(() => setIsMaximized(true));
    }).catch(() => { });
  };
  const handleTopbarDragMouseDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    getCurrentWindow().startDragging().catch(() => { });
  };
  const handleCloseWindow = () => {
    getCurrentWindow().close().catch(() => { });
  };
  const shouldShowWindowControls = platform !== "macos";
  const topbarLocationTitle = selected
    ? `Library / ${gameDisplayName(selected)}`
    : activeMainTab === "feed"
      ? "News & Updates"
      : activeMainTab === "stats"
        ? "All-Time Stats"
        : "Library";

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && !e.shiftKey && e.key === "ArrowLeft") {
        e.preventDefault();
        goBack();
      } else if (e.altKey && !e.shiftKey && e.key === "ArrowRight") {
        e.preventDefault();
        goForward();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goBack, goForward]);

  if (!isAppReady) {
    return (
      <div className="flex flex-col items-center justify-center w-screen h-screen select-none" style={{ background: "var(--color-bg-deep)" }}>
        <h1 className="text-4xl font-black italic tracking-widest mb-6" style={{ background: "linear-gradient(90deg, var(--color-accent), var(--color-warning))", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>LIBMALY</h1>
        <div className="w-8 h-8 rounded-full border-4 border-[var(--color-border)] border-t-[var(--color-accent)] animate-spin" />
        <p className="mt-4 text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--color-text-muted)" }}>Building your library...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: "var(--color-bg)", color: "var(--color-text)", fontFamily: "'Arial', sans-serif" }}>
      <header className="h-8 flex items-stretch border-b select-none" style={{ background: "var(--color-panel)", borderColor: "var(--color-border-soft)" }}>
        <div className="flex items-center gap-1.5 px-2">
          <button
            onClick={goBack}
            disabled={!canGoBack}
            className="w-6 h-6 rounded text-xs disabled:opacity-40"
            style={{ background: "transparent", color: "var(--color-text-muted)" }}
            title="Back (Alt+Left)"
          >
            ←
          </button>
          <button
            onClick={goForward}
            disabled={!canGoForward}
            className="w-6 h-6 rounded text-xs disabled:opacity-40"
            style={{ background: "transparent", color: "var(--color-text-muted)" }}
            title="Forward (Alt+Right)"
          >
            →
          </button>
        </div>
        <div
          className="flex-1 flex items-center gap-2 px-2 overflow-hidden cursor-move"
          onMouseDown={handleTopbarDragMouseDown}
          onDblClick={handleToggleMaximizeWindow}
        >
          <span className="text-[11px] font-semibold truncate" style={{ color: "var(--color-text-soft)" }}>
            {topbarLocationTitle}
          </span>
        </div>
        {shouldShowWindowControls && (
          <div className="flex items-center">
            <button onClick={handleMinimizeWindow} className="w-10 h-8 text-xs" style={{ color: "var(--color-text-muted)" }} title="Minimize">_</button>
            <button onClick={handleToggleMaximizeWindow} className="w-10 h-8 text-xs" style={{ color: "var(--color-text-muted)" }} title={isMaximized ? "Restore" : "Maximize"}>{isMaximized ? "❐" : "□"}</button>
            <button onClick={handleCloseWindow} className="w-10 h-8 text-xs hover:bg-red-600 hover:text-white" style={{ color: "var(--color-text-muted)" }} title="Close">✕</button>
          </div>
        )}
      </header>
      <div className="flex flex-1 overflow-hidden">

      {/* ── Context menu (right-click on game) ── */}
      {ctxMenu && (
        <div ref={ctxMenuRef}
          className="fixed z-[9999] rounded-lg py-1 shadow-2xl"
          style={{
            left: Math.min(ctxMenu.x, window.innerWidth - 200),
            top: Math.min(ctxMenu.y, window.innerHeight - 180),
            width: 192,
            background: "var(--color-panel)",
            border: "1px solid var(--color-border)",
          }}>
          {/* game name header */}
          <div className="px-3 py-2 border-b" style={{ borderColor: "var(--color-border-card)" }}>
            <p className="text-[10px] font-semibold truncate" style={{ color: "var(--color-text-muted)" }}>
              {gameDisplayName(ctxMenu.game)}
            </p>
          </div>
          {/* Open */}
          <button className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left"
            style={{ color: "var(--color-text)" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-panel-3)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            onClick={() => { openGameView(ctxMenu.game); setCtxMenu(null); }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 12h4" /><path d="M8 10v4" /><circle cx="17" cy="12" r="1" />
            </svg>
            Open
          </button>
          {/* Rescan folder */}
          <button className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left"
            style={{ color: "var(--color-text)" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-panel-3)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            onClick={() => rescanGameFolder(ctxMenu.game)}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.5 2v6h-6" /><path d="M2.5 22v-6h6" />
              <path d="M22 11.5A10 10 0 0 0 3.2 7.2M2 12.5a10 10 0 0 0 18.8 4.2" />
            </svg>
            Rescan folder
          </button>
          <div style={{ borderTop: "1px solid var(--color-border-card)", margin: "4px 0" }} />
          {/* Fav toggle */}
          <button className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left"
            style={{ color: favGames[ctxMenu.game.path] ? "var(--color-warning)" : "var(--color-text)" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-panel-3)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            onClick={() => {
              const next = { ...favGames };
              if (next[ctxMenu.game.path]) delete next[ctxMenu.game.path];
              else next[ctxMenu.game.path] = true;
              setFavGames(next); saveCache(SK_FAVS, next);
              setCtxMenu(null);
            }}>
            <svg width="12" height="12" viewBox="0 0 24 24"
              fill={favGames[ctxMenu.game.path] ? "var(--color-warning)" : "none"}
              stroke="var(--color-warning)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            {favGames[ctxMenu.game.path] ? "Remove from favourites" : "Add to favourites"}
          </button>
          {/* Hide toggle */}
          <button className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left"
            style={{ color: "var(--color-text)" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-panel-3)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            onClick={() => {
              const next = { ...hiddenGames };
              if (next[ctxMenu.game.path]) delete next[ctxMenu.game.path];
              else next[ctxMenu.game.path] = true;
              setHiddenGames(next); saveCache(SK_HIDDEN, next);
              setCtxMenu(null);
            }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {hiddenGames[ctxMenu.game.path]
                ? <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></>
                : <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /></>}
            </svg>
            {hiddenGames[ctxMenu.game.path] ? "Show game" : "Hide game"}
          </button>
        </div>
      )}

      {/* ── Sidebar ── */}
      {!isKioskMode && (
        <aside className="flex flex-col flex-shrink-0 h-full relative" style={{ width: sidebarWidth, background: "var(--color-panel-2)", borderRight: "1px solid var(--color-bg-deep)" }}>
          <div
            className="absolute top-0 bottom-0 right-0 w-1 cursor-col-resize hover:bg-[var(--color-accent-mid)] transition-colors z-[100]"
            style={{ transform: "translateX(50%)" }}
            onMouseDown={() => { isDraggingSidebar.current = true; }}
          />
          <button
            onClick={() => { setActiveMainTab("library"); setSelected(null); }}
            title="Library Home"
            className="flex items-center gap-2.5 px-4 py-3 border-b border-t-0 border-l-0 border-r-0 w-full text-left transition-colors"
            style={{ borderColor: "var(--color-bg-deep)", background: activeMainTab === "library" && selected === null ? "var(--color-bg)" : "transparent", cursor: "pointer" }}
            onMouseEnter={(e) => { if (activeMainTab !== "library" || selected !== null) e.currentTarget.style.background = "var(--color-bg)" }}
            onMouseLeave={(e) => { if (activeMainTab !== "library" || selected !== null) e.currentTarget.style.background = "transparent" }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
              stroke={selected === null && activeMainTab === "library" ? "var(--color-accent)" : "var(--color-text-dim)"}
              strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
              <rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 12h4" /><path d="M8 10v4" /><circle cx="17" cy="12" r="1" />
            </svg>
            <span className="font-bold tracking-wide text-sm truncate"
              style={{ color: selected === null && activeMainTab === "library" ? "var(--color-accent)" : "var(--color-text)" }}>LIBMALY</span>
          </button>
          <button
            onClick={() => { setActiveMainTab("feed"); setSelected(null); }}
            title="News Feed"
            className="flex items-center gap-2.5 px-4 py-3 border-b border-t-0 border-l-0 border-r-0 w-full text-left transition-colors"
            style={{ borderColor: "var(--color-bg-deep)", background: activeMainTab === "feed" && selected === null ? "var(--color-bg)" : "transparent", cursor: "pointer" }}
            onMouseEnter={(e) => { if (activeMainTab !== "feed" || selected !== null) e.currentTarget.style.background = "var(--color-bg)" }}
            onMouseLeave={(e) => { if (activeMainTab !== "feed" || selected !== null) e.currentTarget.style.background = "transparent" }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
              stroke={activeMainTab === "feed" && selected === null ? "var(--color-accent)" : "var(--color-text-dim)"}
              strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
              <path d="M4 11a9 9 0 0 1 9 9" /><path d="M4 4a16 16 0 0 1 16 16" /><circle cx="5" cy="19" r="1" />
            </svg>
            <span className="font-bold tracking-wide text-sm truncate"
              style={{ color: activeMainTab === "feed" && selected === null ? "var(--color-accent)" : "var(--color-text)" }}>News & Updates</span>
          </button>
          <button
            onClick={() => { setActiveMainTab("stats"); setSelected(null); }}
            title="All-Time Stats"
            className="flex items-center gap-2.5 px-4 py-3 border-b border-t-0 border-l-0 border-r-0 w-full text-left transition-colors"
            style={{ borderColor: "var(--color-bg-deep)", background: activeMainTab === "stats" && selected === null ? "var(--color-bg)" : "transparent", cursor: "pointer" }}
            onMouseEnter={(e) => { if (activeMainTab !== "stats" || selected !== null) e.currentTarget.style.background = "var(--color-bg)" }}
            onMouseLeave={(e) => { if (activeMainTab !== "stats" || selected !== null) e.currentTarget.style.background = "transparent" }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
              stroke={activeMainTab === "stats" && selected === null ? "var(--color-accent)" : "var(--color-text-dim)"}
              strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
              <path d="M12 20V10" /><path d="M18 20V4" /><path d="M6 20v-4" />
            </svg>
            <span className="font-bold tracking-wide text-sm truncate"
              style={{ color: activeMainTab === "stats" && selected === null ? "var(--color-accent)" : "var(--color-text)" }}>All-Time Stats</span>
          </button>
          <div className="px-3 py-2 border-b" style={{ borderColor: "var(--color-bg-deep)" }}>
            <div className="relative mb-2">
              <svg className="absolute left-2 top-1/2 -translate-y-1/2" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
              </svg>
              <input type="text" placeholder="Search games…" value={search}
                onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
                className="w-full pl-7 pr-3 py-1.5 rounded text-xs outline-none"
                style={{ background: "var(--color-panel-3)", color: "var(--color-text)", border: "1px solid var(--color-border-card)" }} />
            </div>
            {/* Filter chips */}
            <div
              className="flex items-center gap-1 mb-2 mt-1 cursor-pointer text-[10px] uppercase font-bold select-none transition-colors hover:text-[var(--color-text)]"
              style={{ color: showFilters ? "var(--color-text)" : "var(--color-text-muted)" }}
              onClick={() => setShowFilters(p => !p)}
            >
              <svg
                className="transition-transform duration-200"
                style={{ transform: showFilters ? "rotate(90deg)" : "rotate(0deg)" }}
                width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
              >
                <path d="M9 18l6-6-6-6" />
              </svg>
              <span style={{ paddingTop: "1px" }}>Filters</span>
            </div>
            {showFilters && (
              <div className="mb-2 space-y-1.5">
                <div className="flex flex-wrap gap-1">
                  {([
                    ["all", "All"],
                    ["favs", "★ Favs"],
                    ["hidden", `👁 Hidden (${Object.keys(hiddenGames).length})`],
                    ["f95", "F95"],
                    ["dlsite", "DLsite"],
                    ["vndb", "VNDB"],
                    ["mangagamer", "MangaGamer"],
                    ["johren", "Johren"],
                    ["fakku", "FAKKU"],
                    ["unlinked", "Unlinked"],
                  ] as [FilterMode, string][]).map(([mode, label]) => (
                    <button key={mode} onClick={() => setFilterMode(mode)}
                      className="px-2 py-0.5 rounded text-[10px] font-semibold"
                      style={{
                        background: filterMode === mode ? "var(--color-accent-dark)" : "var(--color-panel-alt)",
                        color: filterMode === mode ? "var(--color-white)" : "var(--color-text-muted)",
                        border: `1px solid ${filterMode === mode ? "var(--color-accent-mid)" : "var(--color-border-subtle)"}`,
                      }}>{label}</button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1 mb-1.5">
                  {([
                    ["Playing", "▶ Playing"],
                    ["Completed", "✓ Completed"],
                    ["On Hold", "⏸ On Hold"],
                    ["Dropped", "⏹ Dropped"],
                    ["Plan to Play", "📅 Plan"],
                  ] as [FilterMode, string][]).map(([mode, label]) => (
                    <button key={mode} onClick={() => setFilterMode(mode)}
                      className="px-2 py-0.5 rounded text-[10px] font-semibold"
                      style={{
                        background: filterMode === mode ? "var(--color-accent-dark)" : "var(--color-panel-alt)",
                        color: filterMode === mode ? "var(--color-white)" : "var(--color-text-muted)",
                        border: `1px solid ${filterMode === mode ? "var(--color-accent-mid)" : "var(--color-border-subtle)"}`,
                      }}>{label}</button>
                  ))}
                </div>
                {allCustomTags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {allCustomTags.map((tag) => (
                      <button key={`tag:${tag}`} onClick={() => setFilterMode(`tag:${tag}`)}
                        className="px-2 py-0.5 rounded text-[10px] font-semibold flex items-center gap-1"
                        style={{
                          background: filterMode === `tag:${tag}` ? "var(--color-accent-dark)" : "var(--color-panel-alt)",
                          color: filterMode === `tag:${tag}` ? "var(--color-white)" : "var(--color-accent-soft)",
                          border: `1px solid ${filterMode === `tag:${tag}` ? "var(--color-accent-mid)" : "var(--color-border-strong)"}`,
                        }}>
                        <span className="opacity-60 text-[9px]">#</span>
                        {tag}
                        {filterMode === `tag:${tag}` && (
                          <span className="ml-1 opacity-60" onClick={(e) => {
                            e.stopPropagation(); setFilterMode("all");
                          }}>✕</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {/* Sort */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] flex-shrink-0" style={{ color: "var(--color-text-dim)" }}>Sort:</span>
              {([
                ["lastPlayed", "Recent"],
                ["playtime", "Time"],
                ["name", "Name"],
                ["custom", "Custom"],
              ] as [SortMode, string][]).map(([mode, label]) => (
                <button key={mode} onClick={() => setSortMode(mode)}
                  className="px-2 py-0.5 rounded text-[10px]"
                  style={{
                    background: sortMode === mode ? "var(--color-panel-3)" : "transparent",
                    color: sortMode === mode ? "var(--color-text)" : "var(--color-text-dim)",
                    border: `1px solid ${sortMode === mode ? "var(--color-border-strong)" : "transparent"}`,
                  }}>{label}</button>
              ))}
              {sortMode === "custom" && (
                <span className="text-[9px]" style={{ color: "var(--color-text-dim)" }} title="Drag rows to reorder">⠿ drag</span>
              )}
              <div className="flex-1" />
              <div className="flex bg-[var(--color-panel-alt)] rounded shrink-0 items-center" style={{ padding: "2px" }}>
                <button title="List View" onClick={() => setViewMode("list")} className="p-1 rounded" style={{ background: viewMode === "list" ? "var(--color-border)" : "transparent" }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={viewMode === "list" ? "var(--color-accent)" : "var(--color-text-dim)"} strokeWidth="2.5"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
                </button>
                <button title="Compact List" onClick={() => setViewMode("compact")} className="p-1 rounded" style={{ background: viewMode === "compact" ? "var(--color-border)" : "transparent" }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={viewMode === "compact" ? "var(--color-accent)" : "var(--color-text-dim)"} strokeWidth="2.5"><line x1="4" y1="6" x2="20" y2="6"></line><line x1="4" y1="12" x2="20" y2="12"></line><line x1="4" y1="18" x2="20" y2="18"></line></svg>
                </button>
                <button title="Grid View" onClick={() => setViewMode("grid")} className="p-1 rounded" style={{ background: viewMode === "grid" ? "var(--color-border)" : "transparent" }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={viewMode === "grid" ? "var(--color-accent)" : "var(--color-text-dim)"} strokeWidth="2.5"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
                </button>
              </div>

              <button
                title="Fullscreen Cover Wall"
                onClick={handleToggleKiosk}
                className="px-2 py-0.5 ml-2 rounded text-[9px] uppercase font-bold tracking-wider hover:opacity-100 opacity-60 transition-opacity"
                style={{ background: "var(--color-panel-3)", color: "var(--color-text)" }}>
                Kiosk
              </button>
            </div>
          </div>
          {/* ── Collections ── */}
          <div className="border-b" style={{ borderColor: "var(--color-bg-deep)" }}>
            <div
              className="flex items-center px-3 pt-2 pb-1 gap-1 cursor-pointer select-none transition-colors hover:text-[var(--color-text)]"
              style={{ color: showCollections ? "var(--color-text)" : "var(--color-text-dim)" }}
              onClick={() => setShowCollections(p => !p)}
            >
              <svg className="transition-transform duration-200" style={{ transform: showCollections ? "rotate(90deg)" : "rotate(0deg)" }} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
              <span className="text-[9px] uppercase tracking-widest font-bold flex-1" style={{ paddingTop: "1px" }}>Collections</span>
              {activeCollectionId && (
                <button onClick={(e) => { e.stopPropagation(); setActiveCollectionId(null); }}
                  className="text-[9px] px-1.5 py-0.5 rounded mr-1"
                  style={{ background: "var(--color-panel-3)", color: "var(--color-text-muted)" }}
                  title="Clear filter">✕ clear</button>
              )}
              <button onClick={(e) => { e.stopPropagation(); setCreatingCollection(true); setShowCollections(true); }}
                className="w-5 h-5 flex items-center justify-center rounded text-sm font-bold opacity-60 hover:opacity-100 transition-opacity"
                title="New collection">+</button>
            </div>
            {showCollections && (
              <>
                {collections.length === 0 && !creatingCollection && (
                  <p className="px-3 pb-2 text-[10px]" style={{ color: "var(--color-text-dim)" }}>No collections yet</p>
                )}
                {collections.length > 0 && (
                  <div className="overflow-y-auto" style={{ maxHeight: "152px", scrollbarWidth: "thin", scrollbarColor: "var(--color-border) transparent" }}>
                    {collections.map((col) => (
                      <div key={col.id}
                        className="group flex items-center gap-2 px-3 py-1.5 cursor-pointer"
                        style={{ background: activeCollectionId === col.id ? "var(--color-accent-deep)" : "transparent" }}
                        onClick={() => setActiveCollectionId(activeCollectionId === col.id ? null : col.id)}
                        onMouseEnter={(e) => { if (activeCollectionId !== col.id) e.currentTarget.style.background = "var(--color-bg)"; }}
                        onMouseLeave={(e) => { if (activeCollectionId !== col.id) e.currentTarget.style.background = "transparent"; }}>
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: col.color }} />
                        {renamingCollectionId === col.id ? (
                          <input autoFocus className="flex-1 text-xs px-1 rounded outline-none"
                            style={{ background: "var(--color-panel-3)", color: "var(--color-text)", border: "1px solid var(--color-border-strong)" }}
                            value={renamingCollectionName}
                            onInput={(e) => setRenamingCollectionName((e.target as HTMLInputElement).value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") { handleRenameCollection(col.id, renamingCollectionName); setRenamingCollectionId(null); }
                              if (e.key === "Escape") setRenamingCollectionId(null);
                            }}
                            onBlur={() => { if (renamingCollectionName.trim()) handleRenameCollection(col.id, renamingCollectionName); setRenamingCollectionId(null); }}
                            onClick={(e) => e.stopPropagation()} />
                        ) : (
                          <span className="flex-1 text-xs truncate"
                            style={{ color: activeCollectionId === col.id ? "var(--color-accent)" : "var(--color-text-muted)" }}
                            onDblClick={(e) => { e.stopPropagation(); setRenamingCollectionId(col.id); setRenamingCollectionName(col.name); }}>
                            {col.name}
                          </span>
                        )}
                        <span className="text-[9px] flex-shrink-0" style={{ color: "var(--color-text-dim)" }}>
                          {col.gamePaths.filter((p) => games.some((g) => g.path === p)).length}
                        </span>
                        <button
                          className="opacity-0 group-hover:opacity-100 flex-shrink-0 w-4 h-4 flex items-center justify-center rounded"
                          style={{ fontSize: "13px", color: "var(--color-text-dim)" }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--color-danger)"; e.currentTarget.style.background = "var(--color-danger-bg)"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--color-text-dim)"; e.currentTarget.style.background = "transparent"; }}
                          onClick={(e) => { e.stopPropagation(); handleDeleteCollection(col.id); }}
                          title="Delete collection">×</button>
                      </div>
                    ))}
                  </div>
                )}
                {creatingCollection && (
                  <div className="px-3 pb-2 pt-1 space-y-1.5">
                    <input autoFocus placeholder="Collection name…" value={newCollectionName}
                      onInput={(e) => setNewCollectionName((e.target as HTMLInputElement).value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && newCollectionName.trim()) {
                          handleCreateCollection(newCollectionName.trim(), newCollectionColor);
                          setNewCollectionName(""); setCreatingCollection(false);
                        }
                        if (e.key === "Escape") { setCreatingCollection(false); setNewCollectionName(""); }
                      }}
                      className="w-full px-2.5 py-1 rounded text-xs outline-none"
                      style={{ background: "var(--color-panel-3)", color: "var(--color-text)", border: "1px solid var(--color-border-strong)" }} />
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {COLLECTION_COLORS.map((c) => (
                        <button key={c} onClick={() => setNewCollectionColor(c)}
                          className="w-3.5 h-3.5 rounded-full flex-shrink-0"
                          style={{ background: c, outline: newCollectionColor === c ? "2px solid var(--color-white)" : "none", outlineOffset: "1px" }} />
                      ))}
                      <button className="ml-auto text-[10px] px-2 py-0.5 rounded font-semibold"
                        style={{ background: "var(--color-accent-dark)", color: "var(--color-white)" }}
                        onClick={() => {
                          if (newCollectionName.trim()) {
                            handleCreateCollection(newCollectionName.trim(), newCollectionColor);
                            setNewCollectionName(""); setCreatingCollection(false);
                          }
                        }}>✓</button>
                      <button className="text-[10px] px-2 py-0.5 rounded"
                        style={{ background: "var(--color-panel-3)", color: "var(--color-text-muted)" }}
                        onClick={() => { setCreatingCollection(false); setNewCollectionName(""); }}>✗</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
          {/* ── By Developer ── */}
          <div className="border-b" style={{ borderColor: "var(--color-bg-deep)" }}>
            <div
              className="flex items-center px-3 pt-2 pb-1 gap-1 cursor-pointer select-none transition-colors hover:text-[var(--color-text)]"
              style={{ color: showDevelopers ? "var(--color-text)" : "var(--color-text-dim)" }}
              onClick={() => setShowDevelopers(p => !p)}
            >
              <svg className="transition-transform duration-200" style={{ transform: showDevelopers ? "rotate(90deg)" : "rotate(0deg)" }} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="8.5" cy="7" r="4" />
                <path d="M20 8v6" /><path d="M23 11h-6" />
              </svg>
              <span className="text-[9px] uppercase tracking-widest font-bold flex-1" style={{ paddingTop: "1px" }}>By Developer</span>
              {filterMode.startsWith("dev:") && (
                <button onClick={(e) => { e.stopPropagation(); setFilterMode("all"); }}
                  className="text-[9px] px-1.5 py-0.5 rounded mr-1"
                  style={{ background: "var(--color-panel-3)", color: "var(--color-text-muted)" }}
                  title="Clear filter">✕ clear</button>
              )}
            </div>
            {showDevelopers && (
              developerBuckets.length === 0 ? (
                <p className="px-3 pb-2 text-[10px]" style={{ color: "var(--color-text-dim)" }}>No developers yet</p>
              ) : (
                <div className="overflow-y-auto pb-1" style={{ maxHeight: "156px", scrollbarWidth: "thin", scrollbarColor: "var(--color-border) transparent" }}>
                  {developerBuckets.map((dev) => {
                    const active = filterMode === `dev:${dev.name}`;
                    return (
                      <button key={dev.name}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-left"
                        style={{ background: active ? "var(--color-accent-deep)" : "transparent" }}
                        onClick={() => setFilterMode(active ? "all" : `dev:${dev.name}`)}
                        onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "var(--color-bg)"; }}
                        onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}>
                        <span className="flex-1 text-xs truncate" style={{ color: active ? "var(--color-accent)" : "var(--color-text-muted)" }}>{dev.name}</span>
                        <span className="text-[9px] flex-shrink-0" style={{ color: "var(--color-text-dim)" }}>{dev.count}</span>
                      </button>
                    );
                  })}
                </div>
              )
            )}
          </div>
          {/* ── Wishlist ── */}
          <div className="border-b" style={{ borderColor: "var(--color-bg-deep)" }}>
            <div
              className="flex items-center px-3 pt-2 pb-1 gap-1 cursor-pointer select-none transition-colors hover:text-[var(--color-text)]"
              style={{ color: showWishlist ? "var(--color-text)" : "var(--color-text-dim)" }}
              onClick={() => setShowWishlist(p => !p)}
            >
              <svg className="transition-transform duration-200" style={{ transform: showWishlist ? "rotate(90deg)" : "rotate(0deg)" }} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
              </svg>
              <span className="text-[9px] uppercase tracking-widest font-bold flex-1" style={{ paddingTop: "1px" }}>Wishlist ({wishlist.length})</span>
            </div>
            {showWishlist && (
              <>
                {wishlist.length === 0 && (
                  <p className="px-3 pb-2 text-[10px]" style={{ color: "var(--color-text-dim)" }}>No wishlisted games</p>
                )}
                {wishlist.length > 0 && (
                  <div className="overflow-y-auto" style={{ maxHeight: "152px", scrollbarWidth: "thin", scrollbarColor: "var(--color-border) transparent" }}>
                    {wishlist.map((item) => (
                      <a key={item.id} href={item.id} target="_blank" rel="noreferrer" className="group flex items-center justify-between px-3 py-1.5 cursor-pointer"
                        style={{ borderBottom: "1px solid var(--color-bg-deep)", textDecoration: "none" }}
                        onMouseEnter={e => e.currentTarget.style.background = "var(--color-bg)"}
                        onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                        title={item.title}>
                        <div className="flex flex-col overflow-hidden text-left flex-1 min-w-0 pr-2">
                          <span className="text-xs truncate font-medium group-hover:underline" style={{ color: "var(--color-text)" }}>{item.title}</span>
                          <span className="text-[9px] truncate mt-0.5" style={{ color: "var(--color-text-muted)" }}>{item.source} • <span className={item.releaseStatus === "Completed" ? "text-[var(--color-success)]" : ""}>{item.releaseStatus}</span></span>
                        </div>
                        <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleRemoveWishlist(item.id); }}
                          className="opacity-0 group-hover:opacity-100 px-1 py-0.5 text-[12px] font-bold rounded flex-shrink-0 transition-opacity relative z-10"
                          style={{ color: "var(--color-text-dim)" }}
                          onMouseEnter={e => { e.currentTarget.style.background = "var(--color-danger-bg)"; e.currentTarget.style.color = "var(--color-danger)"; }}
                          onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--color-text-dim)"; }}
                        >✕</button>
                      </a>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
          <div
            ref={sidebarListRefCb}
            className="flex-1 overflow-y-auto"
            style={{ scrollbarWidth: "thin", scrollbarColor: "var(--color-border) transparent" }}
          >
            {syncState === "full-scan" ? (
              <div className="flex flex-col items-center justify-center h-32 gap-2">
                <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2" style={{ borderColor: "var(--color-accent)" }} />
                <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Scanning…</span>
              </div>
            ) : sidebarItems.length === 0 ? (
              <p className="px-4 py-6 text-xs text-center" style={{ color: "var(--color-text-muted)" }}>
                {games.length === 0 ? "Add a library folder to get started" : "No games match"}
              </p>
            ) : (
              <div style={{ position: "relative", height: `${vTotalH}px` }}>
                {vItems.map(({ item, offsetTop }) => {
                  if (item.kind === "group-header") {
                    const collapsed = collapsedGroups.has(item.dir);
                    return (
                      <button key={`hdr:${item.dir}`}
                        onClick={() => toggleGroup(item.dir)}
                        className="w-full flex items-center gap-1.5 px-2.5 py-1 text-left"
                        style={{
                          position: "absolute", top: offsetTop, left: 0, right: 0, height: 28,
                          background: "var(--color-bg-deep)", borderBottom: "1px solid var(--color-border-subtle)"
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-panel-deep)")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "var(--color-bg-deep)")}>
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-dim)"
                          strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                          style={{ transform: collapsed ? "rotate(-90deg)" : "none", transition: "transform 0.15s", flexShrink: 0 }}>
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-dim)"
                          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                        </svg>
                        <span className="flex-1 text-[10px] font-semibold truncate" style={{ color: "var(--color-text-muted)" }}>
                          {item.label}
                        </span>
                        <span className="text-[9px] flex-shrink-0" style={{ color: "var(--color-text-dim)" }}>{item.count}</span>
                      </button>
                    );
                  }

                  // ── Game row ──
                  const game = item.kind === "group-game" ? item.game : (item as { kind: "game"; game: Game }).game;
                  const isGrouped = item.kind === "group-game";
                  // visibleSidebarItems already excludes collapsed group items, but keep the guard
                  if (isGrouped && collapsedGroups.has((item as { kind: "group-game"; dir: string; game: Game }).dir)) return null;

                  const isSelected = selected?.path === game.path;
                  const isDragOver = dragOverPathState === game.path;
                  const m = metadata[game.path];
                  const cus = customizations[game.path];
                  const coverSrc = cus?.coverUrl ?? m?.cover_url;
                  const name = gameDisplayName(game);
                  const isFavItem = !!favGames[game.path];
                  const isHiddenItem = !!hiddenGames[game.path];
                  return (
                    <button key={game.path} onClick={() => openGameView(game)}
                      onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, game }); }}
                      draggable={sortMode === "custom"}
                      onDragStart={(e) => {
                        dragPath.current = game.path;
                        if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragEnter={(e) => {
                        e.preventDefault();
                        if (dragPath.current && dragPath.current !== game.path) {
                          dragOverPath.current = game.path;
                          setDragOverPathState(game.path);
                        }
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
                      }}
                      onDragLeave={() => {
                        if (dragOverPath.current === game.path) {
                          dragOverPath.current = null;
                          setDragOverPathState(null);
                        }
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (dragPath.current && dragPath.current !== game.path) {
                          applyDrop(dragPath.current, game.path);
                        }
                        dragPath.current = null;
                        dragOverPath.current = null;
                        setDragOverPathState(null);
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors"
                      style={{
                        position: "absolute", top: offsetTop, left: 0, right: 0, height: viewMode === "compact" ? 28 : 52,
                        background: isSelected ? "var(--color-border)" : isDragOver ? "var(--color-accent-deep)" : "transparent",
                        borderLeft: `3px solid ${isSelected ? "var(--color-accent)" : isDragOver ? "var(--color-accent-mid)" : isFavItem ? "var(--color-warning)" : "transparent"}`,
                        borderTop: isDragOver ? "1px solid var(--color-accent-mid)" : undefined,
                        color: isSelected ? "var(--color-white)" : "var(--color-text-muted)",
                        opacity: isHiddenItem ? 0.6 : 1,
                        paddingLeft: isGrouped ? "1.75rem" : undefined,
                        cursor: sortMode === "custom" ? "grab" : undefined,
                      }}>
                      {availableGameUpdates[game.path] && (
                        <span className="absolute top-[4px] right-[4px] w-1.5 h-1.5 rounded-full z-10 animate-pulse bg-green-500"
                          style={{ boxShadow: "0 0 5px #10b981" }} title="New update available!" />
                      )}
                      {viewMode === "compact" ? (
                        <div className="w-5 h-5 rounded flex-shrink-0 overflow-hidden relative" style={{ background: heroGradient(game.name) }}>
                          {coverSrc ? <img src={coverSrc} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center font-bold text-white" style={{ fontSize: "9px" }}>{name.charAt(0).toUpperCase()}</div>}
                          <NsfwOverlay gamePath={game.path} meta={m} appSettings={appSettings} revealed={revealedNsfw} onReveal={revealNsfwPath} small={true} />
                        </div>
                      ) : (
                        <div className="w-9 h-9 rounded flex-shrink-0 overflow-hidden relative"
                          style={{ background: (!coverSrc && syncState === "syncing") ? "var(--color-border-soft)" : heroGradient(game.name) }}>
                          {coverSrc
                            ? <img src={coverSrc} alt="" className="w-full h-full object-cover" />
                            : syncState === "syncing"
                              ? <div className="w-full h-full animate-pulse bg-[var(--color-border)]" />
                              : <div className="w-full h-full flex items-center justify-center text-sm font-bold text-white">
                                {name.charAt(0).toUpperCase()}
                              </div>}
                          {isFavItem && (
                            <span className="absolute top-0 right-0 text-[8px] leading-none p-px"
                              style={{ color: "var(--color-warning)", textShadow: "0 0 3px var(--color-black)", zIndex: 11 }}>★</span>
                          )}
                          <NsfwOverlay gamePath={game.path} meta={m} appSettings={appSettings} revealed={revealedNsfw} onReveal={revealNsfwPath} small={true} />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1">
                          {sortMode === "custom" && (
                            <span className="text-[11px] flex-shrink-0 leading-none select-none"
                              style={{ color: "var(--color-text-dim)" }}>⠿</span>
                          )}
                          <p className="text-xs font-medium truncate flex-1">{name}</p>
                          {isHiddenItem && (
                            <span className="text-[9px] px-1 rounded flex-shrink-0"
                              style={{ background: "var(--color-panel-3)", color: "var(--color-text-dim)" }}>hidden</span>
                          )}
                        </div>
                        {viewMode !== "compact" && (
                          <>
                            <p className="text-[10px] truncate" style={{ color: "var(--color-text-dim)" }}>
                              {stats[game.path]?.totalTime > 0
                                ? `${formatTime(stats[game.path].totalTime)}${(stats[game.path].launchCount ?? 0) > 0
                                  ? ` · ${stats[game.path].launchCount}×`
                                  : ""
                                }`
                                : "Never played"}
                            </p>
                            {collections.some((c) => c.gamePaths.includes(game.path)) && (
                              <div className="flex gap-0.5 mt-0.5">
                                {collections.filter((c) => c.gamePaths.includes(game.path)).map((c) => (
                                  <span key={c.id} title={c.name} className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: c.color }} />
                                ))}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="px-3 py-3 space-y-1.5 border-t" style={{ borderColor: "var(--color-bg-deep)" }}>
            {syncState === "syncing" && (
              <div className="flex items-center gap-2 px-1 py-1">
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "var(--color-accent)" }} />
                <span className="text-xs" style={{ color: "var(--color-accent)" }}>Checking changes…</span>
              </div>
            )}

            {/* ── Add dropdown ── */}
            <div ref={addMenuRef} className="relative">
              <button
                onClick={() => setShowAddMenu((p) => !p)}
                className="w-full py-2 rounded text-xs font-semibold flex items-center justify-center gap-1.5"
                style={{ background: showAddMenu ? "var(--color-accent-dark)" : "var(--color-border)", color: "var(--color-text)", border: "1px solid var(--color-border-card)" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-accent-dark)")}
                onMouseLeave={(e) => { if (!showAddMenu) e.currentTarget.style.background = "var(--color-border)"; }}>
                {/* plus icon */}
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Add…
                {/* chevron */}
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                  style={{ marginLeft: "auto", transform: showAddMenu ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              {showAddMenu && (
                <div className="absolute bottom-full mb-1 left-0 right-0 rounded-lg py-1 shadow-2xl z-30"
                  style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
                  <button
                    onClick={handleAddFolder}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left"
                    style={{ color: "var(--color-text)" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-panel-3)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    </svg>
                    Add Library Folder
                    <span className="ml-auto text-[9px]" style={{ color: "var(--color-text-dim)" }}>scan dir</span>
                  </button>
                  <button
                    onClick={handleAddGameManually}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left"
                    style={{ color: "var(--color-text)" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-panel-3)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--color-warning)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 12h4" /><path d="M8 10v4" /><circle cx="17" cy="12" r="1" />
                    </svg>
                    Add Game Manually
                    <span className="ml-auto text-[9px]" style={{ color: "var(--color-text-dim)" }}>.exe / .sh</span>
                  </button>
                </div>
              )}
            </div>

            {/* Settings + app update */}
            <div className="flex gap-1.5">
              <button onClick={() => setShowSettings(true)}
                className="flex-1 py-1.5 rounded text-xs flex items-center justify-center gap-1.5"
                style={{ background: "transparent", color: "var(--color-text-dim)", border: "1px solid var(--color-panel-3)" }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "var(--color-text-muted)"; e.currentTarget.style.borderColor = "var(--color-border-strong)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "var(--color-text-dim)"; e.currentTarget.style.borderColor = "var(--color-panel-3)"; }}
                title="Settings">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
                Settings
              </button>
              <button onClick={() => setShowLogViewer(true)}
                className="flex-1 py-1.5 rounded text-xs flex items-center justify-center gap-1.5"
                style={{ background: "transparent", color: "var(--color-text-dim)", border: "1px solid var(--color-panel-3)" }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "var(--color-text-muted)"; e.currentTarget.style.borderColor = "var(--color-border-strong)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "var(--color-text-dim)"; e.currentTarget.style.borderColor = "var(--color-panel-3)"; }}
                title="Rust logs">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 6h16" /><path d="M4 12h16" /><path d="M4 18h16" />
                </svg>
                Logs
              </button>
              {appUpdate && (
                <button onClick={() => setShowAppUpdateModal(true)}
                  className="flex-1 py-1.5 rounded text-xs font-semibold flex items-center justify-center gap-1"
                  style={{ background: "var(--color-success-bg)", color: "var(--color-success)", border: "1px solid var(--color-success-border)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#1e4a1e")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "var(--color-success-bg)")}
                  title={`v${appUpdate.version} is available — click to install`}>
                  ↑ v{appUpdate.version}
                </button>
              )}
            </div>
          </div>
        </aside>
      )
      }

      {/* ── Main ── */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        {selected === null && activeMainTab === "feed" ? (
          <FeedView appSettings={appSettings} wishlist={wishlist} defaultFeeds={DEFAULT_SETTINGS.rssFeeds} onToggleWishlist={handleToggleWishlist} />
        ) : selected === null && activeMainTab === "stats" ? (
          <StatsView games={games} stats={stats} sessions={sessionLog} customizations={customizations} metadata={metadata} totalPlaytimeSecs={totalPlaytimeLiveSecs} />
        ) : viewMode === "grid" && !selected ? (
          <div className="flex-1 overflow-y-auto px-6 py-6" style={{ scrollbarWidth: "thin", scrollbarColor: "var(--color-border) transparent" }}>
            <div className="grid gap-5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}>
              {filtered.map(game => {
                const isFavItem = !!favGames[game.path];
                const cover = customizations[game.path]?.coverUrl ?? metadata[game.path]?.cover_url;
                return (
                  <button key={game.path} onClick={() => openGameView(game)} className="flex flex-col gap-2 group text-left relative transition-transform hover:scale-105">
                    <div className="aspect-[2/3] w-full bg-[var(--color-panel)] rounded-lg overflow-hidden border border-[var(--color-border)] group-hover:border-[var(--color-accent)] relative shadow-lg">
                      {cover ? (
                        <img src={cover} className="w-full h-full object-cover" alt="" />
                      ) : syncState === "syncing" ? (
                        <div className="w-full h-full animate-pulse bg-[var(--color-border)]" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center p-4 text-center text-sm font-bold text-white" style={{ background: heroGradient(game.name) }}>
                          {gameDisplayName(game)}
                        </div>
                      )}
                      {isFavItem && (
                        <span className="absolute top-2 right-2 text-sm leading-none" style={{ color: "var(--color-warning)", textShadow: "0 0 3px var(--color-black)", zIndex: 11 }}>★</span>
                      )}

                      <NsfwOverlay gamePath={game.path} meta={metadata[game.path]} appSettings={appSettings} revealed={revealedNsfw} onReveal={revealNsfwPath} />
                    </div>
                    <p className="text-xs font-semibold text-[var(--color-text)] truncate px-1">{gameDisplayName(game)}</p>
                  </button>
                )
              })}
            </div>
            {filtered.length === 0 && <div className="text-center py-12 text-[var(--color-text-muted)]">No games match the current filters</div>}
          </div>
        ) : !selected ? (
          games.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4" style={{ color: "var(--color-text-muted)" }}>
              <svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.2 }}>
                <rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 12h4" /><path d="M8 10v4" /><circle cx="17" cy="12" r="1" />
              </svg>
              <p className="text-base" style={{ opacity: 0.4 }}>Add a library folder or game to get started</p>
              <div className="flex gap-3">
                <button onClick={handleAddFolder}
                  className="px-5 py-2.5 rounded font-semibold text-sm flex items-center gap-2"
                  style={{ background: "var(--color-accent-dark)", color: "var(--color-white)" }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                  Add Library Folder
                </button>
                <button onClick={handleAddGameManually}
                  className="px-5 py-2.5 rounded font-semibold text-sm flex items-center gap-2"
                  style={{ background: "var(--color-border)", color: "var(--color-text)", border: "1px solid var(--color-border-strong)" }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 12h4" /><path d="M8 10v4" /><circle cx="17" cy="12" r="1" />
                  </svg>
                  Add Game Manually
                </button>
              </div>
            </div>
          ) : (
            <HomeView
              games={games}
              stats={stats}
              sessions={sessionLog}
              metadata={metadata}
              customizations={customizations}
              favGames={favGames}
              notes={notes}
              runningGamePath={runningGamePath}
              totalPlaytimeSecs={totalPlaytimeLiveSecs}
              onSelect={openGameView}
              onPlay={launchGame}
              onStop={killGame}
            />
          )
        ) : (
          <GameDetail
            game={selected}
            stat={stats[selected.path] || { totalTime: 0, lastPlayed: 0, lastSession: 0 }}
            meta={metadata[selected.path]}
            customization={customizations[selected.path] ?? {}}
            f95LoggedIn={f95LoggedIn}
            screenshots={screenshots[selected.path] ?? []}
            isHidden={!!hiddenGames[selected.path]}
            isFav={!!favGames[selected.path]}
            onPlay={(...args) => launchGame(selected.path, ...args)}
            onStop={killGame}
            isRunning={runningGamePath === selected.path}
            runnerLabel={(() => {
              if (platform === "windows") return undefined;
              const gc = customizations[selected.path];
              if (gc?.runnerOverrideEnabled) {
                const ov = gc.runnerOverride;
                if (!ov || (!ov.runnerPath && ov.runner === "custom")) return "Direct";
                return `${ov.runner.charAt(0).toUpperCase()}${ov.runner.slice(1)} (Override)`;
              }
              if (!launchConfig.enabled) return undefined;
              return `${launchConfig.runner.charAt(0).toUpperCase()}${launchConfig.runner.slice(1)}`;
            })()}
            onDelete={() => setDeleteTarget(selected)}
            onLinkPage={() => setShowLinkModal(true)}
            onOpenF95Login={() => setShowF95Login(true)}
            onClearMeta={handleClearMeta}
            onUpdate={() => setShowUpdateModal(true)}
            onBackupSaves={() => backupSaveFilesForPath(selected.path)}
            onToggleHide={toggleHide}
            onToggleFav={toggleFav}
            onOpenCustomize={() => setShowCustomizeModal(true)}
            onSaveCustomization={(changes) => {
              const nc = { ...(customizations[selected.path] || {}), ...changes };
              setCustomizations(prev => {
                const n = { ...prev, [selected.path]: nc };
                saveCache(SK_CUSTOM, n);
                return n;
              });
            }}
            onOpenNotes={() => setShowNotesModal(true)}
            hasNotes={!!(notes[selected.path]?.trim())}
            onManageCollections={() => setShowManageCollections(true)}
            appSettings={appSettings}
            revealedNsfw={revealedNsfw}
            onRevealNsfw={revealNsfwPath}
            onTakeScreenshot={async () => {
              try {
                await captureScreenshotForPath(selected.path, false);
              } catch (e) {
                alert("Screenshot failed: " + e);
              }
            }}
            onAnnotateScreenshot={async () => {
              try {
                await captureScreenshotForPath(selected.path, true);
              } catch (e) {
                alert("Screenshot failed: " + e);
              }
            }}
            onOpenScreenshotsFolder={() =>
              invoke("open_screenshots_folder", { gameExe: selected.path }).catch((e) =>
                alert("Could not open folder: " + e)
              )
            }
            onExportGalleryZip={handleExportScreenshotZip}
            onUpdateScreenshotTags={handleUpdateScreenshotTags}
            sessions={sessionLog}
            onEditSessionNote={handleEditSessionNote}
            history={history[selected.path] || []}
            onAddHistory={(version, note) => {
              setHistory(prev => {
                const list = prev[selected.path] || [];
                const nextList = [{ id: String(Date.now()), date: Date.now(), version, note }, ...list];
                const n = { ...prev, [selected.path]: nextList };
                saveCache(SK_HISTORY, n);
                return n;
              });
            }}
          />
        )}
      </main>

      </div>

      {/* ── Modals ── */}
      {
        showSettings && (
          <SettingsModal
            f95LoggedIn={f95LoggedIn}
            dlsiteLoggedIn={dlsiteLoggedIn}
            fakkuLoggedIn={fakkuLoggedIn}
            libraryFolders={libraryFolders}
            syncState={syncState}
            platform={platform}
            launchConfig={launchConfig}
            appUpdate={appUpdate}
            onF95Login={() => setShowF95Login(true)}
            onF95Logout={async () => { await invoke("f95_logout").catch(() => { }); setF95LoggedIn(false); }}
            onDLsiteLogin={() => setShowDLsiteLogin(true)}
            onDLsiteLogout={async () => { await invoke("dlsite_logout").catch(() => { }); setDlsiteLoggedIn(false); }}
            onFakkuLogin={() => setShowFakkuLogin(true)}
            onFakkuLogout={async () => { await invoke("fakku_logout").catch(() => { }); setFakkuLoggedIn(false); }}
            onRemoveFolder={handleRemoveFolder}
            onRescanAll={() => runFullScanAll(libraryFolders)}
            onWineSettings={() => setShowWineSettings(true)}
            onSteamImport={() => setShowSteamImport(true)}
            onLutrisImport={() => setShowLutrisImport(true)}
            onPlayniteImport={() => setShowPlayniteImport(true)}
            onGogImport={() => setShowGogImport(true)}
            onAppUpdate={() => setShowAppUpdateModal(true)}
            appSettings={appSettings}
            defaultSettings={DEFAULT_SETTINGS}
            onSaveSettings={(s) => { setAppSettings(s); saveCache(SK_SETTINGS, s); }}
            onOpenMigrationWizard={() => setShowMigrationWizard(true)}
            onExportCSV={handleExportCSV}
            onExportHTML={handleExportHTML}
            onExportCloudState={handleExportCloudState}
            onImportCloudState={handleImportCloudState}
            onClose={() => setShowSettings(false)}
            onBatchMetadataRefresh={handleBatchMetadataRefresh}
            batchRefreshStatus={batchRefreshStatus}
          />
        )
      }
      {
        showWineSettings && (
          <WineSettingsModal
            config={launchConfig}
            onSave={(c) => { setLaunchConfig(c); saveCache(SK_LAUNCH, c); }}
            onClose={() => setShowWineSettings(false)}
          />
        )
      }
      {
        showMigrationWizard && (
          <MigrationWizardModal
            games={games}
            onApply={handleMigrateGameFolder}
            onClose={() => setShowMigrationWizard(false)}
          />
        )
      }
      {
        showManageCollections && selected && (
          <ManageCollectionsModal
            gamePath={selected.path}
            displayTitle={customizations[selected.path]?.displayName ?? metadata[selected.path]?.title ?? selected.name}
            collections={collections}
            onToggle={handleToggleGameInCollection}
            onCreate={handleCreateCollection}
            onClose={() => setShowManageCollections(false)}
          />
        )
      }
      {
        showNotesModal && selected && (
          <NotesModal
            displayTitle={customizations[selected.path]?.displayName ?? metadata[selected.path]?.title ?? selected.name}
            initialNote={notes[selected.path] ?? ""}
            onSave={handleSaveNote}
            onClose={() => setShowNotesModal(false)}
          />
        )
      }
      {
        showCustomizeModal && selected && (
          <CustomizeModal
            game={selected}
            meta={metadata[selected.path]}
            custom={customizations[selected.path] ?? {}}
            platform={platform}
            globalLaunchConfig={launchConfig}
            onSave={handleSaveCustomization}
            onClose={() => setShowCustomizeModal(false)}
          />
        )
      }
      {
        showUpdateModal && selected && (
          <UpdateModal game={selected} onClose={() => setShowUpdateModal(false)} />
        )
      }
      {
        showAppUpdateModal && appUpdate && (
          <AppUpdateModal
            version={appUpdate.version}
            url={appUpdate.url}
            downloadUrl={appUpdate.downloadUrl}
            onClose={() => setShowAppUpdateModal(false)}
          />
        )
      }
      {
        showLogViewer && (
          <LogViewerModal
            logs={rustLogs}
            crashReport={crashReport}
            levelFilter={logLevelFilter}
            onSetLevelFilter={setLogLevelFilter}
            onRefresh={refreshRustLogs}
            onClear={clearRustLogs}
            onExport={handleExportDiagnosticLog}
            onCopyJson={handleCopyDiagnosticJson}
            onClose={() => setShowLogViewer(false)}
          />
        )
      }
      {
        crashReport && (
          <CrashReportModal
            report={crashReport}
            onClose={() => {
              invoke("clear_last_crash_report").catch(() => { });
              setCrashReport(null);
            }}
          />
        )
      }
      {
        pendingMetaUpdate && (
          <MetadataDiffModal
            oldMeta={pendingMetaUpdate.oldMeta}
            newMeta={pendingMetaUpdate.newMeta}
            onConfirm={(logNote) => {
              const { path, newMeta } = pendingMetaUpdate;
              const next = { ...metadata, [path]: { ...newMeta, fetchedAt: Date.now() } };
              setMetadata(next); saveCache(SK_META, next);
              if (logNote) {
                setHistory(prev => {
                  const list = prev[path] || [];
                  const nextList = [{ id: String(Date.now()), date: Date.now(), version: newMeta.version || "Unknown", note: logNote }, ...list];
                  const n = { ...prev, [path]: nextList };
                  saveCache(SK_HISTORY, n);
                  return n;
                });
              }
              setPendingMetaUpdate(null);
            }}
            onClose={() => setPendingMetaUpdate(null)}
          />
        )
      }
      {
        showLinkModal && selected && (
          <LinkPageModal
            gameName={selected.name}
            onClose={() => setShowLinkModal(false)}
            onFetched={handleMetaFetched}
            f95LoggedIn={f95LoggedIn}
            onOpenF95Login={() => { setShowLinkModal(false); setShowF95Login(true); }}
          />
        )
      }
      {
        showF95Login && (
          <F95LoginModal
            onClose={() => setShowF95Login(false)}
            onSuccess={() => setF95LoggedIn(true)}
          />
        )
      }
      {
        showDLsiteLogin && (
          <DLsiteLoginModal
            onClose={() => setShowDLsiteLogin(false)}
            onSuccess={() => setDlsiteLoggedIn(true)}
          />
        )
      }
      {
        showFakkuLogin && (
          <FakkuLoginModal
            onClose={() => setShowFakkuLogin(false)}
            onSuccess={() => setFakkuLoggedIn(true)}
          />
        )
      }
      {
        deleteTarget && (
          <div className="fixed inset-0 flex items-center justify-center z-50"
            style={{ background: "rgba(0,0,0,0.75)" }}
            onClick={(e) => { if (e.target === e.currentTarget && !isDeleting) setDeleteTarget(null); }}>
            <div className="rounded-lg p-6 w-96 shadow-2xl" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border-strong)" }}>
              <h2 className="text-lg font-bold mb-2" style={{ color: "var(--color-white)" }}>Uninstall Game</h2>
              <p className="text-sm mb-1" style={{ color: "var(--color-text)" }}>This will permanently delete:</p>
              <p className="text-xs font-mono mb-4 break-all" style={{ color: "var(--color-danger)" }}>
                {deleteTarget.path.replace(/[\\/][^\\/]+$/, "")}
              </p>
              <p className="text-xs mb-3" style={{ color: "var(--color-text-muted)" }}>This action cannot be undone unless you reinstall the game later.</p>
              <label className="flex items-center gap-2 text-xs mb-5 cursor-pointer select-none" style={{ color: "var(--color-text)" }}>
                <input type="checkbox" checked={keepDataOnDelete} onChange={(e) => setKeepDataOnDelete(e.currentTarget.checked)} />
                Keep playtime and metadata (mark as uninstalled)
              </label>
              <div className="flex gap-3 justify-end">
                <button onClick={() => setDeleteTarget(null)} disabled={isDeleting}
                  className="px-4 py-2 rounded text-sm disabled:opacity-50"
                  style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border-strong)" }}>Cancel</button>
                <button onClick={confirmDelete} disabled={isDeleting}
                  className="px-4 py-2 rounded text-sm font-semibold disabled:opacity-50 flex items-center gap-2"
                  style={{ background: "#c0392b", color: "var(--color-white)" }}>
                  {isDeleting && <span className="w-3 h-3 rounded-full border-2 border-white border-t-transparent animate-spin" />}
                  Delete Files
                </button>
              </div>
            </div>
          </div>
        )
      }
      {/* Session note prompt */}
      {
        pendingNoteSession && (() => {
          const g = games.find(gm => gm.path === pendingNoteSession!.path);
          const name = g ? (customizations[g.path]?.displayName ?? metadata[g.path]?.title ?? g.name) : "Game";
          return (
            <SessionNoteModal
              session={pendingNoteSession}
              gameName={name}
              onSave={handleSaveSessionNote}
              onDismiss={() => setPendingNoteSession(null)}
            />
          );
        })()
      }
      {
        showSteamImport && (
          <SteamImportModal
            games={games}
            metadata={metadata}
            customizations={customizations}
            onImport={handleSteamImport}
            onClose={() => setShowSteamImport(false)}
          />
        )
      }
      {
        showLutrisImport && (
          <LutrisImportModal
            games={games}
            onImport={handleLutrisImport}
            onClose={() => setShowLutrisImport(false)}
          />
        )
      }
      {
        showPlayniteImport && (
          <InteropImportModal
            games={games}
            command="import_playnite_games"
            title="Import from Playnite"
            subtitle="Read installed entries from Playnite library database and merge them into LIBMALY."
            accent="#7d68c9"
            onImport={handleInteropImport}
            onClose={() => setShowPlayniteImport(false)}
          />
        )
      }
      {
        showGogImport && (
          <InteropImportModal
            games={games}
            command="import_gog_galaxy_games"
            title="Import from GOG Galaxy"
            subtitle="Read installed GOG entries from galaxy-2.0.db and merge them into LIBMALY."
            accent="#4f90d9"
            onImport={handleInteropImport}
            onClose={() => setShowGogImport(false)}
          />
        )
      }
      {
        pendingAnnotatedShot && (
          <ScreenshotAnnotateModal
            shot={pendingAnnotatedShot.shot}
            onSave={handleSaveAnnotatedShot}
            onCancel={handleCancelAnnotatedShot}
          />
        )
      }

      <CommandPalette
        isOpen={showCmdPalette}
        onClose={() => setShowCmdPalette(false)}
        games={games}
        metadata={metadata}
        notes={notes}
        onSelect={openGameView}
        onBack={goBack}
        onForward={goForward}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
      />
    </div >
  );

}


