// ─── Storage Keys ─────────────────────────────────────────────────────────────
export const SK_GAMES = "games-list-v2";
export const SK_MTIMES = "dir-mtimes-v2";
export const SK_PATH = "scanned-path";        // legacy – single folder
export const SK_FOLDERS = "library-folders-v1"; // v3: array of LibraryFolder
export const SK_STATS = "game-stats";
export const SK_META = "game-metadata";
export const SK_HIDDEN = "hidden-games-v1";
export const SK_FAVS = "fav-games-v1";
export const SK_GHOST = "ghost-games-v1";
export const SK_CUSTOM = "game-custom-v1";
export const SK_NOTES = "game-notes-v1";
export const SK_ACHIEVEMENTS = "game-achievements-v1";
export const SK_COLLECTIONS = "collections-v1";
export const SK_LAUNCH = "launch-config-v1";
export const SK_RECENT = "recent-games-v1";
export const SK_ORDER = "custom-order-v1";
export const SK_SESSION_LOG = "session-log-v1";
export const SK_WISHLIST = "wishlist-v1";
export const SK_HISTORY = "game-history-v1";
export const SK_SETTINGS = "libmaly_app_settings-v1";

// ─── Background Job Constants ─────────────────────────────────────────────────
export const BACKGROUND_JOB_BUSY_STATUSES = ["queued", "running", "retrying"] as const;
export const JOB_INCREMENTAL_SYNC = "incremental-sync";
export const JOB_FULL_SCAN = "full-scan";
export const JOB_INTEGRITY_CHECK = "integrity-check";
export const JOB_BATCH_METADATA_REFRESH = "batch-metadata-refresh";
export const JOB_AUTO_METADATA_REFRESH = "auto-metadata-refresh";
export const JOB_UPDATE_CHECKER = "update-checker";
export const JOB_AUTO_HEAL_PATHS = "auto-heal-paths";
export const JOB_BACKUP_RETENTION = "backup-retention";
export const JOB_DB_VACUUM = "db-vacuum";
export const DEFAULT_METADATA_QUEUE_CONCURRENCY = 2;
export const DEFAULT_METADATA_QUEUE_MAX_ATTEMPTS = 3;
export const DEFAULT_METADATA_QUEUE_BACKOFF_MS = 1500;

// ─── Collection Colors ────────────────────────────────────────────────────────
export const COLLECTION_COLORS = ["var(--color-accent)", "var(--color-warning)", "#a170c8", "#e8734a", "#5ba85b", "#d45252", "#4a8ee8", "#e85480"];

// ─── Rating Categories ────────────────────────────────────────────────────────
export const RATING_CATEGORIES: { key: "gameplay" | "story" | "soundtrack" | "visuals" | "characters" | "performance"; label: string }[] = [
  { key: "gameplay", label: "Gameplay" },
  { key: "story", label: "Story" },
  { key: "soundtrack", label: "Soundtrack" },
  { key: "visuals", label: "Visuals" },
  { key: "characters", label: "Characters" },
  { key: "performance", label: "Performance" },
];

// ─── Generic Exe Names ────────────────────────────────────────────────────────
export const GENERIC_EXE_NAMES = new Set([
  "game", "start", "play", "launch", "launcher",
  "nw", "nwjs", "app", "electron",
  "main", "run", "exec",
  "renpy", "lib", "engine",
  "ux", "client", "project",
  "visual_novel", "vn",
]);

// ─── Screenshot Toast TTL ─────────────────────────────────────────────────────
export const SCREENSHOT_TOAST_TTL_MS = 3600;

// ─── Default Launch Config ────────────────────────────────────────────────────
export const DEFAULT_LAUNCH_CONFIG = { enabled: false, runner: "wine" as const, runnerPath: "", prefixPath: "" };

// ─── Default Settings ─────────────────────────────────────────────────────────
export const DEFAULT_SETTINGS = {
  updateCheckerEnabled: false,
  sessionToastEnabled: false,
  trayTooltipEnabled: false,
  startupWithWindows: false,
  surpriseLaunchesImmediately: true,
  themeMode: "dark" as const,
  seasonalTheme: "auto" as const,
  ratingScale: "10" as const,
  themeScheduleMode: "manual" as const,
  dayThemeMode: "light" as const,
  nightThemeMode: "dark" as const,
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
  discordEnabled: false,
  discordShowElapsedTime: true,
  discordShowIdlePresence: false,
  discordAllowActivityJoin: true,
  backupRetentionDailyKeep: 7,
  backupRetentionWeeklyKeep: 4,
  backupRetentionMonthlyKeep: 6,
  bossKeyEnabled: false,
  bossKeyCode: 0x7A, // F11
  bossKeyAction: "hide" as const,
  bossKeyMuteSystem: false,
  bossKeyFallbackUrl: "",
  customThemeColors: {},
  language: "en",
};
