// ─── Shared Application Types ─────────────────────────────────────────────────
// All shared interfaces, type aliases, and tightly-coupled runtime constants
// extracted from App.tsx to keep the main module lean.

import type { GameAchievementsByPath } from "../lib/gameAchievements";

// ─── Core game types ──────────────────────────────────────────────────────────

export interface Game { name: string; path: string; uninstalled?: boolean; }
export interface DirMtime { path: string; mtime: number; }
export interface GameStats { totalTime: number; lastPlayed: number; lastSession: number; launchCount: number; }
export type SessionMood = "hype" | "chill" | "chaos";
/** One recorded play session */
export interface SessionEntry {
  id: string;        // unique: timestamp string
  path: string;      // game path (key into other maps)
  startedAt: number; // Unix ms — when the session began
  duration: number;  // seconds
  note: string;      // optional session note, empty string if none
  mood?: SessionMood; // optional mood tag
}

// ─── Steam types ──────────────────────────────────────────────────────────────

export interface SteamEntry { app_id: string; name: string; played_minutes: number; }
export interface SteamLibraryEntry {
  app_id: string;
  name: string;
  install_dir: string;
  library_dir: string;
  manifest_path: string;
  exe?: string | null;
}
export interface SteamOwnedGame {
  app_id: string;
  name: string;
  played_minutes: number;
  installed: boolean;
  install_dir?: string | null;
  library_dir?: string | null;
  manifest_path?: string | null;
  exe?: string | null;
}

// ─── Epic / Legendary types ───────────────────────────────────────────────────

export interface EpicLegendaryStatus {
  available: boolean;
  authenticated: boolean;
  executablePath?: string | null;
  version?: string | null;
  displayName?: string | null;
  installUrl: string;
  lastError?: string | null;
}
export interface EpicOwnedGame {
  app_name: string;
  title: string;
  installed: boolean;
  install_path?: string | null;
  exe?: string | null;
  version?: string | null;
}

// ─── itch.io types ────────────────────────────────────────────────────────────

export interface ItchButlerStatus {
  available: boolean;
  executablePath?: string | null;
  version?: string | null;
  installUrl: string;
  apiKeyProvider: string;
}
export interface ItchInstallLocation {
  id: string;
  path: string;
}
export interface ItchProfile {
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
export interface ItchCave {
  id: string;
  upload?: { id: number } | null;
  build?: { id: number } | null;
}
export interface ItchLibraryEntry {
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
export interface ItchOwnedLibrary {
  profile: ItchProfile;
  records: ItchLibraryEntry[];
  caves: ItchCave[];
  installLocations: ItchInstallLocation[];
}
export interface ItchGameUpdateChoice {
  upload: { id: number; displayName?: string | null; channelName?: string | null; build?: { id: number } | null };
  build?: { id: number; userVersion?: string | null; version?: number | null } | null;
  confidence: number;
}
export interface ItchGameUpdate {
  caveId: string;
  game: { id: number; title: string };
  direct: boolean;
  choices: ItchGameUpdateChoice[];
}
export interface ItchUpdateCheckResult {
  updates: ItchGameUpdate[];
  warnings: string[];
}
export interface ItchInstallResult {
  gameId: number;
  title: string;
  caveId: string;
  installFolder: string;
  uploadId: number;
  buildId?: number | null;
}

// ─── Metadata types ───────────────────────────────────────────────────────────

export interface MetadataSourceLink {
  source: string;
  source_label?: string;
  source_url: string;
  fetchedAt?: number;
}

export interface MetadataSourceSnapshot {
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

export interface GameMetadata {
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

export const METADATA_SOURCE_PRIORITY = [
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

// ─── Metadata post-processing rules ──────────────────────────────────────────

export type MetadataCleanupField =
  | "title" | "developer" | "publisher" | "overview" | "engine"
  | "version" | "release_date" | "circle" | "tags" | "genres" | "*";

export type MetadataCleanupRuleType =
  | "regex_replace"
  | "trim_prefix"
  | "trim_suffix"
  | "strip_brackets"
  | "exclude_item"
  | "lowercase_all"
  | "uppercase_first";

export interface MetadataCleanupRule {
  id: string;
  enabled: boolean;
  field: MetadataCleanupField;
  type: MetadataCleanupRuleType;
  /** pattern for regex_replace / exclude_item / trim_prefix / trim_suffix */
  pattern?: string;
  /** replacement string for regex_replace */
  replacement?: string;
  description?: string;
}

export interface MetadataFieldSourceOverride {
  field: MetadataCleanupField;
  /** ordered list of sources to prefer for this field */
  sources: string[];
}

export interface MetadataPostProcessingConfig {
  /** Reordered global source list; replaces METADATA_SOURCE_PRIORITY baseline */
  globalSourceOrder: string[];
  /** Per-field source preference overrides */
  fieldSourceOverrides: MetadataFieldSourceOverride[];
  /** Post-merge text cleanup rules */
  cleanupRules: MetadataCleanupRule[];
}

export const DEFAULT_METADATA_RULES: MetadataPostProcessingConfig = {
  globalSourceOrder: [],
  fieldSourceOverrides: [],
  cleanupRules: [],
};

// ─── Update / file-op types ───────────────────────────────────────────────────

export interface UpdatePreview {
  game_dir: string;
  source_is_zip: boolean;
  files_to_update: number;
  new_files: number;
  zip_entry_count?: number;
  protected_dirs: string[];
}
export interface UpdateResult {
  files_updated: number;
  files_skipped: number;
  protected_dirs: string[];
  backup_dir: string;
  warnings: string[];
}

export interface Screenshot {
  path: string;
  filename: string;
  timestamp: number;
  tags: string[];
}

export interface ScreenshotToast {
  id: string;
  gamePath: string;
  screenshot: Screenshot;
  label: string;
}

export interface ScreenshotOverlayPayload {
  gamePath: string;
  gameTitle: string;
  screenshot: Screenshot;
  label?: string;
}

// ─── Diagnostics / crash / log types ─────────────────────────────────────────

export interface RustLogEntry {
  ts: number;
  level: string;
  message: string;
}

export interface CrashReport {
  ts: number;
  thread: string;
  message: string;
  location: string;
  backtrace: string;
}
export interface ScraperHealthDiagnostic {
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
export interface IntegrityIssue {
  severity: "error" | "warning" | string;
  code: string;
  message: string;
  path?: string | null;
  gamePath?: string | null;
}
export interface IntegrityCheckReport {
  scannedAt: number;
  totalGames: number;
  totalLibraryFolders: number;
  errorCount: number;
  warningCount: number;
  issues: IntegrityIssue[];
}
export interface AutoHealSuggestion {
  gameName: string;
  oldPath: string;
  newPath: string;
  confidence: number;
  reason: string;
}
export interface AutoHealReport {
  scannedAt: number;
  totalBrokenGames: number;
  suggestionCount: number;
  unresolvedPaths: string[];
  suggestions: AutoHealSuggestion[];
}
export interface BackupRetentionApplyResult {
  snapshotsDeleted: number;
  saveBackupsDeleted: number;
  snapshotsKept: number;
  saveBackupsKept: number;
}
export interface PermissionDiagnostic {
  operation: string;
  rawError: string;
  targetPath?: string | null;
  appDataRoot: string;
  portableMode: boolean;
  summary: string;
  probableCause: string;
  actionableFixes: string[];
}
export interface SnapshotResult {
  id: string;
  path: string;
  createdAt: number;
  entryCount: number;
  label?: string | null;
  reason?: string | null;
}
export interface SnapshotContents extends SnapshotResult {
  entries: Record<string, string>;
}
export interface SnapshotPreviewItem {
  key: string;
  label: string;
  status: "changed" | "same" | "missing_in_snapshot" | "new_in_snapshot";
  currentCount: number;
  snapshotCount: number;
}
export interface SnapshotRestorePreview {
  snapshot: SnapshotContents;
  items: SnapshotPreviewItem[];
  changedCount: number;
  currentGames: number;
  snapshotGames: number;
  currentFolders: number;
  snapshotFolders: number;
}
export interface RecentFileOp {
  ts: number;
  operation: string;
  path: string;
  strategy: string;
  success: boolean;
  error?: string | null;
}
export type BackgroundJobStatus = "queued" | "running" | "retrying" | "failed" | "permanent_failed";
export interface BackgroundJob {
  id: string;
  label: string;
  status: BackgroundJobStatus;
  detail?: string | null;
  progressCurrent?: number | null;
  progressTotal?: number | null;
  attempts?: number | null;
  updatedAt: number;
}
export interface MetadataQueueItem {
  path: string;
  metadata: GameMetadata;
}
export interface FolderQueueItem {
  path: string;
}
export interface SaveBackupResult {
  zip_path: string;
  files: number;
  directories: string[];
}

export interface ZipInstallResult {
  zipPath: string;
  libraryRoot: string;
  installedDir: string;
  sourceDir: string;
  warnings: string[];
}

export interface VacuumReport {
  tempFilesRemoved: number;
  tempBytesFreed: number;
  logEntriesPruned: number;
  journalEntriesPruned: number;
  durationMs: number;
}

export type LogLevelFilter = "all" | "error" | "warn" | "info";

export interface HistoryEntry {
  id: string;
  date: number;
  version: string;
  note: string;
}
export type GameHistoryMap = Record<string, HistoryEntry[]>;
export type NavEntry = {
  tab: "library" | "feed" | "stats";
  selectedPath: string | null;
};

// ─── Rating types ─────────────────────────────────────────────────────────────

export type RatingScale = "10" | "10_decimal" | "100" | "5_star" | "3_smiley";
export type RatingCategoryKey = "gameplay" | "story" | "soundtrack" | "visuals" | "characters" | "performance";

// ─── Game customization ───────────────────────────────────────────────────────

export interface GameCustomization {
  displayName?: string;
  coverUrl?: string;
  backgroundUrl?: string;
  /** Optional game logo artwork URL (e.g. SteamGridDB logos) */
  logoUrl?: string;
  /** Optional game icon artwork URL (e.g. SteamGridDB icons) */
  iconUrl?: string;
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
  /** MUGEN engine compatibility: force process affinity to core 0 only */
  mugenForceSingleCore?: boolean;
  /** MUGEN engine compatibility: path to dgVoodoo2 root folder for wrapper DLLs */
  mugenDgVoodooFolder?: string;
  /** Emulator profile ID to launch this game via an emulator */
  emulatorProfileId?: string;
  /** Absolute path to the ROM file (used with emulatorProfileId) */
  romPath?: string;
}

export interface SearchResultItem {
  title: string;
  url: string;
  cover_url: string | null;
  source: string;
}

// ─── Theme ────────────────────────────────────────────────────────────────────

export type ThemeMode = "dark" | "light" | "oled" | "mint-apple" | "hanami" | "dawn" | "sunset" | "crimson-moon" | "sepia" | "cotton-candy" | "ocean-deep"
  | "citrus-sherbert" | "retro-raincloud" | "sunrise" | "lofi-vibes" | "desert-khaki"
  | "chroma-glow" | "forest" | "midnight-blurple" | "mars" | "dusk" | "retro-storm" | "neon-nights" | "strawberry-lemonade" | "aurora" | "blurple-twilight"
  | "custom";

// ─── Wishlist / library types ─────────────────────────────────────────────────

export interface WishlistItem {
  id: string; // usually a URL
  title: string;
  source: string;
  releaseStatus: string;
  addedAt: number;
}

/** A library root directory that's been added by the user. */
export interface LibraryFolder { path: string; }

export interface RecentGame { name: string; path: string; }

export interface LibraryProfile {
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

export interface LibraryProfileRegistry {
  activeProfileId: string;
  profiles: LibraryProfile[];
}

// ─── Launch / runner types ────────────────────────────────────────────────────

export type RunnerKind = "wine" | "proton" | "custom";

export interface LaunchConfig {
  enabled: boolean;        // false = always run directly
  runner: RunnerKind;
  runnerPath: string;         // path to wine/proton binary
  prefixPath: string;         // WINEPREFIX / STEAM_COMPAT_DATA_PATH
}

export interface RunnerOverrideConfig {
  runner: RunnerKind;
  runnerPath: string;
  prefixPath: string;
}

/** A configured emulator profile for launching ROMs */
export interface EmulatorProfile {
  /** Unique identifier */
  id: string;
  /** Human-readable name, e.g. "RetroArch GBA" */
  name: string;
  /** Absolute path to the emulator executable */
  emulatorPath: string;
  /** Launch args template. Tokens: {rom} {core} {dir} {name} */
  args: string;
  /** Optional core path (e.g. RetroArch .dll/.so core) */
  corePath?: string;
  /** ROM file extensions supported, e.g. ["gba","gb","gbc"] */
  extensions: string[];
}

export interface PrefixInfo {
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

// ─── Third-party store / interop types ───────────────────────────────────────

export interface LutrisGameEntry {
  name: string;
  slug: string;
  exe: string;
  prefix?: string;
  runner?: string;
  args?: string;
  config_path: string;
}

export interface InteropGameEntry {
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

// ─── App settings ─────────────────────────────────────────────────────────────

export interface AppSettings {
  updateCheckerEnabled: boolean;
  appUpdateCheckerEnabled: boolean;
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
  sidebarShowGlobalNotes?: boolean;
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

// ─── Layout / preset types ────────────────────────────────────────────────────

export type LayoutViewMode = "list" | "compact" | "grid";

export type LayoutPresetConfig = {
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
  sidebarShowGlobalNotes: boolean;
  sidebarShowAddButton: boolean;
  sidebarShowSettingsButton: boolean;
  sidebarShowLogsButton: boolean;
};

export type LayoutPresetRecord = {
  id: string;
  name: string;
  description?: string;
  config: LayoutPresetConfig;
};

export type LayoutPresetDescriptor = LayoutPresetRecord & {
  readOnly?: boolean;
};

export const LAYOUT_SIDEBAR_SETTING_KEYS = [
  "sidebarShowNews",
  "sidebarShowStats",
  "sidebarShowSearchTools",
  "sidebarShowCollections",
  "sidebarShowDevelopers",
  "sidebarShowWishlist",
  "sidebarShowSurpriseButton",
  "sidebarShowGlobalNotes",
  "sidebarShowAddButton",
  "sidebarShowSettingsButton",
  "sidebarShowLogsButton",
] as const;

export const BUILTIN_LAYOUT_PRESETS: LayoutPresetDescriptor[] = [
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
      sidebarShowGlobalNotes: false,
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
      sidebarShowGlobalNotes: true,
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
      sidebarShowGlobalNotes: false,
      sidebarShowAddButton: true,
      sidebarShowSettingsButton: true,
      sidebarShowLogsButton: true,
    },
  },
];

// ─── Discord types ────────────────────────────────────────────────────────────

export interface DiscordUserSnapshot {
  id: string;
  username: string;
  displayName: string;
  globalName?: string | null;
  avatarUrl?: string | null;
  status: string;
}

export interface DiscordRelationshipCounts {
  onlinePlayingGame: number;
  onlineElsewhere: number;
  offline: number;
  total: number;
}

export interface DiscordSdkSnapshot {
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

export interface DiscordPresenceInput {
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

// ─── Cloud sync / store types ─────────────────────────────────────────────────

export interface CloudSyncPayloadV1 {
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

export interface SteamLaunchBridge {
  path: string;
  appId: string;
  baselineMinutes: number;
  lastSeenMinutes: number;
  sawIncrease: boolean;
  stalledPolls: number;
  pollCount: number;
}

export const STEAM_PLACEHOLDER_PREFIX = "steam://owned/";
export const EPIC_PLACEHOLDER_PREFIX = "epic://owned/";

export const STORE_PROVIDER_LABELS: Record<string, string> = {
  "epic-games": "Epic Games Store",
  "ea-app": "EA App",
  "ubisoft-connect": "Ubisoft Connect",
  rockstar: "Rockstar Launcher",
  "battle-net": "Battle.net",
  gamejolt: "Game Jolt",
  itch: "itch.io",
};

// ─── Ownership / collections ──────────────────────────────────────────────────

export interface OwnershipGroup {
  id: string;
  displayName: string;
  memberGames: Game[];
  memberPaths: string[];
  primaryGame: Game;
  providerLabels: string[];
  providerSummary: string;
}

export interface Collection {
  id: string;
  name: string;
  color: string;
  gamePaths: string[];
}

// ─── UI / sorting / filtering types ──────────────────────────────────────────

export type SortMode = "name" | "lastPlayed" | "playtime" | "custom";
export type FilterMode = "all" | "favs" | "hidden" | "f95" | "dlsite" | "vndb" | "mangagamer" | "johren" | "fakku" | "igdb" | "rawg" | "mobygames" | "unlinked" | "Playing" | "Completed" | "On Hold" | "Dropped" | "Plan to Play" | string;
export type LaunchRequest = { mode: "path" | "name"; value: string; autoHide?: boolean };

// ─── Profile storage snapshot (for multi-profile support) ────────────────────

export type ProfileStorageSnapshot = {
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
