import { useState, useEffect, useRef, useMemo, useCallback } from "preact/hooks";
import { useTranslation } from "react-i18next";
import i18n from "./i18n";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getVersion } from "@tauri-apps/api/app";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { emitTo, listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { register as registerGlobalShortcut, unregister as unregisterGlobalShortcut } from "@tauri-apps/plugin-global-shortcut";
import { getCurrent as getCurrentDeepLinks, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { getMatches } from "@tauri-apps/plugin-cli";
import { enable as enableAutostart, disable as disableAutostart, isEnabled as isAutostartEnabled } from "@tauri-apps/plugin-autostart";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { marked } from "marked";
import { CommandPalette } from "./components/CommandPalette";
import { AchievementTrackerModal } from "./components/modals/AchievementTrackerModal";
import { MediaInstallPreviewModal } from "./components/modals/MediaInstallPreviewModal";
import { NsfwOverlay } from "./components/common/NsfwOverlay";
import { GameDetail } from "./components/game/GameDetail";
import { AppUpdateModal } from "./components/modals/AppUpdateModal";
import { SaveTransferModal } from "./components/modals/SaveTransferModal";
import { WhatsNewModal } from "./components/modals/WhatsNewModal";
import { CrashReportModal, IntegrityCheckModal, LogViewerModal, RecoveryModeModal, SnapshotRestoreModal } from "./components/modals/DiagnosticsModals";
import { MigrationWizardModal, SettingsModal } from "./components/modals/SettingsModal";
import { ScreenshotAnnotateModal } from "./components/modals/ScreenshotAnnotateModal";
import { FeedView } from "./components/views/FeedView";
import { HomeView } from "./components/views/HomeView";
import { StatsView } from "./components/views/StatsView";
import { mergeFolderGames, mergeFolderMtimes } from "./lib/scanner";
import { appStorageGetItem, appStorageRemoveItem, appStorageSetItem, getAppStorageProfile, setAppStorageProfile } from "./lib/appStorage";
import {
  SK_GAMES, SK_MTIMES, SK_PATH, SK_FOLDERS, SK_STATS, SK_META, SK_HIDDEN, SK_FAVS, SK_GHOST,
  SK_CUSTOM, SK_NOTES, SK_ACHIEVEMENTS, SK_COLLECTIONS, SK_LAUNCH, SK_RECENT, SK_ORDER, SK_SESSION_LOG,
  SK_WISHLIST, SK_HISTORY, SK_SETTINGS, SK_VIEW_MODE, SK_SIDEBAR_WIDTH, SK_LAYOUT_PRESETS, SK_STEAM_WEB_API_KEY, SK_STEAM_PROFILE_REF,
  JOB_INCREMENTAL_SYNC, JOB_FULL_SCAN, JOB_INTEGRITY_CHECK, JOB_BATCH_METADATA_REFRESH,
  JOB_AUTO_METADATA_REFRESH, JOB_UPDATE_CHECKER, JOB_AUTO_HEAL_PATHS, JOB_BACKUP_RETENTION, JOB_DB_VACUUM, JOB_AUTO_CLOUD_BACKUP,
  DEFAULT_METADATA_QUEUE_CONCURRENCY, DEFAULT_METADATA_QUEUE_MAX_ATTEMPTS, DEFAULT_METADATA_QUEUE_BACKOFF_MS,
  COLLECTION_COLORS, SCREENSHOT_TOAST_TTL_MS, DEFAULT_SETTINGS, DEFAULT_LAUNCH_CONFIG,
  GENERIC_EXE_NAMES, RATING_CATEGORIES,
} from "./lib/constants";
import type { GameAchievementItem, GameAchievementsByPath } from "./lib/gameAchievements";
import { normalizeAchievementsMap } from "./lib/gameAchievements";
import {
  assessGameMediaPlaybackContext,
  buildLaunchWineMediaWarningMessage,
  combinePrefixAndGameMedia,
  ENGINE_MEDIA_KNOWLEDGE,
  findMatchingWinePrefixEntry,
  MEDIA_PLAYBACK_GOTCHAS,
  resolveEffectiveWinePrefix,
} from "./lib/mediaPlaybackKnowledge";
import { formatWinetricksErrorWithHints } from "./lib/winetricksSupport";
import {
  buildShaderWarmupLines,
  type ShaderCacheDiscovery,
  WINE_COMPATIBILITY_PRESETS,
} from "./lib/shaderCache";
import {
  normalizePathForMatch, normalizePathNoCase, pathDirname, pathBasename, remapPathByRoot, remapPathByPrefix,
  pathSegmentsRelativeToRoot, deriveGameName, parseDeepLinkUrl, parseSyncOAuthCallbackUrl, resolveSeasonFromDate,
  detectMetadataSourceFromUrl, metadataSourceLabel,
  normalizeHexColor, shiftHexColor, formatScoreForScale,
  resolveOverallScore100, mergeDefaultRssFeeds,
  formatTime, heroGradient, allowsNativeContextMenu,
  isBackgroundJobBusy, backgroundJobButtonLabel, sleep,
} from "./lib/helpers";
import { getSyncProviderLabel, isAutoBackupProvider, syncCompleteOAuthCallback, syncGetConfig, syncUpload, type SyncSaveBackupResult } from "./lib/sync";
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
type SessionMood = "hype" | "chill" | "chaos";
/** One recorded play session */
interface SessionEntry {
  id: string;        // unique: timestamp string
  path: string;      // game path (key into other maps)
  startedAt: number; // Unix ms — when the session began
  duration: number;  // seconds
  note: string;      // optional session note, empty string if none
  mood?: SessionMood; // optional mood tag
}
interface SteamEntry { app_id: string; name: string; played_minutes: number; }
interface SteamLibraryEntry {
  app_id: string;
  name: string;
  install_dir: string;
  library_dir: string;
  manifest_path: string;
  exe?: string | null;
}
interface SteamOwnedGame {
  app_id: string;
  name: string;
  played_minutes: number;
  installed: boolean;
  install_dir?: string | null;
  library_dir?: string | null;
  manifest_path?: string | null;
  exe?: string | null;
}
interface EpicLegendaryStatus {
  available: boolean;
  authenticated: boolean;
  executablePath?: string | null;
  version?: string | null;
  displayName?: string | null;
  installUrl: string;
  lastError?: string | null;
}
interface EpicOwnedGame {
  app_name: string;
  title: string;
  installed: boolean;
  install_path?: string | null;
  exe?: string | null;
  version?: string | null;
}
interface ItchButlerStatus {
  available: boolean;
  executablePath?: string | null;
  version?: string | null;
  installUrl: string;
  apiKeyProvider: string;
}
interface ItchInstallLocation {
  id: string;
  path: string;
}
interface ItchProfile {
  id: number;
  user: {
    id: number;
    username: string;
    displayName: string;
    url?: string | null;
    coverUrl?: string | null;
    stillCoverUrl?: string | null;
  };
}
interface ItchCave {
  id: string;
  upload?: { id: number } | null;
  build?: { id: number } | null;
}
interface ItchLibraryEntry {
  id: number;
  title: string;
  cover?: string | null;
  owned: boolean;
  installed: boolean;
  installedAt?: string | null;
  caveIds: string[];
  primaryCaveId?: string | null;
  installFolders: string[];
}
interface ItchOwnedLibrary {
  profile: ItchProfile;
  records: ItchLibraryEntry[];
  caves: ItchCave[];
  installLocations: ItchInstallLocation[];
}
interface ItchGameUpdateChoice {
  upload: { id: number; displayName?: string | null; channelName?: string | null; build?: { id: number } | null };
  build?: { id: number; userVersion?: string | null; version?: number | null } | null;
  confidence: number;
}
interface ItchGameUpdate {
  caveId: string;
  game: { id: number; title: string };
  direct: boolean;
  choices: ItchGameUpdateChoice[];
}
interface ItchUpdateCheckResult {
  updates: ItchGameUpdate[];
  warnings: string[];
}
interface ItchInstallResult {
  gameId: number;
  title: string;
  caveId: string;
  installFolder: string;
  uploadId: number;
  buildId?: number | null;
}
interface MetadataSourceLink {
  source: string;
  source_label?: string;
  source_url: string;
  fetchedAt?: number;
}

interface MetadataSourceSnapshot {
  source: string;
  source_label?: string;
  source_url: string;
  fetchedAt?: number;
  title?: string;
  version?: string;
  developer?: string;
  publisher?: string;
  genres?: string[];
  overview?: string;
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

interface GameMetadata {
  source: string;
  source_label?: string;
  source_url: string;
  fetchedAt?: number;
  title?: string;
  version?: string;
  developer?: string;
  publisher?: string;
  genres?: string[];
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
  source_links?: MetadataSourceLink[];
  source_snapshots?: Record<string, MetadataSourceSnapshot>;
  aggregated_sources?: string[];
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

interface ScreenshotToast {
  id: string;
  gamePath: string;
  screenshot: Screenshot;
  label: string;
}

interface ScreenshotOverlayPayload {
  gamePath: string;
  gameTitle: string;
  screenshot: Screenshot;
  label?: string;
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
interface ScraperHealthDiagnostic {
  source_id: string;
  source_label: string;
  overall_status: "healthy" | "degraded" | "parser_failed" | string;
  source_wide_parser_failure: boolean;
  total_attempts: number;
  total_successes: number;
  total_failures: number;
  parser_failure_count: number;
  consecutive_parser_failures: number;
  last_success_at?: number | null;
  last_failure_at?: number | null;
  last_failure_kind?: string | null;
  last_failure_reason?: string | null;
  last_failure_url?: string | null;
  recent_failure_reasons: string[];
}
interface IntegrityIssue {
  severity: "error" | "warning" | string;
  code: string;
  message: string;
  path?: string | null;
  gamePath?: string | null;
}
interface IntegrityCheckReport {
  scannedAt: number;
  totalGames: number;
  totalLibraryFolders: number;
  errorCount: number;
  warningCount: number;
  issues: IntegrityIssue[];
}
interface AutoHealSuggestion {
  gameName: string;
  oldPath: string;
  newPath: string;
  confidence: number;
  reason: string;
}
interface AutoHealReport {
  scannedAt: number;
  totalBrokenGames: number;
  suggestionCount: number;
  unresolvedPaths: string[];
  suggestions: AutoHealSuggestion[];
}
interface BackupRetentionApplyResult {
  snapshotsDeleted: number;
  saveBackupsDeleted: number;
  snapshotsKept: number;
  saveBackupsKept: number;
}
interface PermissionDiagnostic {
  operation: string;
  rawError: string;
  targetPath?: string | null;
  appDataRoot: string;
  portableMode: boolean;
  summary: string;
  probableCause: string;
  actionableFixes: string[];
}
interface SnapshotResult {
  id: string;
  path: string;
  createdAt: number;
  entryCount: number;
  label?: string | null;
  reason?: string | null;
}
interface SnapshotContents extends SnapshotResult {
  entries: Record<string, string>;
}
interface SnapshotPreviewItem {
  key: string;
  label: string;
  status: "changed" | "same" | "missing_in_snapshot" | "new_in_snapshot";
  currentCount: number;
  snapshotCount: number;
}
interface SnapshotRestorePreview {
  snapshot: SnapshotContents;
  items: SnapshotPreviewItem[];
  changedCount: number;
  currentGames: number;
  snapshotGames: number;
  currentFolders: number;
  snapshotFolders: number;
}
interface RecentFileOp {
  ts: number;
  operation: string;
  path: string;
  strategy: string;
  success: boolean;
  error?: string | null;
}
type BackgroundJobStatus = "queued" | "running" | "retrying" | "failed" | "permanent_failed";
interface BackgroundJob {
  id: string;
  label: string;
  status: BackgroundJobStatus;
  detail?: string | null;
  progressCurrent?: number | null;
  progressTotal?: number | null;
  attempts?: number | null;
  updatedAt: number;
}
interface MetadataQueueItem {
  path: string;
  metadata: GameMetadata;
}
interface FolderQueueItem {
  path: string;
}
interface SaveBackupResult {
  zip_path: string;
  files: number;
  directories: string[];
}

interface ZipInstallResult {
  zipPath: string;
  libraryRoot: string;
  installedDir: string;
  sourceDir: string;
  warnings: string[];
}

interface VacuumReport {
  tempFilesRemoved: number;
  tempBytesFreed: number;
  logEntriesPruned: number;
  journalEntriesPruned: number;
  durationMs: number;
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
  /** Optional Steam integration for imported Steam titles. */
  steamAppId?: string;
  launchViaSteam?: boolean;
  /** Generic launcher protocol integration for store-managed games. */
  storeProvider?: string;
  storeGameId?: string;
  storeLaunchUri?: string;
  launchViaStore?: boolean;
  /** Epic Games Store integration via Legendary. */
  epicAppName?: string;
  launchViaLegendary?: boolean;
  /** itch.io butler integration metadata. */
  itchCaveId?: string;
  itchGameId?: string;
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
  /** Manual metadata overrides (when scrapers don't work) */
  manualDeveloper?: string;
  manualPublisher?: string;
  manualGenres?: string;
  manualReleaseDate?: string;
  manualDescription?: string;
}

type RatingScale = "10" | "10_decimal" | "100" | "5_star" | "3_smiley";
type ThemeMode = "dark" | "light" | "oled" | "mint-apple" | "hanami" | "dawn" | "sunset" | "crimson-moon" | "sepia" | "cotton-candy" | "ocean-deep"
  | "citrus-sherbert" | "retro-raincloud" | "sunrise" | "lofi-vibes" | "desert-khaki"
  | "chroma-glow" | "forest" | "midnight-blurple" | "mars" | "dusk" | "retro-storm" | "neon-nights" | "strawberry-lemonade" | "aurora" | "blurple-twilight"
  | "custom";
type RatingCategoryKey = "gameplay" | "story" | "soundtrack" | "visuals" | "characters" | "performance";

interface SearchResultItem {
  title: string;
  url: string;
  cover_url: string | null;
  source: string;
}

const METADATA_SOURCE_PRIORITY = [
  "f95",
  "dlsite",
  "vndb",
  "mangagamer",
  "johren",
  "fakku",
  "igdb",
  "rawg",
  "mobygames",
] as const;

function metadataSourceRank(source?: string | null) {
  const normalized = (source || "").trim().toLowerCase();
  const idx = METADATA_SOURCE_PRIORITY.indexOf(normalized as typeof METADATA_SOURCE_PRIORITY[number]);
  return idx === -1 ? METADATA_SOURCE_PRIORITY.length + 1 : idx;
}

async function invokeMetadataForUrl(url: string) {
  return invoke<GameMetadata>("fetch_metadata_for_url", { url });
}

async function invokeMetadataBySource(source: string, url: string) {
  return invoke<GameMetadata>("fetch_metadata_by_source", { source, url });
}

function isNonEmptyMetadataString(value?: string | null): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function sanitizeMetadataString(value?: string | null) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (/^\{\{[\s\S]+\}\}$/.test(normalized)) return undefined;
  return normalized;
}

function sanitizeMetadataStringArray(values?: string[] | null) {
  if (!values || values.length === 0) return [];
  const seen = new Set<string>();
  const next: string[] = [];
  for (const value of values) {
    const normalized = sanitizeMetadataString(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(normalized);
  }
  return next;
}

function normalizeMetadataSnapshot(snapshot: MetadataSourceSnapshot): MetadataSourceSnapshot {
  return {
    ...snapshot,
    source: snapshot.source.trim().toLowerCase(),
    source_label: snapshot.source_label?.trim() || undefined,
    source_url: snapshot.source_url.trim(),
    title: sanitizeMetadataString(snapshot.title),
    version: sanitizeMetadataString(snapshot.version),
    developer: sanitizeMetadataString(snapshot.developer),
    publisher: sanitizeMetadataString(snapshot.publisher),
    overview: sanitizeMetadataString(snapshot.overview),
    overview_html: sanitizeMetadataString(snapshot.overview_html),
    cover_url: sanitizeMetadataString(snapshot.cover_url),
    engine: sanitizeMetadataString(snapshot.engine),
    os: sanitizeMetadataString(snapshot.os),
    language: sanitizeMetadataString(snapshot.language),
    censored: sanitizeMetadataString(snapshot.censored),
    release_date: sanitizeMetadataString(snapshot.release_date),
    last_updated: sanitizeMetadataString(snapshot.last_updated),
    rating: sanitizeMetadataString(snapshot.rating),
    price: sanitizeMetadataString(snapshot.price),
    circle: sanitizeMetadataString(snapshot.circle),
    series: sanitizeMetadataString(snapshot.series),
    author: sanitizeMetadataString(snapshot.author),
    illustration: sanitizeMetadataString(snapshot.illustration),
    voice_actor: sanitizeMetadataString(snapshot.voice_actor),
    music: sanitizeMetadataString(snapshot.music),
    age_rating: sanitizeMetadataString(snapshot.age_rating),
    product_format: sanitizeMetadataString(snapshot.product_format),
    file_format: sanitizeMetadataString(snapshot.file_format),
    file_size: sanitizeMetadataString(snapshot.file_size),
    screenshots: sanitizeMetadataStringArray(snapshot.screenshots),
    tags: sanitizeMetadataStringArray(snapshot.tags),
    genres: sanitizeMetadataStringArray(snapshot.genres),
    relations: sanitizeMetadataStringArray(snapshot.relations),
  };
}

function metadataSnapshotFromMeta(meta: GameMetadata): MetadataSourceSnapshot | null {
  if (!isNonEmptyMetadataString(meta.source)) return null;
  return normalizeMetadataSnapshot({
    source: meta.source,
    source_label: meta.source_label,
    source_url: meta.source_url || "",
    fetchedAt: meta.fetchedAt,
    title: meta.title,
    version: meta.version,
    developer: meta.developer,
    publisher: meta.publisher,
    genres: meta.genres,
    overview: meta.overview,
    overview_html: meta.overview_html,
    cover_url: meta.cover_url,
    screenshots: meta.screenshots || [],
    tags: meta.tags || [],
    relations: meta.relations,
    engine: meta.engine,
    os: meta.os,
    language: meta.language,
    censored: meta.censored,
    release_date: meta.release_date,
    last_updated: meta.last_updated,
    rating: meta.rating,
    price: meta.price,
    circle: meta.circle,
    series: meta.series,
    author: meta.author,
    illustration: meta.illustration,
    voice_actor: meta.voice_actor,
    music: meta.music,
    age_rating: meta.age_rating,
    product_format: meta.product_format,
    file_format: meta.file_format,
    file_size: meta.file_size,
  });
}

function metadataSnapshotsFromMeta(meta?: GameMetadata | null): MetadataSourceSnapshot[] {
  if (!meta) return [];
  const next = new Map<string, MetadataSourceSnapshot>();
  const snapshots = meta.source_snapshots ? Object.values(meta.source_snapshots) : [];
  for (const snapshot of snapshots) {
    if (!isNonEmptyMetadataString(snapshot?.source)) continue;
    const normalized = normalizeMetadataSnapshot(snapshot);
    next.set(normalized.source, normalized);
  }
  if (next.size === 0) {
    const fallback = metadataSnapshotFromMeta(meta);
    if (fallback) next.set(fallback.source, fallback);
  }
  return Array.from(next.values()).sort((a, b) => metadataSourceRank(a.source) - metadataSourceRank(b.source));
}

function buildMetadataSourceLinks(snapshots: MetadataSourceSnapshot[]): MetadataSourceLink[] {
  return snapshots
    .filter((snapshot) => isNonEmptyMetadataString(snapshot.source_url))
    .map((snapshot) => ({ source: snapshot.source, source_label: snapshot.source_label, source_url: snapshot.source_url, fetchedAt: snapshot.fetchedAt }))
    .sort((a, b) => metadataSourceRank(a.source) - metadataSourceRank(b.source));
}

function pickMetadataStringField(
  snapshotsBySource: Map<string, MetadataSourceSnapshot>,
  field:
    | "title"
    | "version"
    | "developer"
    | "publisher"
    | "overview"
    | "overview_html"
    | "cover_url"
    | "engine"
    | "os"
    | "language"
    | "censored"
    | "release_date"
    | "last_updated"
    | "rating"
    | "price"
    | "circle"
    | "series"
    | "author"
    | "illustration"
    | "voice_actor"
    | "music"
    | "age_rating"
    | "product_format"
    | "file_format"
    | "file_size",
  preferredSources?: readonly string[],
): string | undefined {
  const order = [
    ...(preferredSources ?? []),
    ...METADATA_SOURCE_PRIORITY,
    ...Array.from(snapshotsBySource.keys()),
  ];
  const seen = new Set<string>();
  for (const source of order) {
    if (seen.has(source)) continue;
    seen.add(source);
    const candidate = snapshotsBySource.get(source)?.[field];
    if (isNonEmptyMetadataString(typeof candidate === "string" ? candidate : undefined)) {
      return candidate;
    }
  }
  return undefined;
}

function mergeMetadataArrayField(
  snapshotsBySource: Map<string, MetadataSourceSnapshot>,
  field: "screenshots" | "tags" | "genres" | "relations",
  preferredSources?: readonly string[],
) {
  const order = [
    ...(preferredSources ?? []),
    ...METADATA_SOURCE_PRIORITY,
    ...Array.from(snapshotsBySource.keys()),
  ];
  const seenSources = new Set<string>();
  const seenValues = new Set<string>();
  const next: string[] = [];
  for (const source of order) {
    if (seenSources.has(source)) continue;
    seenSources.add(source);
    const values = snapshotsBySource.get(source)?.[field];
    if (!Array.isArray(values)) continue;
    for (const rawValue of values) {
      const value = (rawValue || "").trim();
      if (!value) continue;
      const key = value.toLowerCase();
      if (seenValues.has(key)) continue;
      seenValues.add(key);
      next.push(value);
    }
  }
  return next;
}

function mergeMetadataSnapshots(inputSnapshots: MetadataSourceSnapshot[]): GameMetadata {
  const snapshots = inputSnapshots
    .filter((snapshot) => isNonEmptyMetadataString(snapshot.source))
    .map(normalizeMetadataSnapshot);
  const snapshotsBySource = new Map<string, MetadataSourceSnapshot>();
  for (const snapshot of snapshots) {
    snapshotsBySource.set(snapshot.source, snapshot);
  }
  const aggregatedSources = Array.from(snapshotsBySource.keys()).sort((a, b) => metadataSourceRank(a) - metadataSourceRank(b));
  const sourceLinks = buildMetadataSourceLinks(Array.from(snapshotsBySource.values()));
  const primaryLink = sourceLinks[0] ?? null;
  const fetchedAt = Array.from(snapshotsBySource.values()).reduce<number | undefined>((latest, snapshot) => {
    if (!snapshot.fetchedAt) return latest;
    return latest ? Math.max(latest, snapshot.fetchedAt) : snapshot.fetchedAt;
  }, undefined);

  return {
    source: primaryLink?.source ?? aggregatedSources[0] ?? "",
    source_label: primaryLink?.source_label ?? snapshotsBySource.get(primaryLink?.source ?? aggregatedSources[0] ?? "")?.source_label,
    source_url: primaryLink?.source_url ?? "",
    fetchedAt,
    title: pickMetadataStringField(snapshotsBySource, "title", ["f95", "dlsite", "vndb"]),
    version: pickMetadataStringField(snapshotsBySource, "version", ["f95", "dlsite", "mangagamer", "johren", "fakku", "vndb"]),
    developer: pickMetadataStringField(snapshotsBySource, "developer", ["dlsite", "f95", "mangagamer", "johren", "fakku", "vndb"]),
    publisher: pickMetadataStringField(snapshotsBySource, "publisher", ["dlsite", "vndb", "igdb", "rawg", "mobygames"]),
    genres: mergeMetadataArrayField(snapshotsBySource, "genres", ["vndb", "igdb", "rawg", "mobygames"]),
    overview: pickMetadataStringField(snapshotsBySource, "overview", ["dlsite", "f95", "fakku", "mangagamer", "johren", "vndb"]),
    overview_html: pickMetadataStringField(snapshotsBySource, "overview_html", ["dlsite", "fakku", "mangagamer", "johren"]),
    cover_url: pickMetadataStringField(snapshotsBySource, "cover_url", ["vndb", "dlsite", "f95", "fakku", "igdb", "rawg", "mobygames"]),
    screenshots: mergeMetadataArrayField(snapshotsBySource, "screenshots", ["vndb", "dlsite", "f95", "igdb", "rawg", "mobygames"]),
    tags: mergeMetadataArrayField(snapshotsBySource, "tags", ["f95", "dlsite", "vndb", "igdb", "rawg", "mobygames"]),
    relations: mergeMetadataArrayField(snapshotsBySource, "relations", ["vndb", "igdb", "rawg", "mobygames"]),
    engine: pickMetadataStringField(snapshotsBySource, "engine", ["f95", "vndb", "igdb", "rawg"]),
    os: pickMetadataStringField(snapshotsBySource, "os", ["dlsite", "f95", "vndb"]),
    language: pickMetadataStringField(snapshotsBySource, "language", ["dlsite", "vndb", "f95"]),
    censored: pickMetadataStringField(snapshotsBySource, "censored", ["dlsite", "f95", "fakku"]),
    release_date: pickMetadataStringField(snapshotsBySource, "release_date", ["vndb", "dlsite", "f95", "igdb", "rawg", "mobygames"]),
    last_updated: pickMetadataStringField(snapshotsBySource, "last_updated", ["f95", "dlsite", "rawg", "mobygames"]),
    rating: pickMetadataStringField(snapshotsBySource, "rating", ["dlsite", "f95", "igdb", "rawg", "mobygames"]),
    price: pickMetadataStringField(snapshotsBySource, "price", ["dlsite", "fakku", "mangagamer", "johren", "rawg"]),
    circle: pickMetadataStringField(snapshotsBySource, "circle", ["dlsite"]),
    series: pickMetadataStringField(snapshotsBySource, "series", ["dlsite", "vndb"]),
    author: pickMetadataStringField(snapshotsBySource, "author", ["dlsite"]),
    illustration: pickMetadataStringField(snapshotsBySource, "illustration", ["dlsite"]),
    voice_actor: pickMetadataStringField(snapshotsBySource, "voice_actor", ["dlsite"]),
    music: pickMetadataStringField(snapshotsBySource, "music", ["dlsite"]),
    age_rating: pickMetadataStringField(snapshotsBySource, "age_rating", ["dlsite", "fakku"]),
    product_format: pickMetadataStringField(snapshotsBySource, "product_format", ["dlsite"]),
    file_format: pickMetadataStringField(snapshotsBySource, "file_format", ["dlsite"]),
    file_size: pickMetadataStringField(snapshotsBySource, "file_size", ["dlsite"]),
    source_links: sourceLinks,
    source_snapshots: Object.fromEntries(Array.from(snapshotsBySource.entries())),
    aggregated_sources: aggregatedSources,
  };
}

function mergeMetadataWithSnapshot(existing: GameMetadata | undefined, incoming: GameMetadata | MetadataSourceSnapshot) {
  const existingSnapshots = metadataSnapshotsFromMeta(existing);
  const incomingSnapshot = "source_snapshots" in incoming || "aggregated_sources" in incoming || "source_links" in incoming
    ? metadataSnapshotFromMeta(incoming as GameMetadata)
    : normalizeMetadataSnapshot(incoming as MetadataSourceSnapshot);
  const nextSnapshots = incomingSnapshot ? [...existingSnapshots, incomingSnapshot] : existingSnapshots;
  return mergeMetadataSnapshots(nextSnapshots);
}

function metadataHasLinkedSources(meta?: GameMetadata | null) {
  return metadataSnapshotsFromMeta(meta).some((snapshot) => isNonEmptyMetadataString(snapshot.source_url));
}

function metadataUsesSource(meta: GameMetadata | undefined, source: string) {
  if (!meta) return false;
  return metadataSnapshotsFromMeta(meta).some((snapshot) => snapshot.source === source);
}

function metadataSourceSummary(meta?: GameMetadata | null) {
  if (!meta) return "";
  const snapshots = metadataSnapshotsFromMeta(meta);
  const sources = meta.aggregated_sources?.length ? meta.aggregated_sources : snapshots.map((snapshot) => snapshot.source);
  return Array.from(new Set(sources)).map((source) => snapshots.find((snapshot) => snapshot.source === source)?.source_label || metadataSourceLabel(source)).join(" + ");
}

// ─── Types ────────────────────────────────────────────────────────────────────

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

interface LibraryProfile {
  id: string;
  displayName: string;
  handle?: string | null;
  tagline?: string | null;
  avatarUrl?: string | null;
  bannerUrl?: string | null;
  accentColor?: string | null;
  createdAt: number;
  updatedAt: number;
}

interface LibraryProfileRegistry {
  activeProfileId: string;
  profiles: LibraryProfile[];
}

type RunnerKind = "wine" | "proton" | "custom";

interface LaunchConfig {
  enabled: boolean;        // false = always run directly
  runner: RunnerKind;
  runnerPath: string;         // path to wine/proton binary
  prefixPath: string;         // WINEPREFIX / STEAM_COMPAT_DATA_PATH
}

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
  media: {
    has_media_foundation: boolean;
    has_quartz: boolean;
    has_wmp: boolean;
    has_lavfilters: boolean;
    has_wmv_decoder: boolean;
    likely_video_playback_issue: boolean;
    summary: string;
    notes: string[];
    recommended_verbs: string[];
  };
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
  store_uri?: string | null;
  source_url?: string | null;
  cover_url?: string | null;
  developer?: string | null;
  version?: string | null;
  overview?: string | null;
}

interface AppSettings {
  updateCheckerEnabled: boolean;
  sessionToastEnabled: boolean;
  trayTooltipEnabled: boolean;
  startupWithWindows: boolean;
  surpriseLaunchesImmediately: boolean;
  themeMode: ThemeMode;
  seasonalTheme: "auto" | "winter" | "summer" | "halloween" | "none";
  ratingScale: RatingScale;
  themeScheduleMode: "manual" | "os" | "time";
  dayThemeMode: ThemeMode;
  nightThemeMode: ThemeMode;
  lightStartHour: number;
  darkStartHour: number;
  accentColor: string;
  blurNsfwContent: boolean;
  rssFeeds: { url: string; name: string; enabled?: boolean }[];
  metadataAutoRefetchDays: number;
  autoScreenshotInterval: number;
  saveBackupOnExit: boolean;
  cloudAutoBackupEnabled: boolean;
  cloudAutoBackupIntervalMinutes: number;
  cloudAutoBackupLastSuccessAt: number;
  sidebarMinimalMode?: boolean;
  sidebarShowNews?: boolean;
  sidebarShowStats?: boolean;
  sidebarShowSearchTools?: boolean;
  sidebarShowCollections?: boolean;
  sidebarShowDevelopers?: boolean;
  sidebarShowWishlist?: boolean;
  sidebarShowSurpriseButton?: boolean;
  sidebarShowAddButton?: boolean;
  sidebarShowSettingsButton?: boolean;
  sidebarShowLogsButton?: boolean;
  discordEnabled?: boolean;
  discordShowElapsedTime?: boolean;
  discordShowIdlePresence?: boolean;
  discordAllowActivityJoin?: boolean;
  backupRetentionDailyKeep: number;
  backupRetentionWeeklyKeep: number;
  backupRetentionMonthlyKeep: number;
  bossKeyEnabled?: boolean;
  bossKeyCode?: number;
  bossKeyAction?: "hide" | "kill";
  bossKeyMuteSystem?: boolean;
  bossKeyFallbackUrl?: string;
  customThemeColors?: Record<string, string>;
  language?: string;
  preferredMetadataSource?: "all" | "f95" | "dlsite" | "vndb" | "mangagamer" | "johren" | "fakku";
  preferredSearchEngine?: "duckduckgo" | "google" | "bing" | "brave";
}

type LayoutViewMode = "list" | "compact" | "grid";

type LayoutPresetConfig = {
  viewMode: LayoutViewMode;
  sidebarWidth: number;
  sidebarMinimalMode: boolean;
  sidebarShowNews: boolean;
  sidebarShowStats: boolean;
  sidebarShowSearchTools: boolean;
  sidebarShowCollections: boolean;
  sidebarShowDevelopers: boolean;
  sidebarShowWishlist: boolean;
  sidebarShowSurpriseButton: boolean;
  sidebarShowAddButton: boolean;
  sidebarShowSettingsButton: boolean;
  sidebarShowLogsButton: boolean;
};

type LayoutPresetRecord = {
  id: string;
  name: string;
  description?: string;
  config: LayoutPresetConfig;
};

type LayoutPresetDescriptor = LayoutPresetRecord & {
  readOnly?: boolean;
};

const LAYOUT_SIDEBAR_SETTING_KEYS = [
  "sidebarShowNews",
  "sidebarShowStats",
  "sidebarShowSearchTools",
  "sidebarShowCollections",
  "sidebarShowDevelopers",
  "sidebarShowWishlist",
  "sidebarShowSurpriseButton",
  "sidebarShowAddButton",
  "sidebarShowSettingsButton",
  "sidebarShowLogsButton",
] as const;

function clampSidebarWidthValue(value: number) {
  return Math.max(200, Math.min(600, Math.round(value)));
}

function captureLayoutPresetConfig(viewMode: LayoutViewMode, sidebarWidth: number, appSettings: AppSettings): LayoutPresetConfig {
  return {
    viewMode,
    sidebarWidth: clampSidebarWidthValue(sidebarWidth),
    sidebarMinimalMode: !!appSettings.sidebarMinimalMode,
    sidebarShowNews: appSettings.sidebarShowNews !== false,
    sidebarShowStats: appSettings.sidebarShowStats !== false,
    sidebarShowSearchTools: appSettings.sidebarShowSearchTools !== false,
    sidebarShowCollections: appSettings.sidebarShowCollections !== false,
    sidebarShowDevelopers: appSettings.sidebarShowDevelopers !== false,
    sidebarShowWishlist: appSettings.sidebarShowWishlist !== false,
    sidebarShowSurpriseButton: appSettings.sidebarShowSurpriseButton !== false,
    sidebarShowAddButton: appSettings.sidebarShowAddButton !== false,
    sidebarShowSettingsButton: appSettings.sidebarShowSettingsButton !== false,
    sidebarShowLogsButton: appSettings.sidebarShowLogsButton !== false,
  };
}

function layoutPresetConfigsEqual(left: LayoutPresetConfig, right: LayoutPresetConfig) {
  if (left.viewMode !== right.viewMode || left.sidebarWidth !== right.sidebarWidth || left.sidebarMinimalMode !== right.sidebarMinimalMode) {
    return false;
  }
  return LAYOUT_SIDEBAR_SETTING_KEYS.every((key) => left[key] === right[key]);
}

function slugifyLayoutPresetName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

const BUILTIN_LAYOUT_PRESETS: LayoutPresetDescriptor[] = [
  {
    id: "builtin:minimalist",
    name: "Minimalist",
    description: "Compact list, narrow sidebar, and only the high-frequency controls left visible.",
    readOnly: true,
    config: {
      viewMode: "compact",
      sidebarWidth: 220,
      sidebarMinimalMode: true,
      sidebarShowNews: false,
      sidebarShowStats: false,
      sidebarShowSearchTools: true,
      sidebarShowCollections: false,
      sidebarShowDevelopers: false,
      sidebarShowWishlist: false,
      sidebarShowSurpriseButton: false,
      sidebarShowAddButton: true,
      sidebarShowSettingsButton: true,
      sidebarShowLogsButton: false,
    },
  },
  {
    id: "builtin:data-heavy",
    name: "Data-heavy",
    description: "Wide sidebar, full list mode, and every library section visible for scanning lots of metadata at once.",
    readOnly: true,
    config: {
      viewMode: "list",
      sidebarWidth: 340,
      sidebarMinimalMode: false,
      sidebarShowNews: true,
      sidebarShowStats: true,
      sidebarShowSearchTools: true,
      sidebarShowCollections: true,
      sidebarShowDevelopers: true,
      sidebarShowWishlist: true,
      sidebarShowSurpriseButton: true,
      sidebarShowAddButton: true,
      sidebarShowSettingsButton: true,
      sidebarShowLogsButton: true,
    },
  },
  {
    id: "builtin:console-mode",
    name: "Console-mode",
    description: "Dense launcher-style layout with compact rows and a utility-first sidebar.",
    readOnly: true,
    config: {
      viewMode: "compact",
      sidebarWidth: 280,
      sidebarMinimalMode: true,
      sidebarShowNews: false,
      sidebarShowStats: true,
      sidebarShowSearchTools: true,
      sidebarShowCollections: true,
      sidebarShowDevelopers: false,
      sidebarShowWishlist: false,
      sidebarShowSurpriseButton: true,
      sidebarShowAddButton: true,
      sidebarShowSettingsButton: true,
      sidebarShowLogsButton: true,
    },
  },
];

interface DiscordUserSnapshot {
  id: string;
  username: string;
  displayName: string;
  globalName?: string | null;
  avatarUrl?: string | null;
  status: string;
}

interface DiscordRelationshipCounts {
  onlinePlayingGame: number;
  onlineElsewhere: number;
  offline: number;
  total: number;
}

interface DiscordSdkSnapshot {
  available: boolean;
  initialized: boolean;
  connected: boolean;
  ready: boolean;
  appInstalled?: boolean | null;
  clientStatus: string;
  launchRegistered: boolean;
  richPresenceActive: boolean;
  sdkPath?: string | null;
  currentUser?: DiscordUserSnapshot | null;
  relationshipCounts: DiscordRelationshipCounts;
  lastJoinSecret?: string | null;
  lastError?: string | null;
}

interface DiscordPresenceInput {
  title: string;
  details?: string | null;
  state?: string | null;
  startTimestampMs?: number | null;
  largeImage?: string | null;
  largeText?: string | null;
  largeUrl?: string | null;
  smallImage?: string | null;
  smallText?: string | null;
  joinSecret?: string | null;
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
    achievements: GameAchievementsByPath;
    collections: Collection[];
    launchConfig: LaunchConfig;
    sessionLog: SessionEntry[];
    wishlist: WishlistItem[];
    history: GameHistoryMap;
    appSettings: AppSettings;
  }>;
}

interface SteamLaunchBridge {
  path: string;
  appId: string;
  baselineMinutes: number;
  lastSeenMinutes: number;
  sawIncrease: boolean;
  stalledPolls: number;
  pollCount: number;
}

const STEAM_PLACEHOLDER_PREFIX = "steam://owned/";
const EPIC_PLACEHOLDER_PREFIX = "epic://owned/";

const STORE_PROVIDER_LABELS: Record<string, string> = {
  "epic-games": "Epic Games Store",
  "ea-app": "EA App",
  "ubisoft-connect": "Ubisoft Connect",
  rockstar: "Rockstar Launcher",
  "battle-net": "Battle.net",
  gamejolt: "Game Jolt",
  itch: "itch.io",
};

function steamPlaceholderPath(appId: string) {
  return `${STEAM_PLACEHOLDER_PREFIX}${appId.trim()}`;
}

function epicPlaceholderPath(appName: string) {
  return `${EPIC_PLACEHOLDER_PREFIX}${appName.trim()}`;
}

function isSteamPlaceholderPath(path: string) {
  return normalizePathForMatch(path).startsWith(STEAM_PLACEHOLDER_PREFIX);
}

function isEpicPlaceholderPath(path: string) {
  return normalizePathForMatch(path).startsWith(EPIC_PLACEHOLDER_PREFIX);
}

function storeProviderLabel(source?: string | null) {
  if (!source) return "Store";
  return STORE_PROVIDER_LABELS[source] ?? source;
}

function resolvedGameDisplayName(
  game: Game,
  customizations: Record<string, GameCustomization>,
  metadata: Record<string, GameMetadata>,
) {
  return customizations[game.path]?.displayName ?? metadata[game.path]?.title ?? game.name;
}

function normalizeOwnershipToken(value?: string | null) {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/["'`’]/g, "")
    .replace(/\b(the|edition|complete|definitive|ultimate|goty|game of the year)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function ownershipDeveloperToken(customization?: GameCustomization, meta?: GameMetadata) {
  return normalizeOwnershipToken(
    customization?.manualDeveloper
    ?? meta?.developer
    ?? meta?.circle
    ?? meta?.author
    ?? null
  );
}

function ownershipGroupingKey(
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

function launchProviderLabelForGame(game: Game, customization?: GameCustomization) {
  if (customization?.steamAppId) return "Steam";
  if (customization?.epicAppName) return "Epic Games Store";
  if (customization?.itchGameId || customization?.itchCaveId) return "itch.io";
  if (customization?.storeProvider) return storeProviderLabel(customization.storeProvider);
  if (game.uninstalled) return "Library";
  return "Local";
}

function remoteInstallLabelForCustomization(customization?: GameCustomization) {
  if (!customization) return null;
  if (customization.steamAppId?.trim()) return "Install via Steam";
  if (customization.epicAppName?.trim()) return "Install via Epic Games Store";
  if (customization.storeProvider === "ubisoft-connect" && customization.storeGameId?.trim()) {
    return `Install via ${storeProviderLabel(customization.storeProvider)}`;
  }
  return null;
}

function openStoreLabelForCustomization(customization?: GameCustomization) {
  if (!customization?.storeLaunchUri?.trim()) return null;
  if (customization.storeProvider) {
    return `Open in ${storeProviderLabel(customization.storeProvider)}`;
  }
  return "Open in Launcher";
}

function ownershipPrimaryRank(
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

interface OwnershipGroup {
  id: string;
  displayName: string;
  memberGames: Game[];
  memberPaths: string[];
  primaryGame: Game;
  providerLabels: string[];
  providerSummary: string;
}

interface Collection {
  id: string;
  name: string;
  color: string;
  gamePaths: string[];
}

type SortMode = "name" | "lastPlayed" | "playtime" | "custom";
type FilterMode = "all" | "favs" | "hidden" | "f95" | "dlsite" | "vndb" | "mangagamer" | "johren" | "fakku" | "igdb" | "rawg" | "mobygames" | "unlinked" | "Playing" | "Completed" | "On Hold" | "Dropped" | "Plan to Play" | string;
type LaunchRequest = { mode: "path" | "name"; value: string; autoHide?: boolean };

function achievementTrackerUiState(items: GameAchievementItem[] | undefined): { summary: string | null; openGoals: boolean } {
  const list = items ?? [];
  const total = list.length;
  if (total === 0) return { summary: null, openGoals: false };
  const done = list.filter((i) => i.done).length;
  return { summary: `${done}/${total}`, openGoals: done < total };
}

function loadCache<T>(key: string, fallback: T): T {
  try { const r = appStorageGetItem(key); return r ? JSON.parse(r) : fallback; }
  catch { return fallback; }
}
function saveCache(key: string, val: unknown) { appStorageSetItem(key, JSON.stringify(val)); }

type ProfileStorageSnapshot = {
  libraryFolders: LibraryFolder[];
  games: Game[];
  stats: Record<string, GameStats>;
  metadata: Record<string, GameMetadata>;
  hiddenGames: Record<string, boolean>;
  favGames: Record<string, boolean>;
  ghostGames: Record<string, boolean>;
  customizations: Record<string, GameCustomization>;
  notes: Record<string, string>;
  achievements: GameAchievementsByPath;
  collections: Collection[];
  launchConfig: LaunchConfig;
  recentGames: RecentGame[];
  customOrder: Record<string, string[]>;
  sessionLog: SessionEntry[];
  wishlist: WishlistItem[];
  history: GameHistoryMap;
  appSettings: AppSettings;
  dirMtimes: DirMtime[];
  viewMode: "list" | "compact" | "grid";
  sidebarWidth: number;
};

function readProfileStorageSnapshot(): ProfileStorageSnapshot {
  const cachedSettings = loadCache(SK_SETTINGS, DEFAULT_SETTINGS) as Partial<AppSettings>;
  return {
    libraryFolders: (() => {
      const stored = loadCache<LibraryFolder[]>(SK_FOLDERS, []);
      if (stored.length > 0) return stored;
      const legacy = appStorageGetItem(SK_PATH);
      return legacy ? [{ path: legacy }] : [];
    })(),
    games: loadCache<Game[]>(SK_GAMES, []),
    stats: loadCache(SK_STATS, {}),
    metadata: loadCache(SK_META, {}),
    hiddenGames: loadCache(SK_HIDDEN, {}),
    favGames: loadCache(SK_FAVS, {}),
    ghostGames: loadCache(SK_GHOST, {}),
    customizations: loadCache(SK_CUSTOM, {}),
    notes: loadCache(SK_NOTES, {}),
    achievements: normalizeAchievementsMap(loadCache(SK_ACHIEVEMENTS, {})),
    collections: loadCache(SK_COLLECTIONS, []),
    launchConfig: loadCache(SK_LAUNCH, DEFAULT_LAUNCH_CONFIG),
    recentGames: loadCache(SK_RECENT, []),
    customOrder: loadCache(SK_ORDER, {}),
    sessionLog: loadCache(SK_SESSION_LOG, []),
    wishlist: loadCache(SK_WISHLIST, []),
    history: loadCache(SK_HISTORY, {}),
    appSettings: {
      ...DEFAULT_SETTINGS,
      ...cachedSettings,
      rssFeeds: mergeDefaultRssFeeds(cachedSettings.rssFeeds),
    },
    dirMtimes: loadCache(SK_MTIMES, []),
    viewMode: loadCache(SK_VIEW_MODE, "list"),
    sidebarWidth: loadCache(SK_SIDEBAR_WIDTH, 256),
  };
}

function buildSnapshotEntries(payload: {
  libraryFolders: LibraryFolder[];
  games: Game[];
  stats: Record<string, GameStats>;
  metadata: Record<string, GameMetadata>;
  hiddenGames: Record<string, boolean>;
  favGames: Record<string, boolean>;
  ghostGames: Record<string, boolean>;
  customizations: Record<string, GameCustomization>;
  notes: Record<string, string>;
  achievements: GameAchievementsByPath;
  collections: Collection[];
  launchConfig: LaunchConfig;
  recentGames: RecentGame[];
  customOrder: Record<string, string[]>;
  sessionLog: SessionEntry[];
  wishlist: WishlistItem[];
  history: GameHistoryMap;
  appSettings: AppSettings;
  dirMtimes: DirMtime[];
}) {
  return {
    [SK_GAMES]: JSON.stringify(payload.games),
    [SK_MTIMES]: JSON.stringify(payload.dirMtimes),
    [SK_FOLDERS]: JSON.stringify(payload.libraryFolders),
    [SK_STATS]: JSON.stringify(payload.stats),
    [SK_META]: JSON.stringify(payload.metadata),
    [SK_HIDDEN]: JSON.stringify(payload.hiddenGames),
    [SK_FAVS]: JSON.stringify(payload.favGames),
    [SK_GHOST]: JSON.stringify(payload.ghostGames),
    [SK_CUSTOM]: JSON.stringify(payload.customizations),
    [SK_NOTES]: JSON.stringify(payload.notes),
    [SK_ACHIEVEMENTS]: JSON.stringify(payload.achievements),
    [SK_COLLECTIONS]: JSON.stringify(payload.collections),
    [SK_LAUNCH]: JSON.stringify(payload.launchConfig),
    [SK_RECENT]: JSON.stringify(payload.recentGames),
    [SK_ORDER]: JSON.stringify(payload.customOrder),
    [SK_SESSION_LOG]: JSON.stringify(payload.sessionLog),
    [SK_WISHLIST]: JSON.stringify(payload.wishlist),
    [SK_HISTORY]: JSON.stringify(payload.history),
    [SK_SETTINGS]: JSON.stringify(payload.appSettings),
  };
}

interface SteamLaunchBridge {
  path: string;
  appId: string;
  baselineMinutes: number;
  lastSeenMinutes: number;
  sawIncrease: boolean;
  stalledPolls: number;
  pollCount: number;
}

// ─── TagBadge ─────────────────────────────────────────────────────────────────

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
  const { t } = useTranslation();
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
        <h2 className="text-lg font-bold mb-4" style={{ color: "var(--color-white)" }}>{t('game.update.title')}</h2>

        <div className="space-y-3 mb-6">
          {versionChanged ? (
            <div className="p-3 rounded" style={{ background: "var(--color-panel-3)" }}>
              <p className="text-sm" style={{ color: "var(--color-text)" }}>
                {t('game.update.version_changed', { old: oldV, new: newV })}
              </p>
            </div>
          ) : (
            <div className="p-3 rounded" style={{ background: "var(--color-panel-2)" }}>
              <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                {t('game.update.no_version_change', { version: newV })}
              </p>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-text)" }}>
            <input type="checkbox" checked={wantsToLog} onChange={(e) => setWantsToLog(e.currentTarget.checked)} />
            {t('game.update.log_history')}
          </label>

          {wantsToLog && (
            <textarea
              className="w-full h-20 p-2 rounded text-sm outline-none resize-none"
              style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
              placeholder={t('game.update.placeholder', { version: newV })}
              value={note}
              onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)}
            />
          )}
        </div>

        <div className="flex gap-3 justify-end">
          <button onClick={onClose}
            className="px-4 py-2 rounded text-sm hover:opacity-80 transition-opacity"
            style={{ background: "var(--color-panel-2)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>{t('common.migration.cancel')}</button>
          <button onClick={() => onConfirm(wantsToLog ? note : null)}
            className="px-5 py-2 rounded text-sm font-semibold hover:opacity-80 transition-opacity"
            style={{ background: "var(--color-accent)", color: "var(--color-black-strong)" }}>
            {t('game.update.apply')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Link Page Modal ──────────────────────────────────────────────────────────
function LinkPageModal({ gameName, gamePath, onClose, onFetched, f95LoggedIn, onOpenF95Login, ghostGames, appSettings }: {
  gameName: string;
  gamePath: string;
  onClose: () => void;
  onFetched: (meta: GameMetadata) => void;
  f95LoggedIn: boolean;
  onOpenF95Login: () => void;
  ghostGames: Record<string, boolean>;
  appSettings: AppSettings;
}) {
  const { t } = useTranslation();
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedSource, setSelectedSource] = useState<"all" | "f95" | "dlsite" | "vndb" | "mangagamer" | "johren" | "fakku">(appSettings.preferredMetadataSource || "all");
  const [selectedSearchEngine, setSelectedSearchEngine] = useState<"duckduckgo" | "google" | "bing" | "brave">(appSettings.preferredSearchEngine || "duckduckgo");

  const src = detectMetadataSourceFromUrl(url);

  const [suggestions, setSuggestions] = useState<SearchResultItem[] | null>(null);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [query, setQuery] = useState(gameName);

  const fetchSuggestions = () => {
    setIsLoadingSuggestions(true);
    invoke<SearchResultItem[]>("search_suggest_links", { query, searchEngine: selectedSearchEngine })
      .then((res) => setSuggestions(res))
      .catch((e) => { console.error("suggestions err", e); setSuggestions([]); })
      .finally(() => setIsLoadingSuggestions(false));
  };

  // Auto-fetch suggestions on mount or when search engine changes
  useEffect(() => {
    fetchSuggestions();
    // eslint-disable-next-line
  }, [gameName, selectedSearchEngine]);

  const doFetch = async (targetUrl = url) => {
    if (!targetUrl) return;
    if (ghostGames[gamePath]) {
      setError("Ghost mode is enabled for this game - no network requests allowed.");
      return;
    }
    setLoading(true); setError("");
    try {
      const meta = await invokeMetadataForUrl(targetUrl.trim());
      onFetched(meta); onClose();
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.8)" }}
      onClick={(e) => { if (e.target === e.currentTarget && !loading) onClose(); }}>
      <div className="rounded-lg p-6 w-[480px] shadow-2xl" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
        <h2 className="text-lg font-bold mb-1" style={{ color: "var(--color-white)" }}>{t('game.link.title')}</h2>
        <p className="text-xs mb-4" style={{ color: "var(--color-text-muted)" }}>
          {t('game.link.hint', { name: gameName })}
        </p>
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Preferred source:</span>
          <select
            value={selectedSource}
            onChange={(e) => setSelectedSource((e.target as HTMLSelectElement).value as typeof selectedSource)}
            className="px-2 py-1 rounded text-xs outline-none"
            style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
          >
            <option value="all">All</option>
            <option value="f95">F95zone</option>
            <option value="dlsite">DLsite</option>
            <option value="vndb">VNDB</option>
            <option value="mangagamer">MangaGamer</option>
            <option value="johren">Johren</option>
            <option value="fakku">FAKKU</option>
          </select>
          <span className="text-xs ml-auto" style={{ color: "var(--color-text-muted)" }}>Search engine:</span>
          <select
            value={selectedSearchEngine}
            onChange={(e) => setSelectedSearchEngine((e.target as HTMLSelectElement).value as typeof selectedSearchEngine)}
            className="px-2 py-1 rounded text-xs outline-none"
            style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
          >
            <option value="duckduckgo">DuckDuckGo</option>
            <option value="google">Google</option>
            <option value="bing">Bing</option>
            <option value="brave">Brave</option>
          </select>
        </div>
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
          placeholder={t('game.link.url_placeholder')}
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
            <span className="text-xs flex-1" style={{ color: "var(--color-warning)" }}>{t('game.link.f95_login_hint')}</span>
            <button onClick={onOpenF95Login} className="text-xs underline" style={{ color: "var(--color-warning)" }}>{t('settings.accounts.sign_in', { name: "" }).trim()}</button>
          </div>
        )}
        {!url && (
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <p className="text-[10px] uppercase text-[var(--color-text-muted)] font-bold tracking-widest flex-1">{t('game.link.suggestions')}</p>
              <input type="text" value={query} onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
                className="bg-[var(--color-panel-2)] border border-[var(--color-border)] text-[11px] px-2 py-0.5 rounded outline-none text-[var(--color-text)]"
                placeholder={t('common.search')}
                onKeyDown={(e) => e.key === "Enter" && fetchSuggestions()} />
              <button onClick={fetchSuggestions} disabled={isLoadingSuggestions} className="bg-[var(--color-border)] hover:bg-[var(--color-border-strong)] text-[11px] px-2 py-0.5 rounded text-[var(--color-text)] disabled:opacity-50">
                {isLoadingSuggestions ? t('game.link.searching') : t('common.search')}
              </button>
            </div>
            {isLoadingSuggestions ? (
              <p className="text-xs text-[var(--color-text-muted)]">{t('game.link.searching')}</p>
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
              <p className="text-xs text-[var(--color-text-muted)]">{t('game.link.no_suggestions')}</p>
            ) : null}
          </div>
        )}
        {error && <p className="text-xs mb-2" style={{ color: "var(--color-danger)" }}>{error}</p>}
        <div className="flex gap-3 justify-end mt-2">
          <button onClick={onClose} disabled={loading}
            className="px-4 py-2 rounded text-sm"
            style={{ background: "var(--color-panel-2)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>{t('common.migration.cancel')}</button>
          <button onClick={() => doFetch()} disabled={loading || !url.trim()}
            className="px-5 py-2 rounded text-sm font-semibold disabled:opacity-50 flex items-center gap-2"
            style={{ background: "var(--color-accent-dark)", color: "var(--color-white)" }}>
            {loading
              ? <><span className="w-3 h-3 rounded-full border-2 border-white border-t-transparent animate-spin" />{t('game.link.fetching')}</>
              : t('game.link.fetch')}
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
  const [customTags, setCustomTags] = useState<string[]>(custom.customTags ?? []);
  const [tagInput, setTagInput] = useState("");
  const [personalReview, setPersonalReview] = useState(custom.personalReview ?? "");
  const [manualDeveloper, setManualDeveloper] = useState(custom.manualDeveloper ?? meta?.developer ?? "");
  const [manualPublisher, setManualPublisher] = useState(custom.manualPublisher ?? meta?.publisher ?? "");
  const [manualGenres, setManualGenres] = useState(custom.manualGenres ?? (meta?.genres?.join(", ") ?? ""));
  const [manualReleaseDate, setManualReleaseDate] = useState(custom.manualReleaseDate ?? meta?.release_date ?? "");
  const [manualDescription, setManualDescription] = useState(custom.manualDescription ?? meta?.overview ?? "");

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
      customTags: customTags.length > 0 ? customTags : undefined,
      personalReview: personalReview.trim() || undefined,
      manualDeveloper: manualDeveloper.trim() || undefined,
      manualPublisher: manualPublisher.trim() || undefined,
      manualGenres: manualGenres.trim() || undefined,
      manualReleaseDate: manualReleaseDate.trim() || undefined,
      manualDescription: manualDescription.trim() || undefined,
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

          {/* Custom tags */}
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: "var(--color-text-muted)" }}>
              Custom Tags <span style={{ fontWeight: "normal", color: "var(--color-text-dim)" }}>(for organization & filtering)</span>
            </label>
            <div className="flex gap-2 mb-2">
              <input type="text" placeholder="Add a tag…" value={tagInput}
                onInput={(e) => setTagInput((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && tagInput.trim()) {
                    setCustomTags([...customTags, tagInput.trim()]);
                    setTagInput("");
                  }
                }}
                className="flex-1 px-3 py-2 rounded text-sm outline-none"
                style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border)" }} />
              <button onClick={() => {
                if (tagInput.trim()) {
                  setCustomTags([...customTags, tagInput.trim()]);
                  setTagInput("");
                }
              }}
                className="px-3 py-2 rounded text-xs flex-shrink-0"
                style={{ background: "var(--color-accent-dark)", color: "var(--color-white)", border: "1px solid var(--color-accent-mid)" }}>
                Add
              </button>
            </div>
            {customTags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {customTags.map((tag, i) => (
                  <span key={i} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs"
                    style={{ background: "var(--color-accent-deeper)", color: "var(--color-accent)", border: "1px solid var(--color-accent-mid)" }}>
                    {tag}
                    <button onClick={() => setCustomTags(customTags.filter((_, idx) => idx !== i))}
                      className="hover:text-white transition-colors" title="Remove tag">×</button>
                  </span>
                ))}
              </div>
            )}
            {customTags.length === 0 && (
              <p className="text-[10px]" style={{ color: "var(--color-text-dim)" }}>
                No custom tags yet. Add tags to organize and filter your games.
              </p>
            )}
          </div>

          {/* Personal review */}
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: "var(--color-text-muted)" }}>
              Personal Review <span style={{ fontWeight: "normal", color: "var(--color-text-dim)" }}>(your thoughts & notes)</span>
            </label>
            <textarea
              placeholder="Write your personal review, thoughts, or notes about this game…"
              value={personalReview}
              onInput={(e) => setPersonalReview((e.target as HTMLTextAreaElement).value)}
              rows={4}
              className="w-full px-3 py-2 rounded text-sm outline-none resize-y"
              style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
            />
            <p className="mt-1 text-[10px]" style={{ color: "var(--color-text-dim)" }}>
              This review is stored locally and won't be shared.
            </p>
          </div>

          {/* Manual metadata overrides */}
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: "var(--color-text-muted)" }}>
              Manual Metadata Overrides <span style={{ fontWeight: "normal", color: "var(--color-text-dim)" }}>(when scrapers don't work)</span>
            </label>
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] mb-1" style={{ color: "var(--color-text-dim)" }}>Developer</label>
                <input type="text" placeholder="e.g. Studio Name" value={manualDeveloper}
                  onInput={(e) => setManualDeveloper((e.target as HTMLInputElement).value)}
                  className="w-full px-3 py-2 rounded text-sm outline-none"
                  style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border)" }} />
              </div>
              <div>
                <label className="block text-[10px] mb-1" style={{ color: "var(--color-text-dim)" }}>Publisher</label>
                <input type="text" placeholder="e.g. Publisher Name" value={manualPublisher}
                  onInput={(e) => setManualPublisher((e.target as HTMLInputElement).value)}
                  className="w-full px-3 py-2 rounded text-sm outline-none"
                  style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border)" }} />
              </div>
              <div>
                <label className="block text-[10px] mb-1" style={{ color: "var(--color-text-dim)" }}>Genres <span style={{ fontWeight: "normal" }}>(comma-separated)</span></label>
                <input type="text" placeholder="e.g. RPG, Adventure, Open World" value={manualGenres}
                  onInput={(e) => setManualGenres((e.target as HTMLInputElement).value)}
                  className="w-full px-3 py-2 rounded text-sm outline-none"
                  style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border)" }} />
              </div>
              <div>
                <label className="block text-[10px] mb-1" style={{ color: "var(--color-text-dim)" }}>Release Date</label>
                <input type="text" placeholder="e.g. 2024-01-15" value={manualReleaseDate}
                  onInput={(e) => setManualReleaseDate((e.target as HTMLInputElement).value)}
                  className="w-full px-3 py-2 rounded text-sm outline-none"
                  style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border)" }} />
              </div>
              <div>
                <label className="block text-[10px] mb-1" style={{ color: "var(--color-text-dim)" }}>Description</label>
                <textarea
                  placeholder="Game description or overview…"
                  value={manualDescription}
                  onInput={(e) => setManualDescription((e.target as HTMLTextAreaElement).value)}
                  rows={3}
                  className="w-full px-3 py-2 rounded text-sm outline-none resize-y"
                  style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
                />
              </div>
            </div>
            <p className="mt-2 text-[10px]" style={{ color: "var(--color-text-dim)" }}>
              These fields override scraped metadata. Use when scrapers fail or for custom entries.
            </p>
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
function WineSettingsModal({ config, onSave, onClose, platform = "windows", onPermissionFailure }: {
  config: LaunchConfig;
  onSave: (c: LaunchConfig) => void;
  onClose: () => void;
  platform?: string;
  onPermissionFailure?: (
    operation: string,
    targetPath: string | null,
    error: unknown,
    fallbackTitle?: string,
  ) => Promise<void>;
}) {
  const [cfg, setCfg] = useState<LaunchConfig>(config);
  const [detected, setDetected] = useState<{ name: string; path: string; kind: RunnerKind; flavor?: string }[]>([]);
  const [detecting, setDetecting] = useState(false);
  const [prefixes, setPrefixes] = useState<PrefixInfo[]>([]);
  const [prefixLoading, setPrefixLoading] = useState(false);
  const [prefixError, setPrefixError] = useState("");
  const [newPrefixPath, setNewPrefixPath] = useState("");
  const [toolBusy, setToolBusy] = useState<string | null>(null);
  const [mediaInstallPreview, setMediaInstallPreview] = useState<null | { prefix: PrefixInfo; verbs: string[]; sourceLabel: string }>(null);
  const [selectedVerb, setSelectedVerb] = useState("vcrun2019");
  const winetricksVerbs = ["vcrun2019", "d3dx9", "dotnet48", "corefonts", "xact", "xinput"];
  const [shaderToolExe, setShaderToolExe] = useState("");
  const [shaderToolSteamId, setShaderToolSteamId] = useState("");
  const [shaderToolDiscovery, setShaderToolDiscovery] = useState<ShaderCacheDiscovery | null>(null);
  const [shaderToolBusy, setShaderToolBusy] = useState(false);

  const mediaPlaybackPresets: { label: string; verbs: string[] }[] = [
    { label: "Legacy WMV", verbs: ["wmp9", "wmv9vcm", "qasf"] },
    { label: "RPG Maker", verbs: ["directshow", "quartz", "lavfilters"] },
    { label: "WMP Heavy", verbs: ["wmp11", "mf", "qasf", "lavfilters"] },
    { label: "Fallback Only", verbs: ["directshow", "quartz"] },
  ];

  const openMediaInstallPreview = (prefix: PrefixInfo, verbs: string[], sourceLabel: string) => {
    const v = verbs.filter((x) => x.trim());
    if (!v.length) return;
    setMediaInstallPreview({ prefix, verbs: v, sourceLabel });
  };

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
      alert(formatWinetricksErrorWithHints(String(e)));
    } finally {
      setToolBusy(null);
    }
  };

  const installMediaFixes = (prefix: PrefixInfo) => {
    if ((prefix.media.recommended_verbs?.length || 0) === 0) return;
    openMediaInstallPreview(prefix, prefix.media.recommended_verbs, "Recommended (detected missing components)");
  };

  const runVerb = async (prefix: PrefixInfo) => {
    setToolBusy(`verb:${prefix.path}`);
    try {
      await invoke("run_winetricks", { prefix: prefix.path, verbs: [selectedVerb] });
      alert(`Winetricks finished: ${selectedVerb}`);
      await refreshPrefixes();
    } catch (e) {
      alert(formatWinetricksErrorWithHints(String(e)));
    } finally {
      setToolBusy(null);
    }
  };

  const pickShaderToolExe = async () => {
    const sel = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Executable", extensions: ["exe"] }],
    }).catch(() => null);
    if (sel && typeof sel === "string") setShaderToolExe(sel);
  };

  const discoverShaderToolCaches = async () => {
    const exe = shaderToolExe.trim();
    if (!exe) {
      alert("Choose the game's .exe path first.");
      return;
    }
    setShaderToolBusy(true);
    try {
      const sid = shaderToolSteamId.trim() || null;
      const d = await invoke<ShaderCacheDiscovery>("discover_shader_cache_artifacts", {
        gameExePath: exe,
        steamAppId: sid,
      });
      setShaderToolDiscovery(d);
    } catch (e) {
      if (onPermissionFailure) await onPermissionFailure("discover shader cache files", exe.trim() || null, e, "Shader cache discovery failed");
      else alert("Shader cache discovery failed: " + e);
    } finally {
      setShaderToolBusy(false);
    }
  };

  const exportShaderToolBundle = async () => {
    const exe = shaderToolExe.trim();
    if (!exe) {
      alert("Choose the game's .exe path first.");
      return;
    }
    setShaderToolBusy(true);
    try {
      const sid = shaderToolSteamId.trim() || null;
      const base = exe.replace(/\\/g, "/").split("/").pop()?.replace(/\.[^.]+$/, "") || "game";
      const safe = base.replace(/[^\w\-]+/g, "_").slice(0, 80);
      const out = await save({
        defaultPath: `libmaly-shader-cache-${safe}.zip`,
        filters: [{ name: "ZIP", extensions: ["zip"] }],
      }).catch(() => null);
      if (!out || typeof out !== "string") return;
      const res = await invoke<{
        zip_path: string;
        dxvk_files_packed: number;
        steam_files_packed: number;
      }>("export_shader_cache_bundle", {
        gameExePath: exe,
        steamAppId: sid,
        outputZipPath: out,
      });
      alert(
        `Shader cache bundle saved:\n${res.zip_path}\n\nDXVK entries: ${res.dxvk_files_packed}\nSteam cache files: ${res.steam_files_packed}`,
      );
    } catch (e) {
      if (onPermissionFailure) await onPermissionFailure("export the shader cache bundle", null, e, "Shader cache export failed");
      else alert("Shader cache export failed: " + e);
    } finally {
      setShaderToolBusy(false);
    }
  };

  const importShaderToolBundle = async () => {
    const exe = shaderToolExe.trim();
    if (!exe) {
      alert("Choose the game's .exe path first.");
      return;
    }
    setShaderToolBusy(true);
    try {
      const sid = shaderToolSteamId.trim() || null;
      const zip = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "ZIP", extensions: ["zip"] }],
      }).catch(() => null);
      if (!zip || typeof zip !== "string") return;
      const msg = await invoke<string>("import_shader_cache_bundle", {
        gameExePath: exe,
        steamAppId: sid,
        zipPath: zip,
      });
      alert(msg);
      await discoverShaderToolCaches();
    } catch (e) {
      if (onPermissionFailure) await onPermissionFailure("import the shader cache bundle", null, e, "Shader cache import failed");
      else alert("Shader cache import failed: " + e);
    } finally {
      setShaderToolBusy(false);
    }
  };

  const upd = (patch: Partial<LaunchConfig>) => setCfg((p) => ({ ...p, ...patch }));

  return (
    <>
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
                    <div className="mt-2 rounded px-2.5 py-2" style={{ background: "var(--color-panel-alt)", border: "1px solid var(--color-border-subtle)" }}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-semibold" style={{ color: pfx.media.likely_video_playback_issue ? "var(--color-warning)" : "var(--color-success)" }}>
                          {pfx.media.summary}
                        </span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: pfx.media.has_media_foundation ? "var(--color-success-bg)" : "var(--color-warning-bg)", color: pfx.media.has_media_foundation ? "var(--color-success)" : "var(--color-warning)" }}>
                          MF {pfx.media.has_media_foundation ? "ok" : "missing"}
                        </span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: pfx.media.has_quartz ? "var(--color-success-bg)" : "var(--color-warning-bg)", color: pfx.media.has_quartz ? "var(--color-success)" : "var(--color-warning)" }}>
                          Quartz {pfx.media.has_quartz ? "ok" : "missing"}
                        </span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: pfx.media.has_wmp ? "var(--color-success-bg)" : "var(--color-warning-bg)", color: pfx.media.has_wmp ? "var(--color-success)" : "var(--color-warning)" }}>
                          WMP {pfx.media.has_wmp ? "ok" : "missing"}
                        </span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: pfx.media.has_lavfilters ? "var(--color-success-bg)" : "var(--color-warning-bg)", color: pfx.media.has_lavfilters ? "var(--color-success)" : "var(--color-warning)" }}>
                          LAV {pfx.media.has_lavfilters ? "ok" : "missing"}
                        </span>
                      </div>
                      {pfx.media.notes.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {pfx.media.notes.slice(0, 2).map((note) => (
                            <p key={note} className="text-[10px] leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
                              {note}
                            </p>
                          ))}
                        </div>
                      )}
                      {pfx.media.recommended_verbs.length > 0 && (
                        <div className="mt-2 flex items-center gap-2 flex-wrap">
                          <span className="text-[9px]" style={{ color: "var(--color-text-dim)" }}>
                            Suggested fixes:
                          </span>
                          {pfx.media.recommended_verbs.map((verb) => (
                            <span key={verb} className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: "var(--color-bg-deep)", color: "var(--color-accent-soft)", border: "1px solid var(--color-border-subtle)" }}>
                              {verb}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="mt-2 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          onClick={() => installGraphics(pfx)}
                          disabled={toolBusy === `gfx:${pfx.path}` || (pfx.has_dxvk && pfx.has_vkd3d)}
                          className="px-2.5 py-1 rounded text-[10px] disabled:opacity-40"
                          style={{ background: "var(--color-panel-3)", color: "var(--color-accent-soft)" }}
                        >
                          Install DXVK/VKD3D
                        </button>
                        <button
                          onClick={() => installMediaFixes(pfx)}
                          disabled={!!mediaInstallPreview || pfx.media.recommended_verbs.length === 0}
                          className="px-2.5 py-1 rounded text-[10px] disabled:opacity-40"
                          style={{ background: "var(--color-panel-3)", color: "var(--color-warning)" }}
                          title="Install recommended media/video playback fixes via winetricks"
                        >
                          Install media fixes
                        </button>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 pt-1" style={{ borderTop: "1px solid var(--color-border-subtle)" }}>
                        <span className="text-[9px] shrink-0" style={{ color: "var(--color-text-dim)" }}>Media presets:</span>
                        {mediaPlaybackPresets.map((preset) => (
                          <button
                            key={preset.label}
                            onClick={() => openMediaInstallPreview(pfx, preset.verbs, `Media preset: ${preset.label}`)}
                            disabled={!!mediaInstallPreview}
                            className="px-1.5 py-0.5 rounded text-[9px] disabled:opacity-40"
                            style={{ background: "var(--color-bg-code)", color: "var(--color-accent-soft)", border: "1px solid var(--color-border-subtle)" }}
                            title={`Preview / install: ${preset.verbs.join(", ")}`}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[9px] shrink-0" style={{ color: "var(--color-text-dim)" }}>Compatibility:</span>
                        {WINE_COMPATIBILITY_PRESETS.map((preset) => (
                          <button
                            key={preset.label}
                            onClick={() => openMediaInstallPreview(pfx, preset.verbs, `${preset.title}`)}
                            disabled={!!mediaInstallPreview}
                            className="px-1.5 py-0.5 rounded text-[9px] disabled:opacity-40"
                            style={{ background: "var(--color-panel-2)", color: "var(--color-text-muted)", border: "1px solid var(--color-border-subtle)" }}
                            title={`${preset.title} — ${preset.verbs.join(", ")}`}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
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
                  </div>
                ))}
              </div>
            </div>

            {platform !== "windows" && (
              <div className="rounded-lg p-3 space-y-2.5" style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border)" }}>
                <p className="text-xs font-semibold" style={{ color: "var(--color-text-muted)" }}>Shader cache (DXVK / Steam)</p>
                <p className="text-[10px] leading-relaxed" style={{ color: "var(--color-text-dim)" }}>
                  Point at a Windows game executable. Optional Steam App ID adds Fossilize paths to discover and to the portable ZIP.
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={shaderToolExe}
                    onInput={(e) => setShaderToolExe((e.target as HTMLInputElement).value)}
                    placeholder="Path to game.exe"
                    className="flex-1 px-2 py-1.5 rounded text-[10px] font-mono outline-none"
                    style={{ background: "var(--color-bg-code)", color: "var(--color-text)", border: "1px solid var(--color-panel-3)" }}
                  />
                  <button
                    type="button"
                    onClick={() => void pickShaderToolExe()}
                    className="px-2.5 py-1.5 rounded text-[10px] shrink-0"
                    style={{ background: "var(--color-panel-3)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}
                  >
                    Browse…
                  </button>
                </div>
                <input
                  type="text"
                  value={shaderToolSteamId}
                  onInput={(e) => setShaderToolSteamId((e.target as HTMLInputElement).value)}
                  placeholder="Steam App ID (optional)"
                  className="w-full px-2 py-1.5 rounded text-[10px] font-mono outline-none"
                  style={{ background: "var(--color-bg-code)", color: "var(--color-text)", border: "1px solid var(--color-panel-3)" }}
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void discoverShaderToolCaches()}
                    disabled={shaderToolBusy}
                    className="px-2.5 py-1 rounded text-[10px] disabled:opacity-45"
                    style={{ background: "var(--color-accent-dark)", color: "var(--color-white)" }}
                  >
                    {shaderToolBusy ? "Working…" : "Discover"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void exportShaderToolBundle()}
                    disabled={shaderToolBusy}
                    className="px-2.5 py-1 rounded text-[10px] disabled:opacity-45"
                    style={{ background: "var(--color-panel-3)", color: "var(--color-accent-soft)" }}
                  >
                    Export ZIP
                  </button>
                  <button
                    type="button"
                    onClick={() => void importShaderToolBundle()}
                    disabled={shaderToolBusy}
                    className="px-2.5 py-1 rounded text-[10px] disabled:opacity-45"
                    style={{ background: "var(--color-panel-3)", color: "var(--color-text)" }}
                  >
                    Import ZIP
                  </button>
                </div>
                {shaderToolDiscovery && (
                  <ul className="text-[10px] space-y-0.5 pl-3.5 list-disc" style={{ color: "var(--color-text-muted)" }}>
                    {buildShaderWarmupLines({
                      wineActive: true,
                      discovery: shaderToolDiscovery,
                    }).map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
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
    {mediaInstallPreview !== null && (
      <MediaInstallPreviewModal
        isOpen
        onClose={() => setMediaInstallPreview(null)}
        prefixName={mediaInstallPreview.prefix.name}
        prefixPath={mediaInstallPreview.prefix.path}
        verbs={mediaInstallPreview.verbs}
        sourceLabel={mediaInstallPreview.sourceLabel}
        beforeMedia={mediaInstallPreview.prefix.media}
        onFinished={refreshPrefixes}
      />
    )}
    </>
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
  onSave: (note: string, mood: SessionMood) => void;
  onDismiss: () => void;
}) {
  const [note, setNote] = useState(session.note);
  const [mood, setMood] = useState<SessionMood>(session.mood || "chill");
  const moodStyles: Record<SessionMood, { label: string; color: string; bg: string }> = {
    hype: { label: "hype", color: "var(--color-warning)", bg: "var(--color-warning-bg)" },
    chill: { label: "chill", color: "var(--color-success)", bg: "var(--color-success-bg)" },
    chaos: { label: "chaos", color: "var(--color-danger)", bg: "var(--color-danger-bg)" },
  };
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
          <p className="text-[10px] mb-1.5" style={{ color: "var(--color-text-muted)" }}>Pick a session mood</p>
          <div className="flex gap-2 mb-3">
            {(Object.keys(moodStyles) as SessionMood[]).map((key) => {
              const m = moodStyles[key];
              const isActive = mood === key;
              return (
                <button
                  key={key}
                  onClick={() => setMood(key)}
                  className="px-2.5 py-1 rounded-full text-[10px] font-semibold"
                  style={{
                    background: isActive ? m.bg : "var(--color-panel-2)",
                    color: isActive ? m.color : "var(--color-text-muted)",
                    border: `1px solid ${isActive ? m.color : "var(--color-border)"}`,
                  }}
                >
                  {m.label}
                </button>
              );
            })}
          </div>
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
            <button onClick={() => onSave(note.trim(), mood)}
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
  onImport: (matched: { path: string; addSecs: number }[]) => void | Promise<void>;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [steamEntries, setSteamEntries] = useState<SteamEntry[]>([]);
  const [error, setError] = useState("");
  const [matched, setMatched] = useState<{ path: string; name: string; steamName: string; addSecs: number; checked: boolean }[]>([]);

  const gamesBySteamAppId = useMemo(() => new Map(
    Object.entries(customizations)
      .map(([path, customization]) => [customization.steamAppId?.trim(), path] as const)
      .filter((entry): entry is [string, string] => !!entry[0]),
  ), [customizations]);

  useEffect(() => {
    invoke<SteamEntry[]>("import_steam_playtime")
      .then((entries) => {
        setSteamEntries(entries);
        // Try to fuzzy-match by name
        const hits: typeof matched = [];
        for (const e of entries) {
          const byAppIdPath = gamesBySteamAppId.get(e.app_id.trim());
          if (byAppIdPath) {
            const game = games.find((entry) => entry.path === byAppIdPath);
            if (game) {
              hits.push({
                path: game.path,
                name: customizations[game.path]?.displayName ?? metadata[game.path]?.title ?? game.name,
                steamName: e.name,
                addSecs: e.played_minutes * 60,
                checked: true,
              });
              continue;
            }
          }
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
  }, [customizations, games, gamesBySteamAppId, metadata]);

  const toggle = (path: string) =>
    setMatched(prev => prev.map(m => m.path === path ? { ...m, checked: !m.checked } : m));

  const handleApply = async () => {
    await onImport(matched.filter(m => m.checked).map(m => ({ path: m.path, addSecs: m.addSecs })));
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
            <h2 className="font-bold text-base" style={{ color: "var(--color-white)" }}>Import Steam Playtime</h2>
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>Read playtime from Steam userdata/localconfig.vdf</p>
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
              No Steam playtime data was found. Make sure Steam is installed and that this Steam account has recorded playtime for at least one launched title.
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

function SteamLibraryImportModal({ games, customizations, onImport, onClose }: {
  games: Game[];
  customizations: Record<string, GameCustomization>;
  onImport: (entries: SteamOwnedGame[]) => void | Promise<void>;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<SteamOwnedGame[]>([]);
  const [error, setError] = useState("");
  const [checkedKeys, setCheckedKeys] = useState<Record<string, boolean>>({});
  const [steamApiKey, setSteamApiKey] = useState(() => loadCache(SK_STEAM_WEB_API_KEY, ""));
  const [steamProfileRef, setSteamProfileRef] = useState(() => loadCache(SK_STEAM_PROFILE_REF, ""));
  const [fetchingOwned, setFetchingOwned] = useState(false);

  const existingPaths = useMemo(
    () => new Set(games.map((g) => normalizePathForMatch(g.path))),
    [games],
  );
  const existingAppIds = useMemo(
    () => new Set(
      Object.values(customizations)
        .map((value) => value.steamAppId?.trim())
        .filter((value): value is string => !!value),
    ),
    [customizations],
  );

  const mergeEntries = useCallback((incoming: SteamOwnedGame[]) => {
    setEntries((prev) => {
      const byAppId = new Map(prev.map((entry) => [entry.app_id, entry]));
      for (const entry of incoming) {
        const previous = byAppId.get(entry.app_id);
        byAppId.set(entry.app_id, {
          ...previous,
          ...entry,
          name: entry.name || previous?.name || `App ${entry.app_id}`,
          played_minutes: entry.played_minutes ?? previous?.played_minutes ?? 0,
          installed: entry.installed || previous?.installed || false,
          install_dir: entry.install_dir ?? previous?.install_dir ?? null,
          library_dir: entry.library_dir ?? previous?.library_dir ?? null,
          manifest_path: entry.manifest_path ?? previous?.manifest_path ?? null,
          exe: entry.exe ?? previous?.exe ?? null,
        });
      }
      return Array.from(byAppId.values()).sort((a, b) => a.name.localeCompare(b.name));
    });
  }, []);

  useEffect(() => {
    invoke<SteamLibraryEntry[]>("import_steam_library")
      .then((found) => {
        const mapped = found.map<SteamOwnedGame>((entry) => ({
          app_id: entry.app_id,
          name: entry.name,
          played_minutes: 0,
          installed: true,
          install_dir: entry.install_dir,
          library_dir: entry.library_dir,
          manifest_path: entry.manifest_path,
          exe: entry.exe,
        }));
        mergeEntries(mapped);
        const nextChecked: Record<string, boolean> = {};
        for (const entry of mapped) {
          const selectionKey = entry.exe ? normalizePathForMatch(entry.exe) : `appid:${entry.app_id}`;
          const existsByPath = !!entry.exe && existingPaths.has(normalizePathForMatch(entry.exe));
          if (!existsByPath && !existingAppIds.has(entry.app_id)) {
            nextChecked[selectionKey] = true;
          }
        }
        setCheckedKeys((prev) => ({ ...nextChecked, ...prev }));
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [existingAppIds, existingPaths, mergeEntries]);

  const fetchOwnedLibrary = async () => {
    const trimmedKey = steamApiKey.trim();
    const trimmedProfile = steamProfileRef.trim();
    if (!trimmedKey || !trimmedProfile) {
      setError("Enter both a Steam Web API key and a SteamID / profile URL first.");
      return;
    }
    setFetchingOwned(true);
    setError("");
    try {
      const owned = await invoke<SteamOwnedGame[]>("fetch_steam_owned_games", {
        apiKey: trimmedKey,
        profileRef: trimmedProfile,
      });
      saveCache(SK_STEAM_WEB_API_KEY, trimmedKey);
      saveCache(SK_STEAM_PROFILE_REF, trimmedProfile);
      mergeEntries(owned);
      setCheckedKeys((prev) => {
        const next = { ...prev };
        for (const entry of owned) {
          const selectionKey = entry.exe ? normalizePathForMatch(entry.exe) : `appid:${entry.app_id}`;
          const existsByPath = !!entry.exe && existingPaths.has(normalizePathForMatch(entry.exe));
          if (!existsByPath && !existingAppIds.has(entry.app_id) && !(selectionKey in next)) {
            next[selectionKey] = true;
          }
        }
        return next;
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setFetchingOwned(false);
    }
  };

  const selected = entries.filter((entry) => {
    const selectionKey = entry.exe ? normalizePathForMatch(entry.exe) : `appid:${entry.app_id}`;
    return !!checkedKeys[selectionKey];
  });

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.82)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rounded-xl shadow-2xl w-[760px] max-h-[82vh] flex flex-col"
        style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
        <div className="flex items-center gap-3 px-6 pt-5 pb-4 border-b flex-shrink-0" style={{ borderColor: "var(--color-border-card)" }}>
          <div className="w-9 h-9 rounded flex items-center justify-center" style={{ background: "var(--color-panel-2)" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="var(--color-accent)">
              <path d="M12 2C6.48 2 2 6.48 2 12l5.84 2.41c.53-.32 1.14-.51 1.8-.51.07 0 .14 0 .21.01L12 10.5V10.42c0-2.52 2.04-4.58 4.56-4.58 2.52 0 4.56 2.04 4.56 4.58 0 2.52-2.04 4.56-4.56 4.56h-.1l-3.5 2.53c0 .06.01.12.01.18 0 1.89-1.53 3.42-3.42 3.42-1.67 0-3.07-1.2-3.36-2.79L2.17 14C3.14 18.55 7.15 22 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2z" />
            </svg>
          </div>
          <div>
            <h2 className="font-bold text-base" style={{ color: "var(--color-white)" }}>Import Steam Library & Owned Games</h2>
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              Import installed Steam games from local manifests, and optionally fetch your owned Steam library via Web API for uninstalled titles.
            </p>
          </div>
          <button onClick={onClose} className="ml-auto text-xl" style={{ color: "var(--color-text-dim)" }}>✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4"
          style={{ scrollbarWidth: "thin", scrollbarColor: "var(--color-border) transparent" }}>
          <div className="mb-4 rounded-lg p-3 space-y-3" style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border)" }}>
            <div>
              <div className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>Owned Library via Steam Web API</div>
              <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
                Optional: enter a Steam Web API key plus your SteamID64, vanity name, or Steam Community profile URL to import titles you own but have not installed locally yet.
              </p>
            </div>
            <input
              type="password"
              value={steamApiKey}
              onChange={(e) => setSteamApiKey((e.target as HTMLInputElement).value)}
              placeholder="Steam Web API key"
              className="w-full px-3 py-2 rounded text-sm outline-none"
              style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
            />
            <input
              type="text"
              value={steamProfileRef}
              onChange={(e) => setSteamProfileRef((e.target as HTMLInputElement).value)}
              placeholder="SteamID64, vanity name, or https://steamcommunity.com/id/..."
              className="w-full px-3 py-2 rounded text-sm outline-none"
              style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
            />
            <button
              onClick={() => { void fetchOwnedLibrary(); }}
              disabled={fetchingOwned}
              className="w-full py-2 rounded-lg text-sm font-medium disabled:opacity-50"
              style={{ background: "#16263c", color: "#9ed2ff", border: "1px solid #2f4f76" }}
            >
              {fetchingOwned ? "Loading owned Steam library..." : "Load Owned Steam Library"}
            </button>
          </div>

          {loading && (
            <div className="flex items-center justify-center h-24 gap-3">
              <div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--color-accent)" }} />
              <span className="text-sm" style={{ color: "var(--color-text-muted)" }}>Reading Steam manifests…</span>
            </div>
          )}
          {error && <p className="text-sm" style={{ color: "var(--color-danger)" }}>{error}</p>}
          {!loading && !error && entries.length === 0 && (
            <p className="text-sm text-center py-8" style={{ color: "var(--color-text-muted)" }}>
              No Steam titles found yet. Local manifests will appear automatically, or you can fetch your owned library above.
            </p>
          )}
          {!loading && !error && entries.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs mb-2" style={{ color: "var(--color-text-muted)" }}>
                {entries.length} Steam title{entries.length !== 1 ? "s" : ""} found.
              </p>
              {entries.map((entry) => {
                const selectionKey = entry.exe ? normalizePathForMatch(entry.exe) : `appid:${entry.app_id}`;
                const exists = (!!entry.exe && existingPaths.has(normalizePathForMatch(entry.exe))) || existingAppIds.has(entry.app_id);
                return (
                  <label key={entry.app_id} className="flex items-start gap-3 rounded-lg px-3 py-2 cursor-pointer"
                    style={{ background: "var(--color-panel-2)", opacity: exists ? 0.65 : 1 }}>
                    <input
                      type="checkbox"
                      checked={!!checkedKeys[selectionKey]}
                      disabled={exists}
                      onChange={() => setCheckedKeys((prev) => ({ ...prev, [selectionKey]: !prev[selectionKey] }))}
                      className="mt-1 rounded"
                      style={{ accentColor: "var(--color-accent)" }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate" style={{ color: "var(--color-text)" }}>{entry.name}</p>
                      <p className="text-[10px] break-all" style={{ color: "var(--color-text-dim)" }}>
                        AppID {entry.app_id}{entry.exe ? ` · ${entry.exe}` : " · not installed locally"}
                      </p>
                      <p className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                        {exists
                          ? "Already in your library"
                          : entry.installed
                            ? "Will be imported with Steam launch bridge enabled"
                            : "Will be imported as an uninstalled Steam title with an Install via Steam action"}
                      </p>
                      {entry.played_minutes > 0 && (
                        <p className="text-[10px]" style={{ color: "var(--color-text-dim)" }}>
                          Steam playtime: {formatTime(entry.played_minutes * 60)}
                        </p>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {!loading && entries.length > 0 && (
          <div className="flex gap-3 justify-end px-6 py-4 border-t flex-shrink-0" style={{ borderColor: "var(--color-border-card)" }}>
            <button onClick={onClose} className="px-4 py-2 rounded text-sm"
              style={{ background: "transparent", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>Cancel</button>
            <button
              onClick={async () => {
                await onImport(selected);
                onClose();
              }}
              disabled={selected.length === 0}
              className="px-5 py-2 rounded text-sm font-semibold disabled:opacity-50"
              style={{ background: "#1a3050", color: "var(--color-accent)", border: "1px solid #2a5080" }}
            >
              Import {selected.length} Steam title{selected.length !== 1 ? "s" : ""}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function EpicLegendaryImportModal({ games, customizations, onImport, onClose }: {
  games: Game[];
  customizations: Record<string, GameCustomization>;
  onImport: (entries: EpicOwnedGame[]) => void | Promise<void>;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<EpicLegendaryStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [authing, setAuthing] = useState(false);
  const [entries, setEntries] = useState<EpicOwnedGame[]>([]);
  const [checkedKeys, setCheckedKeys] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");

  const existingPaths = useMemo(
    () => new Set(games.map((g) => normalizePathForMatch(g.path))),
    [games],
  );
  const existingAppNames = useMemo(
    () => new Set(
      Object.values(customizations)
        .map((value) => value.epicAppName?.trim().toLowerCase())
        .filter((value): value is string => !!value),
    ),
    [customizations],
  );

  const loadLibrary = useCallback(async () => {
    setRefreshing(true);
    setError("");
    try {
      const nextStatus = await invoke<EpicLegendaryStatus>("epic_legendary_status");
      setStatus(nextStatus);
      if (!nextStatus.available || !nextStatus.authenticated) {
        setEntries([]);
        if (nextStatus.lastError) setError(nextStatus.lastError);
        return;
      }

      const owned = await invoke<EpicOwnedGame[]>("fetch_epic_owned_games");
      setEntries(owned);
      setCheckedKeys((prev) => {
        const next = { ...prev };
        for (const entry of owned) {
          const selectionKey = entry.exe ? normalizePathForMatch(entry.exe) : `epic:${entry.app_name.toLowerCase()}`;
          const existsByPath = !!entry.exe && existingPaths.has(normalizePathForMatch(entry.exe));
          if (!existsByPath && !existingAppNames.has(entry.app_name.toLowerCase()) && !(selectionKey in next)) {
            next[selectionKey] = true;
          }
        }
        return next;
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [existingAppNames, existingPaths]);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  const selected = entries.filter((entry) => {
    const selectionKey = entry.exe ? normalizePathForMatch(entry.exe) : `epic:${entry.app_name.toLowerCase()}`;
    return !!checkedKeys[selectionKey];
  });

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.82)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rounded-xl shadow-2xl w-[780px] max-h-[84vh] flex flex-col"
        style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
        <div className="flex items-center gap-3 px-6 pt-5 pb-4 border-b flex-shrink-0" style={{ borderColor: "var(--color-border-card)" }}>
          <div className="w-9 h-9 rounded flex items-center justify-center" style={{ background: "#1d1f27" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f4f5f7" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3h8l3 4v12l-7 2-7-2V7l3-4z" />
              <path d="M9.5 8h5" />
              <path d="M9.5 12h5" />
            </svg>
          </div>
          <div>
            <h2 className="font-bold text-base" style={{ color: "var(--color-white)" }}>Import Epic Games Store Library</h2>
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              Use Legendary to read your Epic ownership list, import installed games, and keep uninstalled titles as Legendary-backed placeholders.
            </p>
          </div>
          <button onClick={onClose} className="ml-auto text-xl" style={{ color: "var(--color-text-dim)" }}>✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4"
          style={{ scrollbarWidth: "thin", scrollbarColor: "var(--color-border) transparent" }}>
          <div className="mb-4 rounded-lg p-3 space-y-3" style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border)" }}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>Legendary Bridge</div>
                <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
                  Legendary is the bridge Libmaly uses for Epic ownership sync and authenticated launch. Installed entries get a direct Legendary launch bridge; uninstalled entries stay available as placeholders.
                </p>
              </div>
              <button
                onClick={() => { void loadLibrary(); }}
                disabled={refreshing}
                className="px-3 py-2 rounded text-xs font-semibold disabled:opacity-50"
                style={{ background: "#222936", color: "#bfd2ff", border: "1px solid #46506a" }}
              >
                {refreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
            <div className="rounded-lg px-3 py-2 text-xs" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
              <div style={{ color: "var(--color-text)" }}>
                Status: {status?.available ? (status.authenticated ? `Signed in${status.displayName ? ` as ${status.displayName}` : ""}` : "Legendary found, login required") : "Legendary not found"}
              </div>
              {status?.version && <div style={{ color: "var(--color-text-dim)" }}>Version: {status.version}</div>}
              {status?.executablePath && (
                <div className="break-all" style={{ color: "var(--color-text-dim)" }}>Executable: {status.executablePath}</div>
              )}
            </div>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={async () => {
                  setAuthing(true);
                  setError("");
                  try {
                    await invoke("epic_legendary_auth");
                  } catch (e) {
                    setError(String(e));
                  } finally {
                    setAuthing(false);
                  }
                }}
                disabled={authing}
                className="px-3 py-2 rounded text-xs font-semibold disabled:opacity-50"
                style={{ background: "#2d2532", color: "#ffc2d5", border: "1px solid #7a4a5f" }}
              >
                {authing ? "Opening login..." : "Sign in with Legendary"}
              </button>
              <button
                onClick={() => { void openUrl(status?.installUrl || "https://github.com/derrod/legendary/releases/latest"); }}
                className="px-3 py-2 rounded text-xs font-semibold"
                style={{ background: "transparent", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}
              >
                Install Legendary
              </button>
            </div>
          </div>

          {loading && (
            <div className="flex items-center justify-center h-24 gap-3">
              <div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--color-accent)" }} />
              <span className="text-sm" style={{ color: "var(--color-text-muted)" }}>Checking Legendary and loading Epic library…</span>
            </div>
          )}
          {error && <p className="text-sm" style={{ color: "var(--color-danger)" }}>{error}</p>}
          {!loading && !error && entries.length === 0 && status?.authenticated && (
            <p className="text-sm text-center py-8" style={{ color: "var(--color-text-muted)" }}>
              No Epic titles were returned by Legendary yet.
            </p>
          )}
          {!loading && entries.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs mb-2" style={{ color: "var(--color-text-muted)" }}>
                {entries.length} Epic title{entries.length !== 1 ? "s" : ""} found.
              </p>
              {entries.map((entry) => {
                const selectionKey = entry.exe ? normalizePathForMatch(entry.exe) : `epic:${entry.app_name.toLowerCase()}`;
                const exists = (!!entry.exe && existingPaths.has(normalizePathForMatch(entry.exe))) || existingAppNames.has(entry.app_name.toLowerCase());
                return (
                  <label key={entry.app_name} className="flex items-start gap-3 rounded-lg px-3 py-2 cursor-pointer"
                    style={{ background: "var(--color-panel-2)", opacity: exists ? 0.65 : 1 }}>
                    <input
                      type="checkbox"
                      checked={!!checkedKeys[selectionKey]}
                      disabled={exists}
                      onChange={() => setCheckedKeys((prev) => ({ ...prev, [selectionKey]: !prev[selectionKey] }))}
                      className="mt-1 rounded"
                      style={{ accentColor: "var(--color-accent)" }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate" style={{ color: "var(--color-text)" }}>{entry.title}</p>
                      <p className="text-[10px] break-all" style={{ color: "var(--color-text-dim)" }}>
                        {entry.app_name}{entry.exe ? ` · ${entry.exe}` : " · not installed locally"}
                      </p>
                      <p className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                        {exists
                          ? "Already in your library"
                          : entry.installed
                            ? "Will be imported with Legendary launch enabled"
                            : "Will be imported as an uninstalled Epic title with an Install via Legendary action"}
                      </p>
                      {entry.version && (
                        <p className="text-[10px]" style={{ color: "var(--color-text-dim)" }}>
                          Version: {entry.version}
                        </p>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {!loading && entries.length > 0 && (
          <div className="flex gap-3 justify-end px-6 py-4 border-t flex-shrink-0" style={{ borderColor: "var(--color-border-card)" }}>
            <button onClick={onClose} className="px-4 py-2 rounded text-sm"
              style={{ background: "transparent", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>Cancel</button>
            <button
              onClick={async () => {
                await onImport(selected);
                onClose();
              }}
              disabled={selected.length === 0}
              className="px-5 py-2 rounded text-sm font-semibold disabled:opacity-50"
              style={{ background: "#202630", color: "#f4f5f7", border: "1px solid #505766" }}
            >
              Import {selected.length} Epic title{selected.length !== 1 ? "s" : ""}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ItchImportModal({
  games,
  customizations,
  onImportInstalled,
  onClose,
}: {
  games: Game[];
  customizations: Record<string, GameCustomization>;
  onImportInstalled: (result: ItchInstallResult) => Promise<void>;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<ItchButlerStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [library, setLibrary] = useState<ItchOwnedLibrary | null>(null);
  const [updatesByCaveId, setUpdatesByCaveId] = useState<Record<string, ItchGameUpdate>>({});
  const [warnings, setWarnings] = useState<string[]>([]);
  const [installRoot, setInstallRoot] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  const importedCaveIds = useMemo(
    () => new Set(Object.values(customizations).map((custom) => custom.itchCaveId).filter((value): value is string => !!value)),
    [customizations],
  );
  const existingPaths = useMemo(
    () => new Set(games.map((game) => normalizePathForMatch(game.path))),
    [games],
  );

  const refreshLibrary = useCallback(async (forceFresh = false, nextApiKey?: string) => {
    const key = (nextApiKey ?? apiKey).trim();
    if (!key) {
      setError("Enter an itch.io API key first.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const nextLibrary = await invoke<ItchOwnedLibrary>("itch_butler_list_owned_games", {
        apiKey: key,
        search: null,
        fresh: forceFresh,
      });
      setLibrary(nextLibrary);
      if (!installRoot.trim() && nextLibrary.installLocations.length > 0) {
        setInstallRoot(nextLibrary.installLocations[0].path);
      }
      await invoke("set_api_key", { provider: "itch_io", key });
      if (nextLibrary.records.some((record) => record.caveIds.length > 0)) {
        const updateResult = await invoke<ItchUpdateCheckResult>("itch_butler_check_updates", {
          apiKey: key,
          caveIds: nextLibrary.records.flatMap((record) => record.caveIds),
        });
        setWarnings(updateResult.warnings);
        setUpdatesByCaveId(Object.fromEntries(updateResult.updates.map((update) => [update.caveId, update])));
      } else {
        setWarnings([]);
        setUpdatesByCaveId({});
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [apiKey, installRoot]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [butlerStatus, savedKey] = await Promise.all([
          invoke<ItchButlerStatus>("itch_butler_status"),
          invoke<string>("get_api_key", { provider: "itch_io" }).catch(() => ""),
        ]);
        if (cancelled) return;
        setStatus(butlerStatus);
        setApiKey(savedKey || "");
        if (butlerStatus.available && savedKey) {
          await refreshLibrary(false, savedKey);
        } else {
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(String(e));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshLibrary]);

  const filteredRecords = useMemo(() => {
    const lower = query.trim().toLowerCase();
    if (!library) return [];
    if (!lower) return library.records;
    return library.records.filter((record) => record.title.toLowerCase().includes(lower));
  }, [library, query]);

  const handlePickInstallRoot = async () => {
    const picked = await open({ directory: true, multiple: false }).catch(() => null);
    if (picked && typeof picked === "string") setInstallRoot(picked);
  };

  const handleInstall = async (entry: ItchLibraryEntry) => {
    const key = apiKey.trim();
    const target = installRoot.trim();
    if (!key) {
      setError("Enter an itch.io API key first.");
      return;
    }
    if (!target) {
      setError("Choose an install folder first.");
      return;
    }
    setBusyKey(`install:${entry.id}`);
    setError("");
    try {
      const result = await invoke<ItchInstallResult>("itch_butler_install_game", {
        apiKey: key,
        gameId: entry.id,
        installPath: target,
      });
      await onImportInstalled(result);
      await refreshLibrary(true, key);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyKey(null);
    }
  };

  const handleImportInstalled = async (entry: ItchLibraryEntry) => {
    if (!library || !entry.primaryCaveId || entry.installFolders.length === 0) {
      return;
    }
    const cave = library.caves.find((item) => item.id === entry.primaryCaveId);
    setBusyKey(`import:${entry.primaryCaveId}`);
    setError("");
    try {
      await onImportInstalled({
        gameId: entry.id,
        title: entry.title,
        caveId: entry.primaryCaveId,
        installFolder: entry.installFolders[0],
        uploadId: cave?.upload?.id ?? 0,
        buildId: cave?.build?.id ?? null,
      });
      await refreshLibrary(false, apiKey);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyKey(null);
    }
  };

  const handleUpdate = async (update: ItchGameUpdate) => {
    const choice = [...update.choices].sort((a, b) => b.confidence - a.confidence)[0];
    if (!choice) {
      setError(`No update choice is available for ${update.game.title}.`);
      return;
    }
    setBusyKey(`update:${update.caveId}`);
    setError("");
    try {
      const result = await invoke<ItchInstallResult>("itch_butler_apply_update", {
        apiKey,
        caveId: update.caveId,
        uploadId: choice.upload.id,
        buildId: choice.build?.id ?? choice.upload.build?.id ?? null,
      });
      await onImportInstalled(result);
      await refreshLibrary(true, apiKey);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.82)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="rounded-xl shadow-2xl w-[860px] max-h-[86vh] flex flex-col"
        style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
        <div className="flex items-center gap-3 px-6 pt-5 pb-4 border-b flex-shrink-0" style={{ borderColor: "var(--color-border-card)" }}>
          <div className="w-9 h-9 rounded flex items-center justify-center" style={{ background: "#2b2316", color: "#ffcf8d" }}>
            io
          </div>
          <div>
            <h2 className="font-bold text-base" style={{ color: "var(--color-white)" }}>itch.io Butler</h2>
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              Browse owned purchases, install them with butler, and apply updates without leaving Libmaly.
            </p>
          </div>
          <button onClick={onClose} className="ml-auto text-xl" style={{ color: "var(--color-text-dim)" }}>✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4"
          style={{ scrollbarWidth: "thin", scrollbarColor: "var(--color-border) transparent" }}>
          <div className="rounded-lg p-4 space-y-3" style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border)" }}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>Butler status</div>
                <p className="mt-1 text-sm" style={{ color: status?.available ? "#9fe0a9" : "#ffb0a6" }}>
                  {status?.available ? `Detected ${status.version || "butler"}` : "butler was not found on this system"}
                </p>
                {status?.executablePath && (
                  <p className="text-[10px] break-all" style={{ color: "var(--color-text-dim)" }}>{status.executablePath}</p>
                )}
              </div>
              {!status?.available && (
                <button
                  onClick={() => { void openUrl(status?.installUrl || "https://itch.io/app"); }}
                  className="px-4 py-2 rounded text-sm font-medium"
                  style={{ background: "#3a2516", color: "#ffcf8d", border: "1px solid #7b5a25" }}
                >
                  Get itch app / butler
                </button>
              )}
            </div>

            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey((e.target as HTMLInputElement).value)}
              placeholder="itch.io API key"
              className="w-full px-3 py-2 rounded text-sm outline-none"
              style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
            />

            <div className="grid grid-cols-[1fr_auto_auto] gap-2">
              <input
                type="text"
                value={installRoot}
                onChange={(e) => setInstallRoot((e.target as HTMLInputElement).value)}
                placeholder="Default install folder for itch titles"
                className="w-full px-3 py-2 rounded text-sm outline-none"
                style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
              />
              <button
                onClick={() => { void handlePickInstallRoot(); }}
                className="px-4 py-2 rounded text-sm"
                style={{ background: "transparent", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}
              >
                Browse…
              </button>
              <button
                onClick={() => { void refreshLibrary(true); }}
                disabled={!status?.available || loading}
                className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
                style={{ background: "#2b2316", color: "#ffcf8d", border: "1px solid #7b5a25" }}
              >
                {loading ? "Loading..." : "Load Library"}
              </button>
            </div>

            {library && (
              <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                Signed in as {library.profile.user.displayName || library.profile.user.username}. Owned titles: {library.records.length}. Installed caves: {library.caves.length}.
              </p>
            )}
            {warnings.length > 0 && (
              <p className="text-xs" style={{ color: "#ffd89a" }}>{warnings[0]}</p>
            )}
            {error && <p className="text-sm" style={{ color: "var(--color-danger)" }}>{error}</p>}
          </div>

          {status?.available && library && (
            <>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery((e.target as HTMLInputElement).value)}
                placeholder="Filter owned itch titles"
                className="w-full px-3 py-2 rounded text-sm outline-none"
                style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
              />

              <div className="space-y-2">
                {filteredRecords.map((entry) => {
                  const update = entry.primaryCaveId ? updatesByCaveId[entry.primaryCaveId] : undefined;
                  const imported = !!entry.primaryCaveId && importedCaveIds.has(entry.primaryCaveId);
                  const importFolder = entry.installFolders[0] || null;
                  const alreadyExistsByPath = importFolder
                    ? Array.from(existingPaths).some((path) => path.startsWith(normalizePathForMatch(importFolder)))
                    : false;
                  return (
                    <div key={entry.id} className="rounded-lg p-3 flex gap-3 items-start"
                      style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border-soft)" }}>
                      {entry.cover ? (
                        <img src={entry.cover} alt={entry.title} className="w-12 h-12 rounded object-cover flex-shrink-0" />
                      ) : (
                        <div className="w-12 h-12 rounded flex items-center justify-center flex-shrink-0"
                          style={{ background: "var(--color-panel-3)", color: "var(--color-text-dim)" }}>
                          io
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium truncate" style={{ color: "var(--color-text)" }}>{entry.title}</p>
                          {entry.installed && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--color-success-bg)", color: "var(--color-success)" }}>
                              Installed
                            </span>
                          )}
                          {imported && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "#1b2f42", color: "#9ed2ff" }}>
                              Imported
                            </span>
                          )}
                          {update && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "#3f2f12", color: "#ffd483" }}>
                              Update available
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] mt-1" style={{ color: "var(--color-text-dim)" }}>
                          Game #{entry.id}{entry.installedAt ? ` · installed ${new Date(entry.installedAt).toLocaleString()}` : ""}
                        </p>
                        {importFolder && (
                          <p className="text-[10px] mt-1 break-all" style={{ color: "var(--color-text-muted)" }}>{importFolder}</p>
                        )}
                      </div>
                      <div className="flex flex-col gap-2 items-stretch min-w-[132px]">
                        <button
                          onClick={() => { void handleInstall(entry); }}
                          disabled={busyKey !== null || !status.available}
                          className="px-3 py-2 rounded text-xs font-semibold disabled:opacity-50"
                          style={{ background: "#2b2316", color: "#ffcf8d", border: "1px solid #7b5a25" }}
                        >
                          {busyKey === `install:${entry.id}` ? "Installing..." : entry.installed ? "Reinstall" : "Install"}
                        </button>
                        <button
                          onClick={() => { void handleImportInstalled(entry); }}
                          disabled={!entry.installed || !entry.primaryCaveId || busyKey !== null}
                          className="px-3 py-2 rounded text-xs disabled:opacity-50"
                          style={{ background: "transparent", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}
                        >
                          {busyKey === `import:${entry.primaryCaveId}` ? "Importing..." : imported ? "Re-import" : alreadyExistsByPath ? "Refresh Link" : "Import to Library"}
                        </button>
                        <button
                          onClick={() => { if (update) void handleUpdate(update); }}
                          disabled={!update || busyKey !== null}
                          className="px-3 py-2 rounded text-xs disabled:opacity-50"
                          style={{ background: "#203321", color: "#9fe0a9", border: "1px solid #38603a" }}
                        >
                          {busyKey === `update:${entry.primaryCaveId}` ? "Updating..." : "Apply Update"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {!loading && status?.available && library && filteredRecords.length === 0 && (
            <p className="text-sm text-center py-8" style={{ color: "var(--color-text-muted)" }}>
              No owned itch titles match your current filter.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Lutris Import Modal ────────────────────────────────────────────────────
function LutrisImportModal({ games, onImport, onClose }: {
  games: Game[];
  onImport: (entries: LutrisGameEntry[]) => void | Promise<void>;
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

  const apply = async () => {
    await onImport(rows.filter((r) => r.checked).map((r) => r.entry));
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
  command: "import_playnite_games" | "import_gog_galaxy_games" | "import_protocol_store_games" | "import_exotic_store_games";
  title: string;
  subtitle: string;
  accent: string;
  onImport: (entries: InteropGameEntry[]) => void | Promise<void>;
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

  const apply = async () => {
    await onImport(rows.filter((r) => r.checked).map((r) => r.entry));
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

function ZipInstallModal({
  zipPath,
  libraryFolders,
  defaultFolderPath,
  onInstall,
  onClose,
}: {
  zipPath: string;
  libraryFolders: LibraryFolder[];
  defaultFolderPath: string;
  onInstall: (libraryRoot: string) => Promise<void>;
  onClose: () => void;
}) {
  const [selectedRoot, setSelectedRoot] = useState(defaultFolderPath);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runInstall = async () => {
    if (!selectedRoot.trim()) {
      setError("Choose a library folder first.");
      return;
    }
    setWorking(true);
    setError(null);
    try {
      await onInstall(selectedRoot);
    } catch (e) {
      setError(String(e));
    } finally {
      setWorking(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.82)" }}
      onClick={(e) => { if (e.target === e.currentTarget && !working) onClose(); }}
    >
      <div className="rounded-xl shadow-2xl w-[560px] max-w-[92vw] flex flex-col"
        style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
        <div className="flex items-center gap-3 px-5 py-3 border-b" style={{ borderColor: "var(--color-border-card)" }}>
          <h2 className="font-bold text-sm" style={{ color: "var(--color-white)" }}>Install ZIP via Libmaly</h2>
          <div className="flex-1" />
          <button onClick={onClose} disabled={working} className="text-sm disabled:opacity-40" style={{ color: "var(--color-text-dim)" }}>✕</button>
        </div>
        <div className="px-5 py-4 space-y-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
          <p>Choose which library folder should receive this archive.</p>
          <div className="rounded-lg px-3 py-2 text-xs break-all" style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border-soft)" }}>
            ZIP: {zipPath}
          </div>
          <label className="text-sm block">
            Library folder
            <select
              value={selectedRoot}
              onChange={(e) => setSelectedRoot(e.currentTarget.value)}
              className="mt-2 w-full px-3 py-2 rounded text-sm outline-none"
              style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
            >
              {libraryFolders.map((folder) => (
                <option key={folder.path} value={folder.path}>{folder.path}</option>
              ))}
            </select>
          </label>
          <p className="text-xs" style={{ color: "var(--color-text-dim)" }}>
            Libmaly will extract the archive into a new folder inside the selected library and then scan it for launchable executables.
          </p>
          {error && <p className="text-xs" style={{ color: "var(--color-danger)" }}>{error}</p>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t" style={{ borderColor: "var(--color-border-card)" }}>
          <button onClick={onClose} disabled={working} className="px-3 py-1.5 rounded text-xs disabled:opacity-50"
            style={{ background: "transparent", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>
            Cancel
          </button>
          <button onClick={() => void runInstall()} disabled={working} className="px-4 py-1.5 rounded text-xs font-semibold disabled:opacity-50"
            style={{ background: "var(--color-accent-dark)", color: "var(--color-white)" }}>
            {working ? "Installing..." : "Install"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Migration Wizard ────────────────────────────────────────────────────────
export default function App() {
  const { t } = useTranslation();
  const [profileRegistry, setProfileRegistry] = useState<LibraryProfileRegistry>({
    activeProfileId: getAppStorageProfile(),
    profiles: [],
  });
  const activeLibraryProfile = useMemo(
    () => profileRegistry.profiles.find((profile) => profile.id === profileRegistry.activeProfileId) ?? null,
    [profileRegistry]
  );
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
  const selectedRef = useRef<Game | null>(null);
  useEffect(() => { selectedRef.current = selected; }, [selected]);
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
  const [showSaveTransferModal, setShowSaveTransferModal] = useState(false);
  const [showZipInstallModal, setShowZipInstallModal] = useState(false);
  const [showF95Login, setShowF95Login] = useState(false);
  const [f95LoggedIn, setF95LoggedIn] = useState(false);
  const [showDLsiteLogin, setShowDLsiteLogin] = useState(false);
  const [dlsiteLoggedIn, setDlsiteLoggedIn] = useState(false);
  const [showFakkuLogin, setShowFakkuLogin] = useState(false);
  const [fakkuLoggedIn, setFakkuLoggedIn] = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [showWhatsNewModal, setShowWhatsNewModal] = useState(false);
  const [viewMode, setViewMode] = useState<LayoutViewMode>(() => loadCache(SK_VIEW_MODE, "list"));
  const [isAppReady, setIsAppReady] = useState(false);

  useEffect(() => saveCache(SK_VIEW_MODE, viewMode), [viewMode]);

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
      const src = metadataSourceSummary(metadata[g.path]) || metadata[g.path]?.source || "";
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
      try {
        await invoke("save_string_to_file", { path: savePath, contents: csv });
      } catch (e) {
        await showPermissionDiagnostic("export the CSV file", savePath, e);
      }
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
        achievements,
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
    try {
      await invoke("save_string_to_file", { path: savePath, contents: JSON.stringify(payload, null, 2) });
    } catch (e) {
      await showPermissionDiagnostic("export the cloud backup", savePath, e);
    }
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
    try {
      await ensureSnapshotBeforeRiskyOp("before-cloud-import", "Before importing cloud state");
    } catch {
      return;
    }

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
    if (data.achievements && typeof data.achievements === "object") {
      const nextAch = normalizeAchievementsMap(data.achievements);
      setAchievements(nextAch);
      saveCache(SK_ACHIEVEMENTS, nextAch);
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

      const src = metadataSourceSummary(metadata[g.path]) || metadata[g.path]?.source;
      const url = metadata[g.path]?.source_url;
      const sourceStr = src && url ? `<a href="${url}" target="_blank" style="display: inline-block; font-size: 10px; margin-top: 5px; color: var(--color-accent); text-decoration: none; border: 1px solid var(--color-border); padding: 2px 6px; border-radius: 4px;">↗ ${src}</a>` : "";

      const img = cvr ? `<img src="${cvr}" />` : `<div style="aspect-ratio: 2/3; background: var(--color-border); display: flex; align-items: center; justify-content: center; border-radius: 4px; font-size: 12px; font-weight: bold; color: rgba(255,255,255,0.5);">NO COVER</div>`;
      html += `<div class="card">${img}<h3>${name}</h3>${sourceStr}${ptStr}${ratingStr}${categoryStr}${reviewStr}</div>`;
    }
    html += `</div></body></html>`;
    const savePath = await save({ defaultPath: "libmaly_library.html", filters: [{ name: "HTML", extensions: ["html"] }] });
    if (savePath) {
      try {
        await invoke("save_string_to_file", { path: savePath, contents: html });
      } catch (e) {
        await showPermissionDiagnostic("export the HTML library page", savePath, e);
      }
    }
  };

  const handleExportWishlistHTML = async () => {
    if (wishlist.length === 0) {
      alert("Your wishlist is empty.");
      return;
    }
    const now = new Date().toLocaleDateString();
    let html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>My Wishlist — LIBMALY</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f1117; color: #e0e0e0; min-height: 100vh; }
  .header { text-align: center; padding: 40px 20px 20px; border-bottom: 1px solid #2a2a3a; }
  .header h1 { font-size: 28px; font-weight: 700; background: linear-gradient(90deg, #66c0f4, #f0c040); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 8px; }
  .header p { font-size: 13px; color: #888; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; padding: 24px; max-width: 1200px; margin: 0 auto; }
  .card { background: #1a1d28; border-radius: 10px; overflow: hidden; border: 1px solid #2a2a3a; transition: transform 0.15s, border-color 0.15s; }
  .card:hover { transform: translateY(-2px); border-color: #66c0f4; }
  .card-img { width: 100%; aspect-ratio: 2/3; object-fit: cover; background: #2a2a3a; }
  .card-img-placeholder { width: 100%; aspect-ratio: 2/3; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #2a2a3a, #1a1d28); font-size: 32px; color: #555; }
  .card-body { padding: 12px; }
  .card-title { font-size: 14px; font-weight: 600; color: #e0e0e0; margin-bottom: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .card-source { font-size: 11px; color: #888; margin-bottom: 4px; }
  .card-status { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 4px; display: inline-block; }
  .status-released { background: #1a3a1a; color: #4caf50; }
  .status-upcoming { background: #3a3a1a; color: #f0c040; }
  .status-unknown { background: #2a2a3a; color: #888; }
  .card-link { display: inline-block; margin-top: 8px; font-size: 11px; color: #66c0f4; text-decoration: none; }
  .card-link:hover { text-decoration: underline; }
  .footer { text-align: center; padding: 20px; color: #555; font-size: 11px; border-top: 1px solid #2a2a3a; }
</style></head><body>
<div class="header">
  <h1>🎮 My Wishlist</h1>
  <p>${wishlist.length} game${wishlist.length !== 1 ? "s" : ""} · Generated ${now} with LIBMALY</p>
</div>
<div class="grid">`;

    for (const item of wishlist) {
      const statusClass = item.releaseStatus === "Released" ? "status-released" : item.releaseStatus === "Upcoming" ? "status-upcoming" : "status-unknown";
      html += `<div class="card">
        <div class="card-img-placeholder">🎮</div>
        <div class="card-body">
          <div class="card-title">${item.title.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>
          <div class="card-source">${item.source}</div>
          <span class="card-status ${statusClass}">${item.releaseStatus}</span><br>
          <a class="card-link" href="${item.id}" target="_blank" rel="noopener">View on ${item.source} ↗</a>
        </div>
      </div>`;
    }

    html += `</div>
<div class="footer">Generated by <a href="https://github.com/Baconana-chan/Libmaly" target="_blank" style="color: #66c0f4;">LIBMALY</a> · ${now}</div>
</body></html>`;

    const savePath = await save({ defaultPath: "libmaly-wishlist.html", filters: [{ name: "HTML", extensions: ["html"] }] });
    if (savePath) {
      try {
        await invoke("save_string_to_file", { path: savePath, contents: html });
      } catch (e) {
        await showPermissionDiagnostic("export the wishlist HTML page", savePath, e);
      }
    }
  };

  const [screenshots, setScreenshots] = useState<Record<string, Screenshot[]>>({});
  const [pendingAnnotatedShot, setPendingAnnotatedShot] = useState<{ gamePath: string; shot: Screenshot } | null>(null);
  const [screenshotToasts, setScreenshotToasts] = useState<ScreenshotToast[]>([]);
  const [inAppToasts, setInAppToasts] = useState<{ id: string; type: "session" | "warning" | "info" | "success"; title: string; message: string; icon?: string }[]>([]);
  const [discordSnapshot, setDiscordSnapshot] = useState<DiscordSdkSnapshot | null>(null);
  const [hiddenGames, setHiddenGames] = useState<Record<string, boolean>>(() => loadCache(SK_HIDDEN, {}));
  const [favGames, setFavGames] = useState<Record<string, boolean>>(() => loadCache(SK_FAVS, {}));
  const [ghostGames, setGhostGames] = useState<Record<string, boolean>>(() => loadCache(SK_GHOST, {}));
  const [customizations, setCustomizations] = useState<Record<string, GameCustomization>>(() => loadCache(SK_CUSTOM, {}));
  const [notes, setNotes] = useState<Record<string, string>>(() => loadCache(SK_NOTES, {}));
  const [achievements, setAchievements] = useState<GameAchievementsByPath>(() =>
    normalizeAchievementsMap(loadCache(SK_ACHIEVEMENTS, {}))
  );
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
  const [showAchievementTrackerModal, setShowAchievementTrackerModal] = useState(false);
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [showFilters, setShowFilters] = useState(false);
  const [showCollections, setShowCollections] = useState(false);
  const [showDevelopers, setShowDevelopers] = useState(false);
  const [showWishlist, setShowWishlist] = useState(false);
  const [showLogViewer, setShowLogViewer] = useState(false);
  const [showSnapshotRestore, setShowSnapshotRestore] = useState(false);
  const [integrityReport, setIntegrityReport] = useState<IntegrityCheckReport | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotResult[]>([]);
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);
  const [selectedSnapshotPath, setSelectedSnapshotPath] = useState<string | null>(null);
  const [snapshotPreview, setSnapshotPreview] = useState<SnapshotRestorePreview | null>(null);
  const [snapshotPreviewLoading, setSnapshotPreviewLoading] = useState(false);
  const [snapshotPreviewError, setSnapshotPreviewError] = useState<string | null>(null);
  const [restoringSnapshot, setRestoringSnapshot] = useState(false);
  const [rustLogs, setRustLogs] = useState<RustLogEntry[]>([]);
  const [recentFileOps, setRecentFileOps] = useState<RecentFileOp[]>([]);
  const [crashReport, setCrashReport] = useState<CrashReport | null>(null);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [showRecoveryPrompt, setShowRecoveryPrompt] = useState(false);
  const [scraperHealth, setScraperHealth] = useState<ScraperHealthDiagnostic[]>([]);
  const [logLevelFilter, setLogLevelFilter] = useState<LogLevelFilter>("all");
  const [appVersion, setAppVersion] = useState<string>("unknown");
  const [isUiActive, setIsUiActive] = useState<boolean>(true);
  const [liveSessionExtraSec, setLiveSessionExtraSec] = useState<number>(0);
  const [backgroundJobs, setBackgroundJobs] = useState<Record<string, BackgroundJob>>({});
  const [sortMode, setSortMode] = useState<SortMode>("lastPlayed");
  /** custom-order map: contextKey -> ordered array of game paths */
  const [customOrder, setCustomOrder] = useState<Record<string, string[]>>(
    () => loadCache(SK_ORDER, {})
  );
  /** path currently being dragged in the sidebar */
  const dragPath = useRef<string | null>(null);
  const activeBackgroundJobIds = useRef<Set<string>>(new Set());
  const screenshotToastTimeoutsRef = useRef<Record<string, number>>({});

  // ── UI states ──
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => loadCache(SK_SIDEBAR_WIDTH, 256));
  const [savedLayoutPresets, setSavedLayoutPresets] = useState<LayoutPresetRecord[]>(() => loadCache(SK_LAYOUT_PRESETS, []));
  const isDraggingSidebar = useRef(false);
  const sbWidthRef = useRef(sidebarWidth);
  useEffect(() => { sbWidthRef.current = sidebarWidth; }, [sidebarWidth]);

  const persistSidebarWidth = useCallback((nextWidth: number) => {
    const resolved = clampSidebarWidthValue(nextWidth);
    setSidebarWidth(resolved);
    saveCache(SK_SIDEBAR_WIDTH, resolved);
  }, []);

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
        saveCache(SK_SIDEBAR_WIDTH, sbWidthRef.current);
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
  const persistAppSettings = useCallback((nextSettings: AppSettings | ((prev: AppSettings) => AppSettings)) => {
    setAppSettings((prev) => {
      const resolved = typeof nextSettings === "function"
        ? (nextSettings as (prev: AppSettings) => AppSettings)(prev)
        : nextSettings;
      saveCache(SK_SETTINGS, resolved);
      return resolved;
    });
  }, []);
  const currentLayoutPresetConfig = useMemo(
    () => captureLayoutPresetConfig(viewMode, sidebarWidth, appSettings),
    [appSettings, sidebarWidth, viewMode],
  );
  const layoutPresets = useMemo<LayoutPresetDescriptor[]>(
    () => [
      ...BUILTIN_LAYOUT_PRESETS,
      ...savedLayoutPresets
        .slice()
        .sort((left, right) => left.name.localeCompare(right.name)),
    ],
    [savedLayoutPresets],
  );
  const activeLayoutPresetId = useMemo(
    () => layoutPresets.find((preset) => layoutPresetConfigsEqual(preset.config, currentLayoutPresetConfig))?.id ?? null,
    [currentLayoutPresetConfig, layoutPresets],
  );

  const applyLayoutPreset = useCallback((config: LayoutPresetConfig) => {
    setViewMode(config.viewMode);
    persistSidebarWidth(config.sidebarWidth);
    persistAppSettings((prev) => ({
      ...prev,
      sidebarMinimalMode: config.sidebarMinimalMode,
      sidebarShowNews: config.sidebarShowNews,
      sidebarShowStats: config.sidebarShowStats,
      sidebarShowSearchTools: config.sidebarShowSearchTools,
      sidebarShowCollections: config.sidebarShowCollections,
      sidebarShowDevelopers: config.sidebarShowDevelopers,
      sidebarShowWishlist: config.sidebarShowWishlist,
      sidebarShowSurpriseButton: config.sidebarShowSurpriseButton,
      sidebarShowAddButton: config.sidebarShowAddButton,
      sidebarShowSettingsButton: config.sidebarShowSettingsButton,
      sidebarShowLogsButton: config.sidebarShowLogsButton,
    }));
  }, [persistAppSettings, persistSidebarWidth]);

  const persistLayoutPresets = useCallback((nextPresets: LayoutPresetRecord[] | ((prev: LayoutPresetRecord[]) => LayoutPresetRecord[])) => {
    setSavedLayoutPresets((prev) => {
      const resolved = typeof nextPresets === "function"
        ? (nextPresets as (prev: LayoutPresetRecord[]) => LayoutPresetRecord[])(prev)
        : nextPresets;
      saveCache(SK_LAYOUT_PRESETS, resolved);
      return resolved;
    });
  }, []);

  const saveCurrentLayoutPreset = useCallback((name: string) => {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error("Preset name cannot be empty.");
    }
    persistLayoutPresets((prev) => {
      const baseId = slugifyLayoutPresetName(trimmed) || `preset-${Date.now()}`;
      let nextId = baseId;
      let suffix = 2;
      while (prev.some((preset) => preset.id === nextId)) {
        nextId = `${baseId}-${suffix}`;
        suffix += 1;
      }
      return [
        ...prev,
        {
          id: nextId,
          name: trimmed,
          config: currentLayoutPresetConfig,
        },
      ];
    });
  }, [currentLayoutPresetConfig, persistLayoutPresets]);

  const updateLayoutPreset = useCallback((presetId: string) => {
    persistLayoutPresets((prev) => prev.map((preset) => (
      preset.id === presetId
        ? { ...preset, config: currentLayoutPresetConfig }
        : preset
    )));
  }, [currentLayoutPresetConfig, persistLayoutPresets]);

  const deleteLayoutPreset = useCallback((presetId: string) => {
    persistLayoutPresets((prev) => prev.filter((preset) => preset.id !== presetId));
  }, [persistLayoutPresets]);
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
  const [seasonClockTick, setSeasonClockTick] = useState(Date.now());
  useEffect(() => {
    if (appSettings.seasonalTheme !== "auto") return;
    const t = setInterval(() => setSeasonClockTick(Date.now()), 60 * 60 * 1000);
    return () => clearInterval(t);
  }, [appSettings.seasonalTheme]);
  const effectiveThemeMode = useMemo<ThemeMode>(() => {
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
  const effectiveSeason = useMemo<"winter" | "summer" | "halloween" | "none">(() => {
    if (appSettings.seasonalTheme === "auto") return resolveSeasonFromDate(new Date(seasonClockTick));
    return appSettings.seasonalTheme || "none";
  }, [appSettings.seasonalTheme, seasonClockTick]);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = effectiveThemeMode;
    if (effectiveSeason === "none") delete root.dataset.season;
    else root.dataset.season = effectiveSeason;
    const accent = normalizeHexColor(appSettings.accentColor, DEFAULT_SETTINGS.accentColor);
    root.style.setProperty("--color-accent", accent);
    root.style.setProperty("--color-accent-dark", shiftHexColor(accent, -0.42));
    root.style.setProperty("--color-accent-mid", shiftHexColor(accent, -0.28));
    root.style.setProperty("--color-accent-soft", shiftHexColor(accent, -0.08));
    root.style.setProperty("--color-accent-deep", shiftHexColor(accent, -0.62));
    root.style.setProperty("--color-accent-deeper", shiftHexColor(accent, -0.68));
    root.style.setProperty("--color-accent-muted", shiftHexColor(accent, -0.46));

    if (effectiveThemeMode === "custom" && appSettings.customThemeColors) {
      Object.entries(appSettings.customThemeColors).forEach(([key, val]) => {
        if (val) root.style.setProperty(`--color-${key}`, val);
      });
    } else {
      // Clear custom properties when not in custom mode to avoid leakage
      const keys = ["bg", "bg-elev", "bg-deep", "bg-code", "bg-overlay", "panel", "panel-2", "panel-3", "panel-alt", "panel-deep", "panel-low", "border", "border-soft", "border-card", "border-strong", "border-subtle", "text", "text-soft", "text-muted", "text-dim"];
      keys.forEach(k => root.style.removeProperty(`--color-${k}`));
    }
  }, [effectiveThemeMode, effectiveSeason, appSettings.accentColor, appSettings.customThemeColors]);

  // Sync i18n language with settings
  useEffect(() => {
    if (appSettings.language && i18n.language !== appSettings.language) {
      i18n.changeLanguage(appSettings.language).catch(() => { });
    }
  }, [appSettings.language]);

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
  const runningGamePathRef = useRef<string | null>(null);
  useEffect(() => { runningGamePathRef.current = runningGamePath; }, [runningGamePath]);
  const [platform, setPlatform] = useState<string>("windows");
  const [launchConfig, setLaunchConfig] = useState<LaunchConfig>(() => loadCache(SK_LAUNCH, DEFAULT_LAUNCH_CONFIG));
  const [, setRecentGames] = useState<RecentGame[]>(() => loadCache(SK_RECENT, []));
  const [availableGameUpdates, setAvailableGameUpdates] = useState<Record<string, string>>({});
  const [showWineSettings, setShowWineSettings] = useState(false);
  const [appUpdate, setAppUpdate] = useState<{ version: string; url: string; downloadUrl: string } | null>(null);
  const [showAppUpdateModal, setShowAppUpdateModal] = useState(false);
  const [showCmdPalette, setShowCmdPalette] = useState(false);
  const [pendingLaunchRequest, setPendingLaunchRequest] = useState<LaunchRequest | null>(null);
  const [pendingZipInstallPath, setPendingZipInstallPath] = useState<string | null>(null);
  const [zipInstallInProgress, setZipInstallInProgress] = useState(false);
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
  /** Show the Steam library import modal */
  const [showSteamLibraryImport, setShowSteamLibraryImport] = useState(false);
  /** Show the Epic Games Store / Legendary import modal */
  const [showEpicImport, setShowEpicImport] = useState(false);
  /** Show the Lutris import modal */
  const [showLutrisImport, setShowLutrisImport] = useState(false);
  /** Show the Playnite import modal */
  const [showPlayniteImport, setShowPlayniteImport] = useState(false);
  /** Show the GOG Galaxy import modal */
  const [showGogImport, setShowGogImport] = useState(false);
  /** Show the EA App / Ubisoft / Rockstar import modal */
  const [showProtocolStoreImport, setShowProtocolStoreImport] = useState(false);
  /** Show the GameJolt / Battle.net import modal */
  const [showExoticImport, setShowExoticImport] = useState(false);
  /** Show the itch.io butler modal */
  const [showItchImport, setShowItchImport] = useState(false);
  /** Wishlisted unowned games */
  const [wishlist, setWishlist] = useState<WishlistItem[]>(() => loadCache(SK_WISHLIST, []));

  /** Game version history */
  const [history, setHistory] = useState<GameHistoryMap>(() => loadCache(SK_HISTORY, {}));

  const effectiveWinePrefixForSelected = useMemo(() => {
    if (!selected || platform === "windows") return null;
    const gc = customizations[selected.path];
    return resolveEffectiveWinePrefix(platform, {
      runnerOverrideEnabled: gc?.runnerOverrideEnabled,
      runnerOverride: gc?.runnerOverride,
      globalLaunchEnabled: launchConfig.enabled,
      globalPrefixPath: launchConfig.prefixPath,
    });
  }, [selected, platform, customizations, launchConfig]);

  const [winePrefixRowForSelected, setWinePrefixRowForSelected] = useState<PrefixInfo | null>(null);
  useEffect(() => {
    if (!effectiveWinePrefixForSelected) {
      setWinePrefixRowForSelected(null);
      return;
    }
    let cancelled = false;
    invoke<PrefixInfo[]>("list_wine_prefixes")
      .then((list) => {
        if (cancelled) return;
        setWinePrefixRowForSelected(findMatchingWinePrefixEntry(list, effectiveWinePrefixForSelected) ?? null);
      })
      .catch(() => setWinePrefixRowForSelected(null));
    return () => { cancelled = true; };
  }, [effectiveWinePrefixForSelected]);

  const selectedWineMediaAssessment = useMemo(() => {
    if (!selected || platform === "windows" || !effectiveWinePrefixForSelected) return null;
    const actualExe = customizations[selected.path]?.exeOverride || selected.path;
    const ctx = assessGameMediaPlaybackContext({
      engine: metadata[selected.path]?.engine,
      gamePath: pathDirname(actualExe),
      launchExePath: actualExe,
    });
    return combinePrefixAndGameMedia(winePrefixRowForSelected?.media, ctx);
  }, [selected, platform, effectiveWinePrefixForSelected, winePrefixRowForSelected, metadata, customizations]);

  const refreshWinePrefixRowForSelected = useCallback(async () => {
    if (!effectiveWinePrefixForSelected) return;
    const list = await invoke<PrefixInfo[]>("list_wine_prefixes").catch(() => []);
    setWinePrefixRowForSelected(findMatchingWinePrefixEntry(list, effectiveWinePrefixForSelected) ?? null);
  }, [effectiveWinePrefixForSelected]);

  const [gameMediaInstallPreview, setGameMediaInstallPreview] = useState<null | {
    prefixPath: string;
    prefixName: string;
    verbs: string[];
    sourceLabel: string;
    beforeMedia: PrefixInfo["media"];
  }>(null);

  const [shaderCacheDiscovery, setShaderCacheDiscovery] = useState<ShaderCacheDiscovery | null>(null);
  const [shaderCacheActionBusy, setShaderCacheActionBusy] = useState(false);

  const refetchShaderDiscovery = useCallback(async () => {
    if (!selected || platform === "windows") {
      setShaderCacheDiscovery(null);
      return;
    }
    const gc = customizations[selected.path];
    if (!(gc?.runnerOverrideEnabled || launchConfig.enabled)) {
      setShaderCacheDiscovery(null);
      return;
    }
    const exe = gc?.exeOverride || selected.path;
    const sid = gc?.steamAppId?.trim() || null;
    try {
      const d = await invoke<ShaderCacheDiscovery>("discover_shader_cache_artifacts", {
        gameExePath: exe,
        steamAppId: sid,
      });
      setShaderCacheDiscovery(d);
    } catch {
      setShaderCacheDiscovery(null);
    }
  }, [selected, platform, customizations, launchConfig.enabled]);

  useEffect(() => {
    void refetchShaderDiscovery();
  }, [refetchShaderDiscovery]);

  const [steamLaunchBridge, setSteamLaunchBridge] = useState<SteamLaunchBridge | null>(null);
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

  const applyProfileStorageSnapshot = useCallback((snapshot: ProfileStorageSnapshot, nextProfileId?: string) => {
    if (nextProfileId) {
      setAppStorageProfile(nextProfileId);
    }
    setLibraryFolders(snapshot.libraryFolders);
    setGames(snapshot.games);
    setStats(snapshot.stats);
    setMetadata(snapshot.metadata);
    setHiddenGames(snapshot.hiddenGames);
    setFavGames(snapshot.favGames);
    setCustomizations(snapshot.customizations);
    setNotes(snapshot.notes);
    setAchievements(snapshot.achievements);
    setCollections(snapshot.collections);
    setLaunchConfig({ ...DEFAULT_LAUNCH_CONFIG, ...snapshot.launchConfig });
    setRecentGames(snapshot.recentGames);
    setCustomOrder(snapshot.customOrder);
    setSessionLog(snapshot.sessionLog);
    setWishlist(snapshot.wishlist);
    setHistory(snapshot.history);
    setAppSettings(snapshot.appSettings);
    setViewMode(snapshot.viewMode);
    setSidebarWidth(snapshot.sidebarWidth);
    setActiveCollectionId(null);
    setShowCollections(false);
    setShowDevelopers(false);
    setShowWishlist(false);
    invoke("set_recent_games", { games: snapshot.recentGames }).catch(() => { });
    if (selectedRef.current && !snapshot.games.some((game) => game.path === selectedRef.current?.path)) {
      setSelected(null);
    }
  }, []);

  const reloadActiveProfile = useCallback((profileId: string) => {
    setAppStorageProfile(profileId);
    const snapshot = readProfileStorageSnapshot();
    applyProfileStorageSnapshot(snapshot, profileId);
  }, [applyProfileStorageSnapshot]);

  const resolveGameTitle = useCallback((gamePath: string) =>
    customizationsRef.current[gamePath]?.displayName
    ?? metadataRef.current[gamePath]?.title
    ?? gamesRef.current.find((game) => game.path === gamePath)?.name
    ?? "Unknown game"
  , []);

  const refreshDiscordSnapshot = useCallback(async () => {
    try {
      const snapshot = await invoke<DiscordSdkSnapshot>("discord_get_snapshot");
      setDiscordSnapshot(snapshot);
      return snapshot;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const syncDiscord = async () => {
      if (!appSettings.discordEnabled) {
        try { await invoke("discord_shutdown"); } catch { }
        if (!cancelled) setDiscordSnapshot(null);
        return;
      }
      try {
        const snapshot = await invoke<DiscordSdkSnapshot>("discord_initialize");
        if (!cancelled) setDiscordSnapshot(snapshot);
      } catch (e) {
        if (!cancelled) {
          setDiscordSnapshot(null);
          setInAppToasts(prev => [
            {
              id: `discord-init-${Date.now()}`,
              type: "warning" as const,
              title: "Discord integration unavailable",
              message: String(e),
              icon: "💬",
            },
            ...prev,
          ].slice(0, 5));
        }
      }
    };
    void syncDiscord();
    return () => { cancelled = true; };
  }, [appSettings.discordEnabled]);

  useEffect(() => {
    if (!appSettings.discordEnabled) return;
    void refreshDiscordSnapshot();
    const timer = setInterval(() => {
      void refreshDiscordSnapshot();
    }, 15000);
    return () => clearInterval(timer);
  }, [appSettings.discordEnabled, refreshDiscordSnapshot]);

  const ensureScreenshotOverlayWindow = useCallback(async () => {
    const existing = await WebviewWindow.getByLabel("screenshot-overlay");
    if (existing) return existing;
    const overlayUrl = new URL("/overlay.html", window.location.origin).toString();
    const created = new WebviewWindow("screenshot-overlay", {
      url: overlayUrl,
      title: "LIBMALY Screenshot Overlay",
      width: 380,
      height: 220,
      visible: false,
      decorations: false,
      transparent: true,
      shadow: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      focus: false,
      focusable: false,
    });
    created.once("tauri://created", async () => {
      await created.setAlwaysOnTop(true).catch(() => {});
      await created.setSkipTaskbar(true).catch(() => {});
      await created.setIgnoreCursorEvents(true).catch(() => {});
      await created.hide().catch(() => {});
    });
    return created;
  }, []);

  const emitScreenshotOverlay = useCallback(async (
    gamePath: string,
    screenshot: Screenshot,
    label = "Screenshot saved",
  ) => {
    const payload: ScreenshotOverlayPayload = {
      gamePath,
      gameTitle: resolveGameTitle(gamePath),
      screenshot,
      label,
    };
    try {
      await ensureScreenshotOverlayWindow();
      await emitTo("screenshot-overlay", "libmaly://screenshot-overlay-show", payload);
    } catch {
      // Ignore overlay errors; screenshot capture itself already succeeded.
    }
  }, [ensureScreenshotOverlayWindow, resolveGameTitle]);

  const dismissScreenshotToast = useCallback((id: string) => {
    const timeoutId = screenshotToastTimeoutsRef.current[id];
    if (timeoutId) {
      window.clearTimeout(timeoutId);
      delete screenshotToastTimeoutsRef.current[id];
    }
    setScreenshotToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const queueScreenshotToast = useCallback((gamePath: string, screenshot: Screenshot, label = t('screenshot.saved')) => {
    const id = `${screenshot.path}:${Date.now()}`;
    setScreenshotToasts((prev) => [
      { id, gamePath, screenshot, label },
      ...prev.filter((toast) => toast.screenshot.path !== screenshot.path),
    ].slice(0, 4));
    const timeoutId = window.setTimeout(() => dismissScreenshotToast(id), SCREENSHOT_TOAST_TTL_MS);
    screenshotToastTimeoutsRef.current[id] = timeoutId;
  }, [dismissScreenshotToast]);

  const recordScreenshotCapture = useCallback((
    gamePath: string,
    screenshot: Screenshot,
    options?: { showToast?: boolean; showOverlay?: boolean; label?: string },
  ) => {
    setScreenshots((prev) => {
      const existing = prev[gamePath] ?? [];
      if (existing.some((shot) => shot.path === screenshot.path)) return prev;
      return {
        ...prev,
        [gamePath]: [screenshot, ...existing],
      };
    });
    if (options?.showToast !== false) {
      queueScreenshotToast(gamePath, screenshot, options?.label);
    }
    if (options?.showOverlay !== false) {
      void emitScreenshotOverlay(gamePath, screenshot, options?.label);
    }
  }, [emitScreenshotOverlay, queueScreenshotToast]);

  useEffect(() => () => {
    for (const timeoutId of Object.values(screenshotToastTimeoutsRef.current)) {
      window.clearTimeout(timeoutId);
    }
    screenshotToastTimeoutsRef.current = {};
  }, []);

  const runDeferredStartupTasks = useCallback(async () => {
    if (!appSettingsRef.current.updateCheckerEnabled) return;
    invoke<{ version: string; url: string; download_url: string } | null>("check_app_update")
      .then((u) => { if (u) setAppUpdate({ version: u.version, url: u.url, downloadUrl: u.download_url }); })
      .catch(() => { });
  }, []);

  // ── Periodic vacuum: runs once 30s after startup, then every 24 hours ────
  useEffect(() => {
    // Short initial delay so startup scan/metadata tasks finish first.
    const initialTimer = window.setTimeout(() => {
      runDbVacuum(true).catch(() => {});
    }, 30_000);
    // Repeat every 24 hours to keep the local state trim.
    const periodicTimer = window.setInterval(() => {
      runDbVacuum(true).catch(() => {});
    }, 24 * 60 * 60 * 1000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(periodicTimer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    invoke<string>("get_platform")
      .then((detectedPlatform) => {
        if (detectedPlatform === "windows") {
          void ensureScreenshotOverlayWindow();
        }
      })
      .catch(() => {});
  }, [ensureScreenshotOverlayWindow]);

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

  const handleSaveLibraryProfile = useCallback(async (profile: {
    id?: string;
    displayName: string;
    handle?: string;
    tagline?: string;
    avatarUrl?: string;
    bannerUrl?: string;
    accentColor?: string;
  }) => {
    const nextRegistry = await invoke<LibraryProfileRegistry>("save_library_profile", { profile });
    setProfileRegistry(nextRegistry);
  }, []);

  const handleSwitchLibraryProfile = useCallback(async (profileId: string) => {
    const nextRegistry = await invoke<LibraryProfileRegistry>("switch_library_profile", { profileId });
    setProfileRegistry(nextRegistry);
    reloadActiveProfile(nextRegistry.activeProfileId);
    setInAppToasts(prev => [
      {
        id: `profile-switch-${Date.now()}`,
        type: "info" as const,
        title: "Profile switched",
        message: `Active profile is now ${nextRegistry.profiles.find((p) => p.id === nextRegistry.activeProfileId)?.displayName ?? nextRegistry.activeProfileId}.`,
        icon: "👤",
      },
      ...prev,
    ].slice(0, 5));
  }, [reloadActiveProfile]);

  const handleDeleteLibraryProfile = useCallback(async (profileId: string) => {
    const profile = profileRegistry.profiles.find((entry) => entry.id === profileId);
    if (!profile) return;
    if (!confirm(`Delete profile "${profile.displayName}"? Its existing library data will remain on disk, but the profile will be removed from the launcher selector.`)) return;
    const nextRegistry = await invoke<LibraryProfileRegistry>("delete_library_profile", { profileId });
    setProfileRegistry(nextRegistry);
    reloadActiveProfile(nextRegistry.activeProfileId);
  }, [profileRegistry, reloadActiveProfile]);

  const handleIncomingDeepLink = useCallback(async (rawUrl: string) => {
    const oauthCallback = parseSyncOAuthCallbackUrl(rawUrl);
    if (oauthCallback) {
      try {
        const config = await syncCompleteOAuthCallback(rawUrl);
        window.dispatchEvent(new CustomEvent("libmaly-sync-config-updated"));
        setInAppToasts(prev => [
          {
            id: `sync-oauth-${Date.now()}`,
            type: "success" as const,
            title: "Cloud sync connected",
            message: `${getSyncProviderLabel(config.provider)} authorization completed successfully.`,
            icon: "☁️",
          },
          ...prev,
        ].slice(0, 5));
      } catch (error) {
        setInAppToasts(prev => [
          {
            id: `sync-oauth-failed-${Date.now()}`,
            type: "warning" as const,
            title: "Cloud sync authorization failed",
            message: String(error),
            icon: "⚠️",
          },
          ...prev,
        ].slice(0, 5));
      }
      return true;
    }

    const req = parseDeepLinkUrl(rawUrl);
    if (req) {
      setPendingLaunchRequest(req);
      return true;
    }

    return false;
  }, []);

  // No auto-select: show HomeView when nothing is selected

  useEffect(() => {
    let disposed = false;
    invoke<boolean>("f95_is_logged_in").then(setF95LoggedIn).catch(() => { });
    invoke<boolean>("dlsite_is_logged_in").then(setDlsiteLoggedIn).catch(() => { });
    invoke<boolean>("fakku_is_logged_in").then(setFakkuLoggedIn).catch(() => { });
    invoke<string>("get_platform").then(setPlatform).catch(() => { });
    getVersion().then((v) => {
      setAppVersion(v);
      const lastSeen = appStorageGetItem("libmaly_last_seen_version");
      if (lastSeen !== v) {
        setShowWhatsNewModal(true);
        appStorageSetItem("libmaly_last_seen_version", v);
      }
    }).catch(() => { });

    (async () => {
      try {
        const registry = await invoke<LibraryProfileRegistry>("get_library_profiles");
        if (disposed) return;
        setProfileRegistry(registry);
        if (registry.activeProfileId && registry.activeProfileId !== getAppStorageProfile()) {
          reloadActiveProfile(registry.activeProfileId);
        }
      } catch { }

      const storedRecent = loadCache<RecentGame[]>(SK_RECENT, []);
      if (storedRecent.length > 0) {
        invoke("set_recent_games", { games: storedRecent }).catch(() => { });
      }
      const folders = loadCache<LibraryFolder[]>(SK_FOLDERS, []);
      const legacyPath = appStorageGetItem(SK_PATH);
      const roots = folders.length > 0 ? folders : (legacyPath ? [{ path: legacyPath }] : []);
      getMatches().then((matches: any) => {
        const sub = matches?.subcommand;
        if (sub?.name === "launch") {
          const nameArg = sub?.matches?.args?.name?.value;
          const value = typeof nameArg === "string" ? nameArg : Array.isArray(nameArg) ? nameArg[0] : null;
          if (value && value.trim()) setPendingLaunchRequest({ mode: "name", value: value.trim() });
          return;
        }
        if (sub?.name === "quick-launch-exe") {
          const pathArg = sub?.matches?.args?.path?.value;
          const value = typeof pathArg === "string" ? pathArg : Array.isArray(pathArg) ? pathArg[0] : null;
          if (value && value.trim()) setPendingLaunchRequest({ mode: "path", value: value.trim(), autoHide: true });
          return;
        }
        if (sub?.name === "quick-install-zip") {
          const pathArg = sub?.matches?.args?.path?.value;
          const value = typeof pathArg === "string" ? pathArg : Array.isArray(pathArg) ? pathArg[0] : null;
          if (value && value.trim()) setPendingZipInstallPath(value.trim());
        }
      }).catch(() => { });
      getCurrentDeepLinks().then(async (urls) => {
        const arr = Array.isArray(urls) ? urls : [];
        for (const rawUrl of arr) {
          if (await handleIncomingDeepLink(rawUrl)) {
            break;
          }
        }
      }).catch(() => { });
      invoke<RustLogEntry[]>("get_recent_logs", { limit: 300 }).then(setRustLogs).catch(() => { });
      invoke<RecentFileOp[]>("get_recent_file_ops", { limit: 40 }).then(setRecentFileOps).catch(() => { });
      const continueNormalStartup = () => {
        if (roots.length > 0) {
          runIncrementalSyncAll(roots).finally(() => setIsAppReady(true));
        } else {
          setIsAppReady(true);
        }
        runDeferredStartupTasks();
      };
      invoke<CrashReport | null>("get_last_crash_report").then((r) => {
        if (r) {
          setCrashReport(r);
          setRecoveryMode(true);
          setShowRecoveryPrompt(true);
          setIsAppReady(true);
          return;
        }
        continueNormalStartup();
      }).catch(() => {
        continueNormalStartup();
      });
      invoke<ScraperHealthDiagnostic[]>("get_scraper_health_snapshot").then(setScraperHealth).catch(() => { });
    })();

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
        const title = customizationsRef.current[p.path]?.displayName ?? metadataRef.current[p.path]?.title ?? gamesRef.current.find(g => g.path === p.path)?.name ?? "Game";
        // Show in-app notification toast instead of system notification
        setInAppToasts(prev => [
          {
            id: `session-${Date.now()}`,
            type: "session" as const,
            title: "Session Ended",
            message: `Played ${title} for ${formatTime(p.duration_secs)}`,
            icon: "🎮",
          },
          ...prev,
        ].slice(0, 5));
        // Also send system notification if permission granted (optional fallback)
        isPermissionGranted().then(granted => {
          if (!granted) {
            return requestPermission()
              .then(r => r === "granted" || r === "default" ? true : false)
              .catch(() => false);
          }
          return true;
        }).then(granted => {
          if (granted) {
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
    const unlistenProfileSwitched = listen<LibraryProfileRegistry>("library-profile-switched", (ev) => {
      setProfileRegistry(ev.payload);
      reloadActiveProfile(ev.payload.activeProfileId);
    });
    const unlistenShot = listen<{ game_exe: string; screenshot: Screenshot }>("screenshot-taken", (ev) => {
      const { game_exe, screenshot } = ev.payload;
      recordScreenshotCapture(game_exe, screenshot, { showToast: true });
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
      void (async () => {
        for (const rawUrl of urls) {
          if (await handleIncomingDeepLink(rawUrl)) {
            break;
          }
        }
      })();
    });
    const unlistenRustLog = listen<RustLogEntry>("rust-log", (ev) => {
      const entry = ev.payload;
      setRustLogs((prev) => {
        const next = [...prev, entry];
        return next.length > 500 ? next.slice(next.length - 500) : next;
      });
    });
    const unlistenDiscordJoin = listen<string>("discord-activity-join", (ev) => {
      const secret = ev.payload || "";
      const rawName = secret.startsWith("name:") ? secret.slice(5) : secret;
      const name = rawName.trim();
      if (!name) return;
      setInAppToasts(prev => [
        {
          id: `discord-join-${Date.now()}`,
          type: "info" as const,
          title: "Discord join request",
          message: `Discord asked LIBMALY to open ${name}.`,
          icon: "💬",
        },
        ...prev,
      ].slice(0, 5));
      const ranked = gamesRef.current
        .map((g) => {
          const display = (customizationsRef.current[g.path]?.displayName ?? metadataRef.current[g.path]?.title ?? g.name).toLowerCase();
          const plain = g.name.toLowerCase();
          const q = name.toLowerCase();
          const score =
            display === q || plain === q ? 0 :
              display.startsWith(q) || plain.startsWith(q) ? 1 :
                (display.includes(q) || plain.includes(q) ? 2 : 99);
          return { g, score };
        })
        .filter((r) => r.score < 99)
        .sort((a, b) => a.score - b.score || a.g.name.localeCompare(b.g.name));
      if (ranked.length === 0) return;
      const game = ranked[0].g;
      openGameView(game);
      setActiveMainTab("library");
      if (!runningGamePathRef.current && confirm(`Launch "${name}" from Discord?`)) {
        launchGame(game.path);
      }
    });

    return () => {
      disposed = true;
      unlistenFinished.then((f) => f());
      unlistenStarted.then((f) => f());
      unlistenProfileSwitched.then((f) => f());
      unlistenShot.then((f) => f());
      unlistenBoss.then((f) => f());
      unlistenDeepLink.then((f) => f());
      unlistenRustLog.then((f) => f());
      unlistenDiscordJoin.then((f) => f());
    };
  }, [handleIncomingDeepLink, reloadActiveProfile]);

  useEffect(() => {
    if (!steamLaunchBridge) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const minutes = await invoke<number | null>("get_steam_playtime_minutes", { appId: steamLaunchBridge.appId });
        if (cancelled || typeof minutes !== "number") return;
        if (minutes > steamLaunchBridge.lastSeenMinutes) {
          syncSteamTrackedTotal(steamLaunchBridge.path, minutes);
          setSteamLaunchBridge((prev) => prev && prev.appId === steamLaunchBridge.appId ? {
            ...prev,
            lastSeenMinutes: minutes,
            sawIncrease: true,
            stalledPolls: 0,
            pollCount: prev.pollCount + 1,
          } : prev);
          return;
        }
        const nextPollCount = steamLaunchBridge.pollCount + 1;
        const nextStalledPolls = steamLaunchBridge.sawIncrease ? steamLaunchBridge.stalledPolls + 1 : steamLaunchBridge.stalledPolls;
        if ((steamLaunchBridge.sawIncrease && nextStalledPolls >= 3) || (!steamLaunchBridge.sawIncrease && nextPollCount >= 5)) {
          finalizeSteamLaunchBridge(
            steamLaunchBridge.path,
            steamLaunchBridge.baselineMinutes,
            minutes,
          );
          return;
        }
        setSteamLaunchBridge((prev) => prev && prev.appId === steamLaunchBridge.appId ? {
          ...prev,
          lastSeenMinutes: minutes,
          stalledPolls: nextStalledPolls,
          pollCount: nextPollCount,
        } : prev);
      } catch {
        // Ignore transient Steam read failures while polling.
      }
    };
    const timer = setInterval(poll, 45000);
    void poll();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [steamLaunchBridge]);

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

  useEffect(() => {
    if (!appSettings.discordEnabled) return;
    // Ghost mode: don't send any presence for ghost games
    if (runningGamePath && ghostGames[runningGamePath]) {
      invoke("discord_clear_presence").catch(() => { });
      return;
    }
    if (!runningGamePath) {
      if (appSettings.discordShowIdlePresence) {
        const idlePresence: DiscordPresenceInput = {
          title: "LIBMALY",
          details: "Browsing library",
          state: "Idle",
        };
        invoke("discord_set_presence", { input: idlePresence })
          .then(() => refreshDiscordSnapshot())
          .catch(() => { });
      } else {
        invoke("discord_clear_presence").catch(() => { });
        void refreshDiscordSnapshot();
      }
      return;
    }
    const title = resolveGameTitle(runningGamePath);
    const gameMeta = metadataRef.current[runningGamePath];
    const largeImage = customizationsRef.current[runningGamePath]?.coverUrl
      ?? gameMeta?.cover_url
      ?? undefined;
    const largeUrl = gameMeta?.source_url?.startsWith("http")
      ? gameMeta.source_url
      : undefined;
    const presence: DiscordPresenceInput = {
      title,
      details: "Playing via LIBMALY",
      state: appSettings.discordShowElapsedTime !== false ? "Session in progress" : undefined,
      startTimestampMs: appSettings.discordShowElapsedTime !== false ? sessionStartRef.current : undefined,
      largeImage,
      largeText: title,
      largeUrl,
      joinSecret: appSettings.discordAllowActivityJoin === false ? undefined : `name:${title}`,
    };
    invoke("discord_set_presence", { input: presence })
      .then(() => refreshDiscordSnapshot())
      .catch(() => { });
  }, [
    appSettings.discordEnabled,
    appSettings.discordShowElapsedTime,
    appSettings.discordShowIdlePresence,
    appSettings.discordAllowActivityJoin,
    runningGamePath,
    refreshDiscordSnapshot,
    resolveGameTitle,
  ]);

  // Auto-screenshot timer
  useEffect(() => {
    const mins = appSettings.autoScreenshotInterval;
    if (!mins || mins <= 0 || !runningGamePath) return;

    const intervalId = setInterval(async () => {
      try {
        await captureScreenshotForPath(runningGamePath, false, { showToast: false, showOverlay: false });
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
    if (recoveryMode || !appSettings.updateCheckerEnabled || games.length === 0) return;
    const checkUpdates = async () => {
      const items = games
        .map((g) => ({ path: g.path, metadata: metadataRef.current[g.path] }))
        .filter((entry): entry is MetadataQueueItem => metadataHasLinkedSources(entry.metadata) && !ghostGames[entry.path]);
      await runMetadataQueueJob({
        jobId: JOB_UPDATE_CHECKER,
        label: "Update Checker",
        items,
        mode: "update-check",
        concurrency: 1,
        onItemSuccess: (path, nextMeta) => {
          const current = metadataRef.current[path];
          if (nextMeta.version && current?.version && nextMeta.version !== current.version) {
            setAvailableGameUpdates(prev => ({ ...prev, [path]: nextMeta.version! }));
          }
        },
      });
    };
    // Debounce initial run so it doesn't block startup
    const timer = setTimeout(checkUpdates, 5000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line
  }, [appSettings.updateCheckerEnabled, recoveryMode]);

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
      mood: "chill",
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

  const syncSteamTrackedTotal = (path: string, totalMinutes: number) => {
    const totalSecs = Math.max(0, Math.floor(totalMinutes * 60));
    setStats((prev) => {
      const cur = prev[path] || { totalTime: 0, lastPlayed: 0, lastSession: 0, launchCount: 0 };
      if (totalSecs <= cur.totalTime) return prev;
      const next = {
        ...prev,
        [path]: {
          ...cur,
          totalTime: totalSecs,
          lastPlayed: Date.now(),
        },
      };
      saveCache(SK_STATS, next);
      return next;
    });
  };

  const finalizeSteamLaunchBridge = (path: string, baselineMinutes: number, finalMinutes: number) => {
    const deltaSecs = Math.max(0, Math.floor((finalMinutes - baselineMinutes) * 60));
    if (deltaSecs > 0) {
      const startedAt = sessionStartRef.current || (Date.now() - deltaSecs * 1000);
      const entry: SessionEntry = {
        id: String(startedAt),
        path,
        startedAt,
        duration: deltaSecs,
        note: "",
        mood: "chill",
      };
      setSessionLog((prev) => {
        const next = [entry, ...prev];
        saveCache(SK_SESSION_LOG, next);
        return next;
      });
      if (deltaSecs >= 30) setPendingNoteSession(entry);
    }
    setStats((prev) => {
      const cur = prev[path] || { totalTime: 0, lastPlayed: 0, lastSession: 0, launchCount: 0 };
      const totalSecs = Math.max(cur.totalTime, Math.floor(finalMinutes * 60));
      const next = {
        ...prev,
        [path]: {
          ...cur,
          totalTime: totalSecs,
          lastPlayed: deltaSecs > 0 ? Date.now() : cur.lastPlayed,
          lastSession: deltaSecs > 0 ? deltaSecs : cur.lastSession,
          launchCount: deltaSecs > 0 ? (cur.launchCount ?? 0) + 1 : (cur.launchCount ?? 0),
        },
      };
      saveCache(SK_STATS, next);
      return next;
    });
    setRunningGamePath((current) => current === path ? null : current);
    setSteamLaunchBridge(null);
    if (appSettingsRef.current.saveBackupOnExit && deltaSecs > 0) {
      backupSaveFilesForPath(path, true).catch(() => { });
    }
  };

  /** Save or dismiss the note for the pending session */
  const handleSaveSessionNote = (note: string, mood: SessionMood) => {
    if (!pendingNoteSession) return;
    const updated = { ...pendingNoteSession, note, mood };
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
  const handleSteamImport = async (matches: { path: string; addSecs: number }[]) => {
    if (matches.length === 0) return;
    try {
      await ensureSnapshotBeforeRiskyOp("before-steam-import", "Before importing Steam playtime");
    } catch {
      return;
    }
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

  const handleSteamLibraryImport = async (entries: SteamOwnedGame[]) => {
    if (entries.length === 0) return;
    try {
      await ensureSnapshotBeforeRiskyOp("before-steam-library-import", "Before importing Steam library");
    } catch {
      return;
    }

    setGames((prev) => {
      const next = [...prev];
      const seen = new Set(prev.map((g) => normalizePathForMatch(g.path)));
      const placeholderIndexByAppId = new Map<string, number>();
      for (let i = 0; i < next.length; i += 1) {
        const appId = customizations[next[i].path]?.steamAppId?.trim();
        if (appId) placeholderIndexByAppId.set(appId, i);
      }
      for (const entry of entries) {
        const appId = entry.app_id.trim();
        if (entry.exe) {
          const key = normalizePathForMatch(entry.exe);
          const placeholderIndex = placeholderIndexByAppId.get(appId);
          if (placeholderIndex != null) {
            next[placeholderIndex] = {
              ...next[placeholderIndex],
              name: entry.name || next[placeholderIndex].name,
              path: entry.exe,
              uninstalled: false,
            };
            seen.add(key);
            continue;
          }
          if (seen.has(key)) continue;
          next.push({ name: entry.name || deriveGameName(entry.exe), path: entry.exe, uninstalled: false });
          seen.add(key);
          continue;
        }

        const placeholderPath = steamPlaceholderPath(appId);
        const key = normalizePathForMatch(placeholderPath);
        if (seen.has(key)) continue;
        next.push({ name: entry.name || `Steam App ${appId}`, path: placeholderPath, uninstalled: true });
        seen.add(key);
      }
      saveCache(SK_GAMES, next);
      return next;
    });

    setCustomizations((prev) => {
      const next = { ...prev };
      for (const entry of entries) {
        const appId = entry.app_id.trim();
        const targetPath = entry.exe || steamPlaceholderPath(appId);
        const oldPath = Object.keys(next).find((key) => key !== targetPath && next[key]?.steamAppId?.trim() === appId) || null;
        const prevCustom = oldPath ? (next[oldPath] ?? {}) : (next[targetPath] ?? {});
        next[targetPath] = {
          ...prevCustom,
          displayName: prevCustom.displayName ?? entry.name ?? (entry.exe ? deriveGameName(entry.exe) : entry.name),
          steamAppId: appId,
          launchViaSteam: true,
        };
        if (oldPath) delete next[oldPath];
      }
      saveCache(SK_CUSTOM, next);
      return next;
    });
  };

  const handleEpicImport = async (entries: EpicOwnedGame[]) => {
    if (entries.length === 0) return;
    try {
      await ensureSnapshotBeforeRiskyOp("before-epic-import", "Before importing Epic Games Store library");
    } catch {
      return;
    }

    setGames((prev) => {
      const next = [...prev];
      const seen = new Set(prev.map((g) => normalizePathForMatch(g.path)));
      const placeholderIndexByAppName = new Map<string, number>();
      for (let i = 0; i < next.length; i += 1) {
        const appName = customizations[next[i].path]?.epicAppName?.trim().toLowerCase();
        if (appName) placeholderIndexByAppName.set(appName, i);
      }
      for (const entry of entries) {
        const appName = entry.app_name.trim();
        if (!appName) continue;
        if (entry.exe) {
          const key = normalizePathForMatch(entry.exe);
          const placeholderIndex = placeholderIndexByAppName.get(appName.toLowerCase());
          if (placeholderIndex != null) {
            next[placeholderIndex] = {
              ...next[placeholderIndex],
              name: entry.title || next[placeholderIndex].name,
              path: entry.exe,
              uninstalled: false,
            };
            seen.add(key);
            continue;
          }
          if (seen.has(key)) continue;
          next.push({ name: entry.title || deriveGameName(entry.exe), path: entry.exe, uninstalled: false });
          seen.add(key);
          continue;
        }

        const placeholderPath = epicPlaceholderPath(appName);
        const key = normalizePathForMatch(placeholderPath);
        if (seen.has(key)) continue;
        next.push({ name: entry.title || appName, path: placeholderPath, uninstalled: true });
        seen.add(key);
      }
      saveCache(SK_GAMES, next);
      return next;
    });

    setCustomizations((prev) => {
      const next = { ...prev };
      for (const entry of entries) {
        const appName = entry.app_name.trim();
        if (!appName) continue;
        const targetPath = entry.exe || epicPlaceholderPath(appName);
        const oldPath = Object.keys(next).find((key) => key !== targetPath && next[key]?.epicAppName?.trim().toLowerCase() === appName.toLowerCase()) || null;
        const prevCustom = oldPath ? (next[oldPath] ?? {}) : (next[targetPath] ?? {});
        next[targetPath] = {
          ...prevCustom,
          displayName: prevCustom.displayName ?? entry.title ?? (entry.exe ? deriveGameName(entry.exe) : entry.title),
          storeProvider: prevCustom.storeProvider ?? "epic-games",
          storeGameId: prevCustom.storeGameId ?? appName,
          epicAppName: appName,
          launchViaLegendary: prevCustom.launchViaLegendary ?? true,
        };
        if (oldPath) delete next[oldPath];
      }
      saveCache(SK_CUSTOM, next);
      return next;
    });
  };

  const handleItchInstalledImport = async (result: ItchInstallResult) => {
    const [scanned] = await invoke<[Game[], DirMtime[]]>("scan_games", { path: result.installFolder });
    const candidates = [...scanned].sort((a, b) => {
      const preferred = result.title.toLowerCase();
      const score = (game: Game) => {
        const name = (game.name || deriveGameName(game.path)).toLowerCase();
        let value = game.path.replace(/\\/g, "/").split("/").length * 10 + game.path.length;
        if (name === preferred) value -= 200;
        else if (name.includes(preferred) || preferred.includes(name)) value -= 100;
        return value;
      };
      return score(a) - score(b);
    });

    const primary = candidates[0] || null;
    if (!primary) {
      alert(`Itch install finished, but Libmaly could not find a launchable executable in:\n${result.installFolder}`);
      return;
    }

    const cachedCustom = loadCache<Record<string, GameCustomization>>(SK_CUSTOM, {});
    const previousPath = Object.keys(cachedCustom).find((path) => cachedCustom[path]?.itchCaveId === result.caveId) || null;
    if (previousPath && normalizePathForMatch(previousPath) !== normalizePathForMatch(primary.path)) {
      applyExplicitGamePathRemaps([{ oldPath: previousPath, newPath: primary.path }]);
    }

    const nextGames = loadCache<Game[]>(SK_GAMES, []);
    const normalizedPrimary = normalizePathForMatch(primary.path);
    const existingIndex = nextGames.findIndex((game) => normalizePathForMatch(game.path) === normalizedPrimary);
    if (existingIndex >= 0) {
      nextGames[existingIndex] = {
        ...nextGames[existingIndex],
        name: result.title || nextGames[existingIndex].name,
        path: primary.path,
        uninstalled: false,
      };
    } else {
      nextGames.push({ name: result.title || primary.name, path: primary.path, uninstalled: false });
    }
    saveCache(SK_GAMES, nextGames);
    setGames(nextGames);

    const nextCustom = loadCache<Record<string, GameCustomization>>(SK_CUSTOM, {});
    const previousCustom = nextCustom[primary.path] ?? (previousPath ? nextCustom[previousPath] ?? {} : {});
    nextCustom[primary.path] = {
      ...previousCustom,
      displayName: previousCustom.displayName ?? result.title ?? primary.name,
      itchCaveId: result.caveId,
      itchGameId: String(result.gameId),
      pinnedExes: candidates.slice(1, 8).map((candidate) => ({ name: candidate.name, path: candidate.path })),
    };
    if (previousPath && previousPath !== primary.path) {
      delete nextCustom[previousPath];
    }
    saveCache(SK_CUSTOM, nextCustom);
    setCustomizations(nextCustom);
  };

  const handleLutrisImport = async (entries: LutrisGameEntry[]) => {
    if (entries.length === 0) return;
    try {
      await ensureSnapshotBeforeRiskyOp("before-lutris-import", "Before importing Lutris entries");
    } catch {
      return;
    }

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

  const handleInteropImport = async (entries: InteropGameEntry[]) => {
    if (entries.length === 0) return;
    try {
      await ensureSnapshotBeforeRiskyOp("before-interop-import", "Before importing launcher entries");
    } catch {
      return;
    }

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
        const shouldAttachStoreLaunch = !!e.store_uri && ["ea-app", "ubisoft-connect", "rockstar"].includes(e.source);
        next[e.exe] = {
          ...prevCustom,
          displayName: prevCustom.displayName ?? e.name ?? deriveGameName(e.exe),
          launchArgs: prevCustom.launchArgs ?? e.args,
          storeProvider: prevCustom.storeProvider ?? (shouldAttachStoreLaunch ? e.source : undefined),
          storeGameId: prevCustom.storeGameId ?? (shouldAttachStoreLaunch ? e.game_id : undefined),
          storeLaunchUri: prevCustom.storeLaunchUri ?? (shouldAttachStoreLaunch ? e.store_uri ?? undefined : undefined),
          launchViaStore: shouldAttachStoreLaunch ? (prevCustom.launchViaStore ?? true) : prevCustom.launchViaStore,
        };
      }
      saveCache(SK_CUSTOM, next);
      return next;
    });

    setMetadata((prev) => {
      const next = { ...prev };
      for (const e of entries) {
        if (!e.exe) continue;
        if (!e.source_url && !e.cover_url && !e.developer && !e.version && !e.overview) continue;
        next[e.exe] = mergeMetadataWithSnapshot(next[e.exe], {
          source: e.source,
          source_url: e.source_url ?? "",
          title: e.name ?? undefined,
          developer: e.developer ?? undefined,
          cover_url: e.cover_url ?? undefined,
          overview: e.overview ?? undefined,
          version: e.version ?? undefined,
          fetchedAt: Date.now(),
          screenshots: [],
          tags: [],
        });
      }
      saveCache(SK_META, next);
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

  const upsertBackgroundJob = (
    id: string,
    patch: Omit<BackgroundJob, "id" | "updatedAt"> & Partial<Pick<BackgroundJob, "detail" | "progressCurrent" | "progressTotal" | "attempts">>,
  ) => {
    setBackgroundJobs((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        id,
        ...patch,
        updatedAt: Date.now(),
      },
    }));
  };

  const clearBackgroundJob = (id: string) => {
    setBackgroundJobs((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const isBackgroundJobActive = (id: string) => activeBackgroundJobIds.current.has(id);

  const runQueueJob = async <TItem, TResult>({
    jobId,
    label,
    items,
    concurrency = 1,
    maxAttempts = DEFAULT_METADATA_QUEUE_MAX_ATTEMPTS,
    backoffMs = DEFAULT_METADATA_QUEUE_BACKOFF_MS,
    getItemLabel,
    actionLabel,
    successLabel,
    runItem,
    onItemSuccess,
  }: {
    jobId: string;
    label: string;
    items: TItem[];
    concurrency?: number;
    maxAttempts?: number;
    backoffMs?: number;
    getItemLabel: (item: TItem) => string;
    actionLabel: string;
    successLabel: string;
    runItem: (item: TItem) => Promise<TResult>;
    onItemSuccess?: (item: TItem, result: TResult) => void;
  }) => {
    if (items.length === 0 || isBackgroundJobActive(jobId)) {
      return { completed: 0, failed: 0, cancelled: false };
    }

    activeBackgroundJobIds.current.add(jobId);
    upsertBackgroundJob(jobId, {
      label,
      status: "queued",
      detail: `Queued ${items.length} item(s)...`,
      progressCurrent: 0,
      progressTotal: items.length,
      attempts: 1,
    });

    let nextIndex = 0;
    let completed = 0;
    let failed = 0;

    const processOne = async () => {
      while (true) {
        const itemIndex = nextIndex++;
        if (itemIndex >= items.length) return;
        const item = items[itemIndex];
        const itemLabel = getItemLabel(item);

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          const state: BackgroundJobStatus = attempt === 1 ? "running" : "retrying";
          upsertBackgroundJob(jobId, {
            label,
            status: state,
            detail: `${actionLabel} ${completed + failed + 1} / ${items.length}: ${itemLabel} (attempt ${attempt}/${maxAttempts})`,
            progressCurrent: completed + failed,
            progressTotal: items.length,
            attempts: attempt,
          });
          try {
            const result = await runItem(item);
            onItemSuccess?.(item, result);
            completed++;
            upsertBackgroundJob(jobId, {
              label,
              status: "running",
              detail: `${successLabel} ${completed + failed} / ${items.length}`,
              progressCurrent: completed + failed,
              progressTotal: items.length,
              attempts: attempt,
            });
            break;
          } catch (e) {
            if (attempt < maxAttempts) {
              upsertBackgroundJob(jobId, {
                label,
                status: "retrying",
                detail: `Retrying ${itemLabel} after error: ${String(e)}`,
                progressCurrent: completed + failed,
                progressTotal: items.length,
                attempts: attempt,
              });
              await sleep(Math.min(backoffMs * (2 ** (attempt - 1)), 12000));
              continue;
            }
            failed++;
            upsertBackgroundJob(jobId, {
              label,
              status: "failed",
              detail: `Failed ${failed} item(s). Last error on ${itemLabel}: ${String(e)}`,
              progressCurrent: completed + failed,
              progressTotal: items.length,
              attempts: attempt,
            });
          }
        }
      }
    };

    try {
      const workerCount = Math.max(1, Math.min(concurrency, items.length));
      await Promise.all(Array.from({ length: workerCount }, () => processOne()));
      if (failed > 0) {
        upsertBackgroundJob(jobId, {
          label,
          status: "failed",
          detail: `${label} finished with ${failed} failed item(s) out of ${items.length}.`,
          progressCurrent: completed + failed,
          progressTotal: items.length,
          attempts: maxAttempts,
        });
      } else {
        clearBackgroundJob(jobId);
      }
      return { completed, failed, cancelled: false };
    } finally {
      activeBackgroundJobIds.current.delete(jobId);
    }
  };

  const fetchMetadataForPath = async (currentMeta: GameMetadata, gamePath: string) => {
    if (ghostGames[gamePath]) return null; // Ghost mode: no network requests
    const snapshots = metadataSnapshotsFromMeta(currentMeta).filter((snapshot) => isNonEmptyMetadataString(snapshot.source_url));
    if (snapshots.length === 0) return null;

    const refreshedSnapshots: MetadataSourceSnapshot[] = [];
    let successCount = 0;
    let lastError: unknown = null;

    for (const snapshot of snapshots) {
      if (!snapshot.source_url) {
        refreshedSnapshots.push(snapshot);
        continue;
      }
      try {
        const result = await invokeMetadataBySource(snapshot.source, snapshot.source_url);
        if (result) {
          refreshedSnapshots.push(normalizeMetadataSnapshot({
            ...result,
            source: snapshot.source,
            source_label: result.source_label || snapshot.source_label,
            source_url: snapshot.source_url,
            fetchedAt: Date.now(),
            screenshots: result.screenshots || [],
            tags: result.tags || [],
          }));
          successCount += 1;
        } else {
          refreshedSnapshots.push(snapshot);
        }
      } catch (error) {
        lastError = error;
        refreshedSnapshots.push(snapshot);
      }
    }

    if (successCount === 0 && lastError) {
      throw lastError;
    }

    return mergeMetadataSnapshots(refreshedSnapshots);
  };

  const applyMetadataUpdate = (path: string, nextMeta: GameMetadata) => {
    setMetadata((prev) => {
      const next = { ...prev, [path]: mergeMetadataSnapshots(metadataSnapshotsFromMeta(nextMeta)) };
      saveCache(SK_META, next);
      return next;
    });
  };

  const runMetadataQueueJob = async ({
    jobId,
    label,
    items,
    mode,
    concurrency = DEFAULT_METADATA_QUEUE_CONCURRENCY,
    maxAttempts = DEFAULT_METADATA_QUEUE_MAX_ATTEMPTS,
    backoffMs = DEFAULT_METADATA_QUEUE_BACKOFF_MS,
    onItemSuccess,
  }: {
    jobId: string;
    label: string;
    items: MetadataQueueItem[];
    mode: "refresh" | "update-check";
    concurrency?: number;
    maxAttempts?: number;
    backoffMs?: number;
    onItemSuccess?: (path: string, meta: GameMetadata) => void;
  }) => {
    return runQueueJob<MetadataQueueItem, GameMetadata | null>({
      jobId,
      label,
      items,
      concurrency,
      maxAttempts,
      backoffMs,
      getItemLabel: (item) => item.path,
      actionLabel: mode === "update-check" ? "Checking" : "Updating",
      successLabel: mode === "update-check" ? "Checked" : "Updated",
      runItem: (item) => fetchMetadataForPath(item.metadata, item.path),
      onItemSuccess: (item, nextMeta) => {
        if (nextMeta) {
          onItemSuccess?.(item.path, nextMeta);
        }
      },
    });
  };

  const runFolderSyncQueueJob = async ({
    jobId,
    label,
    folders,
    scanMode,
  }: {
    jobId: string;
    label: string;
    folders: LibraryFolder[];
    scanMode: "incremental" | "full";
  }) => {
    let workingGames = gamesRef.current;
    let workingMtimes = loadCache<DirMtime[]>(SK_MTIMES, []);

    const runFolderScan = async (item: FolderQueueItem) => {
      if (scanMode === "full") {
        return await invoke<[Game[], DirMtime[]]>("scan_games", { path: item.path }).catch(() => [[], []] as [Game[], DirMtime[]]);
      }
      try {
        return await invoke<[Game[], DirMtime[]]>("scan_games_incremental", {
          path: item.path,
          cachedGames: workingGames,
          cachedMtimes: workingMtimes,
        });
      } catch {
        return await invoke<[Game[], DirMtime[]]>("scan_games", { path: item.path }).catch(() => [[], []] as [Game[], DirMtime[]]);
      }
    };

    const result = await runQueueJob<FolderQueueItem, [Game[], DirMtime[]]>({
      jobId,
      label,
      items: folders.map((folder) => ({ path: folder.path })),
      concurrency: 1,
      maxAttempts: 2,
      backoffMs: 1000,
      getItemLabel: (item) => item.path,
      actionLabel: "Scanning",
      successLabel: "Scanned",
      runItem: runFolderScan,
      onItemSuccess: (item, [ng, nm]) => {
        const merged = applySingleScanResult(workingGames, workingMtimes, ng, nm, item.path);
        workingGames = merged.games;
        workingMtimes = merged.mtimes;
      },
    });

    if (result.failed === 0) {
      persistScanState(workingGames, workingMtimes);
    }
    return result;
  };

  const syncJob = syncState === "full-scan"
    ? backgroundJobs[JOB_FULL_SCAN] ?? null
    : syncState === "syncing"
      ? backgroundJobs[JOB_INCREMENTAL_SYNC] ?? null
      : null;
  const integrityCheckJob = backgroundJobs[JOB_INTEGRITY_CHECK] ?? null;
  const batchMetadataRefreshJob = backgroundJobs[JOB_BATCH_METADATA_REFRESH] ?? null;
  const backgroundJobSummaries = useMemo(
    () => Object.values(backgroundJobs).sort((a, b) => b.updatedAt - a.updatedAt),
    [backgroundJobs],
  );
  const integrityCheckStatus = backgroundJobButtonLabel(integrityCheckJob, t("settings.scanner.integrity_check"));
  const batchRefreshStatus = backgroundJobButtonLabel(batchMetadataRefreshJob, t("settings.scanner.refetch_all"));
  const autoHealPathsJob = backgroundJobs[JOB_AUTO_HEAL_PATHS] ?? null;
  const autoHealPathsStatus = backgroundJobButtonLabel(autoHealPathsJob, t("settings.scanner.auto_heal"));
  const backupRetentionJob = backgroundJobs[JOB_BACKUP_RETENTION] ?? null;
  const backupRetentionStatus = backgroundJobButtonLabel(backupRetentionJob, t("settings.system.apply_backup"));
  const dbVacuumJob = backgroundJobs[JOB_DB_VACUUM] ?? null;
  const dbVacuumStatus = backgroundJobButtonLabel(dbVacuumJob, "Optimize Storage");
  const autoCloudBackupJob = backgroundJobs[JOB_AUTO_CLOUD_BACKUP] ?? null;
  const isIntegrityCheckBusy = integrityCheckJob ? isBackgroundJobBusy(integrityCheckJob.status) : false;
  const isBatchMetadataRefreshBusy = batchMetadataRefreshJob ? isBackgroundJobBusy(batchMetadataRefreshJob.status) : false;
  const isAutoHealPathsBusy = autoHealPathsJob ? isBackgroundJobBusy(autoHealPathsJob.status) : false;
  const isBackupRetentionBusy = backupRetentionJob ? isBackgroundJobBusy(backupRetentionJob.status) : false;
  const isDbVacuumBusy = dbVacuumJob ? isBackgroundJobBusy(dbVacuumJob.status) : false;
  const isAutoCloudBackupBusy = autoCloudBackupJob ? isBackgroundJobBusy(autoCloudBackupJob.status) : false;

  // ── Scanning ────────────────────────────────────────────────────────────────
  const runIncrementalSyncAll = async (folders: LibraryFolder[]) => {
    if (isSyncing.current) return;
    isSyncing.current = true; setSyncState("syncing");
    try {
      await runFolderSyncQueueJob({
        jobId: JOB_INCREMENTAL_SYNC,
        label: "Incremental Sync",
        folders,
        scanMode: "incremental",
      });
    } catch (e) {
      upsertBackgroundJob(JOB_INCREMENTAL_SYNC, {
        label: "Incremental Sync",
        status: "permanent_failed",
        detail: `Incremental sync failed: ${String(e)}`,
      });
      throw e;
    } finally {
      isSyncing.current = false; setSyncState("idle");
    }
  };

  const runFullScanAll = async (folders: LibraryFolder[]) => {
    setSyncState("full-scan");
    try {
      await runFolderSyncQueueJob({
        jobId: JOB_FULL_SCAN,
        label: "Full Rescan",
        folders,
        scanMode: "full",
      });
    } catch (e) {
      upsertBackgroundJob(JOB_FULL_SCAN, {
        label: "Full Rescan",
        status: "permanent_failed",
        detail: `Full rescan failed: ${String(e)}`,
      });
      throw e;
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
      await runFolderSyncQueueJob({
        jobId: JOB_FULL_SCAN,
        label: "Full Rescan",
        folders: [{ path: sel }],
        scanMode: "full",
      });
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

  const installZipIntoLibrary = async (zipPath: string, libraryRoot: string) => {
    setZipInstallInProgress(true);
    try {
      const result = await invoke<ZipInstallResult>("install_zip_game_to_library", {
        zipPath,
        libraryRoot,
      });
      const scanned = await invoke<[Game[], DirMtime[]]>("scan_games", {
        path: result.installedDir,
      });
      const installedGames = Array.isArray(scanned?.[0]) ? scanned[0] : [];

      if (installedGames.length > 0) {
        setGames((prev) => {
          const next = [...prev];
          const seen = new Set(prev.map((g) => normalizePathForMatch(g.path)));
          for (const game of installedGames) {
            const key = normalizePathForMatch(game.path);
            if (seen.has(key)) continue;
            next.push({ ...game, uninstalled: false });
            seen.add(key);
          }
          saveCache(SK_GAMES, next);
          return next;
        });

        const primary = installedGames[0];
        openGameView(primary);
        setActiveMainTab("library");
        alert(
          result.warnings.length > 0
            ? `Archive installed to:\n${result.installedDir}\n\nFound ${installedGames.length} executable(s).\n\nWarnings:\n${result.warnings.join("\n")}`
            : `Archive installed to:\n${result.installedDir}\n\nFound ${installedGames.length} executable(s).`,
        );
      } else {
        alert(
          result.warnings.length > 0
            ? `Archive installed to:\n${result.installedDir}\n\nNo launchable executables were detected automatically.\n\nWarnings:\n${result.warnings.join("\n")}`
            : `Archive installed to:\n${result.installedDir}\n\nNo launchable executables were detected automatically.`,
        );
      }

      setPendingZipInstallPath(null);
      setShowZipInstallModal(false);
    } finally {
      setZipInstallInProgress(false);
    }
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
    try {
      await ensureSnapshotBeforeRiskyOp("before-folder-migration", `Before migrating library paths from ${oldRoot} to ${newRoot}`);
    } catch {
      return 0;
    }

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
    const nextAchievements = remapRecord(achievements);
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
    setAchievements(nextAchievements); saveCache(SK_ACHIEVEMENTS, nextAchievements);
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

  const applyExplicitGamePathRemaps = (pairs: { oldPath: string; newPath: string; }[]) => {
    if (pairs.length === 0) return 0;
    const pathMap = new Map<string, string>();
    for (const pair of pairs) {
      pathMap.set(normalizePathForMatch(pair.oldPath), pair.newPath);
    }
    const remapGamePath = (path: string) => pathMap.get(normalizePathForMatch(path)) ?? null;
    const remapGamePathOrSelf = (path: string) => remapGamePath(path) ?? path;
    const remapNestedFileForGame = (ownerGamePath: string, nestedPath?: string) => {
      if (!nestedPath) return nestedPath;
      const ownerNewPath = remapGamePath(ownerGamePath);
      if (!ownerNewPath) return nestedPath;
      return remapPathByPrefix(nestedPath, pathDirname(ownerGamePath), pathDirname(ownerNewPath)) ?? nestedPath;
    };
    const remapRecord = <T,>(src: Record<string, T>): Record<string, T> => {
      const out: Record<string, T> = {};
      for (const [k, v] of Object.entries(src)) out[remapGamePathOrSelf(k)] = v;
      return out;
    };

    const touchedOldPaths = new Set<string>();
    const nextGamesRaw = games.map((g) => {
      const mapped = remapGamePath(g.path);
      if (!mapped) return g;
      touchedOldPaths.add(g.path);
      return { ...g, path: mapped, uninstalled: false };
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
    const nextAchievements = remapRecord(achievements);
    const nextHistory = remapRecord(history);
    const nextCollections = collections.map((c) => ({
      ...c,
      gamePaths: Array.from(new Set(c.gamePaths.map(remapGamePathOrSelf))),
    }));
    const nextSessionLog = sessionLog.map((s) => ({ ...s, path: remapGamePathOrSelf(s.path) }));
    const nextCustomOrder: Record<string, string[]> = Object.fromEntries(
      Object.entries(customOrder).map(([k, arr]) => [k, Array.from(new Set(arr.map(remapGamePathOrSelf)))])
    );
    const nextRecent = loadCache<RecentGame[]>(SK_RECENT, []).map((r) => ({ ...r, path: remapGamePathOrSelf(r.path) }));

    const nextCustomizations: Record<string, GameCustomization> = {};
    for (const [path, custom] of Object.entries(customizations)) {
      const nextPath = remapGamePathOrSelf(path);
      nextCustomizations[nextPath] = {
        ...custom,
        exeOverride: remapNestedFileForGame(path, custom.exeOverride),
        pinnedExes: custom.pinnedExes?.map((p) => ({ ...p, path: remapNestedFileForGame(path, p.path) || p.path })),
        runnerOverride: custom.runnerOverride
          ? {
            ...custom.runnerOverride,
            prefixPath: custom.runnerOverride.prefixPath,
            runnerPath: custom.runnerOverride.runnerPath,
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
    setAchievements(nextAchievements); saveCache(SK_ACHIEVEMENTS, nextAchievements);
    setHistory(nextHistory); saveCache(SK_HISTORY, nextHistory);
    setCollections(nextCollections); saveCache(SK_COLLECTIONS, nextCollections);
    setSessionLog(nextSessionLog); saveCache(SK_SESSION_LOG, nextSessionLog);
    setCustomOrder(nextCustomOrder); saveCache(SK_ORDER, nextCustomOrder);
    setCustomizations(nextCustomizations); saveCache(SK_CUSTOM, nextCustomizations);
    setRecentGames(nextRecent); saveCache(SK_RECENT, nextRecent);
    invoke("set_recent_games", { games: nextRecent }).catch(() => { });

    if (selected) {
      const mapped = remapGamePath(selected.path);
      if (mapped) {
        const nextSelected = nextGames.find((g) => normalizePathForMatch(g.path) === normalizePathForMatch(mapped)) || null;
        setSelected(nextSelected);
      }
    }
    setRunningGamePath((prev) => (prev ? remapGamePathOrSelf(prev) : prev));
    setDeleteTarget((prev) => (prev ? { ...prev, path: remapGamePathOrSelf(prev.path) } : prev));
    setPendingMetaUpdate((prev) => (prev ? { ...prev, path: remapGamePathOrSelf(prev.path) } : prev));
    setScreenshots((prev) => {
      const next: Record<string, Screenshot[]> = {};
      for (const [k, v] of Object.entries(prev)) next[remapGamePathOrSelf(k)] = v;
      return next;
    });
    setNavHistory((prev) => prev.map((n) => ({
      ...n,
      selectedPath: n.selectedPath ? remapGamePathOrSelf(n.selectedPath) : null,
    })));

    return touchedOldPaths.size;
  };

  const handleAutoHealPaths = async () => {
    if (isAutoHealPathsBusy) return;
    upsertBackgroundJob(JOB_AUTO_HEAL_PATHS, {
      label: "Auto-Heal Paths",
      status: "running",
      detail: "Scanning library folders for moved or renamed games...",
    });
    try {
      const report = await invoke<AutoHealReport>("suggest_auto_heal_paths", {
        libraryFolders,
        games,
      });
      if (report.suggestions.length === 0) {
        clearBackgroundJob(JOB_AUTO_HEAL_PATHS);
        alert(report.totalBrokenGames === 0
          ? "No broken game paths were detected."
          : "No confident auto-heal matches were found. Try Migration Wizard or a manual rescan.");
        return;
      }

      const summaryLines = [
        `Auto-heal found ${report.suggestionCount} suggestion(s) for ${report.totalBrokenGames} broken game path(s).`,
        "",
        ...report.suggestions.slice(0, 8).map((x) => `${x.gameName}: ${x.oldPath} -> ${x.newPath} (${x.confidence}%)`),
      ];
      if (report.unresolvedPaths.length > 0) {
        summaryLines.push("");
        summaryLines.push(`Unresolved: ${report.unresolvedPaths.length}`);
      }
      const proceed = confirm(`${summaryLines.join("\n")}\n\nApply these path fixes?`);
      if (!proceed) {
        clearBackgroundJob(JOB_AUTO_HEAL_PATHS);
        return;
      }

      await ensureSnapshotBeforeRiskyOp("before-auto-heal-paths", "Before auto-healing moved or renamed game paths");
      const healed = applyExplicitGamePathRemaps(report.suggestions.map((x) => ({ oldPath: x.oldPath, newPath: x.newPath })));
      upsertBackgroundJob(JOB_AUTO_HEAL_PATHS, {
        label: "Auto-Heal Paths",
        status: "running",
        detail: `Applied ${healed} path fix(es). Refreshing library scan...`,
      });
      if (libraryFolders.length > 0) {
        runIncrementalSyncAll(libraryFolders).catch(() => { });
      }
      clearBackgroundJob(JOB_AUTO_HEAL_PATHS);
      alert(`Auto-heal applied ${healed} path fix(es).${report.unresolvedPaths.length > 0 ? `\nUnresolved paths: ${report.unresolvedPaths.length}` : ""}`);
    } catch (e) {
      upsertBackgroundJob(JOB_AUTO_HEAL_PATHS, {
        label: "Auto-Heal Paths",
        status: "permanent_failed",
        detail: `Auto-heal failed: ${String(e)}`,
      });
      alert("Auto-heal failed: " + e);
    }
  };

  const applyBackupRetentionPolicy = async (silent = false) => {
    if (isBackupRetentionBusy) return null;
    upsertBackgroundJob(JOB_BACKUP_RETENTION, {
      label: "Backup Retention",
      status: "running",
      detail: "Pruning snapshots and save backups by retention policy...",
    });
    try {
      const result = await invoke<BackupRetentionApplyResult>("apply_backup_retention_policy", {
        policy: {
          dailyKeep: Math.max(0, appSettingsRef.current.backupRetentionDailyKeep || 0),
          weeklyKeep: Math.max(0, appSettingsRef.current.backupRetentionWeeklyKeep || 0),
          monthlyKeep: Math.max(0, appSettingsRef.current.backupRetentionMonthlyKeep || 0),
        },
      });
      clearBackgroundJob(JOB_BACKUP_RETENTION);
      if (!silent) {
        alert(
          `Backup retention applied.\n` +
          `Snapshots: kept ${result.snapshotsKept}, deleted ${result.snapshotsDeleted}\n` +
          `Save backups: kept ${result.saveBackupsKept}, deleted ${result.saveBackupsDeleted}`
        );
      }
      return result;
    } catch (e) {
      upsertBackgroundJob(JOB_BACKUP_RETENTION, {
        label: "Backup Retention",
        status: "permanent_failed",
        detail: `Backup retention failed: ${String(e)}`,
      });
      if (!silent) {
        alert("Backup retention failed: " + e);
      }
      return null;
    }
  };

  const runDbVacuum = async (silent = false) => {
    if (isDbVacuumBusy) return null;
    upsertBackgroundJob(JOB_DB_VACUUM, {
      label: "Storage Vacuum",
      status: "running",
      detail: "Pruning in-memory logs, journal, and orphaned temp files...",
    });
    try {
      const result = await invoke<VacuumReport>("run_db_vacuum");
      clearBackgroundJob(JOB_DB_VACUUM);
      if (!silent) {
        const freed = result.tempBytesFreed > 0
          ? `\nTemp files freed: ${result.tempBytesFreed} bytes (${result.tempFilesRemoved} file(s))`
          : "";
        const pruned = (result.logEntriesPruned + result.journalEntriesPruned) > 0
          ? `\nLog/journal entries pruned: ${result.logEntriesPruned + result.journalEntriesPruned}`
          : "";
        alert(`Storage optimized in ${result.durationMs}ms.${freed}${pruned || (freed ? "" : "\nNothing to prune — storage is already clean.")}`);
      }
      return result;
    } catch (e) {
      upsertBackgroundJob(JOB_DB_VACUUM, {
        label: "Storage Vacuum",
        status: "permanent_failed",
        detail: `Vacuum failed: ${String(e)}`,
      });
      if (!silent) {
        alert("Storage vacuum failed: " + e);
      }
      return null;
    }
  };

  const runAutoCloudBackup = useCallback(async () => {
    if (isAutoCloudBackupBusy) return null;
    upsertBackgroundJob(JOB_AUTO_CLOUD_BACKUP, {
      label: "Cloud Auto-Backup",
      status: "running",
      detail: "Preparing cloud backup...",
    });
    try {
      const config = await syncGetConfig();
      if (!config) {
        upsertBackgroundJob(JOB_AUTO_CLOUD_BACKUP, {
          label: "Cloud Auto-Backup",
          status: "permanent_failed",
          detail: "Cloud backup skipped: no provider configured.",
        });
        return null;
      }
      if (!isAutoBackupProvider(config.provider)) {
        upsertBackgroundJob(JOB_AUTO_CLOUD_BACKUP, {
          label: "Cloud Auto-Backup",
          status: "permanent_failed",
          detail: `Cloud backup requires Google Drive or Dropbox. Current provider: ${getSyncProviderLabel(config.provider)}.`,
        });
        return null;
      }
      upsertBackgroundJob(JOB_AUTO_CLOUD_BACKUP, {
        label: "Cloud Auto-Backup",
        status: "running",
        detail: `Uploading library state to ${getSyncProviderLabel(config.provider)}...`,
      });
      const result = await syncUpload();
      clearBackgroundJob(JOB_AUTO_CLOUD_BACKUP);
      persistAppSettings((prev) => ({
        ...prev,
        cloudAutoBackupLastSuccessAt: Date.now(),
      }));
      return result;
    } catch (e) {
      upsertBackgroundJob(JOB_AUTO_CLOUD_BACKUP, {
        label: "Cloud Auto-Backup",
        status: "permanent_failed",
        detail: `Cloud auto-backup failed: ${String(e)}`,
      });
      return null;
    }
  }, [clearBackgroundJob, isAutoCloudBackupBusy, persistAppSettings, upsertBackgroundJob]);

  useEffect(() => {
    if (!appSettings.cloudAutoBackupEnabled) return;
    const intervalMinutes = Math.max(5, appSettings.cloudAutoBackupIntervalMinutes || 0);
    const initialTimer = window.setTimeout(() => {
      runAutoCloudBackup().catch(() => {});
    }, Math.min(intervalMinutes * 60 * 1000, 60_000));
    const periodicTimer = window.setInterval(() => {
      runAutoCloudBackup().catch(() => {});
    }, intervalMinutes * 60 * 1000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(periodicTimer);
    };
  }, [appSettings.cloudAutoBackupEnabled, appSettings.cloudAutoBackupIntervalMinutes, runAutoCloudBackup]);

  const backupSaveFilesForPath = async (gamePath: string, silent = false) => {
    try {
      const res = await invoke<SaveBackupResult>("backup_save_files", { gamePath });
      await applyBackupRetentionPolicy(true);
      if (!silent) {
        alert(`Save backup created:\n${res.zip_path}\nFiles: ${res.files}`);
      }
      return res;
    } catch (e) {
      if (!silent) {
        await showPermissionDiagnostic("create the save-file backup", null, e, "Save-file backup failed");
      }
      throw e;
    }
  };

  const backupSaveFilesToCloudForPath = async (gamePath: string) => {
    try {
      const result = await invoke<SyncSaveBackupResult>("sync_upload_save_backup", { gamePath });
      await applyBackupRetentionPolicy(true);
      alert(
        `Save backup created and uploaded:\n${result.zipPath}\nRemote: ${result.remotePath}\nFiles: ${result.files}`,
      );
      return result;
    } catch (e) {
      alert(`Cloud save backup failed: ${String(e)}`);
      throw e;
    }
  };

  const installSelectedSteamGame = async () => {
    if (!selected) return;
    const appId = customizations[selected.path]?.steamAppId?.trim();
    if (!appId) {
      alert("This game does not have a Steam app ID yet.");
      return;
    }
    try {
      await invoke("install_steam_game", { appId });
      alert("Steam install request sent. Once the game is installed, re-run the Steam library import to upgrade this placeholder into a local executable entry.");
    } catch (e) {
      alert(`Failed to trigger Steam install: ${String(e)}`);
    }
  };

  const installSelectedEpicGame = async () => {
    if (!selected) return;
    const appName = customizations[selected.path]?.epicAppName?.trim();
    if (!appName) {
      alert("This game does not have an Epic / Legendary app name yet.");
      return;
    }
    try {
      await invoke("install_epic_game", { appName });
      alert("Legendary install started. Re-run the Epic import after completion to replace the placeholder with the installed executable path.");
    } catch (e) {
      alert(`Failed to start Legendary install: ${String(e)}`);
    }
  };

  const installSelectedUbisoftGame = async () => {
    if (!selected) return;
    const customization = customizations[selected.path];
    const gameId = customization?.storeGameId?.trim();
    if (!gameId) {
      alert("This game does not have a Ubisoft Connect game ID yet.");
      return;
    }
    try {
      await invoke("launch_store_uri", { uri: `uplay://install/${encodeURIComponent(gameId)}` });
      alert("Ubisoft Connect install request sent. Re-run the Ubisoft import after completion to replace this launcher entry with the installed executable path.");
    } catch (e) {
      alert(`Failed to trigger Ubisoft Connect install: ${String(e)}`);
    }
  };

  const installSelectedRemoteStoreGame = async () => {
    if (!selected) return;
    const customization = customizations[selected.path];
    if (!customization) {
      alert("This game does not have remote install metadata yet.");
      return;
    }
    if (customization.steamAppId?.trim()) {
      await installSelectedSteamGame();
      return;
    }
    if (customization.epicAppName?.trim()) {
      await installSelectedEpicGame();
      return;
    }
    if (customization.storeProvider === "ubisoft-connect" && customization.storeGameId?.trim()) {
      await installSelectedUbisoftGame();
      return;
    }
    alert("This launcher does not support remote install from Libmaly yet.");
  };

  const launchSelectedStoreGame = async () => {
    if (!selected) return;
    const uri = customizations[selected.path]?.storeLaunchUri?.trim();
    if (!uri) {
      alert("This game does not have a launcher protocol URI yet.");
      return;
    }
    try {
      await invoke("launch_store_uri", { uri });
    } catch (e) {
      alert(`Failed to launch from store: ${String(e)}`);
    }
  };

  const formatPermissionDiagnostic = (diag: PermissionDiagnostic, fallbackTitle?: string) => {
    const lines = [
      fallbackTitle || "File operation failed.",
      "",
      diag.summary,
    ];
    if (diag.targetPath) {
      lines.push(`Path: ${diag.targetPath}`);
    }
    lines.push(`Cause: ${diag.probableCause}`);
    if (diag.actionableFixes.length > 0) {
      lines.push("");
      lines.push("Try this:");
      for (const fix of diag.actionableFixes.slice(0, 4)) {
        lines.push(`- ${fix}`);
      }
    }
    return lines.join("\n");
  };

  const showPermissionDiagnostic = async (
    operation: string,
    targetPath: string | null,
    error: unknown,
    fallbackTitle?: string,
  ) => {
    const rawError = String(error ?? "Unknown error");
    try {
      const diag = await invoke<PermissionDiagnostic>("diagnose_permissions_failure", {
        operation,
        targetPath,
        rawError,
      });
      alert(formatPermissionDiagnostic(diag, fallbackTitle));
    } catch {
      alert(`${fallbackTitle || "File operation failed"}: ${rawError}`);
    }
  };

  const createStateSnapshot = async (label: string, reason: string) => {
    const dirMtimes = loadCache<DirMtime[]>(SK_MTIMES, []);
    const result = await invoke<SnapshotResult>("create_snapshot", {
      request: {
        label,
        reason,
        entries: buildSnapshotEntries({
          libraryFolders,
          games,
          stats,
          metadata,
          hiddenGames,
          favGames,
          ghostGames,
          customizations,
          notes,
          achievements,
          collections,
          launchConfig,
          recentGames: loadCache<RecentGame[]>(SK_RECENT, []),
          customOrder,
          sessionLog,
          wishlist,
          history,
          appSettings,
          dirMtimes,
        }),
      },
    });
    await applyBackupRetentionPolicy(true);
    return result;
  };

  const getCurrentSnapshotEntries = (): Record<string, string> => buildSnapshotEntries({
    libraryFolders,
    games,
    stats,
    metadata,
    hiddenGames,
    favGames,
    ghostGames,
    customizations,
    notes,
    achievements,
    collections,
    launchConfig,
    recentGames: loadCache<RecentGame[]>(SK_RECENT, []),
    customOrder,
    sessionLog,
    wishlist,
    history,
    appSettings,
    dirMtimes: loadCache<DirMtime[]>(SK_MTIMES, []),
  });

  const createPreUpdateBackup = async () => {
    try {
      const entries = getCurrentSnapshotEntries();
      const result = await invoke<{ id: string }>("create_snapshot", {
        request: {
          label: "pre-update-backup",
          reason: `Automatic backup before updating to version ${appUpdate?.version || "latest"}`,
          entries,
        },
      });
      console.log("Pre-update backup created:", result.id);
    } catch (e) {
      console.error("Failed to create pre-update backup:", e);
      // Don't block the update if backup fails
    }
  };

  const ensureSnapshotBeforeRiskyOp = async (label: string, reason: string) => {
    try {
      return await createStateSnapshot(label, reason);
    } catch (e) {
      await showPermissionDiagnostic("create a safety snapshot", null, e, "Could not create a pre-operation snapshot");
      const proceed = confirm("Snapshot creation failed. Continue without a restore point?");
      if (!proceed) throw new Error("Snapshot creation failed and operation was cancelled.");
      return null;
    }
  };

  const refreshSnapshots = async () => {
    setSnapshotsLoading(true);
    try {
      const next = await invoke<SnapshotResult[]>("list_snapshots");
      setSnapshots(next);
      const nextSelectedPath = selectedSnapshotPath && next.some((x) => x.path === selectedSnapshotPath)
        ? selectedSnapshotPath
        : (next[0]?.path ?? null);
      setSelectedSnapshotPath(nextSelectedPath);
      if (nextSelectedPath) {
        setSnapshotPreviewLoading(true);
        setSnapshotPreviewError(null);
        try {
          const preview = await invoke<SnapshotRestorePreview>("preview_restore_snapshot", {
            path: nextSelectedPath,
            currentEntries: getCurrentSnapshotEntries(),
          });
          setSnapshotPreview(preview);
        } catch (e) {
          setSnapshotPreview(null);
          setSnapshotPreviewError(String(e));
        } finally {
          setSnapshotPreviewLoading(false);
        }
      } else {
        setSnapshotPreview(null);
        setSnapshotPreviewError(null);
      }
    } catch (e) {
      alert("Could not load snapshots: " + e);
    } finally {
      setSnapshotsLoading(false);
    }
  };

  const handleSelectSnapshot = async (path: string) => {
    setSelectedSnapshotPath(path);
    setSnapshotPreview(null);
    setSnapshotPreviewError(null);
    setSnapshotPreviewLoading(true);
    try {
      const preview = await invoke<SnapshotRestorePreview>("preview_restore_snapshot", {
        path,
        currentEntries: getCurrentSnapshotEntries(),
      });
      setSnapshotPreview(preview);
    } catch (e) {
      setSnapshotPreviewError(String(e));
    } finally {
      setSnapshotPreviewLoading(false);
    }
  };

  const applyRestoredEntries = (entries: Record<string, string>) => {
    const knownKeys = Object.keys(getCurrentSnapshotEntries());
    const getParsed = <T,>(key: string, fallback: T): T => {
      const raw = entries[key];
      if (typeof raw !== "string") return fallback;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return fallback;
      }
    };

    for (const key of knownKeys) {
      if (!(key in entries)) {
        appStorageRemoveItem(key);
      }
    }
    for (const [key, value] of Object.entries(entries)) {
      appStorageSetItem(key, value);
    }

    const nextFolders = getParsed<LibraryFolder[]>(SK_FOLDERS, []);
    const nextGames = getParsed<Game[]>(SK_GAMES, []);
    const nextStats = getParsed<Record<string, GameStats>>(SK_STATS, {});
    const nextMetadata = getParsed<Record<string, GameMetadata>>(SK_META, {});
    const nextHidden = getParsed<Record<string, boolean>>(SK_HIDDEN, {});
    const nextFavs = getParsed<Record<string, boolean>>(SK_FAVS, {});
    const nextCustom = getParsed<Record<string, GameCustomization>>(SK_CUSTOM, {});
    const nextNotes = getParsed<Record<string, string>>(SK_NOTES, {});
    const nextAchievements = normalizeAchievementsMap(getParsed<Record<string, unknown>>(SK_ACHIEVEMENTS, {}));
    const nextCollections = getParsed<Collection[]>(SK_COLLECTIONS, []);
    const nextLaunch = { ...DEFAULT_LAUNCH_CONFIG, ...getParsed<LaunchConfig>(SK_LAUNCH, DEFAULT_LAUNCH_CONFIG) };
    const nextRecent = getParsed<RecentGame[]>(SK_RECENT, []);
    const nextOrder = getParsed<Record<string, string[]>>(SK_ORDER, {});
    const nextSession = getParsed<SessionEntry[]>(SK_SESSION_LOG, []);
    const nextWishlist = getParsed<WishlistItem[]>(SK_WISHLIST, []);
    const nextHistory = getParsed<GameHistoryMap>(SK_HISTORY, {});
    const nextSettings: AppSettings = {
      ...DEFAULT_SETTINGS,
      ...getParsed<Partial<AppSettings>>(SK_SETTINGS, DEFAULT_SETTINGS),
    };
    const nextMtimes = getParsed<DirMtime[]>(SK_MTIMES, []);

    setLibraryFolders(nextFolders);
    setGames(nextGames);
    setStats(nextStats);
    setMetadata(nextMetadata);
    setHiddenGames(nextHidden);
    setFavGames(nextFavs);
    setCustomizations(nextCustom);
    setNotes(nextNotes);
    setAchievements(nextAchievements);
    setCollections(nextCollections);
    setLaunchConfig(nextLaunch);
    setRecentGames(nextRecent);
    setCustomOrder(nextOrder);
    setSessionLog(nextSession);
    setWishlist(nextWishlist);
    setHistory(nextHistory);
    setAppSettings(nextSettings);
    saveCache(SK_MTIMES, nextMtimes);
    if (selected && !nextGames.some((g) => g.path === selected.path)) {
      setSelected(null);
    }
  };

  const handleRestoreSnapshot = async () => {
    if (!selectedSnapshotPath) return;
    setRestoringSnapshot(true);
    try {
      await ensureSnapshotBeforeRiskyOp("before-snapshot-restore", "Before restoring a snapshot");
      const snapshot = snapshotPreview?.snapshot && snapshotPreview.snapshot.path === selectedSnapshotPath
        ? snapshotPreview.snapshot
        : await invoke<SnapshotContents>("restore_snapshot", { path: selectedSnapshotPath });
      applyRestoredEntries(snapshot.entries);
      setShowSnapshotRestore(false);
      setSnapshotPreview(null);
      setSnapshotPreviewError(null);
      alert(`Snapshot restored:\n${snapshot.path}`);
    } catch (e) {
      if (!String(e).includes("cancelled")) {
        alert("Snapshot restore failed: " + e);
      }
    } finally {
      setRestoringSnapshot(false);
    }
  };

  const handleResumeNormalStartup = async () => {
    setShowRecoveryPrompt(false);
    setRecoveryMode(false);
    const roots = libraryFolders.length > 0
      ? libraryFolders
      : (() => {
        const legacyPath = appStorageGetItem(SK_PATH);
        return legacyPath ? [{ path: legacyPath }] : [];
      })();
    if (roots.length > 0) {
      runIncrementalSyncAll(roots).catch(() => { });
    }
    runDeferredStartupTasks();
  };

  const launchGame = async (path: string, overridePath?: string, overrideArgs?: string) => {
    const gameCustom = customizations[path];

    if (!overridePath && !overrideArgs && isSteamPlaceholderPath(path) && gameCustom?.steamAppId?.trim()) {
      try {
        await invoke("install_steam_game", { appId: gameCustom.steamAppId.trim() });
      } catch (e) {
        alert("Failed to trigger Steam install: " + e);
      }
      return;
    }

    if (!overridePath && !overrideArgs && isEpicPlaceholderPath(path) && gameCustom?.epicAppName?.trim()) {
      try {
        await invoke("install_epic_game", { appName: gameCustom.epicAppName.trim() });
      } catch (e) {
        alert("Failed to trigger Epic install: " + e);
      }
      return;
    }

    const shouldLaunchViaLegendary = !overridePath && !overrideArgs && !!gameCustom?.launchViaLegendary && !!gameCustom?.epicAppName?.trim();
    if (shouldLaunchViaLegendary && gameCustom?.epicAppName) {
      try {
        await invoke("launch_epic_game", { appName: gameCustom.epicAppName.trim() });
      } catch (e) {
        alert("Failed to launch through Legendary: " + e);
      }
      return;
    }

    const shouldLaunchViaStore = !overridePath && !overrideArgs && !!gameCustom?.launchViaStore && !!gameCustom?.storeLaunchUri?.trim();
    if (shouldLaunchViaStore && gameCustom?.storeLaunchUri) {
      try {
        await invoke("launch_store_uri", { uri: gameCustom.storeLaunchUri.trim() });
      } catch (e) {
        alert("Failed to launch through store: " + e);
      }
      return;
    }

    // Only launch via Steam if explicitly enabled AND steamAppId is valid (non-empty string)
    const shouldLaunchViaSteam = !overridePath && !overrideArgs && 
                                  gameCustom?.launchViaSteam && 
                                  gameCustom?.steamAppId && 
                                  typeof gameCustom.steamAppId === 'string' &&
                                  gameCustom.steamAppId.trim().length > 0;

    if (shouldLaunchViaSteam && gameCustom?.steamAppId) {
      try {
        const appId = gameCustom.steamAppId; // Type guard for TypeScript
        const baselineMinutes = await invoke<number | null>("get_steam_playtime_minutes", { appId });
        await invoke("launch_steam_game", { appId });
        setRunningGamePath(path);
        sessionStartRef.current = Date.now();
        setSteamLaunchBridge({
          path,
          appId,
          baselineMinutes: baselineMinutes ?? 0,
          lastSeenMinutes: baselineMinutes ?? 0,
          sawIncrease: false,
          stalledPolls: 0,
          pollCount: 0,
        });
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
        return;
      } catch (e) {
        alert("Failed to launch through Steam: " + e);
        return;
      }
    }

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

    // Launch-time warning: prefix media health + per-game engine/path heuristics
    if (platform !== "windows" && (runner || prefix)) {
      const effectivePrefix = (prefix ?? gameCustom?.runnerOverride?.prefixPath ?? launchConfig.prefixPath)?.trim() || null;
      if (effectivePrefix) {
        try {
          const prefixInfos = await invoke<PrefixInfo[]>("list_wine_prefixes").catch(() => []);
          const matchingPrefix = findMatchingWinePrefixEntry(prefixInfos, effectivePrefix);
          if (matchingPrefix?.media.likely_video_playback_issue) {
            const ctx = assessGameMediaPlaybackContext({
              engine: metadata[path]?.engine,
              gamePath: pathDirname(actualPath),
              launchExePath: actualPath,
            });
            const assessment = combinePrefixAndGameMedia(matchingPrefix.media, ctx);
            if (assessment.showLaunchWarning) {
              if (!confirm(buildLaunchWineMediaWarningMessage(assessment))) return;
            }
          }
        } catch {
          // Ignore diagnostic check failures — don't block launch
        }
      }
    }

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
    if (steamLaunchBridge) {
      try {
        const minutes = await invoke<number | null>("get_steam_playtime_minutes", { appId: steamLaunchBridge.appId });
        finalizeSteamLaunchBridge(
          steamLaunchBridge.path,
          steamLaunchBridge.baselineMinutes,
          minutes ?? steamLaunchBridge.lastSeenMinutes,
        );
        alert("Steam-managed session tracking stopped. The game itself may still be running in Steam.");
      } catch (e) {
        alert("Failed to stop Steam-managed session tracking: " + e);
      }
      return;
    }
    try { await invoke("kill_game"); }
    catch (e) { alert("Failed to stop game: " + e); }
  };

  const handleGameShaderCacheExport = async () => {
    if (!selected || platform === "windows") return;
    setShaderCacheActionBusy(true);
    try {
      const gc = customizations[selected.path];
      const exe = gc?.exeOverride || selected.path;
      const sid = gc?.steamAppId?.trim() || null;
      const safe = selected.name.replace(/[^\w\-]+/g, "_").slice(0, 80) || "game";
      const out = await save({
        defaultPath: `libmaly-shader-cache-${safe}.zip`,
        filters: [{ name: "ZIP", extensions: ["zip"] }],
      }).catch(() => null);
      if (!out || typeof out !== "string") return;
      const res = await invoke<{
        zip_path: string;
        dxvk_files_packed: number;
        steam_files_packed: number;
      }>("export_shader_cache_bundle", {
        gameExePath: exe,
        steamAppId: sid,
        outputZipPath: out,
      });
      alert(
        `Shader cache bundle saved:\n${res.zip_path}\n\nDXVK entries: ${res.dxvk_files_packed}\nSteam cache files: ${res.steam_files_packed}\n\nYou can copy this zip to another PC and import it for the same game build.`,
      );
      await refetchShaderDiscovery();
    } catch (e) {
      await showPermissionDiagnostic("export the shader cache bundle", null, e, "Shader cache export failed");
    } finally {
      setShaderCacheActionBusy(false);
    }
  };

  const handleGameShaderCacheImport = async () => {
    if (!selected || platform === "windows") return;
    setShaderCacheActionBusy(true);
    try {
      const gc = customizations[selected.path];
      const exe = gc?.exeOverride || selected.path;
      const sid = gc?.steamAppId?.trim() || null;
      const zip = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "ZIP", extensions: ["zip"] }],
      }).catch(() => null);
      if (!zip || typeof zip !== "string") return;
      const msg = await invoke<string>("import_shader_cache_bundle", {
        gameExePath: exe,
        steamAppId: sid,
        zipPath: zip,
      });
      alert(msg);
      await refetchShaderDiscovery();
    } catch (e) {
      await showPermissionDiagnostic("import the shader cache bundle", null, e, "Shader cache import failed");
    } finally {
      setShaderCacheActionBusy(false);
    }
  };

  const handleOpenGameInstallFolder = async () => {
    if (!selected) return;
    const exe = customizations[selected.path]?.exeOverride || selected.path;
    const dir = pathDirname(exe);
    if (!dir) return;
    try {
      await openPath(dir);
    } catch (e) {
      alert("Could not open folder: " + e);
    }
  };

  useEffect(() => {
    if (!pendingZipInstallPath) return;
    if (zipInstallInProgress) return;
    if (libraryFolders.length === 0) {
      alert("Add a library folder in Libmaly before installing ZIP archives from Explorer.");
      setPendingZipInstallPath(null);
      setShowZipInstallModal(false);
      return;
    }
    if (libraryFolders.length === 1) {
      void installZipIntoLibrary(pendingZipInstallPath, libraryFolders[0].path).catch((e) => {
        alert("Failed to install ZIP archive: " + e);
        setPendingZipInstallPath(null);
        setShowZipInstallModal(false);
      });
      return;
    }
    setShowZipInstallModal(true);
  }, [pendingZipInstallPath, libraryFolders, zipInstallInProgress]);

  useEffect(() => {
    if (!pendingLaunchRequest) return;
    if (!pendingLaunchRequest.autoHide && !isAppReady) return;

    const hideIfRequested = async () => {
      if (!pendingLaunchRequest.autoHide) return;
      try {
        await getCurrentWindow().hide();
      } catch {
        // Ignore window-hide failures during quick launch.
      }
    };

    const launchByPath = async (requestedPath: string) => {
      const wanted = normalizePathForMatch(requestedPath);
      const game = games.find((g) => normalizePathForMatch(g.path) === wanted);
      if (game) {
        openGameView(game);
        setActiveMainTab("library");
        await launchGame(game.path);
        await hideIfRequested();
        return true;
      }
      await launchGame(requestedPath);
      await hideIfRequested();
      return true;
    };

    const launchByName = async (rawName: string) => {
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
      await launchGame(game.path);
      await hideIfRequested();
      return true;
    };

    void (async () => {
      const ok = pendingLaunchRequest.mode === "path"
        ? await launchByPath(pendingLaunchRequest.value)
        : await launchByName(pendingLaunchRequest.value);

      if (!ok) {
        const target = pendingLaunchRequest.mode === "path" ? "path" : "name";
        alert(`Could not launch game by ${target}: ${pendingLaunchRequest.value}`);
      }
      setPendingLaunchRequest(null);
    })();
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
    const mergedMeta = mergeMetadataWithSnapshot(oldMeta, { ...meta, fetchedAt: Date.now() });
    if (oldMeta) {
      setPendingMetaUpdate({ path: selected.path, oldMeta, newMeta: mergedMeta });
    } else {
      const next = { ...metadata, [selected.path]: mergedMeta };
      setMetadata(next);
      saveCache(SK_META, next);

      if (mergedMeta.version) {
        setHistory(prev => {
          const list = prev[selected.path] || [];
          if (list.length === 0) {
            const nextList = [{ id: String(Date.now()), date: Date.now(), version: mergedMeta.version!, note: "Initial link" }];
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
    if (batchMetadataRefreshJob && isBackgroundJobBusy(batchMetadataRefreshJob.status)) return;
    const items = Object.keys(metadata)
      .filter((p) => metadataHasLinkedSources(metadata[p]) && !ghostGames[p])
      .map((path) => ({ path, metadata: metadata[path] }));
    if (items.length === 0) return;
    try {
      await ensureSnapshotBeforeRiskyOp("before-batch-metadata-refresh", "Before refreshing metadata for all linked games");
    } catch {
      return;
    }
    await runMetadataQueueJob({
      jobId: JOB_BATCH_METADATA_REFRESH,
      label: "Metadata Refetch",
      items,
      mode: "refresh",
      onItemSuccess: applyMetadataUpdate,
    });
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
      await showPermissionDiagnostic("save screenshot tags", null, e, "Could not save screenshot tags");
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
      await showPermissionDiagnostic("export screenshots", savePath, e, "Screenshot export failed");
    }
  };

  const captureScreenshotForPath = async (
    gamePath: string,
    annotate: boolean,
    options?: { showToast?: boolean; showOverlay?: boolean },
  ) => {
    const shot = await invoke<Screenshot>("take_screenshot_manual");
    if (annotate) {
      setPendingAnnotatedShot({ gamePath, shot });
      return;
    }
    recordScreenshotCapture(gamePath, shot, options);
  };

  const handleSaveAnnotatedShot = async (dataUrl: string) => {
    if (!pendingAnnotatedShot) return;
    const { gamePath, shot } = pendingAnnotatedShot;
    try {
      await invoke("overwrite_screenshot_png", { path: shot.path, dataUrl });
      recordScreenshotCapture(gamePath, shot, { label: t('screenshot.annotated_saved') });
    } catch (e) {
      await showPermissionDiagnostic("save the annotated screenshot", shot.path, e, "Annotated screenshot save failed");
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
    const fileOps = await invoke<RecentFileOp[]>("get_recent_file_ops", { limit: 40 }).catch(() => []);
    setRecentFileOps(fileOps);
    const health = await invoke<ScraperHealthDiagnostic[]>("get_scraper_health_snapshot").catch(() => []);
    setScraperHealth(health);
  };

  const clearRustLogs = async () => {
    await invoke("clear_recent_logs").catch(() => { });
    setRustLogs([]);
  };

  const buildDiagnosticsPayload = async () => {
    const levelMatches = (l: RustLogEntry) => {
      const x = l.level.toLowerCase();
      const norm: "error" | "warn" | "info" = x.startsWith("err") ? "error" : x.startsWith("warn") ? "warn" : "info";
      return logLevelFilter === "all" ? true : norm === logLevelFilter;
    };
    const scraperHealthSnapshot = await invoke<ScraperHealthDiagnostic[]>("get_scraper_health_snapshot").catch(() => scraperHealth);
    setScraperHealth(scraperHealthSnapshot);

    // Include Wine/Proton media compatibility findings
    let wineMediaDiagnostics: { prefix: string; summary: string; likely_video_playback_issue: boolean; recommended_verbs: string[] }[] = [];
    let perGameWineVideoPlayback: Record<string, unknown>[] = [];
    if (platform !== "windows") {
      try {
        const prefixInfos = await invoke<PrefixInfo[]>("list_wine_prefixes").catch(() => []);
        wineMediaDiagnostics = prefixInfos.map(p => ({
          prefix: p.path,
          summary: p.media.summary,
          likely_video_playback_issue: p.media.likely_video_playback_issue,
          recommended_verbs: p.media.recommended_verbs || [],
        }));
        perGameWineVideoPlayback = games.map((g) => {
          const eff = resolveEffectiveWinePrefix(platform, {
            runnerOverrideEnabled: customizations[g.path]?.runnerOverrideEnabled,
            runnerOverride: customizations[g.path]?.runnerOverride,
            globalLaunchEnabled: launchConfig.enabled,
            globalPrefixPath: launchConfig.prefixPath,
          });
          const actualExe = customizations[g.path]?.exeOverride || g.path;
          const title = customizations[g.path]?.displayName ?? metadata[g.path]?.title ?? g.name;
          if (!eff) {
            return {
              path: g.path,
              title,
              engine: metadata[g.path]?.engine ?? null,
              exeBasename: pathBasename(actualExe),
              effectivePrefix: null,
              note: "no_wine_prefix_configured_for_game",
            };
          }
          const row = findMatchingWinePrefixEntry(prefixInfos, eff);
          const ctx = assessGameMediaPlaybackContext({
            engine: metadata[g.path]?.engine,
            gamePath: pathDirname(actualExe),
            launchExePath: actualExe,
          });
          const combined = combinePrefixAndGameMedia(row?.media, ctx);
          return {
            path: g.path,
            title,
            engine: metadata[g.path]?.engine ?? null,
            exeBasename: pathBasename(actualExe),
            effectivePrefix: eff,
            prefixKind: row?.kind ?? null,
            prefixFoundInScan: Boolean(row),
            effectiveIntroRisk: combined.effectiveRisk,
            launchWouldWarn: combined.showLaunchWarning,
            summary: combined.summary,
            matchedKnowledgeRuleIds: ctx.matchedRules.map((r) => r.id),
            suggestedVerbs: combined.suggestedVerbs,
          };
        });
      } catch { /* ignore */ }
    }

    return {
      exportedAt: new Date().toISOString(),
      app: {
        version: appVersion,
        platform,
        userAgent: navigator.userAgent,
      },
      recoveryMode,
      levelFilter: logLevelFilter,
      crashReport,
      integrityReport,
      snapshotPreview,
      scraperHealth: scraperHealthSnapshot,
      wineMediaDiagnostics,
      mediaPlaybackKnowledgeBase: {
        version: 1,
        rules: ENGINE_MEDIA_KNOWLEDGE.map((r) => ({
          id: r.id,
          label: r.label,
          introReliance: r.introReliance,
          extraVerbs: r.extraVerbs ?? [],
        })),
        gotchas: MEDIA_PLAYBACK_GOTCHAS,
      },
      perGameWineVideoPlayback,
      recentFileOps,
      logs: rustLogs.filter(levelMatches),
    };
  };

  const handleCopyDiagnosticJson = async () => {
    try {
      const payload = await buildDiagnosticsPayload();
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      alert("Diagnostics JSON copied.");
    } catch {
      alert("Could not copy diagnostics JSON.");
    }
  };

  const handleExportDiagnosticLog = async () => {
    const payload = await buildDiagnosticsPayload();
    const savePath = await save({
      defaultPath: `libmaly-diagnostics-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    }).catch(() => null);
    if (!savePath || typeof savePath !== "string") return;
    try {
      await invoke("save_string_to_file", { path: savePath, contents: JSON.stringify(payload, null, 2) });
    } catch (e) {
      await showPermissionDiagnostic("export diagnostics JSON", savePath, e, "Diagnostics export failed");
    }
  };

  const handleRunIntegrityCheck = async () => {
    upsertBackgroundJob(JOB_INTEGRITY_CHECK, {
      label: "Integrity Check",
      status: "queued",
      detail: "Checking library...",
    });
    try {
      upsertBackgroundJob(JOB_INTEGRITY_CHECK, {
        label: "Integrity Check",
        status: "running",
        detail: "Scanning folders, executables, and metadata links...",
      });
      const report = await invoke<IntegrityCheckReport>("run_integrity_check", {
        libraryFolders,
        games,
        customizations,
        metadata,
      });
      setIntegrityReport(report);
      clearBackgroundJob(JOB_INTEGRITY_CHECK);
    } catch (e) {
      upsertBackgroundJob(JOB_INTEGRITY_CHECK, {
        label: "Integrity Check",
        status: "permanent_failed",
        detail: `Integrity check failed: ${String(e)}`,
      });
      alert("Integrity check failed: " + e);
    }
  };

  useEffect(() => {
    if (recoveryMode || !appSettings.metadataAutoRefetchDays) return;
    let active = true;
    const run = async () => {
      const now = Date.now();
      const expiryAge = appSettings.metadataAutoRefetchDays * 24 * 60 * 60 * 1000;

      const items = Object.keys(metadataRef.current).filter(p => {
        const m = metadataRef.current[p];
        if (!metadataHasLinkedSources(m)) return false;
        if (ghostGames[p]) return false; // Skip ghost mode games
        if (!m.fetchedAt) return true;
        return now - m.fetchedAt > expiryAge;
      }).map((path) => ({ path, metadata: metadataRef.current[path] }));

      if (!active || items.length === 0) return;
      await runMetadataQueueJob({
        jobId: JOB_AUTO_METADATA_REFRESH,
        label: "Auto Metadata Refresh",
        items,
        mode: "refresh",
        onItemSuccess: (path, nextMeta) => {
          if (!active) return;
          applyMetadataUpdate(path, nextMeta);
        },
      });
    };
    run();
    return () => { active = false; };
  }, [appSettings.metadataAutoRefetchDays, recoveryMode]); // eslint-disable-line

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
      !c.runnerOverride &&
      !c.steamAppId &&
      !c.launchViaSteam &&
      !c.storeProvider &&
      !c.storeGameId &&
      !c.storeLaunchUri &&
      !c.launchViaStore &&
      !c.epicAppName &&
      !c.launchViaLegendary
    ) delete next[selected.path];
    else next[selected.path] = c;
    setCustomizations(next); saveCache(SK_CUSTOM, next);
  };

  const handleSaveNote = (text: string) => {
    if (!selected) return;
    const next = { ...notes, [selected.path]: text };
    setNotes(next); saveCache(SK_NOTES, next);
  };

  const handleSaveAchievements = (items: GameAchievementItem[]) => {
    if (!selected) return;
    const next = { ...achievements };
    if (items.length === 0) delete next[selected.path];
    else next[selected.path] = items;
    setAchievements(next);
    saveCache(SK_ACHIEVEMENTS, next);
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
    resolvedGameDisplayName(g, customizations, metadata);

  const ownershipGroupsState = useMemo(() => {
    const buckets = new Map<string, Game[]>();
    for (const game of games) {
      const key = ownershipGroupingKey(game, customizations, metadata);
      const existing = buckets.get(key);
      if (existing) existing.push(game);
      else buckets.set(key, [game]);
    }

    const groups: OwnershipGroup[] = [];
    const byPath = new Map<string, OwnershipGroup>();
    for (const [key, memberGames] of buckets.entries()) {
      const ranked = [...memberGames].sort((a, b) => {
        const aScore = ownershipPrimaryRank(a, customizations[a.path], metadata[a.path]);
        const bScore = ownershipPrimaryRank(b, customizations[b.path], metadata[b.path]);
        if (aScore !== bScore) return bScore - aScore;
        return gameDisplayName(a).localeCompare(gameDisplayName(b));
      });
      const primaryGame = ranked[0] ?? memberGames[0];
      const providerLabels = Array.from(new Set(
        memberGames
          .map((game) => launchProviderLabelForGame(game, customizations[game.path]))
          .filter(Boolean)
      ));
      const providerSummary = providerLabels.length <= 1
        ? (providerLabels[0] ?? "Local")
        : `${providerLabels[0]} +${providerLabels.length - 1}`;
      const group: OwnershipGroup = {
        id: key,
        displayName: gameDisplayName(primaryGame),
        memberGames: ranked,
        memberPaths: ranked.map((game) => game.path),
        primaryGame,
        providerLabels,
        providerSummary,
      };
      groups.push(group);
      for (const game of memberGames) {
        byPath.set(game.path, group);
      }
    }

    return { groups, byPath };
  }, [games, customizations, metadata]);

  const selectedOwnershipGroup = useMemo(() => {
    if (!selected) return null;
    return ownershipGroupsState.byPath.get(selected.path) ?? null;
  }, [ownershipGroupsState.byPath, selected]);

  const ownershipGroupStatsById = useMemo(() => {
    const next: Record<string, GameStats> = {};
    for (const group of ownershipGroupsState.groups) {
      next[group.id] = group.memberGames.reduce<GameStats>((acc, game) => {
        const stat = stats[game.path];
        if (!stat) return acc;
        acc.totalTime += stat.totalTime ?? 0;
        acc.launchCount += stat.launchCount ?? 0;
        acc.lastPlayed = Math.max(acc.lastPlayed, stat.lastPlayed ?? 0);
        acc.lastSession = Math.max(acc.lastSession, stat.lastSession ?? 0);
        return acc;
      }, { totalTime: 0, lastPlayed: 0, lastSession: 0, launchCount: 0 });
    }
    return next;
  }, [ownershipGroupsState.groups, stats]);

  const surpriseCandidates = useMemo(() => {
    return games.filter((g) =>
      !hiddenGames[g.path] &&
      customizations[g.path]?.status !== "Dropped"
    );
  }, [games, hiddenGames, customizations]);

  const handleSurpriseLaunch = useCallback(() => {
    if (surpriseCandidates.length === 0) {
      alert("No eligible games to launch. Unhide a game or remove Dropped status.");
      return;
    }
    const pick = surpriseCandidates[Math.floor(Math.random() * surpriseCandidates.length)];
    openGameView(pick);
    setActiveMainTab("library");
    if (appSettingsRef.current.surpriseLaunchesImmediately) {
      launchGame(pick.path);
    }
  }, [surpriseCandidates, openGameView, launchGame]);

  // ── Context menu state ──────────────────────────────────────────────────────
  interface CtxMenu { x: number; y: number; game: Game; }
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      if (allowsNativeContextMenu(e.target)) return;
      e.preventDefault();
    };
    document.addEventListener("contextmenu", handleContextMenu);
    return () => document.removeEventListener("contextmenu", handleContextMenu);
  }, [recordScreenshotCapture]);
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
    | { kind: "game"; game: Game; card: OwnershipGroup; depth: number }
    | { kind: "group-header"; dir: string; label: string; count: number; depth: number }
    | { kind: "group-game"; game: Game; card: OwnershipGroup; dir: string; depth: number };


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
        else if (filterMode === "f95") return metadataUsesSource(metadata[g.path], "f95");
        else if (filterMode === "dlsite") return metadataUsesSource(metadata[g.path], "dlsite");
        else if (filterMode === "vndb") return metadataUsesSource(metadata[g.path], "vndb");
        else if (filterMode === "mangagamer") return metadataUsesSource(metadata[g.path], "mangagamer");
        else if (filterMode === "johren") return metadataUsesSource(metadata[g.path], "johren");
        else if (filterMode === "fakku") return metadataUsesSource(metadata[g.path], "fakku");
        else if (filterMode === "igdb") return metadataUsesSource(metadata[g.path], "igdb");
        else if (filterMode === "rawg") return metadataUsesSource(metadata[g.path], "rawg");
        else if (filterMode === "mobygames") return metadataUsesSource(metadata[g.path], "mobygames");
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

  const groupedFiltered = useMemo(() => {
    const seen = new Set<string>();
    const next: OwnershipGroup[] = [];
    for (const game of filtered) {
      const group = ownershipGroupsState.byPath.get(game.path);
      if (!group || seen.has(group.id)) continue;
      seen.add(group.id);
      next.push(group);
    }
    return next;
  }, [filtered, ownershipGroupsState.byPath]);

  const sidebarItems = useMemo<SidebarItem[]>(() => {
    type FolderNode = {
      dir: string;
      label: string;
      children: Map<string, FolderNode>;
      directCards: OwnershipGroup[];
      totalGames: number;
    };
    const rootNode: FolderNode = {
      dir: "",
      label: "",
      children: new Map(),
      directCards: [],
      totalGames: 0,
    };

    const ensureChild = (parent: FolderNode, dir: string, label: string) => {
      let child = parent.children.get(dir);
      if (!child) {
        child = { dir, label, children: new Map(), directCards: [], totalGames: 0 };
        parent.children.set(dir, child);
      }
      return child as FolderNode;
    };

    for (const card of groupedFiltered) {
      const parentDir = pathDirname(card.primaryGame.path);
      const relativeSegments = pathSegmentsRelativeToRoot(parentDir, libraryFolders);
      let cursor = rootNode;
      const accumulated: string[] = [];
      for (const segment of relativeSegments) {
        accumulated.push(segment);
        const dirKey = accumulated.join("/");
        cursor = ensureChild(cursor, dirKey, segment);
      }
      cursor.directCards.push(card);
    }

    const finalizeCounts = (node: FolderNode): number => {
      let total = node.directCards.length;
      for (const child of node.children.values()) {
        total += finalizeCounts(child);
      }
      node.totalGames = total;
      return total;
    };
    finalizeCounts(rootNode);

    const flattenNode = (node: FolderNode, depth: number, items: SidebarItem[]) => {
      const childNodes = Array.from(node.children.values());
      const shouldGroup = node.dir !== "" && node.totalGames >= 2;
      const childDepth = shouldGroup ? depth + 1 : depth;

      if (shouldGroup) {
        items.push({
          kind: "group-header",
          dir: node.dir,
          label: node.label,
          count: node.totalGames,
          depth,
        });
        if (collapsedGroups.has(node.dir)) return;
      }

      childNodes.sort((a, b) => a.label.localeCompare(b.label));
      for (const child of childNodes) {
        flattenNode(child, childDepth, items);
      }
      for (const card of node.directCards) {
        if (shouldGroup) {
          items.push({ kind: "group-game", game: card.primaryGame, card, dir: node.dir, depth: childDepth });
        } else {
          items.push({ kind: "game", game: card.primaryGame, card, depth: childDepth });
        }
      }
    };

    const items: SidebarItem[] = [];
    flattenNode(rootNode, 0, items);
    return items;
  }, [groupedFiltered, libraryFolders, collapsedGroups]);

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
      (item) => (item.kind === "game" || item.kind === "group-game") && item.card.memberPaths.includes(selected.path)
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

      const actionable = visibleSidebarItems.filter(i => i.kind === "game" || i.kind === "group-game").map(i => (i as SidebarItem & { card: OwnershipGroup }).card);
      if (actionable.length === 0) return;

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        let idx = selected ? actionable.findIndex(card => card.memberPaths.includes(selected.path)) : -1;

        if (e.key === "ArrowDown") {
          const next = idx === -1 ? 0 : Math.min(idx + 1, actionable.length - 1);
          const card = actionable[next];
          openGameView(card.memberGames.find((game) => game.path === selected?.path) ?? card.primaryGame);
        } else {
          const prev = idx === -1 ? actionable.length - 1 : Math.max(idx - 1, 0);
          const card = actionable[prev];
          openGameView(card.memberGames.find((game) => game.path === selected?.path) ?? card.primaryGame);
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
  }, [visibleSidebarItems, selected, openGameView, runningGamePath, syncState, launchGame]);

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
  const sidebarMinimalMode = !!appSettings.sidebarMinimalMode;
  const sidebarNavButtonClass = `flex items-center ${sidebarMinimalMode ? "gap-2 px-3 py-2" : "gap-2.5 px-4 py-3"} border-b border-t-0 border-l-0 border-r-0 w-full text-left transition-colors`;
  const sidebarNavIconSize = sidebarMinimalMode ? 18 : 22;
  const sidebarNavLabelClass = `${sidebarMinimalMode ? "text-xs" : "text-sm"} font-bold tracking-wide truncate`;
  const sidebarSectionBoxClass = sidebarMinimalMode ? "px-2 py-1.5 border-b" : "px-3 py-2 border-b";
  const sidebarFooterClass = sidebarMinimalMode ? "px-2 py-2 space-y-1 border-t" : "px-3 py-3 space-y-1.5 border-t";
  const sidebarActionButtonClass = `w-full ${sidebarMinimalMode ? "py-1.5 text-[11px]" : "py-2 text-xs"} rounded font-semibold flex items-center justify-center gap-1.5 disabled:opacity-60`;
  const sidebarUtilityButtonClass = `flex-1 ${sidebarMinimalMode ? "py-1 text-[11px]" : "py-1.5 text-xs"} rounded flex items-center justify-center gap-1.5`;

  useEffect(() => {
    if (activeMainTab === "feed" && appSettings.sidebarShowNews === false) {
      setActiveMainTab("library");
      setSelected(null);
    } else if (activeMainTab === "stats" && appSettings.sidebarShowStats === false) {
      setActiveMainTab("library");
      setSelected(null);
    }
  }, [activeMainTab, appSettings.sidebarShowNews, appSettings.sidebarShowStats]);

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

  useEffect(() => {
    const onMouseNavigation = (e: MouseEvent) => {
      if (e.button === 3) {
        e.preventDefault();
        goBack();
      } else if (e.button === 4) {
        e.preventDefault();
        goForward();
      }
    };

    window.addEventListener("mouseup", onMouseNavigation);
    return () => window.removeEventListener("mouseup", onMouseNavigation);
  }, [goBack, goForward]);

  if (!isAppReady) {
    return (
      <div className="flex flex-col items-center justify-center w-screen h-screen select-none" style={{ background: "var(--color-bg-deep)" }}>
        <h1 className="text-4xl font-black italic tracking-widest mb-6" style={{ background: "linear-gradient(90deg, var(--color-accent), var(--color-warning))", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>LIBMALY</h1>
        <div className="w-8 h-8 rounded-full border-4 border-[var(--color-border)] border-t-[var(--color-accent)] animate-spin" />
        <p className="mt-4 text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--color-text-muted)" }}>{t('loading.building_library')}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: "linear-gradient(135deg, var(--season-overlay) 0%, var(--color-bg) 45%, var(--color-bg-elev) 100%)", color: "var(--color-text)", fontFamily: "'Arial', sans-serif" }}>
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
          {appSettings.sidebarShowSettingsButton === false && (
            <button
              onClick={() => setShowSettings(true)}
              className="w-6 h-6 rounded text-xs"
              style={{ background: "transparent", color: "var(--color-text-muted)" }}
              title={t('library.sidebar.settings')}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ margin: "0 auto" }}>
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l-.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
          )}
        </div>
        <div
          data-tauri-drag-region
          className="flex-1 flex items-center gap-2 px-2 overflow-hidden cursor-move"
          onDblClick={handleToggleMaximizeWindow}
        >
          {activeLibraryProfile && (
            <div
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-full max-w-[220px]"
              style={{
                background: activeLibraryProfile.accentColor
                  ? `color-mix(in srgb, ${activeLibraryProfile.accentColor} 18%, transparent)`
                  : "var(--color-panel-3)",
                border: `1px solid ${activeLibraryProfile.accentColor || "var(--color-border-soft)"}`,
              }}
              title={activeLibraryProfile.tagline || activeLibraryProfile.displayName}
            >
              <span
                className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0 overflow-hidden"
                style={{
                  background: activeLibraryProfile.avatarUrl
                    ? `center / cover no-repeat url(${activeLibraryProfile.avatarUrl})`
                    : activeLibraryProfile.accentColor || "var(--color-accent)",
                  color: "white",
                }}
              >
                {!activeLibraryProfile.avatarUrl && activeLibraryProfile.displayName.slice(0, 1).toUpperCase()}
              </span>
              <span className="text-[10px] font-semibold truncate" style={{ color: "var(--color-text)" }}>
                {activeLibraryProfile.displayName}
              </span>
            </div>
          )}
          <span className="text-[11px] font-semibold truncate" style={{ color: "var(--color-text-soft)" }}>
            {topbarLocationTitle}
          </span>
        </div>
        {shouldShowWindowControls && (
          <div className="flex items-center relative z-10" onMouseDown={(e) => e.stopPropagation()}>
            <button
              onClick={handleMinimizeWindow}
              onMouseDown={(e) => e.stopPropagation()}
              className="w-10 h-8 text-xs"
              style={{ color: "var(--color-text-muted)", pointerEvents: "auto" }}
              title="Minimize"
            >
              _
            </button>
            <button
              onClick={handleToggleMaximizeWindow}
              onMouseDown={(e) => e.stopPropagation()}
              className="w-10 h-8 text-xs"
              style={{ color: "var(--color-text-muted)", pointerEvents: "auto" }}
              title={isMaximized ? "Restore" : "Maximize"}
            >
              {isMaximized ? "❐" : "□"}
            </button>
            <button
              onClick={handleCloseWindow}
              onMouseDown={(e) => e.stopPropagation()}
              className="w-10 h-8 text-xs hover:bg-red-600 hover:text-white"
              style={{ color: "var(--color-text-muted)", pointerEvents: "auto" }}
              title="Close"
            >
              ✕
            </button>
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
            {t('game.menu.open')}
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
            {t('game.menu.rescan')}
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
            {favGames[ctxMenu.game.path] ? t('game.menu.fav_remove') : t('game.menu.fav_add')}
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
            {hiddenGames[ctxMenu.game.path] ? t('game.menu.unhide') : t('game.menu.hide')}
          </button>
        </div>
      )}

      {screenshotToasts.length > 0 && (
        <div className="fixed right-4 bottom-4 z-[9990] flex flex-col gap-2 pointer-events-none">
          {screenshotToasts.map((toast) => {
            const game = games.find((entry) => entry.path === toast.gamePath) ?? null;
            const gameTitle = game
              ? gameDisplayName(game)
              : customizations[toast.gamePath]?.displayName
                ?? metadata[toast.gamePath]?.title
                ?? "Unknown game";
            return (
              <div
                key={toast.id}
                className="pointer-events-auto flex items-center gap-3 rounded-xl p-2.5 text-left shadow-2xl"
                style={{
                  width: 320,
                  background: "color-mix(in srgb, var(--color-panel) 90%, black 10%)",
                  border: "1px solid var(--color-border-strong)",
                  boxShadow: "0 18px 40px rgba(0,0,0,0.35)",
                }}
              >
                <button
                  className="flex items-center gap-3 min-w-0 flex-1 text-left transition-transform hover:scale-[1.01]"
                  onClick={() => {
                    if (game) openGameView(game);
                    dismissScreenshotToast(toast.id);
                  }}
                >
                  <img
                    src={convertFileSrc(toast.screenshot.path)}
                    alt={toast.screenshot.filename}
                    className="w-16 h-10 rounded object-cover flex-shrink-0"
                    style={{ background: "var(--color-bg-deep)", border: "1px solid var(--color-border-subtle)" }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] uppercase tracking-[0.18em] font-bold" style={{ color: "var(--color-accent-soft)" }}>
                      {toast.label}
                    </div>
                    <div className="text-sm font-semibold truncate" style={{ color: "var(--color-text)" }}>
                      {gameTitle}
                    </div>
                    <div className="text-[11px] truncate" style={{ color: "var(--color-text-dim)" }}>
                      {toast.screenshot.filename}
                    </div>
                  </div>
                </button>
                <button
                  className="w-7 h-7 rounded-full text-xs flex items-center justify-center flex-shrink-0"
                  style={{ background: "var(--color-panel-3)", color: "var(--color-text-muted)" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    dismissScreenshotToast(toast.id);
                  }}
                  title="Dismiss"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* In-app notification toasts (custom notification layer) */}
      {inAppToasts.length > 0 && (
        <div className="fixed left-4 bottom-4 z-[9989] flex flex-col gap-2 pointer-events-none">
          {inAppToasts.map((toast) => (
            <div
              key={toast.id}
              className="pointer-events-auto flex items-start gap-3 rounded-xl p-3 text-left shadow-2xl"
              style={{
                width: 300,
                background: "color-mix(in srgb, var(--color-panel) 92%, black 8%)",
                border: "1px solid var(--color-border-strong)",
                boxShadow: "0 12px 32px rgba(0,0,0,0.3)",
                animation: "slideInLeft 0.25s ease-out",
              }}
            >
              <span className="text-lg flex-shrink-0 mt-0.5">{toast.icon || "ℹ️"}</span>
              <div className="min-w-0 flex-1">
                <div className="text-[10px] uppercase tracking-[0.18em] font-bold" style={{ color: "var(--color-accent-soft)" }}>
                  {toast.title}
                </div>
                <div className="text-xs mt-0.5" style={{ color: "var(--color-text-soft)" }}>
                  {toast.message}
                </div>
              </div>
              <button
                className="w-6 h-6 rounded-full text-xs flex items-center justify-center flex-shrink-0"
                style={{ background: "var(--color-panel-3)", color: "var(--color-text-muted)" }}
                onClick={() => setInAppToasts(prev => prev.filter(t => t.id !== toast.id))}
              >
                ✕
              </button>
            </div>
          ))}
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
            className={sidebarNavButtonClass}
            style={{ borderColor: "var(--color-bg-deep)", background: activeMainTab === "library" && selected === null ? "var(--color-bg)" : "transparent", cursor: "pointer" }}
            onMouseEnter={(e) => { if (activeMainTab !== "library" || selected !== null) e.currentTarget.style.background = "var(--color-bg)" }}
            onMouseLeave={(e) => { if (activeMainTab !== "library" || selected !== null) e.currentTarget.style.background = "transparent" }}>
            <svg width={sidebarNavIconSize} height={sidebarNavIconSize} viewBox="0 0 24 24" fill="none"
              stroke={selected === null && activeMainTab === "library" ? "var(--color-accent)" : "var(--color-text-dim)"}
              strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
              <rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 12h4" /><path d="M8 10v4" /><circle cx="17" cy="12" r="1" />
            </svg>
            <span className={sidebarNavLabelClass}
              style={{ color: selected === null && activeMainTab === "library" ? "var(--color-accent)" : "var(--color-text)" }}>{t('common.app_name')}</span>
          </button>
          {appSettings.sidebarShowNews !== false && (
          <button
            onClick={() => { setActiveMainTab("feed"); setSelected(null); }}
            title="News Feed"
            className={sidebarNavButtonClass}
            style={{ borderColor: "var(--color-bg-deep)", background: activeMainTab === "feed" && selected === null ? "var(--color-bg)" : "transparent", cursor: "pointer" }}
            onMouseEnter={(e) => { if (activeMainTab !== "feed" || selected !== null) e.currentTarget.style.background = "var(--color-bg)" }}
            onMouseLeave={(e) => { if (activeMainTab !== "feed" || selected !== null) e.currentTarget.style.background = "transparent" }}>
            <svg width={sidebarNavIconSize} height={sidebarNavIconSize} viewBox="0 0 24 24" fill="none"
              stroke={activeMainTab === "feed" && selected === null ? "var(--color-accent)" : "var(--color-text-dim)"}
              strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
              <path d="M4 11a9 9 0 0 1 9 9" /><path d="M4 4a16 16 0 0 1 16 16" /><circle cx="5" cy="19" r="1" />
            </svg>
            <span className={sidebarNavLabelClass}
              style={{ color: activeMainTab === "feed" && selected === null ? "var(--color-accent)" : "var(--color-text)" }}>{t('library.sidebar.news')}</span>
          </button>
          )}
          {appSettings.sidebarShowStats !== false && (
          <button
            onClick={() => { setActiveMainTab("stats"); setSelected(null); }}
            title="All-Time Stats"
            className={sidebarNavButtonClass}
            style={{ borderColor: "var(--color-bg-deep)", background: activeMainTab === "stats" && selected === null ? "var(--color-bg)" : "transparent", cursor: "pointer" }}
            onMouseEnter={(e) => { if (activeMainTab !== "stats" || selected !== null) e.currentTarget.style.background = "var(--color-bg)" }}
            onMouseLeave={(e) => { if (activeMainTab !== "stats" || selected !== null) e.currentTarget.style.background = "transparent" }}>
            <svg width={sidebarNavIconSize} height={sidebarNavIconSize} viewBox="0 0 24 24" fill="none"
              stroke={activeMainTab === "stats" && selected === null ? "var(--color-accent)" : "var(--color-text-dim)"}
              strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
              <path d="M12 20V10" /><path d="M18 20V4" /><path d="M6 20v-4" />
            </svg>
            <span className={sidebarNavLabelClass}
              style={{ color: activeMainTab === "stats" && selected === null ? "var(--color-accent)" : "var(--color-text)" }}>{t('library.sidebar.stats')}</span>
          </button>
          )}
          {appSettings.sidebarShowSearchTools !== false && (
          <div className={sidebarSectionBoxClass} style={{ borderColor: "var(--color-bg-deep)" }}>
            <div className="relative mb-2">
              <svg className="absolute left-2 top-1/2 -translate-y-1/2" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
              </svg>
              <input type="text" placeholder={t('library.sidebar.search_placeholder')} value={search}
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
              <span style={{ paddingTop: "1px" }}>{t('library.sidebar.filters')}</span>
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
                      }}>{t(`library.filters.${mode}` as any, { defaultValue: label, count: mode === 'hidden' ? Object.keys(hiddenGames).length : undefined })}</button>
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
                      }}>{t(`library.filters.${mode.replace(/\s/g, '_').toLowerCase()}` as any, { defaultValue: label })}</button>
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
              <span className="text-[10px] flex-shrink-0" style={{ color: "var(--color-text-dim)" }}>{t('library.sidebar.sort')}:</span>
              {(["lastPlayed", "playtime", "name", "custom"] as SortMode[]).map((mode) => (
                <button key={mode} onClick={() => setSortMode(mode)}
                  className="px-2 py-0.5 rounded text-[10px]"
                  style={{
                    background: sortMode === mode ? "var(--color-panel-3)" : "transparent",
                    color: sortMode === mode ? "var(--color-text)" : "var(--color-text-dim)",
                    border: `1px solid ${sortMode === mode ? "var(--color-border-strong)" : "transparent"}`,
                  }}>{t(`library.sidebar.sort_options.${mode}` as any)}</button>
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
          )}
          {/* ── Collections ── */}
          {appSettings.sidebarShowCollections !== false && (
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
                          title={t('library.sidebar.delete_collection')}>×</button>
                      </div>
                    ))}
                  </div>
                )}
                {creatingCollection && (
                  <div className="px-3 pb-2 pt-1 space-y-1.5">
                    <input autoFocus placeholder={t('library.sidebar.collection_placeholder')} value={newCollectionName}
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
          )}
          {/* ── By Developer ── */}
          {appSettings.sidebarShowDevelopers !== false && (
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
              <span className="text-[9px] uppercase tracking-widest font-bold flex-1" style={{ paddingTop: "1px" }}>{t('library.sidebar.by_developer')}</span>
              {filterMode.startsWith("dev:") && (
                <button onClick={(e) => { e.stopPropagation(); setFilterMode("all"); }}
                  className="text-[9px] px-1.5 py-0.5 rounded mr-1"
                  style={{ background: "var(--color-panel-3)", color: "var(--color-text-muted)" }}
                  title={t('library.sidebar.clear_filter')}>✕ {t('library.sidebar.clear')}</button>
              )}
            </div>
            {showDevelopers && (
              developerBuckets.length === 0 ? (
                <p className="px-3 pb-2 text-[10px]" style={{ color: "var(--color-text-dim)" }}>{t('library.sidebar.no_developers')}</p>
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
          )}
          {/* ── Wishlist ── */}
          {appSettings.sidebarShowWishlist !== false && (
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
              <span className="text-[9px] uppercase tracking-widest font-bold flex-1" style={{ paddingTop: "1px" }}>{t('library.sidebar.wishlist')} ({wishlist.length})</span>
              {wishlist.length > 0 && (
                <button
                  onClick={(e) => { e.stopPropagation(); handleExportWishlistHTML(); }}
                  className="text-[9px] px-1.5 py-0.5 rounded"
                  style={{ background: "var(--color-panel-3)", color: "var(--color-accent-soft)" }}
                  title="Export wishlist as sharable HTML page"
                >
                  📤
                </button>
              )}
            </div>
            {showWishlist && (
              <>
                {wishlist.length === 0 && (
                  <p className="px-3 pb-2 text-[10px]" style={{ color: "var(--color-text-dim)" }}>{t('library.sidebar.no_wishlist')}</p>
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
          )}
          <div
            ref={sidebarListRefCb}
            className="flex-1 overflow-y-auto"
            style={{ scrollbarWidth: "thin", scrollbarColor: "var(--color-border) transparent" }}
          >
            {syncState === "full-scan" ? (
              <div className="flex flex-col items-center justify-center h-32 gap-2">
                <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2" style={{ borderColor: "var(--color-accent)" }} />
                <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>{t('library.status.scanning')}</span>
              </div>
            ) : sidebarItems.length === 0 ? (
              <p className="px-4 py-6 text-xs text-center" style={{ color: "var(--color-text-muted)" }}>
                {games.length === 0 ? t('library.main.add_hint') : t('library.main.no_games_match')}
              </p>
            ) : (
              <div style={{ position: "relative", height: `${vTotalH}px` }}>
                {vItems.map(({ item, offsetTop }) => {
                  if (item.kind === "group-header") {
                    const collapsed = collapsedGroups.has(item.dir);
                    const indent = 10 + item.depth * 14;
                    return (
                      <button key={`hdr:${item.dir}`}
                        onClick={() => toggleGroup(item.dir)}
                        className="w-full flex items-center gap-1.5 px-2.5 py-1 text-left"
                        style={{
                          position: "absolute", top: offsetTop, left: 0, right: 0, height: 28,
                          background: "var(--color-bg-deep)", borderBottom: "1px solid var(--color-border-subtle)",
                          paddingLeft: `${indent}px`,
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
                  const card = item.card;
                  const isGrouped = item.kind === "group-game";
                  const depth = item.depth;
                  // visibleSidebarItems already excludes collapsed group items, but keep the guard
                  if (isGrouped && collapsedGroups.has((item as { kind: "group-game"; dir: string; game: Game }).dir)) return null;

                  const activeGroupGame = selected && card.memberPaths.includes(selected.path)
                    ? card.memberGames.find((entry) => entry.path === selected.path) ?? game
                    : game;
                  const isSelected = !!selected && card.memberPaths.includes(selected.path);
                  const isDragOver = dragOverPathState === card.primaryGame.path;
                  const m = metadata[activeGroupGame.path] ?? metadata[game.path];
                  const cus = customizations[activeGroupGame.path] ?? customizations[game.path];
                  const coverSrc = cus?.coverUrl ?? m?.cover_url;
                  const name = card.displayName;
                  const isFavItem = card.memberGames.some((entry) => !!favGames[entry.path]);
                  const isHiddenItem = card.memberGames.every((entry) => !!hiddenGames[entry.path]);
                  const groupStats = ownershipGroupStatsById[card.id] ?? { totalTime: 0, lastPlayed: 0, lastSession: 0, launchCount: 0 };
                  const collectionMatches = collections.filter((collection) => card.memberGames.some((entry) => collection.gamePaths.includes(entry.path)));
                  return (
                    <button key={card.id} onClick={() => openGameView(activeGroupGame)}
                      onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, game: activeGroupGame }); }}
                      draggable={sortMode === "custom"}
                      onDragStart={(e) => {
                        dragPath.current = card.primaryGame.path;
                        if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragEnter={(e) => {
                        e.preventDefault();
                        if (dragPath.current && dragPath.current !== card.primaryGame.path) {
                          dragOverPath.current = card.primaryGame.path;
                          setDragOverPathState(card.primaryGame.path);
                        }
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
                      }}
                      onDragLeave={() => {
                        if (dragOverPath.current === card.primaryGame.path) {
                          dragOverPath.current = null;
                          setDragOverPathState(null);
                        }
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (dragPath.current && dragPath.current !== card.primaryGame.path) {
                          applyDrop(dragPath.current, card.primaryGame.path);
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
                        paddingLeft: `${12 + depth * 18}px`,
                        cursor: sortMode === "custom" ? "grab" : undefined,
                      }}>
                      {availableGameUpdates[game.path] && (
                        <span className="absolute top-[4px] right-[4px] w-1.5 h-1.5 rounded-full z-10 animate-pulse bg-green-500"
                          style={{ boxShadow: "0 0 5px #10b981" }} title={t('library.sidebar.new_update_badge')} />
                      )}
                      {viewMode === "compact" ? (
                        <div className="w-5 h-5 rounded flex-shrink-0 overflow-hidden relative" style={{ background: heroGradient(game.name) }}>
                          {coverSrc ? <img src={coverSrc} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center font-bold text-white" style={{ fontSize: "9px" }}>{name.charAt(0).toUpperCase()}</div>}
                          <NsfwOverlay gamePath={activeGroupGame.path} meta={m} appSettings={appSettings} revealed={revealedNsfw} onReveal={revealNsfwPath} small={true} />
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
                          <NsfwOverlay gamePath={activeGroupGame.path} meta={m} appSettings={appSettings} revealed={revealedNsfw} onReveal={revealNsfwPath} small={true} />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1">
                          {sortMode === "custom" && (
                            <span className="text-[11px] flex-shrink-0 leading-none select-none"
                              style={{ color: "var(--color-text-dim)" }}>⠿</span>
                          )}
                          <p className="text-xs font-medium truncate flex-1">{name}</p>
                          {card.providerLabels.length > 1 && (
                            <span className="text-[9px] px-1 rounded flex-shrink-0"
                              style={{ background: "var(--color-accent-deep)", color: "var(--color-accent-soft)" }}>
                              {card.providerSummary}
                            </span>
                          )}
                          {isHiddenItem && (
                            <span className="text-[9px] px-1 rounded flex-shrink-0"
                              style={{ background: "var(--color-panel-3)", color: "var(--color-text-dim)" }}>{t('game.hidden')}</span>
                          )}
                        </div>
                        {viewMode !== "compact" && (
                          <>
                            <p className="text-[10px] truncate" style={{ color: "var(--color-text-dim)" }}>
                              {groupStats.totalTime > 0
                                ? `${formatTime(groupStats.totalTime)}${(groupStats.launchCount ?? 0) > 0
                                  ? ` · ${t('game.times_played', { count: groupStats.launchCount })}`
                                  : ""
                                }`
                                : t('library.status.never_played')}
                            </p>
                            {collectionMatches.length > 0 && (
                              <div className="flex gap-0.5 mt-0.5">
                                {collectionMatches.map((c) => (
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
          <div className={sidebarFooterClass} style={{ borderColor: "var(--color-bg-deep)" }}>
            {syncState === "syncing" && (
              <div className="flex items-center gap-2 px-1 py-1">
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "var(--color-accent)" }} />
                <span className="text-xs" style={{ color: "var(--color-accent)" }}>{t('library.status.checking_changes')}</span>
              </div>
            )}

            {appSettings.sidebarShowSurpriseButton !== false && (
              <button
                onClick={handleSurpriseLaunch}
                disabled={surpriseCandidates.length === 0}
                className={sidebarActionButtonClass}
                style={{ background: "var(--color-panel-3)", color: "var(--color-text)", border: "1px solid var(--color-border-strong)" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-panel-2)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "var(--color-panel-3)")}
                title={t('library.sidebar.surprise')}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--color-warning)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2l2.5 6.5L21 9l-5 4 1.5 6.5L12 16l-5.5 3.5L8 13 3 9l6.5-.5L12 2z" />
                </svg>
                {t('library.sidebar.surprise')}
              </button>
            )}

            {/* ── Add dropdown ── */}
            {appSettings.sidebarShowAddButton !== false && (
            <div ref={addMenuRef} className="relative">
              <button
                onClick={() => setShowAddMenu((p) => !p)}
                className={sidebarActionButtonClass}
                style={{ background: showAddMenu ? "var(--color-accent-dark)" : "var(--color-border)", color: "var(--color-text)", border: "1px solid var(--color-border-card)" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-accent-dark)")}
                onMouseLeave={(e) => { if (!showAddMenu) e.currentTarget.style.background = "var(--color-border)"; }}>
                {/* plus icon */}
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                {t('library.sidebar.add')}
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
                    {t('library.sidebar.add_folder')}
                    <span className="ml-auto text-[9px]" style={{ color: "var(--color-text-dim)" }}>{t('library.sidebar.scan_dir_hint')}</span>
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
                    {t('library.sidebar.add_game')}
                    <span className="ml-auto text-[9px]" style={{ color: "var(--color-text-dim)" }}>{t('library.sidebar.exe_sh_hint')}</span>
                  </button>
                </div>
              )}
            </div>
            )}

            {/* Settings + app update */}
            <div className="flex gap-1.5">
              {appSettings.sidebarShowSettingsButton !== false && <button onClick={() => setShowSettings(true)}
                className={sidebarUtilityButtonClass}
                style={{ background: "transparent", color: "var(--color-text-dim)", border: "1px solid var(--color-panel-3)" }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "var(--color-text-muted)"; e.currentTarget.style.borderColor = "var(--color-border-strong)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "var(--color-text-dim)"; e.currentTarget.style.borderColor = "var(--color-panel-3)"; }}
                title={t('library.sidebar.settings')}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
                {t('library.sidebar.settings')}
              </button>}
              {appSettings.sidebarShowLogsButton !== false && <button onClick={() => setShowLogViewer(true)}
                className={sidebarUtilityButtonClass}
                style={{ background: "transparent", color: "var(--color-text-dim)", border: "1px solid var(--color-panel-3)" }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "var(--color-text-muted)"; e.currentTarget.style.borderColor = "var(--color-border-strong)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "var(--color-text-dim)"; e.currentTarget.style.borderColor = "var(--color-panel-3)"; }}
                title={t('library.sidebar.logs')}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 6h16" /><path d="M4 12h16" /><path d="M4 18h16" />
                </svg>
                {t('library.sidebar.logs')}
              </button>}
              {appUpdate && (
                <button onClick={() => setShowAppUpdateModal(true)}
                  className="flex-1 py-1.5 rounded text-xs font-semibold flex items-center justify-center gap-1"
                  style={{ background: "var(--color-success-bg)", color: "var(--color-success)", border: "1px solid var(--color-success-border)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#1e4a1e")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "var(--color-success-bg)")}
                  title={t('library.sidebar.update_available_tooltip', { version: appUpdate.version })}>
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
          <StatsView games={games} stats={stats} sessions={sessionLog} customizations={customizations} metadata={metadata} notes={notes} collections={collections} wishlist={wishlist} totalPlaytimeSecs={totalPlaytimeLiveSecs} />
        ) : viewMode === "grid" && !selected ? (
          <div className="flex-1 overflow-y-auto px-6 py-6" style={{ scrollbarWidth: "thin", scrollbarColor: "var(--color-border) transparent" }}>
            <div className="grid gap-5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}>
              {groupedFiltered.map((card) => {
                const activeGroupGame = card.primaryGame;
                const isFavItem = card.memberGames.some((game) => !!favGames[game.path]);
                const cover = customizations[activeGroupGame.path]?.coverUrl
                  ?? metadata[activeGroupGame.path]?.cover_url
                  ?? customizations[card.primaryGame.path]?.coverUrl
                  ?? metadata[card.primaryGame.path]?.cover_url;
                const groupStats = ownershipGroupStatsById[card.id] ?? { totalTime: 0, lastPlayed: 0, lastSession: 0, launchCount: 0 };
                return (
                  <button key={card.id} onClick={() => openGameView(activeGroupGame)} className="flex flex-col gap-2 group text-left relative transition-transform hover:scale-105">
                    <div className="aspect-[2/3] w-full bg-[var(--color-panel)] rounded-lg overflow-hidden border border-[var(--color-border)] group-hover:border-[var(--color-accent)] relative shadow-lg">
                      {cover ? (
                        <img src={cover} className="w-full h-full object-cover" alt="" />
                      ) : syncState === "syncing" ? (
                        <div className="w-full h-full animate-pulse bg-[var(--color-border)]" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center p-4 text-center text-sm font-bold text-white" style={{ background: heroGradient(card.primaryGame.name) }}>
                          {card.displayName}
                        </div>
                      )}
                      {isFavItem && (
                        <span className="absolute top-2 right-2 text-sm leading-none" style={{ color: "var(--color-warning)", textShadow: "0 0 3px var(--color-black)", zIndex: 11 }}>★</span>
                      )}

                      {card.providerLabels.length > 1 && (
                        <span className="absolute top-2 left-2 text-[10px] px-2 py-0.5 rounded-full font-semibold"
                          style={{ background: "rgba(10, 20, 34, 0.82)", color: "var(--color-accent-soft)", border: "1px solid var(--color-accent-mid)", zIndex: 11 }}>
                          {card.providerSummary}
                        </span>
                      )}

                      <NsfwOverlay gamePath={activeGroupGame.path} meta={metadata[activeGroupGame.path] ?? metadata[card.primaryGame.path]} appSettings={appSettings} revealed={revealedNsfw} onReveal={revealNsfwPath} />
                    </div>
                    <div className="px-1">
                      <p className="text-xs font-semibold text-[var(--color-text)] truncate">{card.displayName}</p>
                      <p className="text-[10px] truncate" style={{ color: "var(--color-text-dim)" }}>
                        {card.providerLabels.length > 1 ? `${card.providerLabels.length} launch providers` : card.providerSummary}
                        {groupStats.totalTime > 0 ? ` · ${formatTime(groupStats.totalTime)}` : ""}
                      </p>
                    </div>
                  </button>
                )
              })}
            </div>
            {groupedFiltered.length === 0 && <div className="text-center py-12 text-[var(--color-text-muted)]">{t('library.main.no_games_match')}</div>}
          </div>
        ) : !selected ? (
          games.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4" style={{ color: "var(--color-text-muted)" }}>
              <svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.2 }}>
                <rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 12h4" /><path d="M8 10v4" /><circle cx="17" cy="12" r="1" />
              </svg>
              <p className="text-base" style={{ opacity: 0.4 }}>{t('library.main.add_hint')}</p>
              <div className="flex gap-3">
                <button onClick={handleAddFolder}
                  className="px-5 py-2.5 rounded font-semibold text-sm flex items-center gap-2"
                  style={{ background: "var(--color-accent-dark)", color: "var(--color-white)" }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                  {t('library.sidebar.add_folder')}
                </button>
                <button onClick={handleAddGameManually}
                  className="px-5 py-2.5 rounded font-semibold text-sm flex items-center gap-2"
                  style={{ background: "var(--color-border)", color: "var(--color-text)", border: "1px solid var(--color-border-strong)" }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 12h4" /><path d="M8 10v4" /><circle cx="17" cy="12" r="1" />
                  </svg>
                  {t('library.sidebar.add_game')}
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
        ) : (() => {
          const achUi = achievementTrackerUiState(achievements[selected.path]);
          const wineLaunchActive =
            platform !== "windows" &&
            !!(launchConfig.enabled || customizations[selected.path]?.runnerOverrideEnabled);
          const shaderCachePanel = wineLaunchActive
            ? {
                warmupLines: buildShaderWarmupLines({
                  wineActive: true,
                  prefixHasDxvk: winePrefixRowForSelected?.has_dxvk,
                  discovery: shaderCacheDiscovery,
                  engine: metadata[selected.path]?.engine,
                }),
                busy: shaderCacheActionBusy,
                onRefresh: () => { void refetchShaderDiscovery(); },
                onExport: handleGameShaderCacheExport,
                onImport: handleGameShaderCacheImport,
                onOpenGameFolder: handleOpenGameInstallFolder,
              }
            : null;
          return (
          <GameDetail
            game={selected}
            stat={stats[selected.path] || { totalTime: 0, lastPlayed: 0, lastSession: 0 }}
            meta={metadata[selected.path]}
            customization={customizations[selected.path] ?? {}}
            launchOptions={selectedOwnershipGroup && selectedOwnershipGroup.memberGames.length > 1
              ? selectedOwnershipGroup.memberGames.map((entry) => ({
                path: entry.path,
                label: `${launchProviderLabelForGame(entry, customizations[entry.path])}${entry.uninstalled ? " · Uninstalled" : " · Installed"}`,
              }))
              : []}
            currentLaunchOptionPath={selected.path}
            onSelectLaunchOption={(path) => {
              const nextGame = selectedOwnershipGroup?.memberGames.find((entry) => entry.path === path) ?? games.find((entry) => entry.path === path) ?? null;
              if (nextGame) openGameView(nextGame);
            }}
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
            onLaunchStoreGame={selected.uninstalled
              ? (() => {
                  const customization = customizations[selected.path];
                  const remoteInstallLabel = remoteInstallLabelForCustomization(customization);
                  const openStoreLabel = openStoreLabelForCustomization(customization);
                  if (!remoteInstallLabel && !openStoreLabel) return null;
                  return () => {
                    if (remoteInstallLabel) {
                      void installSelectedRemoteStoreGame();
                      return;
                    }
                    void launchSelectedStoreGame();
                  };
                })()
              : null}
            launchStoreLabel={selected.uninstalled
              ? remoteInstallLabelForCustomization(customizations[selected.path]) ?? openStoreLabelForCustomization(customizations[selected.path])
              : null}
            onRemoteInstall={selected && !selected.uninstalled && remoteInstallLabelForCustomization(customizations[selected.path])
              ? () => { void installSelectedRemoteStoreGame(); }
              : null}
            remoteInstallLabel={selected && !selected.uninstalled
              ? remoteInstallLabelForCustomization(customizations[selected.path])
              : null}
            onBackupSaves={() => backupSaveFilesForPath(selected.path)}
            onBackupSavesToCloud={() => { void backupSaveFilesToCloudForPath(selected.path); }}
            wineIntroVideoAssessment={selectedWineMediaAssessment}
            shaderCachePanel={shaderCachePanel}
            onInstallMediaFixes={platform !== "windows" ? async () => {
              if (platform === "windows") return;
              const gc = customizations[selected.path];
              const effectivePrefix = (gc?.runnerOverride?.prefixPath ?? launchConfig.prefixPath)?.trim();
              if (!effectivePrefix) {
                alert("No Wine/Proton prefix configured for this game.");
                return;
              }
              const prefixInfos = await invoke<PrefixInfo[]>("list_wine_prefixes").catch(() => []);
              const matchingPrefix = findMatchingWinePrefixEntry(prefixInfos, effectivePrefix);
              if (!matchingPrefix) {
                alert(`Prefix not found in scan: ${effectivePrefix}`);
                return;
              }
              if (matchingPrefix.media.recommended_verbs.length === 0) {
                alert("No media fixes recommended for this prefix.");
                return;
              }
              setGameMediaInstallPreview({
                prefixPath: matchingPrefix.path,
                prefixName: matchingPrefix.name,
                verbs: [...matchingPrefix.media.recommended_verbs],
                sourceLabel: "Recommended (this game's prefix)",
                beforeMedia: { ...matchingPrefix.media },
              });
            }: undefined}
            onToggleHide={toggleHide}
            onToggleFav={toggleFav}
            onTransferSaves={() => setShowSaveTransferModal(true)}
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
            onOpenAchievements={() => setShowAchievementTrackerModal(true)}
            achievementSummary={achUi.summary}
            achievementHasOpenGoals={achUi.openGoals}
            onManageCollections={() => setShowManageCollections(true)}
            appSettings={appSettings}
            revealedNsfw={revealedNsfw}
            onRevealNsfw={revealNsfwPath}
            onTakeScreenshot={async () => {
              try {
                await captureScreenshotForPath(selected.path, false);
              } catch (e) {
                await showPermissionDiagnostic("capture a screenshot", null, e, "Screenshot failed");
              }
            }}
            onAnnotateScreenshot={async () => {
              try {
                await captureScreenshotForPath(selected.path, true);
              } catch (e) {
                await showPermissionDiagnostic("capture a screenshot", null, e, "Screenshot failed");
              }
            }}
            onOpenScreenshotsFolder={() =>
              invoke("open_screenshots_folder", { gameExe: selected.path }).catch((e) =>
                showPermissionDiagnostic("open the screenshots folder", null, e, "Could not open screenshots folder")
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
          );
        })()}
      </main>
      </div>

      {/* ── Modals ── */}
      {
        showSettings && (
          <SettingsModal
            games={games}
            ghostGames={ghostGames}
            onToggleGhost={(path) => {
              const next = { ...ghostGames };
              if (next[path]) delete next[path]; else next[path] = true;
              setGhostGames(next); saveCache(SK_GHOST, next);
            }}
            onToggleAllGhost={(enabled) => {
              const next: Record<string, boolean> = {};
              if (enabled) games.forEach(g => next[g.path] = true);
              setGhostGames(next); saveCache(SK_GHOST, next);
            }}
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
            onSteamLibraryImport={() => setShowSteamLibraryImport(true)}
            onEpicImport={() => setShowEpicImport(true)}
            onLutrisImport={() => setShowLutrisImport(true)}
            onPlayniteImport={() => setShowPlayniteImport(true)}
            onGogImport={() => setShowGogImport(true)}
            onProtocolStoreImport={() => setShowProtocolStoreImport(true)}
            onExoticImport={() => setShowExoticImport(true)}
            onItchImport={() => setShowItchImport(true)}
            onAppUpdate={() => setShowAppUpdateModal(true)}
            onOpenWhatsNew={() => setShowWhatsNewModal(true)}
            appSettings={appSettings}
            defaultSettings={DEFAULT_SETTINGS}
            onSaveSettings={persistAppSettings}
            viewMode={viewMode}
            sidebarWidth={sidebarWidth}
            layoutPresets={layoutPresets}
            activeLayoutPresetId={activeLayoutPresetId}
            onViewModeChange={setViewMode}
            onSidebarWidthChange={persistSidebarWidth}
            onApplyLayoutPreset={applyLayoutPreset}
            onSaveLayoutPreset={saveCurrentLayoutPreset}
            onUpdateLayoutPreset={updateLayoutPreset}
            onDeleteLayoutPreset={deleteLayoutPreset}
            libraryProfiles={profileRegistry.profiles}
            activeLibraryProfileId={profileRegistry.activeProfileId}
            onSwitchLibraryProfile={handleSwitchLibraryProfile}
            onSaveLibraryProfile={handleSaveLibraryProfile}
            onDeleteLibraryProfile={handleDeleteLibraryProfile}
            discordSnapshot={discordSnapshot}
            onOpenDiscordSettings={() => { invoke("discord_open_connected_games_settings").catch((e) => alert("Could not open Discord settings: " + e)); }}
            onOpenMigrationWizard={() => setShowMigrationWizard(true)}
            onRunIntegrityCheck={handleRunIntegrityCheck}
            onOpenRestoreSnapshots={() => {
              setShowSnapshotRestore(true);
              setSnapshotPreview(null);
              setSnapshotPreviewError(null);
              refreshSnapshots();
            }}
            onExportCSV={handleExportCSV}
            onExportHTML={handleExportHTML}
            onExportCloudState={handleExportCloudState}
            onImportCloudState={handleImportCloudState}
            onClose={() => setShowSettings(false)}
            onBatchMetadataRefresh={handleBatchMetadataRefresh}
            batchRefreshStatus={batchRefreshStatus}
            integrityCheckStatus={integrityCheckStatus}
            backgroundJobs={backgroundJobSummaries}
            syncStatusText={backgroundJobButtonLabel(syncJob, syncState === "full-scan" ? "Full rescan in progress" : syncState === "syncing" ? "Incremental sync in progress" : "Idle")}
            isIntegrityCheckBusy={isIntegrityCheckBusy}
            isBatchMetadataRefreshBusy={isBatchMetadataRefreshBusy}
            onAutoHealPaths={handleAutoHealPaths}
            autoHealPathsStatus={autoHealPathsStatus}
            isAutoHealPathsBusy={isAutoHealPathsBusy}
            onApplyBackupRetentionPolicy={() => { applyBackupRetentionPolicy(false).catch(() => { }); }}
            backupRetentionStatus={backupRetentionStatus}
            isBackupRetentionBusy={isBackupRetentionBusy}
            onRunDbVacuum={() => { runDbVacuum(false).catch(() => { }); }}
            dbVacuumStatus={dbVacuumStatus}
            isDbVacuumBusy={isDbVacuumBusy}
            onRunCloudBackupNow={() => { runAutoCloudBackup().catch(() => { }); }}
            cloudBackupNowStatus={autoCloudBackupJob?.detail || null}
            isCloudBackupNowBusy={isAutoCloudBackupBusy}
          />
        )
      }
      {
        integrityReport && (
          <IntegrityCheckModal
            report={integrityReport}
            onClose={() => setIntegrityReport(null)}
          />
        )
      }
      {
        showSnapshotRestore && (
          <SnapshotRestoreModal
            snapshots={snapshots}
            selectedPath={selectedSnapshotPath}
            preview={snapshotPreview}
            previewLoading={snapshotPreviewLoading}
            previewError={snapshotPreviewError}
            loading={snapshotsLoading}
            restoring={restoringSnapshot}
            onSelect={handleSelectSnapshot}
            onRefresh={refreshSnapshots}
            onRestore={handleRestoreSnapshot}
            onClose={() => {
              setShowSnapshotRestore(false);
              setSnapshotPreview(null);
              setSnapshotPreviewError(null);
            }}
          />
        )
      }
      {
        showWineSettings && (
          <WineSettingsModal
            config={launchConfig}
            platform={platform}
            onPermissionFailure={showPermissionDiagnostic}
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
        showAchievementTrackerModal && selected && (
          <AchievementTrackerModal
            key={selected.path}
            displayTitle={customizations[selected.path]?.displayName ?? metadata[selected.path]?.title ?? selected.name}
            initialItems={achievements[selected.path] ?? []}
            onSave={handleSaveAchievements}
            onClose={() => setShowAchievementTrackerModal(false)}
          />
        )
      }
      {
        gameMediaInstallPreview !== null && (
          <MediaInstallPreviewModal
            isOpen
            onClose={() => setGameMediaInstallPreview(null)}
            prefixName={gameMediaInstallPreview.prefixName}
            prefixPath={gameMediaInstallPreview.prefixPath}
            verbs={gameMediaInstallPreview.verbs}
            sourceLabel={gameMediaInstallPreview.sourceLabel}
            beforeMedia={gameMediaInstallPreview.beforeMedia}
            onFinished={refreshWinePrefixRowForSelected}
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
            onBeforeUpdate={createPreUpdateBackup}
          />
        )
      }
      {
        showWhatsNewModal && (
          <WhatsNewModal onClose={() => setShowWhatsNewModal(false)} />
        )
      }
      {
        showZipInstallModal && pendingZipInstallPath && libraryFolders.length > 1 && (
          <ZipInstallModal
            zipPath={pendingZipInstallPath}
            libraryFolders={libraryFolders}
            defaultFolderPath={libraryFolders[0]?.path ?? ""}
            onInstall={async (libraryRoot) => {
              await installZipIntoLibrary(pendingZipInstallPath, libraryRoot);
            }}
            onClose={() => {
              setShowZipInstallModal(false);
              setPendingZipInstallPath(null);
            }}
          />
        )
      }
      {
        showLogViewer && (
          <LogViewerModal
            logs={rustLogs}
            recentFileOps={recentFileOps}
            crashReport={crashReport}
            scraperHealth={scraperHealth}
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
        showRecoveryPrompt && crashReport && (
          <RecoveryModeModal
            report={crashReport}
            onStaySafe={() => setShowRecoveryPrompt(false)}
            onResume={handleResumeNormalStartup}
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
            gamePath={selected.path}
            ghostGames={ghostGames}
            onClose={() => setShowLinkModal(false)}
            onFetched={handleMetaFetched}
            f95LoggedIn={f95LoggedIn}
            onOpenF95Login={() => { setShowLinkModal(false); setShowF95Login(true); }}
            appSettings={appSettings}
          />
        )
      }
      {
        showSaveTransferModal && selected && (
          <SaveTransferModal
            gameName={selected.name}
            gamePath={selected.path}
            engine={metadata[selected.path]?.engine}
            companyName={metadata[selected.path]?.developer}
            onClose={() => setShowSaveTransferModal(false)}
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
              <h2 className="text-lg font-bold mb-2" style={{ color: "var(--color-white)" }}>{t('library.uninstall.title')}</h2>
              <p className="text-sm mb-1" style={{ color: "var(--color-text)" }}>{t('library.uninstall.confirm')}</p>
              <p className="text-xs font-mono mb-4 break-all" style={{ color: "var(--color-danger)" }}>
                {deleteTarget.path.replace(/[\\/][^\\/]+$/, "")}
              </p>
              <p className="text-xs mb-3" style={{ color: "var(--color-text-muted)" }}>{t('library.uninstall.warning')}</p>
              <label className="flex items-center gap-2 text-xs mb-5 cursor-pointer select-none" style={{ color: "var(--color-text)" }}>
                <input type="checkbox" checked={keepDataOnDelete} onChange={(e) => setKeepDataOnDelete(e.currentTarget.checked)} />
                {t('library.uninstall.keep_data')}
              </label>
              <div className="flex gap-3 justify-end">
                <button onClick={() => setDeleteTarget(null)} disabled={isDeleting}
                  className="px-4 py-2 rounded text-sm disabled:opacity-50"
                  style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border-strong)" }}>{t('common.cancel')}</button>
                <button onClick={confirmDelete} disabled={isDeleting}
                  className="px-4 py-2 rounded text-sm font-semibold disabled:opacity-50 flex items-center gap-2"
                  style={{ background: "#c0392b", color: "var(--color-white)" }}>
                  {isDeleting && <span className="w-3 h-3 rounded-full border-2 border-white border-t-transparent animate-spin" />}
                  {t('library.uninstall.delete_files')}
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
        showSteamLibraryImport && (
          <SteamLibraryImportModal
            games={games}
            customizations={customizations}
            onImport={handleSteamLibraryImport}
            onClose={() => setShowSteamLibraryImport(false)}
          />
        )
      }
      {
        showEpicImport && (
          <EpicLegendaryImportModal
            games={games}
            customizations={customizations}
            onImport={handleEpicImport}
            onClose={() => setShowEpicImport(false)}
          />
        )
      }
      {
        showItchImport && (
          <ItchImportModal
            games={games}
            customizations={customizations}
            onImportInstalled={handleItchInstalledImport}
            onClose={() => setShowItchImport(false)}
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
        showProtocolStoreImport && (
          <InteropImportModal
            games={games}
            command="import_protocol_store_games"
            title="Import from EA App / Ubisoft Connect / Rockstar"
            subtitle="Scan Windows uninstall entries, Ubisoft install registry, and Origin local manifests to attach launcher-managed games with protocol-based launch support."
            accent="#ff8aa5"
            onImport={handleInteropImport}
            onClose={() => setShowProtocolStoreImport(false)}
          />
        )
      }
      {
        showExoticImport && (
          <InteropImportModal
            games={games}
            command="import_exotic_store_games"
            title="Import from GameJolt / Battle.net"
            subtitle="Experimental: detect installed GameJolt and Battle.net titles from local manifests or registry and prefill best-effort public store metadata."
            accent="#e6b85c"
            onImport={handleInteropImport}
            onClose={() => setShowExoticImport(false)}
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
        achievementsByPath={achievements}
        onSelect={openGameView}
        onBack={goBack}
        onForward={goForward}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
      />
    </div >
  );

}


