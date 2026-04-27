import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { useTranslation } from "react-i18next";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import SyncConflictModal from "./SyncConflictModal";
import { addCustomLanguage, loadCustomLanguages, removeCustomLanguage } from "../../i18n";
import { SK_COLLECTIONS, SK_GAMES, SK_META, SK_NOTES } from "../../lib/constants";
import type { MetadataPostProcessingConfig, MetadataCleanupField, MetadataCleanupRuleType, MetadataCleanupRule, EmulatorProfile } from "../../types";
import {
  syncConfigure,
  syncGetConfig,
  syncUpload,
  syncDownload,
  syncCheckRemote,
  syncPreviewConflicts,
  type SyncProviderConfig,
  type SyncConflictPreviewReport,
  type SyncResult,
  type WebdavConfig,
  type NextcloudConfig,
  type S3Config,
  type GitConfig,
  type GoogleDriveConfig,
  type DropboxConfig,
  createWebdavConfig,
  createNextcloudConfig,
  createS3Config,
  createGitConfig,
  createGoogleDriveConfig,
  createDropboxConfig,
  getSyncProviderLabel,
  isAutoBackupProvider,
  syncStartOAuth,
} from "../../lib/sync";

interface Game { name: string; path: string; }
type BackgroundJobStatus = "queued" | "running" | "retrying" | "failed" | "permanent_failed";
interface BackgroundJobSummary {
  id: string;
  label: string;
  status: BackgroundJobStatus;
  detail?: string | null;
  progressCurrent?: number | null;
  progressTotal?: number | null;
  attempts?: number | null;
  updatedAt: number;
}

type RatingScale = "10" | "10_decimal" | "100" | "5_star" | "3_smiley";
type GameDetailLayoutPreset = "metadata-first" | "screenshots-first" | "notes-first";
type ThemeMode = "dark" | "light" | "oled" | "mint-apple" | "hanami" | "dawn" | "sunset" | "crimson-moon" | "sepia" | "cotton-candy" | "ocean-deep"
  | "citrus-sherbert" | "retro-raincloud" | "sunrise" | "lofi-vibes" | "desert-khaki"
  | "chroma-glow" | "forest" | "midnight-blurple" | "mars" | "dusk" | "retro-storm" | "neon-nights" | "strawberry-lemonade" | "aurora" | "blurple-twilight"
  | "custom";
interface AppSettingsLike {
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
  themeBackgroundImageUrl?: string;
  themeBackgroundImageOverlay?: string;
  themeBackgroundImageOpacity?: number;
  themeBackgroundImageBlurPx?: number;
  themeMarketplaceRelayUrl?: string;
  language?: string;
  preferredSearchEngine?: "duckduckgo" | "google" | "bing" | "brave";
  gameDetailLayoutPreset: GameDetailLayoutPreset;
}

interface DiscordSdkSnapshotLike {
  available: boolean;
  initialized: boolean;
  connected: boolean;
  ready: boolean;
  clientStatus: string;
  launchRegistered: boolean;
  richPresenceActive: boolean;
  currentUser?: {
    displayName: string;
    username: string;
    status: string;
  } | null;
  relationshipCounts: {
    onlinePlayingGame: number;
    onlineElsewhere: number;
    offline: number;
    total: number;
  };
  lastError?: string | null;
}

interface LibraryProfileLike {
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

interface LibraryProfileDraftLike {
  id?: string;
  displayName: string;
  handle?: string;
  tagline?: string;
  avatarUrl?: string;
  bannerUrl?: string;
  accentColor?: string;
}

interface VaultEntryStatus {
  key: string;
  group: string;
  label: string;
  hasValue: boolean;
}

interface VaultSummary {
  profileId: string;
  entries: VaultEntryStatus[];
}

interface CustomMetadataTemplateSummary {
  id: string;
  name: string;
  description?: string | null;
  enabled: boolean;
  overrideBuiltin: boolean;
  urlPatterns: string[];
  fieldCount: number;
}

type LayoutViewMode = "list" | "compact" | "grid";

interface LayoutPresetConfig {
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
}

interface LayoutPresetDescriptor {
  id: string;
  name: string;
  description?: string;
  config: LayoutPresetConfig;
  readOnly?: boolean;
}

interface StorageBootstrap {
  unified: boolean;
  entries: Record<string, string>;
}

interface ExplorerQuickLaunchStatus {
  supported: boolean;
  registered: boolean;
  menuTitle: string;
  executablePath?: string | null;
  command?: string | null;
}

interface ExplorerZipInstallStatus {
  supported: boolean;
  registered: boolean;
  menuTitle: string;
  executablePath?: string | null;
  command?: string | null;
}

interface ConsistencyTestResult {
  passed: boolean;
  message: string;
  details?: string[];
}

interface ReliabilityScenarioResult {
  key: string;
  passed: boolean;
  message: string;
  details: string[];
}

interface ReliabilityScenarioReport {
  completedAt: number;
  platform: string;
  scenarios: ReliabilityScenarioResult[];
}

interface ThemeMarketplaceEntry {
  id: string;
  name: string;
  author?: string;
  description?: string;
  previewImage?: string;
  tags?: string[];
  accentColor?: string;
  customThemeColors?: Record<string, string>;
  backgroundImageUrl?: string;
  backgroundOverlay?: string;
  backgroundOpacity?: number;
  backgroundBlurPx?: number;
}

const TRUSTED_THEME_RELAY_HOSTS = new Set([
  "raw.githubusercontent.com",
  "gist.githubusercontent.com",
  "cdn.jsdelivr.net",
  "themes.libmaly.dev",
  "localhost",
  "127.0.0.1",
]);

const GLOBAL_STORAGE_KEYS = new Set(["libmaly_last_seen_version"]);

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: "dark", label: "themes.dark" },
  { value: "light", label: "themes.light" },
  { value: "oled", label: "themes.oled" },
  { value: "citrus-sherbert", label: "themes.citrus" },
  { value: "retro-raincloud", label: "themes.retro_raincloud" },
  { value: "sunrise", label: "themes.sunrise" },
  { value: "lofi-vibes", label: "themes.lofi" },
  { value: "desert-khaki", label: "themes.desert" },
  { value: "chroma-glow", label: "themes.chroma" },
  { value: "forest", label: "themes.forest" },
  { value: "midnight-blurple", label: "themes.midnight" },
  { value: "mars", label: "themes.mars" },
  { value: "dusk", label: "themes.dusk" },
  { value: "retro-storm", label: "themes.retro_storm" },
  { value: "neon-nights", label: "themes.neon" },
  { value: "strawberry-lemonade", label: "themes.strawberry" },
  { value: "aurora", label: "themes.aurora" },
  { value: "blurple-twilight", label: "themes.twilight" },
  { value: "mint-apple", label: "themes.mint" },
  { value: "hanami", label: "themes.hanami" },
  { value: "dawn", label: "themes.dawn" },
  { value: "sunset", label: "themes.sunset" },
  { value: "crimson-moon", label: "themes.crimson" },
  { value: "sepia", label: "themes.sepia" },
  { value: "cotton-candy", label: "themes.candy" },
  { value: "ocean-deep", label: "themes.ocean" },
  { value: "custom", label: "themes.custom" },
];

const DAY_THEME_OPTIONS = THEME_OPTIONS.filter((theme) =>
  ["light", "mint-apple", "hanami", "dawn", "cotton-candy", "citrus-sherbert", "retro-raincloud", "sunrise", "lofi-vibes", "desert-khaki"].includes(theme.value)
);

const NIGHT_THEME_OPTIONS = THEME_OPTIONS.filter((theme) =>
  ["dark", "oled", "sunset", "crimson-moon", "sepia", "ocean-deep", "chroma-glow", "forest", "midnight-blurple", "mars", "dusk", "retro-storm", "neon-nights", "strawberry-lemonade", "aurora", "blurple-twilight"].includes(theme.value)
);

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

function normalizeHexColor(input: string, fallback: string) {
  const x = (input || "").trim();
  const hex = x.startsWith("#") ? x : `#${x}`;
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.toLowerCase() : fallback;
}

function isTrustedThemeRelayUrl(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    return TRUSTED_THEME_RELAY_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function parseThemeMarketplaceCatalog(raw: unknown): ThemeMarketplaceEntry[] {
  const rows = Array.isArray(raw)
    ? raw
    : (raw && typeof raw === "object" && Array.isArray((raw as { themes?: unknown[] }).themes)
      ? (raw as { themes: unknown[] }).themes
      : []);

  const entries: ThemeMarketplaceEntry[] = [];
  for (const item of rows) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = String(row.id || row.slug || "").trim();
    const name = String(row.name || "").trim();
    if (!id || !name) continue;
    entries.push({
      id,
      name,
      author: typeof row.author === "string" ? row.author : undefined,
      description: typeof row.description === "string" ? row.description : undefined,
      previewImage: typeof row.previewImage === "string" ? row.previewImage : undefined,
      tags: Array.isArray(row.tags) ? row.tags.filter((x): x is string => typeof x === "string") : undefined,
      accentColor: typeof row.accentColor === "string" ? row.accentColor : undefined,
      customThemeColors: row.customThemeColors && typeof row.customThemeColors === "object" ? row.customThemeColors as Record<string, string> : undefined,
      backgroundImageUrl: typeof row.backgroundImageUrl === "string" ? row.backgroundImageUrl : undefined,
      backgroundOverlay: typeof row.backgroundOverlay === "string" ? row.backgroundOverlay : undefined,
      backgroundOpacity: typeof row.backgroundOpacity === "number" ? row.backgroundOpacity : undefined,
      backgroundBlurPx: typeof row.backgroundBlurPx === "number" ? row.backgroundBlurPx : undefined,
    });
  }
  return entries;
}

function MigrationWizardModal({
  games,
  onApply,
  onClose,
}: {
  games: Game[];
  onApply: (oldRoot: string, newRoot: string) => Promise<number>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [oldRoot, setOldRoot] = useState("");
  const [newRoot, setNewRoot] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  const matchedCount = useMemo(() => {
    if (!oldRoot.trim()) return 0;
    return games.filter((g) => remapPathByRoot(g.path, oldRoot, newRoot || oldRoot) !== null).length;
  }, [games, oldRoot, newRoot]);

  const pickFolder = async (mode: "old" | "new") => {
    const selected = await open({ directory: true, multiple: false }).catch(() => null);
    if (!selected || typeof selected !== "string") return;
    if (mode === "old") setOldRoot(selected);
    else setNewRoot(selected);
  };

  const apply = async () => {
    setError("");
    if (!oldRoot.trim() || !newRoot.trim()) {
      setError(t('common.migration.error_select_both'));
      return;
    }
    if (normalizePathForMatch(oldRoot) === normalizePathForMatch(newRoot)) {
      setError(t('common.migration.error_same_folder'));
      return;
    }
    if (matchedCount === 0) {
      setError(t('common.migration.error_no_matches'));
      return;
    }
    setWorking(true);
    try {
      const moved = await onApply(oldRoot, newRoot);
      alert(t('common.migration.success', { count: moved }));
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setWorking(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-9999 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.8)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="rounded-xl shadow-2xl w-160 max-w-[92vw] max-h-[85vh] flex flex-col"
        style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
        <div className="flex items-center gap-3 px-5 py-3 border-b" style={{ borderColor: "var(--color-border-card)" }}>
          <h2 className="font-bold text-sm" style={{ color: "var(--color-white)" }}>{t('common.migration.title')}</h2>
          <div className="flex-1" />
          <button onClick={onClose} className="text-sm" style={{ color: "var(--color-text-dim)" }}>✕</button>
        </div>
        <div className="px-5 py-4 space-y-3 text-xs" style={{ color: "var(--color-text-muted)" }}>
          <p>
            {t('common.migration.description')}
          </p>
          <div className="space-y-2">
            <label className="block text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>{t('common.migration.old_folder')}</label>
            <div className="flex gap-2">
              <input
                value={oldRoot}
                onInput={(e) => setOldRoot((e.target as HTMLInputElement).value)}
                placeholder="D:\\Games\\OldFolder"
                className="flex-1 px-2.5 py-2 rounded outline-none bg-transparent border text-sm"
                style={{ borderColor: "var(--color-border)", color: "var(--color-text)" }}
              />
              <button onClick={() => pickFolder("old")} className="px-3 py-2 rounded text-xs font-semibold"
                style={{ background: "var(--color-panel-3)", color: "var(--color-text)" }}>{t('common.migration.browse')}</button>
            </div>
          </div>
          <div className="space-y-2">
            <label className="block text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>{t('common.migration.new_folder')}</label>
            <div className="flex gap-2">
              <input
                value={newRoot}
                onInput={(e) => setNewRoot((e.target as HTMLInputElement).value)}
                placeholder="E:\\Games\\NewFolder"
                className="flex-1 px-2.5 py-2 rounded outline-none bg-transparent border text-sm"
                style={{ borderColor: "var(--color-border)", color: "var(--color-text)" }}
              />
              <button onClick={() => pickFolder("new")} className="px-3 py-2 rounded text-xs font-semibold"
                style={{ background: "var(--color-panel-3)", color: "var(--color-text)" }}>{t('common.migration.browse')}</button>
            </div>
          </div>
          <div className="rounded p-2.5" style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border-soft)" }}>
            <p style={{ color: "var(--color-text-muted)" }}>
              {t('common.migration.matched_games', { count: matchedCount })}
            </p>
          </div>
          {error && <p style={{ color: "var(--color-danger)" }}>{error}</p>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t" style={{ borderColor: "var(--color-border-card)" }}>
          <button onClick={onClose} className="px-3 py-1.5 rounded text-xs" style={{ background: "transparent", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>
            {t('common.migration.cancel')}
          </button>
          <button onClick={apply} disabled={working} className="px-4 py-1.5 rounded text-xs font-semibold disabled:opacity-50"
            style={{ background: "var(--color-accent-dark)", color: "var(--color-white)" }}>
            {working ? t('common.migration.migrating') : t('common.migration.apply')}
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingsSurface({
  title,
  description,
  children,
  wide = false,
}: {
  title: string;
  description?: string;
  children: ComponentChildren;
  wide?: boolean;
}) {
  return (
    <section
      className={`settings-surface-card${wide ? " settings-surface-card--wide" : ""}`}
      style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}
    >
      <div className="settings-surface-card__header">
        <h3 className="settings-surface-card__title">{title}</h3>
        {description && (
          <p className="settings-surface-card__description" style={{ color: "var(--color-text-muted)" }}>
            {description}
          </p>
        )}
      </div>
      <div className="settings-surface-card__body">{children}</div>
    </section>
  );
}

function SettingsStat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="settings-stat" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
      <div className="settings-stat__label" style={{ color: "var(--color-text-dim)" }}>{label}</div>
      <div className="settings-stat__value" style={{ color: "var(--color-text)" }}>{value}</div>
    </div>
  );
}

// ─── Settings Modal ────────────────────────────────────────────────────────────
function SettingsModal({
  games, ghostGames, onToggleGhost, onToggleAllGhost,
  f95LoggedIn, dlsiteLoggedIn, fakkuLoggedIn, libraryFolders, syncState, platform, launchConfig,
  appUpdate, appSettings,
  defaultSettings,
  onF95Login, onF95Logout, onDLsiteLogin, onDLsiteLogout, onFakkuLogin, onFakkuLogout, onRemoveFolder,
  onRescanAll, onWineSettings, onSteamImport, onSteamLibraryImport, onEpicImport, onLutrisImport, onPlayniteImport, onGogImport, onProtocolStoreImport, onExoticImport, onItchImport, onAppUpdate, onOpenWhatsNew, onSaveSettings, onOpenMigrationWizard, onClose,
  viewMode, sidebarWidth, layoutPresets, activeLayoutPresetId, onViewModeChange, onSidebarWidthChange, onApplyLayoutPreset, onSaveLayoutPreset, onUpdateLayoutPreset, onDeleteLayoutPreset,
  onRunIntegrityCheck, onOpenRestoreSnapshots, onExportCSV, onExportHTML, onExportCloudState, onImportCloudState, onBatchMetadataRefresh, batchRefreshStatus, integrityCheckStatus,
  backgroundJobs, syncStatusText, isIntegrityCheckBusy, isBatchMetadataRefreshBusy, onAutoHealPaths, autoHealPathsStatus, isAutoHealPathsBusy,
  onApplyBackupRetentionPolicy, backupRetentionStatus, isBackupRetentionBusy,
  onRunDbVacuum, dbVacuumStatus, isDbVacuumBusy,
  onRunCloudBackupNow, cloudBackupNowStatus, isCloudBackupNowBusy,
  discordSnapshot, onOpenDiscordSettings
  , libraryProfiles, activeLibraryProfileId, onSwitchLibraryProfile, onSaveLibraryProfile, onDeleteLibraryProfile
  , metadataRules, onSaveMetadataRules
  , emulatorProfiles, onSaveEmulatorProfiles
}: {
  games: Game[];
  ghostGames: Record<string, boolean>;
  onToggleGhost: (path: string) => void;
  onToggleAllGhost: (enabled: boolean) => void;
  f95LoggedIn: boolean; dlsiteLoggedIn: boolean; fakkuLoggedIn: boolean; libraryFolders: { path: string }[]; syncState: string;
  platform: string; launchConfig: { enabled: boolean; runner: string };
  appUpdate: { version: string } | null; appSettings: AppSettingsLike;
  defaultSettings: AppSettingsLike;
  onF95Login: () => void; onF95Logout: () => void;
  onDLsiteLogin: () => void; onDLsiteLogout: () => void;
  onFakkuLogin: () => void; onFakkuLogout: () => void;
  onRemoveFolder: (p: string) => void;
  onRescanAll: () => void; onWineSettings: () => void; onSteamImport: () => void; onSteamLibraryImport: () => void; onEpicImport: () => void; onLutrisImport: () => void; onPlayniteImport: () => void; onGogImport: () => void; onProtocolStoreImport: () => void; onExoticImport: () => void; onItchImport: () => void;
  onAppUpdate: () => void; onOpenWhatsNew: () => void; onSaveSettings: (s: AppSettingsLike) => void; onOpenMigrationWizard: () => void; onClose: () => void;
  viewMode: LayoutViewMode;
  sidebarWidth: number;
  layoutPresets: LayoutPresetDescriptor[];
  activeLayoutPresetId: string | null;
  onViewModeChange: (mode: LayoutViewMode) => void;
  onSidebarWidthChange: (width: number) => void;
  onApplyLayoutPreset: (config: LayoutPresetConfig) => void;
  onSaveLayoutPreset: (name: string) => void;
  onUpdateLayoutPreset: (presetId: string) => void;
  onDeleteLayoutPreset: (presetId: string) => void;
  onRunIntegrityCheck: () => void;
  onOpenRestoreSnapshots: () => void;
  onExportCSV: () => void; onExportHTML: () => void; onExportCloudState: () => void; onImportCloudState: () => void;
  onBatchMetadataRefresh: () => void;
  batchRefreshStatus: string | null;
  integrityCheckStatus: string | null;
  backgroundJobs: BackgroundJobSummary[];
  syncStatusText: string;
  isIntegrityCheckBusy: boolean;
  isBatchMetadataRefreshBusy: boolean;
  onAutoHealPaths: () => void;
  autoHealPathsStatus: string | null;
  isAutoHealPathsBusy: boolean;
  onApplyBackupRetentionPolicy: () => void;
  backupRetentionStatus: string | null;
  isBackupRetentionBusy: boolean;
  onRunDbVacuum: () => void;
  dbVacuumStatus: string | null;
  isDbVacuumBusy: boolean;
  onRunCloudBackupNow: () => void;
  cloudBackupNowStatus: string | null;
  isCloudBackupNowBusy: boolean;
  discordSnapshot: DiscordSdkSnapshotLike | null;
  onOpenDiscordSettings: () => void;
  libraryProfiles: LibraryProfileLike[];
  activeLibraryProfileId: string;
  onSwitchLibraryProfile: (profileId: string) => void;
  onSaveLibraryProfile: (profile: LibraryProfileDraftLike) => Promise<void> | void;
  onDeleteLibraryProfile: (profileId: string) => Promise<void> | void;
  metadataRules: MetadataPostProcessingConfig;
  onSaveMetadataRules: (cfg: MetadataPostProcessingConfig) => void;
  emulatorProfiles: EmulatorProfile[];
  onSaveEmulatorProfiles: (profiles: EmulatorProfile[]) => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"general" | "scanner" | "import" | "rss" | "ghost" | "sync" | "sources" | "customcss" | "consistency" | "vault" | "wine" | "metarules" | "emulators">("general");
  const [customLangs, setCustomLangs] = useState<Record<string, { name: string; translation: Record<string, unknown> }>>({});
  const [langImporting, setLangImporting] = useState(false);

  // Sync state
  const [syncProviderType, setSyncProviderType] = useState<"webdav" | "nextcloud" | "s3" | "git" | "google-drive" | "dropbox">("webdav");
  const [syncConfig, setSyncConfig] = useState<SyncProviderConfig | null>(null);
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [syncConflictReport, setSyncConflictReport] = useState<SyncConflictPreviewReport | null>(null);
  const [remoteExists, setRemoteExists] = useState<boolean | null>(null);
  const [webdavUrl, setWebdavUrl] = useState("");
  const [webdavUsername, setWebdavUsername] = useState("");
  const [webdavPassword, setWebdavPassword] = useState("");
  const [webdavPath, setWebdavPath] = useState("libmaly-state.json");
  const [s3Bucket, setS3Bucket] = useState("");
  const [s3Region, setS3Region] = useState("");
  const [s3AccessKey, setS3AccessKey] = useState("");
  const [s3SecretKey, setS3SecretKey] = useState("");
  const [s3Endpoint, setS3Endpoint] = useState("");
  const [s3Path, setS3Path] = useState("libmaly-state.json");
  const [gitUrl, setGitUrl] = useState("");
  const [gitBranch, setGitBranch] = useState("main");
  const [gitUsername, setGitUsername] = useState("");
  const [gitPassword, setGitPassword] = useState("");
  const [googleDriveAccessToken, setGoogleDriveAccessToken] = useState("");
  const [googleDriveFileName, setGoogleDriveFileName] = useState("libmaly-state.json");
  const [googleDriveClientId, setGoogleDriveClientId] = useState("");
  const [googleDriveRefreshToken, setGoogleDriveRefreshToken] = useState("");
  const [googleDriveAuthMode, setGoogleDriveAuthMode] = useState<"oauth" | "manual">("oauth");
  const [dropboxAccessToken, setDropboxAccessToken] = useState("");
  const [dropboxPath, setDropboxPath] = useState("/Apps/Libmaly/libmaly-state.json");
  const [dropboxClientId, setDropboxClientId] = useState("");
  const [dropboxRefreshToken, setDropboxRefreshToken] = useState("");
  const [dropboxAuthMode, setDropboxAuthMode] = useState<"oauth" | "manual">("oauth");

  // Custom CSS state
  const [customCss, setCustomCss] = useState("");
  const [cssSaving, setCssSaving] = useState(false);
  const [customMetadataTemplates, setCustomMetadataTemplates] = useState<CustomMetadataTemplateSummary[]>([]);
  const [customMetadataJson, setCustomMetadataJson] = useState("");
  const [customMetadataBusy, setCustomMetadataBusy] = useState(false);
  const [customMetadataStatus, setCustomMetadataStatus] = useState<string | null>(null);
  const [explorerQuickLaunchStatus, setExplorerQuickLaunchStatus] = useState<ExplorerQuickLaunchStatus | null>(null);
  const [explorerQuickLaunchBusy, setExplorerQuickLaunchBusy] = useState(false);
  const [explorerQuickLaunchMessage, setExplorerQuickLaunchMessage] = useState<string | null>(null);
  const [explorerZipInstallStatus, setExplorerZipInstallStatus] = useState<ExplorerZipInstallStatus | null>(null);
  const [explorerZipInstallBusy, setExplorerZipInstallBusy] = useState(false);
  const [explorerZipInstallMessage, setExplorerZipInstallMessage] = useState<string | null>(null);

  // API Keys state
  const [igdbClientId, setIgdbClientId] = useState("");
  const [igdbClientSecret, setIgdbClientSecret] = useState("");

  useEffect(() => {
    if (platform !== "windows") return;
    invoke<ExplorerQuickLaunchStatus>("get_explorer_quick_launch_status")
      .then(setExplorerQuickLaunchStatus)
      .catch(() => {
        setExplorerQuickLaunchStatus(null);
      });
    invoke<ExplorerZipInstallStatus>("get_explorer_zip_install_status")
      .then(setExplorerZipInstallStatus)
      .catch(() => {
        setExplorerZipInstallStatus(null);
      });
  }, [platform]);

  const refreshExplorerQuickLaunchStatus = async () => {
    if (platform !== "windows") return;
    const status = await invoke<ExplorerQuickLaunchStatus>("get_explorer_quick_launch_status");
    setExplorerQuickLaunchStatus(status);
  };

  const handleRegisterExplorerQuickLaunch = async () => {
    setExplorerQuickLaunchBusy(true);
    setExplorerQuickLaunchMessage(null);
    try {
      const status = await invoke<ExplorerQuickLaunchStatus>("register_explorer_quick_launch");
      setExplorerQuickLaunchStatus(status);
      setExplorerQuickLaunchMessage("Explorer quick-launch registered for .exe files.");
    } catch (error) {
      setExplorerQuickLaunchMessage(`Could not register Explorer quick-launch: ${String(error)}`);
      await refreshExplorerQuickLaunchStatus().catch(() => {});
    } finally {
      setExplorerQuickLaunchBusy(false);
    }
  };

  const handleUnregisterExplorerQuickLaunch = async () => {
    setExplorerQuickLaunchBusy(true);
    setExplorerQuickLaunchMessage(null);
    try {
      const status = await invoke<ExplorerQuickLaunchStatus>("unregister_explorer_quick_launch");
      setExplorerQuickLaunchStatus(status);
      setExplorerQuickLaunchMessage("Explorer quick-launch removed from .exe files.");
    } catch (error) {
      setExplorerQuickLaunchMessage(`Could not remove Explorer quick-launch: ${String(error)}`);
      await refreshExplorerQuickLaunchStatus().catch(() => {});
    } finally {
      setExplorerQuickLaunchBusy(false);
    }
  };

  const refreshExplorerZipInstallStatus = async () => {
    if (platform !== "windows") return;
    const status = await invoke<ExplorerZipInstallStatus>("get_explorer_zip_install_status");
    setExplorerZipInstallStatus(status);
  };

  const handleRegisterExplorerZipInstall = async () => {
    setExplorerZipInstallBusy(true);
    setExplorerZipInstallMessage(null);
    try {
      const status = await invoke<ExplorerZipInstallStatus>("register_explorer_zip_install");
      setExplorerZipInstallStatus(status);
      setExplorerZipInstallMessage("Explorer ZIP install registered for .zip files.");
    } catch (error) {
      setExplorerZipInstallMessage(`Could not register Explorer ZIP install: ${String(error)}`);
      await refreshExplorerZipInstallStatus().catch(() => {});
    } finally {
      setExplorerZipInstallBusy(false);
    }
  };

  const handleUnregisterExplorerZipInstall = async () => {
    setExplorerZipInstallBusy(true);
    setExplorerZipInstallMessage(null);
    try {
      const status = await invoke<ExplorerZipInstallStatus>("unregister_explorer_zip_install");
      setExplorerZipInstallStatus(status);
      setExplorerZipInstallMessage("Explorer ZIP install removed from .zip files.");
    } catch (error) {
      setExplorerZipInstallMessage(`Could not remove Explorer ZIP install: ${String(error)}`);
      await refreshExplorerZipInstallStatus().catch(() => {});
    } finally {
      setExplorerZipInstallBusy(false);
    }
  };
  const [rawgApiKey, setRawgApiKey] = useState("");
  const [mobygamesApiKey, setMobygamesApiKey] = useState("");
  const [itchApiKey, setItchApiKey] = useState("");
  const [steamGridDbApiKey, setSteamGridDbApiKey] = useState("");
  const [apiKeySaving, setApiKeySaving] = useState(false);
  const [vaultSummary, setVaultSummary] = useState<VaultSummary | null>(null);
  const [layoutPresetName, setLayoutPresetName] = useState("");
  const [layoutPresetStatus, setLayoutPresetStatus] = useState<string | null>(null);
  const [themeMarketplaceItems, setThemeMarketplaceItems] = useState<ThemeMarketplaceEntry[]>([]);
  const [themeMarketplaceLoading, setThemeMarketplaceLoading] = useState(false);
  const [themeMarketplaceStatus, setThemeMarketplaceStatus] = useState<string | null>(null);
  const [themeMarketplaceFilter, setThemeMarketplaceFilter] = useState("");
  const filteredThemeMarketplaceItems = useMemo(() => {
    const q = themeMarketplaceFilter.trim().toLowerCase();
    if (!q) return themeMarketplaceItems;
    return themeMarketplaceItems.filter((item) => (
      item.name.toLowerCase().includes(q)
      || item.author?.toLowerCase().includes(q)
      || item.description?.toLowerCase().includes(q)
      || item.tags?.some((tag) => tag.toLowerCase().includes(q))
    ));
  }, [themeMarketplaceFilter, themeMarketplaceItems]);

  // Data consistency test state
  const [testResults, setTestResults] = useState<Record<string, ConsistencyTestResult>>({});
  const [testsRunning, setTestsRunning] = useState(false);

  const discordStatusSummary = !discordSnapshot
    ? t('settings.system.discord_not_initialized')
    : (!discordSnapshot.connected && discordSnapshot.richPresenceActive)
      ? t('settings.system.discord_status_with_linger', {
        status: t(`settings.system.discord_client_status.${discordSnapshot.clientStatus}`, { defaultValue: discordSnapshot.clientStatus }),
      })
      : t(`settings.system.discord_client_status.${discordSnapshot.clientStatus}`, { defaultValue: discordSnapshot.clientStatus });
  const showDiscordError = !!discordSnapshot?.lastError && !discordSnapshot?.connected && !discordSnapshot?.ready;
  const makeEmptyProfileDraft = (): LibraryProfileDraftLike => ({
    displayName: "",
    handle: "",
    tagline: "",
    avatarUrl: "",
    bannerUrl: "",
    accentColor: appSettings.accentColor || "#66c0f4",
  });
  const profileById = useMemo(
    () => Object.fromEntries(libraryProfiles.map((profile) => [profile.id, profile])),
    [libraryProfiles]
  );
  const [selectedProfileId, setSelectedProfileId] = useState<string>(activeLibraryProfileId || "new");
  const [profileDraft, setProfileDraft] = useState<LibraryProfileDraftLike>(makeEmptyProfileDraft());
  const selectedProfile = selectedProfileId && selectedProfileId !== "new" ? profileById[selectedProfileId] : null;

  // Load custom languages on mount
  useMemo(() => {
    const loaded = loadCustomLanguages();
    setCustomLangs(loaded);
    // Register each custom language with i18n
    for (const [code, { name, translation }] of Object.entries(loaded)) {
      addCustomLanguage(code, name, translation);
    }
  }, []);

  useEffect(() => {
    setSelectedProfileId(activeLibraryProfileId || "new");
  }, [activeLibraryProfileId]);

  useEffect(() => {
    if (selectedProfile) {
      setProfileDraft({
        id: selectedProfile.id,
        displayName: selectedProfile.displayName,
        handle: selectedProfile.handle || "",
        tagline: selectedProfile.tagline || "",
        avatarUrl: selectedProfile.avatarUrl || "",
        bannerUrl: selectedProfile.bannerUrl || "",
        accentColor: selectedProfile.accentColor || appSettings.accentColor || "#66c0f4",
      });
      return;
    }
    setProfileDraft(makeEmptyProfileDraft());
  }, [selectedProfileId, selectedProfile, appSettings.accentColor]);

  useEffect(() => {
    if (tab !== "general") return;
    if (themeMarketplaceItems.length > 0 || themeMarketplaceLoading) return;
    void loadThemeMarketplace();
  }, [tab]);

  const handleImportLanguage = async () => {
    const path = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "JSON", extensions: ["json"] }],
    }).catch(() => null);
    if (!path || typeof path !== "string") return;

    setLangImporting(true);
    try {
      const raw = await invoke<string>("read_string_from_file", { path });
      const data = JSON.parse(raw);

      // Validate structure
      if (!data.code || !data.name || !data.translation || typeof data.translation !== "object") {
        alert("Invalid language file. Expected format: { \"code\": \"pt\", \"name\": \"Português\", \"translation\": { ... } }");
        return;
      }

      const { code, name, translation } = data;
      addCustomLanguage(code, name, translation);
      setCustomLangs(prev => ({ ...prev, [code]: { name, translation } }));
      onSaveSettings({ ...appSettings, language: code });
      alert(`Language "${name}" (${code}) imported and activated!`);
    } catch (e: any) {
      alert("Failed to import language: " + String(e));
    } finally {
      setLangImporting(false);
    }
  };

  const loadThemeMarketplace = async (relayUrl?: string) => {
    const url = (relayUrl ?? appSettings.themeMarketplaceRelayUrl ?? defaultSettings.themeMarketplaceRelayUrl ?? "").trim();
    if (!url) {
      setThemeMarketplaceStatus("Set a relay URL first.");
      return;
    }
    if (!isTrustedThemeRelayUrl(url)) {
      setThemeMarketplaceStatus("Relay URL is not trusted. Allowed hosts: raw.githubusercontent.com, gist.githubusercontent.com, cdn.jsdelivr.net, themes.libmaly.dev, localhost.");
      return;
    }

    setThemeMarketplaceLoading(true);
    setThemeMarketplaceStatus(null);
    try {
      const response = await fetch(url, { method: "GET" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const json = await response.json();
      const entries = parseThemeMarketplaceCatalog(json);
      setThemeMarketplaceItems(entries);
      setThemeMarketplaceStatus(entries.length > 0
        ? `Loaded ${entries.length} theme${entries.length === 1 ? "" : "s"}.`
        : "Relay is reachable, but no themes were found in the catalog.");
    } catch (error) {
      setThemeMarketplaceItems([]);
      setThemeMarketplaceStatus(`Could not load theme marketplace: ${String(error)}`);
    } finally {
      setThemeMarketplaceLoading(false);
    }
  };

  const installMarketplaceTheme = (entry: ThemeMarketplaceEntry) => {
    const nextCustomColors = {
      ...(appSettings.customThemeColors || {}),
      ...(entry.customThemeColors || {}),
    };
    const nextAccent = normalizeHexColor(entry.accentColor || appSettings.accentColor || defaultSettings.accentColor, defaultSettings.accentColor);
    onSaveSettings({
      ...appSettings,
      themeMode: "custom",
      accentColor: nextAccent,
      customThemeColors: nextCustomColors,
      themeBackgroundImageUrl: entry.backgroundImageUrl ?? appSettings.themeBackgroundImageUrl ?? "",
      themeBackgroundImageOverlay: entry.backgroundOverlay ?? appSettings.themeBackgroundImageOverlay ?? defaultSettings.themeBackgroundImageOverlay,
      themeBackgroundImageOpacity: entry.backgroundOpacity ?? appSettings.themeBackgroundImageOpacity ?? defaultSettings.themeBackgroundImageOpacity,
      themeBackgroundImageBlurPx: entry.backgroundBlurPx ?? appSettings.themeBackgroundImageBlurPx ?? defaultSettings.themeBackgroundImageBlurPx,
    });
    setThemeMarketplaceStatus(`Installed '${entry.name}'.`);
  };

  const handleRemoveCustomLanguage = (code: string) => {
    if (!confirm(`Remove custom language "${customLangs[code]?.name || code}"?`)) return;
    removeCustomLanguage(code);
    setCustomLangs(prev => {
      const next = { ...prev };
      delete next[code];
      return next;
    });
    if (appSettings.language === code) {
      onSaveSettings({ ...appSettings, language: "en" });
    }
  };

  // Sync functions
  const loadSyncConfig = async () => {
    setSyncLoading(true);
    try {
      const savedConfig = await syncGetConfig();
      if (savedConfig) {
        setSyncConfig(savedConfig);
        setSyncProviderType(savedConfig.provider);
        
        if (savedConfig.provider === "webdav") {
          const cfg = savedConfig.config as WebdavConfig;
          setWebdavUrl(cfg.url);
          setWebdavUsername(cfg.username);
          setWebdavPassword(cfg.password);
          setWebdavPath(cfg.path);
        } else if (savedConfig.provider === "nextcloud") {
          const cfg = savedConfig.config as NextcloudConfig;
          setWebdavUrl(cfg.url);
          setWebdavUsername(cfg.username);
          setWebdavPassword(cfg.password);
          setWebdavPath(cfg.path);
        } else if (savedConfig.provider === "s3") {
          const cfg = savedConfig.config as S3Config;
          setS3Bucket(cfg.bucket);
          setS3Region(cfg.region);
          setS3AccessKey(cfg.accessKey);
          setS3SecretKey(cfg.secretKey);
          setS3Endpoint(cfg.endpoint || "");
          setS3Path(cfg.path);
        } else if (savedConfig.provider === "git") {
          const cfg = savedConfig.config as GitConfig;
          setGitUrl(cfg.url);
          setGitBranch(cfg.branch);
          setGitUsername(cfg.username || "");
          setGitPassword(cfg.password || "");
        } else if (savedConfig.provider === "google-drive") {
          const cfg = savedConfig.config as GoogleDriveConfig;
          setGoogleDriveAccessToken(cfg.accessToken);
          setGoogleDriveFileName(cfg.fileName);
          setGoogleDriveClientId(cfg.clientId || "");
          setGoogleDriveRefreshToken(cfg.refreshToken || "");
          setGoogleDriveAuthMode(cfg.clientId || cfg.refreshToken ? "oauth" : "manual");
        } else if (savedConfig.provider === "dropbox") {
          const cfg = savedConfig.config as DropboxConfig;
          setDropboxAccessToken(cfg.accessToken);
          setDropboxPath(cfg.path);
          setDropboxClientId(cfg.clientId || "");
          setDropboxRefreshToken(cfg.refreshToken || "");
          setDropboxAuthMode(cfg.clientId || cfg.refreshToken ? "oauth" : "manual");
        }
      } else {
        setSyncConfig(null);
        setWebdavUrl("");
        setWebdavUsername("");
        setWebdavPassword("");
        setWebdavPath("libmaly-state.json");
        setS3Bucket("");
        setS3Region("");
        setS3AccessKey("");
        setS3SecretKey("");
        setS3Endpoint("");
        setS3Path("libmaly-state.json");
        setGitUrl("");
        setGitBranch("main");
        setGitUsername("");
        setGitPassword("");
        setGoogleDriveAccessToken("");
        setGoogleDriveFileName("libmaly-state.json");
        setGoogleDriveClientId("");
        setGoogleDriveRefreshToken("");
        setDropboxAccessToken("");
        setDropboxPath("/Apps/Libmaly/libmaly-state.json");
        setDropboxClientId("");
        setDropboxRefreshToken("");
      }
    } catch (error) {
      console.error("Failed to load sync config:", error);
    } finally {
      setSyncLoading(false);
    }
  };

  const loadVaultSummary = async () => {
    try {
      const summary = await invoke<VaultSummary>("vault_list_entries");
      setVaultSummary(summary);
    } catch (error) {
      console.error("Failed to load vault summary:", error);
    }
  };

  const loadCustomMetadataTemplates = async () => {
    try {
      const templates = await invoke<CustomMetadataTemplateSummary[]>("custom_metadata_list_templates");
      setCustomMetadataTemplates(templates);
    } catch (error) {
      console.error("Failed to load custom metadata templates:", error);
      setCustomMetadataStatus(`Failed to load templates: ${String(error)}`);
    }
  };

  useEffect(() => {
    loadSyncConfig();
    void loadVaultSummary();
    void loadCustomMetadataTemplates();
  }, [activeLibraryProfileId]);

  useEffect(() => {
    const reload = () => { void loadSyncConfig(); void loadVaultSummary(); void loadCustomMetadataTemplates(); };
    window.addEventListener("libmaly-sync-config-updated", reload);
    return () => window.removeEventListener("libmaly-sync-config-updated", reload);
  }, []);

  // Load custom CSS from localStorage and apply it
  useEffect(() => {
    const savedCss = localStorage.getItem("libmaly_custom_css") || "";
    setCustomCss(savedCss);
    applyCustomCss(savedCss);
  }, []);

  // Load API keys from backend
  useEffect(() => {
    const loadApiKeys = async () => {
      try {
        setIgdbClientId("");
        setIgdbClientSecret("");
        setRawgApiKey("");
        setMobygamesApiKey("");
        setItchApiKey("");
        setSteamGridDbApiKey("");
        const [igdbId, igdbSecret, rawgKey, mobyKey, itchKey, steamGridDbKey] = await Promise.all([
          invoke<string>("get_api_key", { provider: "igdb_client_id" }),
          invoke<string>("get_api_key", { provider: "igdb_client_secret" }),
          invoke<string>("get_api_key", { provider: "rawg" }),
          invoke<string>("get_api_key", { provider: "mobygames" }),
          invoke<string>("get_api_key", { provider: "itch_io" }),
          invoke<string>("get_api_key", { provider: "steamgriddb" }),
        ]);
        if (igdbId) setIgdbClientId(igdbId);
        if (igdbSecret) setIgdbClientSecret(igdbSecret);
        if (rawgKey) setRawgApiKey(rawgKey);
        if (mobyKey) setMobygamesApiKey(mobyKey);
        if (itchKey) setItchApiKey(itchKey);
        if (steamGridDbKey) setSteamGridDbApiKey(steamGridDbKey);
      } catch (e) {
        console.error("Failed to load API keys:", e);
      }
    };
    loadApiKeys();
  }, [activeLibraryProfileId]);

  const applyCustomCss = (css: string) => {
    let styleTag = document.getElementById("libmaly-custom-css") as HTMLStyleElement;
    if (!styleTag) {
      styleTag = document.createElement("style");
      styleTag.id = "libmaly-custom-css";
      document.head.appendChild(styleTag);
    }
    styleTag.textContent = css;
  };

  const handleSaveCustomCss = () => {
    setCssSaving(true);
    try {
      localStorage.setItem("libmaly_custom_css", customCss);
      applyCustomCss(customCss);
      setTimeout(() => setCssSaving(false), 500);
    } catch (error) {
      console.error("Failed to save custom CSS:", error);
      setCssSaving(false);
    }
  };

  const handleResetCustomCss = () => {
    if (!confirm("Reset custom CSS to default?")) return;
    setCustomCss("");
    localStorage.removeItem("libmaly_custom_css");
    applyCustomCss("");
  };

  const handleImportCustomMetadataJson = async () => {
    if (!customMetadataJson.trim()) {
      setCustomMetadataStatus("Paste a template JSON document first.");
      return;
    }
    setCustomMetadataBusy(true);
    setCustomMetadataStatus(null);
    try {
      const templates = await invoke<CustomMetadataTemplateSummary[]>("custom_metadata_import_templates", { jsonText: customMetadataJson });
      setCustomMetadataTemplates(templates);
      setCustomMetadataStatus(`Imported ${templates.length} custom metadata template(s).`);
    } catch (error) {
      setCustomMetadataStatus(`Import failed: ${String(error)}`);
    } finally {
      setCustomMetadataBusy(false);
    }
  };

  const handleImportCustomMetadataFile = async () => {
    const picked = await open({
      multiple: false,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!picked || Array.isArray(picked)) return;
    setCustomMetadataBusy(true);
    setCustomMetadataStatus(null);
    try {
      const templates = await invoke<CustomMetadataTemplateSummary[]>("custom_metadata_import_templates_from_path", { path: picked });
      setCustomMetadataTemplates(templates);
      setCustomMetadataStatus(`Imported templates from ${picked}.`);
    } catch (error) {
      setCustomMetadataStatus(`File import failed: ${String(error)}`);
    } finally {
      setCustomMetadataBusy(false);
    }
  };

  const handleExportCustomMetadata = async () => {
    const target = await save({
      defaultPath: "libmaly-custom-metadata.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!target) return;
    setCustomMetadataBusy(true);
    setCustomMetadataStatus(null);
    try {
      await invoke("custom_metadata_export_templates_to_path", { path: target });
      setCustomMetadataStatus(`Exported templates to ${target}.`);
    } catch (error) {
      setCustomMetadataStatus(`Export failed: ${String(error)}`);
    } finally {
      setCustomMetadataBusy(false);
    }
  };

  const handleLoadInstalledCustomMetadataJson = async () => {
    setCustomMetadataBusy(true);
    setCustomMetadataStatus(null);
    try {
      const raw = await invoke<string>("custom_metadata_export_templates");
      setCustomMetadataJson(raw);
      setCustomMetadataStatus("Loaded installed templates into the editor.");
    } catch (error) {
      setCustomMetadataStatus(`Could not load installed templates: ${String(error)}`);
    } finally {
      setCustomMetadataBusy(false);
    }
  };

  const handleDeleteCustomMetadataTemplate = async (id: string) => {
    setCustomMetadataBusy(true);
    setCustomMetadataStatus(null);
    try {
      const templates = await invoke<CustomMetadataTemplateSummary[]>("custom_metadata_delete_template", { id });
      setCustomMetadataTemplates(templates);
      setCustomMetadataStatus(`Removed template '${id}'.`);
    } catch (error) {
      setCustomMetadataStatus(`Delete failed: ${String(error)}`);
    } finally {
      setCustomMetadataBusy(false);
    }
  };

  // Data consistency test functions
  const runConsistencyTests = async () => {
    const loadConsistencyStorageEntries = async () => {
      const profileId = (activeLibraryProfileId || "default").trim() || "default";
      const profilePrefix = `libmaly_profile::${profileId}::`;
      const entries: Record<string, string> = {};

      if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
        try {
          const bootstrap = await invoke<StorageBootstrap>("get_storage_bootstrap");
          if (bootstrap?.unified) {
            for (const [key, value] of Object.entries(bootstrap.entries || {})) {
              if (key.startsWith(profilePrefix)) {
                entries[key.slice(profilePrefix.length)] = value;
              } else if (GLOBAL_STORAGE_KEYS.has(key)) {
                entries[key] = value;
              } else if (profileId === "default" && !key.startsWith("libmaly_profile::")) {
                entries[key] = value;
              }
            }
            return entries;
          }
        } catch {
          // Fall back to localStorage below when unified bootstrap is unavailable.
        }
      }

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        const value = localStorage.getItem(key);
        if (value === null) continue;
        if (key.startsWith(profilePrefix)) {
          entries[key.slice(profilePrefix.length)] = value;
        } else if (GLOBAL_STORAGE_KEYS.has(key)) {
          entries[key] = value;
        } else if (profileId === "default" && !key.startsWith("libmaly_profile::")) {
          entries[key] = value;
        }
      }

      return entries;
    };

    setTestsRunning(true);
    const results: Record<string, ConsistencyTestResult> = {};
    const storageEntries = await loadConsistencyStorageEntries();

    // Test 1: Games list consistency
    try {
      const gamesList = JSON.parse(storageEntries[SK_GAMES] || "[]");
      const details: string[] = [];
      let passed = true;

      if (!Array.isArray(gamesList)) {
        passed = false;
        details.push("Games list is not an array");
      } else {
        details.push(`Found ${gamesList.length} games`);
        const duplicatePaths = gamesList.filter((g: any, i: number, arr: any[]) => 
          arr.findIndex((x: any) => x.path === g.path) !== i
        );
        if (duplicatePaths.length > 0) {
          passed = false;
          details.push(`Found ${duplicatePaths.length} duplicate game paths`);
        }
        const invalidGames = gamesList.filter((g: any) => !g.path || !g.name);
        if (invalidGames.length > 0) {
          passed = false;
          details.push(`Found ${invalidGames.length} games missing required fields`);
        }
      }
      results["games_list"] = { passed, message: passed ? "Games list is valid" : "Games list has issues", details };
    } catch (e) {
      results["games_list"] = { passed: false, message: "Failed to parse games list", details: [String(e)] };
    }

    // Test 2: Metadata consistency
    try {
      const metadata = JSON.parse(storageEntries[SK_META] || "{}");
      const details: string[] = [];
      let passed = true;

      if (typeof metadata !== "object" || metadata === null) {
        passed = false;
        details.push("Metadata is not an object");
      } else {
        details.push(`Found metadata for ${Object.keys(metadata).length} games`);
        const gamesList = JSON.parse(storageEntries[SK_GAMES] || "[]");
        const metadataKeys = Object.keys(metadata);
        const gamePaths = new Set(gamesList.map((g: any) => normalizePathForMatch(g.path)));
        const orphanedMetadata = metadataKeys.filter((key) => !gamePaths.has(normalizePathForMatch(key)));
        if (orphanedMetadata.length > 0) {
          passed = false;
          details.push(`Found ${orphanedMetadata.length} orphaned metadata entries`);
        }
      }
      results["metadata"] = { passed, message: passed ? "Metadata is consistent" : "Metadata has issues", details };
    } catch (e) {
      results["metadata"] = { passed: false, message: "Failed to parse metadata", details: [String(e)] };
    }

    // Test 3: Notes consistency
    try {
      const notes = JSON.parse(storageEntries[SK_NOTES] || "{}");
      const details: string[] = [];
      let passed = true;

      if (typeof notes !== "object" || notes === null) {
        passed = false;
        details.push("Notes is not an object");
      } else {
        details.push(`Found notes for ${Object.keys(notes).length} games`);
        const gamesList = JSON.parse(storageEntries[SK_GAMES] || "[]");
        const noteKeys = Object.keys(notes);
        const gamePaths = new Set(gamesList.map((g: any) => normalizePathForMatch(g.path)));
        const orphanedNotes = noteKeys.filter((key) => !gamePaths.has(normalizePathForMatch(key)));
        if (orphanedNotes.length > 0) {
          passed = false;
          details.push(`Found ${orphanedNotes.length} orphaned note entries`);
        }
      }
      results["notes"] = { passed, message: passed ? "Notes are consistent" : "Notes have issues", details };
    } catch (e) {
      results["notes"] = { passed: false, message: "Failed to parse notes", details: [String(e)] };
    }

    // Test 4: Collections consistency
    try {
      const collections = JSON.parse(storageEntries[SK_COLLECTIONS] || "[]");
      const details: string[] = [];
      let passed = true;

      if (!Array.isArray(collections)) {
        passed = false;
        details.push("Collections is not an array");
      } else {
        details.push(`Found ${collections.length} collections`);
        const gamesList = JSON.parse(storageEntries[SK_GAMES] || "[]");
        const gamePaths = new Set(gamesList.map((g: any) => normalizePathForMatch(g.path)));
        collections.forEach((col: any) => {
          if (!col.games || !Array.isArray(col.games)) {
            passed = false;
            details.push(`Collection "${col.name}" has invalid games array`);
          } else {
            const invalidGames = col.games.filter((path: string) => !gamePaths.has(normalizePathForMatch(path)));
            if (invalidGames.length > 0) {
              passed = false;
              details.push(`Collection "${col.name}" has ${invalidGames.length} invalid game paths`);
            }
          }
        });
      }
      results["collections"] = { passed, message: passed ? "Collections are consistent" : "Collections have issues", details };
    } catch (e) {
      results["collections"] = { passed: false, message: "Failed to parse collections", details: [String(e)] };
    }

    // Test 5: Storage keys consistency
    try {
      const details: string[] = [];
      let passed = true;
      const requiredKeys = [SK_GAMES, SK_META, SK_NOTES];
      const optionalKeys = [SK_COLLECTIONS];
      const foundKeys = Object.keys(storageEntries).sort();
      details.push(`Found ${foundKeys.length} storage entries in the active profile snapshot`);
      const missingRequiredKeys = requiredKeys.filter((key) => !(key in storageEntries));
      if (missingRequiredKeys.length > 0) {
        passed = false;
        details.push(`Missing required keys: ${missingRequiredKeys.join(", ")}`);
      }
      const missingOptionalKeys = optionalKeys.filter((key) => !(key in storageEntries));
      if (missingOptionalKeys.length > 0) {
        details.push(`Optional keys not present: ${missingOptionalKeys.join(", ")} (this is normal if you don't use this feature)`);
      }
      results["storage_keys"] = { passed, message: passed ? "Storage keys are present" : "Missing required keys", details };
    } catch (e) {
      results["storage_keys"] = { passed: false, message: "Failed to check storage keys", details: [String(e)] };
    }

    // Test 6: JSON validity for all libmaly keys
    try {
      const details: string[] = [];
      let passed = true;
      let invalidCount = 0;
      let checkedCount = 0;
      for (const [key, value] of Object.entries(storageEntries)) {
        if (!value) continue;
        checkedCount++;
        try {
          JSON.parse(value);
        } catch {
          if (value === value.trim() && !value.startsWith("{") && !value.startsWith("[")) {
            continue;
          }
          passed = false;
          invalidCount++;
          details.push(`Invalid JSON in key: ${key}`);
        }
      }
      if (invalidCount === 0) {
        details.push(`Checked ${checkedCount} storage entries - all contain valid data`);
      }
      results["json_validity"] = { passed, message: passed ? "All data is valid" : `Found ${invalidCount} invalid entries`, details };
    } catch (e) {
      results["json_validity"] = { passed: false, message: "Failed to check JSON validity", details: [String(e)] };
    }

    // Test 7-11: Release reliability scenarios
    try {
      const report = await invoke<ReliabilityScenarioReport>("run_release_reliability_checks");
      for (const scenario of report.scenarios) {
        const details = [...(scenario.details || [])];
        if (scenario.key === "cross_platform_backup_restore") {
          details.push(`Validated on current runtime platform: ${report.platform}`);
        }
        results[scenario.key] = {
          passed: scenario.passed,
          message: scenario.message,
          details,
        };
      }
    } catch (e) {
      results["release_reliability"] = {
        passed: false,
        message: "Failed to run release reliability scenarios",
        details: [String(e)],
      };
    }

    setTestResults(results);
    setTestsRunning(false);
  };

  const handleSyncSave = async () => {
    setSyncLoading(true);
    try {
      let newConfig: SyncProviderConfig;

      if (syncProviderType === "webdav") {
        newConfig = createWebdavConfig({
          url: webdavUrl,
          username: webdavUsername,
          password: webdavPassword,
          path: webdavPath,
        });
      } else if (syncProviderType === "nextcloud") {
        newConfig = createNextcloudConfig({
          url: webdavUrl,
          username: webdavUsername,
          password: webdavPassword,
          path: webdavPath,
        });
      } else if (syncProviderType === "s3") {
        newConfig = createS3Config({
          bucket: s3Bucket,
          region: s3Region,
          accessKey: s3AccessKey,
          secretKey: s3SecretKey,
          endpoint: s3Endpoint || undefined,
          path: s3Path,
        });
      } else if (syncProviderType === "google-drive") {
        newConfig = createGoogleDriveConfig({
          accessToken: googleDriveAccessToken,
          fileName: googleDriveFileName,
          clientId: googleDriveAuthMode === "oauth" ? googleDriveClientId || undefined : undefined,
          refreshToken: googleDriveAuthMode === "oauth" ? googleDriveRefreshToken || undefined : undefined,
        });
      } else if (syncProviderType === "dropbox") {
        newConfig = createDropboxConfig({
          accessToken: dropboxAccessToken,
          path: dropboxPath,
          clientId: dropboxAuthMode === "oauth" ? dropboxClientId || undefined : undefined,
          refreshToken: dropboxAuthMode === "oauth" ? dropboxRefreshToken || undefined : undefined,
        });
      } else {
        newConfig = createGitConfig({
          url: gitUrl,
          branch: gitBranch,
          username: gitUsername || undefined,
          password: gitPassword || undefined,
        });
      }

      await syncConfigure(newConfig);
      setSyncConfig(newConfig);
      setSyncConflictReport(null);
      setSyncResult({ success: true, message: "Configuration saved", conflictsDetected: false, entriesSynced: 0 });
      await loadVaultSummary();
    } catch (error) {
      setSyncResult({ success: false, message: String(error), conflictsDetected: false, entriesSynced: 0 });
    } finally {
      setSyncLoading(false);
    }
  };

  const handleSyncUpload = async () => {
    if (!syncConfig) return;
    setSyncLoading(true);
    try {
      const result = await syncUpload();
      setSyncResult(result);
      if (result.conflictsDetected) {
        const report = await syncPreviewConflicts();
        setSyncConflictReport(report);
      } else {
        setSyncConflictReport(null);
      }
    } catch (error) {
      setSyncResult({ success: false, message: String(error), conflictsDetected: false, entriesSynced: 0 });
    } finally {
      setSyncLoading(false);
    }
  };

  const handleSyncDownload = async () => {
    if (!syncConfig) return;
    setSyncLoading(true);
    try {
      const result = await syncDownload();
      setSyncResult(result);
      if (result.conflictsDetected) {
        const report = await syncPreviewConflicts();
        setSyncConflictReport(report);
      } else {
        setSyncConflictReport(null);
      }
    } catch (error) {
      setSyncResult({ success: false, message: String(error), conflictsDetected: false, entriesSynced: 0 });
    } finally {
      setSyncLoading(false);
    }
  };

  const handleCheckRemote = async () => {
    if (!syncConfig) return;
    setSyncLoading(true);
    try {
      const exists = await syncCheckRemote();
      setRemoteExists(exists);
    } catch (error) {
      console.error("Failed to check remote:", error);
    } finally {
      setSyncLoading(false);
    }
  };
  const handleStartOAuth = async (provider: "google-drive" | "dropbox") => {
    const clientId = provider === "google-drive" ? googleDriveClientId.trim() : dropboxClientId.trim();
    if (!clientId) {
      setSyncResult({ success: false, message: "Enter a Client ID / App key before starting OAuth.", conflictsDetected: false, entriesSynced: 0 });
      return;
    }
    setSyncLoading(true);
    try {
      const result = await syncStartOAuth(provider, clientId);
      await openUrl(result.authorizationUrl);
      setSyncResult({ success: true, message: `Browser opened for ${getSyncProviderLabel(provider)} OAuth. Finish the login flow and LIBMALY will capture the callback automatically.`, conflictsDetected: false, entriesSynced: 0 });
    } catch (error) {
      setSyncResult({ success: false, message: String(error), conflictsDetected: false, entriesSynced: 0 });
    } finally {
      setSyncLoading(false);
    }
  };
  const tabs: { id: typeof tab; label: string }[] = [
    { id: "general", label: t('settings.tabs.general') },
    { id: "scanner", label: t('settings.tabs.scanner') },
    { id: "import", label: t('settings.tabs.import') },
    { id: "rss", label: t('settings.tabs.rss') },
    { id: "ghost", label: "👻 Ghost Mode" },
    { id: "sync", label: "🔄 Sync" },
    { id: "sources", label: "🕸 Sources" },
    { id: "customcss", label: "🎨 Custom CSS" },
    { id: "consistency", label: "🧪 Consistency Tests" },
    { id: "vault" as const, label: "🔐 Vault" },
    { id: "emulators" as const, label: t('settings.tabs.emulators') },
    { id: "metarules" as const, label: t('settings.tabs.metarules') },
    ...(platform !== "windows" ? [{ id: "wine" as const, label: t('settings.tabs.wine') }] : []),
  ];
  const jobTone = (status: BackgroundJobStatus) => {
    switch (status) {
      case "queued":
        return { fg: "var(--color-text-muted)", bg: "var(--color-panel-3)" };
      case "running":
        return { fg: "var(--color-accent)", bg: "rgba(55, 165, 216, 0.14)" };
      case "retrying":
        return { fg: "var(--color-warning)", bg: "var(--color-warning-bg)" };
      case "failed":
      case "permanent_failed":
        return { fg: "var(--color-danger-strong)", bg: "var(--color-danger-bg)" };
      default:
        return { fg: "var(--color-text-muted)", bg: "var(--color-panel-3)" };
    }
  };
  const jobStatusLabel = (status: BackgroundJobStatus) => {
    switch (status) {
      case "queued":
        return t('common.jobs.queued');
      case "running":
        return t('common.jobs.running');
      case "retrying":
        return t('common.jobs.retrying');
      case "failed":
        return t('common.jobs.failed');
      case "permanent_failed":
        return t('common.jobs.stopped');
      default:
        return status;
    }
  };
  const autoCloudBackupJob = backgroundJobs.find((job) => job.id === "auto-cloud-backup") ?? null;
  const autoCloudBackupStatus = autoCloudBackupJob
    ? (autoCloudBackupJob.detail?.trim() || jobStatusLabel(autoCloudBackupJob.status))
    : null;
  const syncGuide = useMemo(() => {
    switch (syncProviderType) {
      case "webdav":
        return {
          title: "WebDAV Quick Start",
          intro: "Use this if you already have a WebDAV-compatible storage endpoint from a NAS, hosting panel, or cloud provider.",
          steps: [
            "Copy the base WebDAV URL from your provider dashboard.",
            "Enter the login and password used for that WebDAV endpoint.",
            "Pick a remote file path such as libmaly-state.json.",
            "Save configuration, then use Check Remote or Upload to test it.",
          ],
          tips: [
            "Good fit for self-hosted storage and NAS setups.",
            "If your provider gives a folder URL, use the folder path plus a file name in the Path field.",
          ],
        };
      case "nextcloud":
        return {
          title: "Nextcloud Quick Start",
          intro: "Nextcloud uses the same WebDAV fields, but the URL usually points to your Nextcloud WebDAV endpoint.",
          steps: [
            "Open Nextcloud settings and find the WebDAV URL.",
            "Paste that URL here and enter your Nextcloud username and app password.",
            "Choose a file path such as Libmaly/libmaly-state.json.",
            "Save configuration and test with Upload or Download.",
          ],
          tips: [
            "An app password is safer than your main account password.",
            "If sync fails, double-check that the URL is the WebDAV endpoint, not the normal web UI page.",
          ],
        };
      case "google-drive":
        return googleDriveAuthMode === "oauth"
          ? {
            title: "Google Drive OAuth Guide",
            intro: "Best option if you want Libmaly to reconnect automatically later using a refresh token.",
            steps: [
              "Create a desktop OAuth client in Google Cloud Console.",
              "Paste the client ID into the OAuth Client ID field.",
              "Click Connect Google Drive and finish the browser login.",
              "After the callback returns to Libmaly, save the configuration if you changed the file name.",
            ],
            tips: [
              "The library state is stored in the hidden appData folder, not in your visible Drive root.",
              "OAuth is the better long-term option because the token can be refreshed automatically.",
            ],
          }
          : {
            title: "Google Drive Manual Token Guide",
            intro: "Use this if getting a ready-made access token is easier for you than setting up OAuth in the app.",
            steps: [
              "Generate or obtain a Google Drive access token with permission for app data access.",
              "Paste that token into the Access Token field.",
              "Choose the remote file name for the library state.",
              "Save configuration and immediately test with Upload, because manual tokens can expire quickly.",
            ],
            tips: [
              "Manual tokens are simpler once, but usually less convenient over time because they expire.",
              "If Upload suddenly stops working later, the first thing to check is whether the token expired.",
            ],
          };
      case "dropbox":
        return dropboxAuthMode === "oauth"
          ? {
            title: "Dropbox OAuth Guide",
            intro: "Best option if you want Libmaly to keep working without re-pasting tokens all the time.",
            steps: [
              "Create a scoped Dropbox app in the Dropbox developer console.",
              "Paste the app key into the Dropbox App Key field.",
              "Set a destination path such as /Apps/Libmaly/libmaly-state.json.",
              "Click Connect Dropbox and complete the browser login flow.",
            ],
            tips: [
              "Keep the path absolute and start it with /.",
              "OAuth is the recommended mode for scheduled auto-backups.",
            ],
          }
          : {
            title: "Dropbox Manual Token Guide",
            intro: "Use this mode if you already know how to mint a Dropbox access token and want the fastest setup.",
            steps: [
              "Generate or obtain a Dropbox access token for your app.",
              "Paste the token into the Access Token field.",
              "Set the destination file path, for example /Apps/Libmaly/libmaly-state.json.",
              "Save configuration and test with Upload right away.",
            ],
            tips: [
              "Like Google manual mode, this can stop working when the token expires.",
              "If you want less maintenance, switch back to OAuth mode later.",
            ],
          };
      case "git":
        return {
          title: "Git Sync Guide",
          intro: "Use this if you want the library state versioned in a Git repository.",
          steps: [
            "Create an empty repository or choose an existing private repo.",
            "Paste the clone URL and branch name.",
            "If the repo needs authentication, enter a username and token.",
            "Save configuration, then upload to push the current state.",
          ],
          tips: [
            "Private repositories are strongly recommended.",
            "Git is useful if you want history and manual rollback outside Libmaly.",
          ],
        };
      case "s3":
        return {
          title: "S3 Quick Start",
          intro: "Use this for AWS S3 or compatible object storage such as Cloudflare R2, MinIO, Wasabi, or Backblaze B2 S3.",
          steps: [
            "Enter the bucket name and region from your object storage provider.",
            "Paste the access key and secret key for a user that can read and write one object.",
            "If you are using a non-AWS provider, fill in the custom endpoint URL.",
            "Choose an object path such as libmaly-state.json or Libmaly/state.json, then save and test it.",
          ],
          tips: [
            "Leave Endpoint empty for normal AWS S3.",
            "For S3-compatible providers, Endpoint is often the only extra field you need.",
          ],
        };
      default:
        return null;
    }
  }, [dropboxAuthMode, googleDriveAuthMode, syncProviderType]);
  const formatTimestamp = (value?: number | null) => {
    if (!value) return "Never";
    try {
      return new Date(value).toLocaleString();
    } catch {
      return "Never";
    }
  };
  const selectedCustomLayoutPreset = useMemo(
    () => layoutPresets.find((preset) => preset.id === activeLayoutPresetId && !preset.readOnly) ?? null,
    [activeLayoutPresetId, layoutPresets],
  );
  const connectedStorefronts = [f95LoggedIn, dlsiteLoggedIn, fakkuLoggedIn].filter(Boolean).length;
  const activeSidebarSections = [
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
  ].filter((key) => ((appSettings as unknown as Record<string, unknown>)[key]) !== false).length;
  const tabDescriptions: Record<typeof tab, string> = {
    general: "Profile, appearance, accounts, and core app behavior.",
    scanner: "Library maintenance, rescans, recovery, and metadata refresh.",
    import: "Storefront and launcher import bridges.",
    rss: "Configure feed sources for updates and news.",
    ghost: "Keep selected games strictly local-only.",
    sync: "Cloud sync providers, OAuth, and backup scheduling.",
    sources: "Import and manage custom JSON metadata scrapers.",
    customcss: "Inject custom CSS overrides into the app.",
    consistency: "Run data-integrity checks against local state.",
    vault: "Secure secrets, sessions, and API credentials.",
    emulators: "Manage emulator profiles used to launch ROM targets.",
    metarules: "Customize source priority, per-field source overrides, and post-merge text cleanup rules.",
    wine: "Wine and Proton runtime configuration.",
  };

  const handleSaveLayoutPresetClick = () => {
    try {
      onSaveLayoutPreset(layoutPresetName);
      setLayoutPresetStatus(`Saved layout preset '${layoutPresetName.trim()}'.`);
      setLayoutPresetName("");
    } catch (error) {
      setLayoutPresetStatus(String(error));
    }
  };

  const handleUpdateLayoutPresetClick = (presetId: string, presetName: string) => {
    onUpdateLayoutPreset(presetId);
    setLayoutPresetStatus(`Updated layout preset '${presetName}'.`);
  };

  const handleDeleteLayoutPresetClick = (presetId: string, presetName: string) => {
    if (!confirm(`Delete layout preset '${presetName}'?`)) return;
    onDeleteLayoutPreset(presetId);
    setLayoutPresetStatus(`Deleted layout preset '${presetName}'.`);
  };
  return (
    <>
      <div className="fixed inset-0 z-9990 flex items-center justify-center"
        style={{ background: "rgba(0,0,0,0.75)" }}
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="rounded-xl shadow-2xl flex flex-col overflow-hidden"
          style={{ width: 960, maxWidth: "94vw", maxHeight: "88vh", background: "var(--color-bg)", border: "1px solid var(--color-border)" }}>

        {/* Header */}
        <div className="flex items-start gap-3 px-6 py-5 border-b shrink-0" style={{ borderColor: "var(--color-border-soft)" }}>
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-lg" style={{ color: "var(--color-white)" }}>{t('common.settings')}</h2>
            <p className="mt-1 text-sm leading-relaxed" style={{ color: "var(--color-text-muted)" }}>{tabDescriptions[tab]}</p>
          </div>
          <button onClick={onClose} style={{ color: "var(--color-text-dim)", fontSize: 18, lineHeight: 1 }}>✕</button>
        </div>

        {/* Tab bar */}
        <div className="flex flex-wrap gap-2 px-6 pt-4 pb-1 shrink-0" style={{ background: "var(--color-bg-elev)" }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className="px-3 py-2 rounded-lg text-xs font-medium shrink-0 transition-colors"
              style={{
                background: tab === t.id ? "var(--color-panel)" : "var(--color-panel-2)",
                color: tab === t.id ? "var(--color-accent)" : "var(--color-text-muted)",
                border: `1px solid ${tab === t.id ? "var(--color-accent-deep)" : "var(--color-border-soft)"}`,
                boxShadow: tab === t.id ? "inset 0 0 0 1px rgba(102, 192, 244, 0.18)" : "none",
              }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4"
          style={{ background: "var(--color-bg-elev)", scrollbarWidth: "thin", scrollbarColor: "var(--color-border) transparent" }}>

          {tab === "general" && (
            <>
              <section className="settings-hero-card" style={{ background: "linear-gradient(135deg, rgba(42,109,181,0.22), rgba(22,32,45,0.95))", border: "1px solid var(--color-accent-deep)" }}>
                <div className="settings-hero-card__content">
                  <div>
                    <div className="settings-hero-card__eyebrow" style={{ color: "var(--color-accent-soft)" }}>Settings Overview</div>
                    <h3 className="settings-hero-card__title" style={{ color: "var(--color-white)" }}>Less scanning, more signal</h3>
                    <p className="settings-hero-card__description" style={{ color: "var(--color-text-soft)" }}>
                      General settings are now grouped by intent: identity, accounts, app behavior, appearance, safety, and maintenance. The idea is to make first-time setup readable instead of forcing one long pass over unrelated controls.
                    </p>
                  </div>
                  <div className="settings-stats-grid">
                    <SettingsStat label="Active profile" value={selectedProfile?.displayName || profileDraft.displayName || "New profile"} />
                    <SettingsStat label="Storefront sessions" value={`${connectedStorefronts}/3 connected`} />
                    <SettingsStat label="Library folders" value={`${libraryFolders.length}`} />
                    <SettingsStat label="Sidebar sections" value={`${activeSidebarSections} visible`} />
                  </div>
                </div>
              </section>

              <div className="settings-general-grid">
                <SettingsSurface
                  title="Language & Discovery"
                  description="Pick the app language and the search engine used for metadata lookup."
                >
                  <div className="space-y-3">
                    <div>
                      <label className="block text-[11px] mb-1" style={{ color: "var(--color-text-dim)" }}>{t('settings.language')}</label>
                      <select
                        value={appSettings.language || "en"}
                        onChange={(e) => onSaveSettings({ ...appSettings, language: e.currentTarget.value })}
                        className="w-full px-3 py-2 rounded-lg text-sm bg-transparent border outline-none"
                        style={{ background: "var(--color-panel-2)", color: "var(--color-text)", borderColor: "var(--color-border)" }}
                      >
                        <option value="en" style={{ background: "var(--color-panel-2)" }}>English (US)</option>
                        <option value="ru" style={{ background: "var(--color-panel-2)" }}>Русский (Russian)</option>
                        <option value="ja" style={{ background: "var(--color-panel-2)" }}>日本語 (Japanese)</option>
                        <option value="zh" style={{ background: "var(--color-panel-2)" }}>中文 (Chinese)</option>
                        <option value="ko" style={{ background: "var(--color-panel-2)" }}>한국어 (Korean)</option>
                        <option value="zh-TW" style={{ background: "var(--color-panel-2)" }}>繁體中文 (Taiwanese)</option>
                        <option value="pl" style={{ background: "var(--color-panel-2)" }}>Polski (Polish)</option>
                        <option value="uk" style={{ background: "var(--color-panel-2)" }}>Українська (Ukrainian)</option>
                        <option value="de" style={{ background: "var(--color-panel-2)" }}>Deutsch (German)</option>
                        <option value="fr" style={{ background: "var(--color-panel-2)" }}>Français (French)</option>
                        {Object.entries(customLangs).map(([code, { name }]) => (
                          <option key={code} value={code} style={{ background: "var(--color-panel-2)" }}>
                            {name} ({code})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={handleImportLanguage}
                        disabled={langImporting}
                        className="flex-1 py-2 rounded text-xs flex items-center justify-center gap-1.5 disabled:opacity-50"
                        style={{ background: "var(--color-panel-3)", color: "var(--color-accent)", border: "1px solid var(--color-border)" }}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="7 10 12 15 17 10" />
                          <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                        {langImporting ? "Importing..." : "Import Language"}
                      </button>
                      {customLangs[appSettings.language || ""] && (
                        <button
                          onClick={() => handleRemoveCustomLanguage(appSettings.language!)}
                          className="py-2 px-3 rounded text-xs"
                          style={{ background: "var(--color-danger-bg)", color: "var(--color-danger)", border: "1px solid var(--color-danger-border)" }}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    <div>
                      <label className="block text-[11px] mb-1" style={{ color: "var(--color-text-dim)" }}>Search Engine</label>
                      <select
                        value={appSettings.preferredSearchEngine || "duckduckgo"}
                        onChange={(e) => onSaveSettings({ ...appSettings, preferredSearchEngine: e.currentTarget.value as any })}
                        className="w-full px-3 py-2 rounded-lg text-sm bg-transparent border outline-none"
                        style={{ background: "var(--color-panel-2)", color: "var(--color-text)", borderColor: "var(--color-border)" }}
                      >
                        <option value="duckduckgo" style={{ background: "var(--color-panel-2)" }}>DuckDuckGo</option>
                        <option value="google" style={{ background: "var(--color-panel-2)" }}>Google</option>
                        <option value="bing" style={{ background: "var(--color-panel-2)" }}>Bing</option>
                        <option value="brave" style={{ background: "var(--color-panel-2)" }}>Brave</option>
                      </select>
                    </div>
                    {Object.keys(customLangs).length > 0 && (
                      <p className="text-[11px]" style={{ color: "var(--color-text-dim)" }}>
                        Custom languages: {Object.keys(customLangs).map(c => customLangs[c].name).join(", ")}
                      </p>
                    )}
                  </div>
                </SettingsSurface>

                <SettingsSurface
                  title="Accounts"
                  description="Connect storefront sessions here. Provider secrets are kept in the secure vault."
                >
                  <div className="space-y-2.5">
                    <div className="settings-account-row" style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border-soft)" }}>
                      <div>
                        <div className="settings-account-row__title">F95zone</div>
                        <div className="settings-account-row__status" style={{ color: f95LoggedIn ? "var(--color-warning)" : "var(--color-text-dim)" }}>
                          {f95LoggedIn ? t('settings.accounts.logged_in') : t('settings.accounts.sign_in', { name: "F95zone" })}
                        </div>
                      </div>
                      {f95LoggedIn ? (
                        <button onClick={onF95Logout} className="settings-account-row__button" style={{ background: "var(--color-warning-bg)", color: "var(--color-warning)", border: "1px solid var(--color-warning-border)" }}>
                          {t('settings.accounts.sign_out')}
                        </button>
                      ) : (
                        <button onClick={() => { onClose(); onF95Login(); }} className="settings-account-row__button" style={{ background: "var(--color-panel-3)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}>
                          Sign in
                        </button>
                      )}
                    </div>
                    <div className="settings-account-row" style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border-soft)" }}>
                      <div>
                        <div className="settings-account-row__title">DLsite</div>
                        <div className="settings-account-row__status" style={{ color: dlsiteLoggedIn ? "var(--color-danger-strong)" : "var(--color-text-dim)" }}>
                          {dlsiteLoggedIn ? t('settings.accounts.logged_in') : `${t('settings.accounts.sign_in', { name: "DLsite" })} · ${t('settings.accounts.age_gate')}`}
                        </div>
                      </div>
                      {dlsiteLoggedIn ? (
                        <button onClick={onDLsiteLogout} className="settings-account-row__button" style={{ background: "var(--color-danger-bg)", color: "var(--color-danger-strong)", border: "1px solid var(--color-danger-border)" }}>
                          {t('settings.accounts.sign_out')}
                        </button>
                      ) : (
                        <button onClick={() => { onClose(); onDLsiteLogin(); }} className="settings-account-row__button" style={{ background: "var(--color-panel-3)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}>
                          Sign in
                        </button>
                      )}
                    </div>
                    <div className="settings-account-row" style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border-soft)" }}>
                      <div>
                        <div className="settings-account-row__title">FAKKU</div>
                        <div className="settings-account-row__status" style={{ color: fakkuLoggedIn ? "#da4c96" : "var(--color-text-dim)" }}>
                          {fakkuLoggedIn ? t('settings.accounts.logged_in') : `${t('settings.accounts.sign_in', { name: "FAKKU" })} · ${t('settings.accounts.age_check_bypass')}`}
                        </div>
                      </div>
                      {fakkuLoggedIn ? (
                        <button onClick={onFakkuLogout} className="settings-account-row__button" style={{ background: "#3b1f2f", color: "#da4c96", border: "1px solid #6a2d4b" }}>
                          {t('settings.accounts.sign_out')}
                        </button>
                      ) : (
                        <button onClick={() => { onClose(); onFakkuLogin(); }} className="settings-account-row__button" style={{ background: "var(--color-panel-3)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}>
                          Sign in
                        </button>
                      )}
                    </div>
                  </div>
                </SettingsSurface>

                <SettingsSurface
                  title={t('settings.profiles.title')}
                  description="Profiles isolate library data, sync state, secrets, and presentation identity."
                  wide
                >
                  <div className="rounded-lg p-3 space-y-3" style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border-soft)" }}>
                    <div className="flex items-center gap-3">
                      <div
                        className="w-11 h-11 rounded-xl flex items-center justify-center text-sm font-black overflow-hidden"
                        style={{
                          background: selectedProfile?.avatarUrl
                            ? `center / cover no-repeat url(${selectedProfile.avatarUrl})`
                            : `linear-gradient(135deg, ${profileDraft.accentColor || "#66c0f4"}, color-mix(in srgb, ${profileDraft.accentColor || "#66c0f4"} 45%, black 55%))`,
                          color: "white",
                        }}
                      >
                        {!selectedProfile?.avatarUrl && (profileDraft.displayName || "P").slice(0, 1).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold truncate" style={{ color: "var(--color-text)" }}>
                          {selectedProfile?.displayName || profileDraft.displayName || t('settings.profiles.new_profile')}
                        </div>
                        <div className="text-[11px] truncate" style={{ color: "var(--color-text-dim)" }}>
                          {selectedProfile?.id === activeLibraryProfileId ? t('settings.profiles.active_profile') : t('settings.profiles.profile_editor')}
                          {profileDraft.handle ? ` · @${profileDraft.handle}` : ""}
                        </div>
                        {(profileDraft.tagline || selectedProfile?.tagline) && (
                          <div className="text-[11px] truncate mt-0.5" style={{ color: "var(--color-text-muted)" }}>
                            {profileDraft.tagline || selectedProfile?.tagline}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <select
                        value={selectedProfileId}
                        onChange={(e) => setSelectedProfileId(e.currentTarget.value)}
                        className="flex-1 px-3 py-2 rounded text-sm bg-transparent border outline-none"
                        style={{ background: "var(--color-panel)", color: "var(--color-text)", borderColor: "var(--color-border)" }}
                      >
                        {libraryProfiles.map((profile) => (
                          <option key={profile.id} value={profile.id} style={{ background: "var(--color-panel-2)" }}>
                            {profile.displayName}{profile.id === activeLibraryProfileId ? t('settings.profiles.active_suffix') : ""}
                          </option>
                        ))}
                        <option value="new" style={{ background: "var(--color-panel-2)" }}>{t('settings.profiles.create_new')}</option>
                      </select>
                      {selectedProfileId !== activeLibraryProfileId && selectedProfileId !== "new" && (
                        <button
                          onClick={() => onSwitchLibraryProfile(selectedProfileId)}
                          className="px-3 py-2 rounded text-xs font-semibold"
                          style={{ background: "var(--color-accent-dark)", color: "var(--color-white)" }}
                        >
                          {t('settings.profiles.switch')}
                        </button>
                      )}
                      <button
                        onClick={() => setSelectedProfileId("new")}
                        className="px-3 py-2 rounded text-xs font-semibold"
                        style={{ background: "var(--color-panel-3)", color: "var(--color-text)" }}
                      >
                        {t('settings.profiles.new_button')}
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                        {t('settings.profiles.display_name')}
                        <input
                          type="text"
                          value={profileDraft.displayName || ""}
                          onInput={(e) => setProfileDraft((prev) => ({ ...prev, displayName: (e.target as HTMLInputElement).value }))}
                          className="mt-1 w-full px-2 py-1.5 rounded bg-transparent border outline-none"
                          style={{ borderColor: "var(--color-border)", color: "var(--color-text)" }}
                        />
                      </label>
                      <label className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                        {t('settings.profiles.handle')}
                        <input
                          type="text"
                          value={profileDraft.handle || ""}
                          onInput={(e) => setProfileDraft((prev) => ({ ...prev, handle: (e.target as HTMLInputElement).value.replace(/^@+/, "") }))}
                          className="mt-1 w-full px-2 py-1.5 rounded bg-transparent border outline-none"
                          style={{ borderColor: "var(--color-border)", color: "var(--color-text)" }}
                          placeholder={t('settings.profiles.handle_placeholder')}
                        />
                      </label>
                      <label className="text-xs col-span-2" style={{ color: "var(--color-text-muted)" }}>
                        {t('settings.profiles.tagline')}
                        <input
                          type="text"
                          value={profileDraft.tagline || ""}
                          onInput={(e) => setProfileDraft((prev) => ({ ...prev, tagline: (e.target as HTMLInputElement).value }))}
                          className="mt-1 w-full px-2 py-1.5 rounded bg-transparent border outline-none"
                          style={{ borderColor: "var(--color-border)", color: "var(--color-text)" }}
                          placeholder={t('settings.profiles.tagline_placeholder')}
                        />
                      </label>
                      <label className="text-xs col-span-2" style={{ color: "var(--color-text-muted)" }}>
                        {t('settings.profiles.avatar_url')}
                        <input
                          type="text"
                          value={profileDraft.avatarUrl || ""}
                          onInput={(e) => setProfileDraft((prev) => ({ ...prev, avatarUrl: (e.target as HTMLInputElement).value }))}
                          className="mt-1 w-full px-2 py-1.5 rounded bg-transparent border outline-none"
                          style={{ borderColor: "var(--color-border)", color: "var(--color-text)" }}
                          placeholder="https://..."
                        />
                      </label>
                      <label className="text-xs col-span-2" style={{ color: "var(--color-text-muted)" }}>
                        {t('settings.profiles.banner_url')}
                        <input
                          type="text"
                          value={profileDraft.bannerUrl || ""}
                          onInput={(e) => setProfileDraft((prev) => ({ ...prev, bannerUrl: (e.target as HTMLInputElement).value }))}
                          className="mt-1 w-full px-2 py-1.5 rounded bg-transparent border outline-none"
                          style={{ borderColor: "var(--color-border)", color: "var(--color-text)" }}
                          placeholder="https://..."
                        />
                      </label>
                      <label className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                        {t('settings.profiles.accent_color')}
                        <input
                          type="color"
                          value={profileDraft.accentColor || "#66c0f4"}
                          onInput={(e) => setProfileDraft((prev) => ({ ...prev, accentColor: (e.target as HTMLInputElement).value }))}
                          className="mt-1 w-full h-9 rounded bg-transparent border outline-none"
                          style={{ borderColor: "var(--color-border)" }}
                        />
                      </label>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => onSaveLibraryProfile(profileDraft)}
                        disabled={!profileDraft.displayName?.trim()}
                        className="flex-1 py-2 rounded text-xs font-semibold disabled:opacity-50"
                        style={{ background: "var(--color-accent-dark)", color: "var(--color-white)" }}
                      >
                        {profileDraft.id ? t('settings.profiles.save_profile') : t('settings.profiles.create_profile')}
                      </button>
                      {selectedProfile && libraryProfiles.length > 1 && (
                        <button
                          onClick={() => onDeleteLibraryProfile(selectedProfile.id)}
                          className="px-3 py-2 rounded text-xs font-semibold"
                          style={{ background: "var(--color-danger-bg)", color: "var(--color-danger)", border: "1px solid var(--color-danger-border)" }}
                        >
                          {t('common.delete')}
                        </button>
                      )}
                    </div>
                  </div>
                </SettingsSurface>

                <SettingsSurface
                  title="System Defaults"
                  description="Controls that affect startup behavior, notifications, scoring, privacy blur, and capture cadence."
                >
                  <div className="space-y-2.5">
                    <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
                      <input type="checkbox" checked={appSettings.startupWithWindows}
                        onChange={(e) => onSaveSettings({ ...appSettings, startupWithWindows: e.currentTarget.checked })} />
                      {t('settings.system.startup')}
                    </label>
                    {platform === "windows" && (
                      <div className="rounded-lg px-3 py-3 space-y-2" style={{ background: "var(--color-bg-overlay)", border: "1px solid var(--color-border-soft)" }}>
                        <div className="text-sm" style={{ color: "var(--color-text)" }}>Explorer quick-launch for `.exe`</div>
                        <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                          Adds a right-click entry in Explorer so users can launch a game executable through Libmaly even when the app is closed.
                        </p>
                        <div className="text-[11px]" style={{ color: explorerQuickLaunchStatus?.registered ? "var(--color-success)" : "var(--color-text-dim)" }}>
                          Status: {explorerQuickLaunchStatus?.registered ? "Registered" : "Not registered"}
                        </div>
                        {explorerQuickLaunchStatus?.command && (
                          <div className="text-[10px] break-all" style={{ color: "var(--color-text-dim)" }}>
                            Command: {explorerQuickLaunchStatus.command}
                          </div>
                        )}
                        {explorerQuickLaunchMessage && (
                          <div className="text-[11px]" style={{ color: explorerQuickLaunchMessage.startsWith("Could not") ? "var(--color-danger)" : "var(--color-text-muted)" }}>
                            {explorerQuickLaunchMessage}
                          </div>
                        )}
                        <div className="flex gap-2">
                          <button
                            onClick={() => void handleRegisterExplorerQuickLaunch()}
                            disabled={explorerQuickLaunchBusy}
                            className="flex-1 py-2 rounded text-xs font-semibold disabled:opacity-50"
                            style={{ background: "var(--color-panel-3)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
                          >
                            {explorerQuickLaunchBusy ? "Working..." : explorerQuickLaunchStatus?.registered ? "Re-register" : "Register"}
                          </button>
                          <button
                            onClick={() => void handleUnregisterExplorerQuickLaunch()}
                            disabled={explorerQuickLaunchBusy || !explorerQuickLaunchStatus?.registered}
                            className="flex-1 py-2 rounded text-xs font-semibold disabled:opacity-50"
                            style={{ background: "var(--color-panel-3)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    )}
                    {platform === "windows" && (
                      <div className="rounded-lg px-3 py-3 space-y-2" style={{ background: "var(--color-bg-overlay)", border: "1px solid var(--color-border-soft)" }}>
                        <div className="text-sm" style={{ color: "var(--color-text)" }}>Explorer install for `.zip`</div>
                        <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                          Adds a right-click entry in Explorer so users can install ZIP archives into a Libmaly library folder directly from the file manager.
                        </p>
                        <div className="text-[11px]" style={{ color: explorerZipInstallStatus?.registered ? "var(--color-success)" : "var(--color-text-dim)" }}>
                          Status: {explorerZipInstallStatus?.registered ? "Registered" : "Not registered"}
                        </div>
                        {explorerZipInstallStatus?.command && (
                          <div className="text-[10px] break-all" style={{ color: "var(--color-text-dim)" }}>
                            Command: {explorerZipInstallStatus.command}
                          </div>
                        )}
                        {explorerZipInstallMessage && (
                          <div className="text-[11px]" style={{ color: explorerZipInstallMessage.startsWith("Could not") ? "var(--color-danger)" : "var(--color-text-muted)" }}>
                            {explorerZipInstallMessage}
                          </div>
                        )}
                        <div className="flex gap-2">
                          <button
                            onClick={() => void handleRegisterExplorerZipInstall()}
                            disabled={explorerZipInstallBusy}
                            className="flex-1 py-2 rounded text-xs font-semibold disabled:opacity-50"
                            style={{ background: "var(--color-panel-3)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
                          >
                            {explorerZipInstallBusy ? "Working..." : explorerZipInstallStatus?.registered ? "Re-register" : "Register"}
                          </button>
                          <button
                            onClick={() => void handleUnregisterExplorerZipInstall()}
                            disabled={explorerZipInstallBusy || !explorerZipInstallStatus?.registered}
                            className="flex-1 py-2 rounded text-xs font-semibold disabled:opacity-50"
                            style={{ background: "var(--color-panel-3)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    )}
                    <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
                      <input type="checkbox" checked={appSettings.updateCheckerEnabled}
                        onChange={(e) => onSaveSettings({ ...appSettings, updateCheckerEnabled: e.currentTarget.checked })} />
                      {t('settings.system.updates')}
                    </label>
                    <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
                      <input type="checkbox" checked={appSettings.appUpdateCheckerEnabled !== false}
                        onChange={(e) => onSaveSettings({ ...appSettings, appUpdateCheckerEnabled: e.currentTarget.checked })} />
                      {t('settings.system.app_update_checker')}
                    </label>
                    <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
                      <input type="checkbox" checked={appSettings.sessionToastEnabled}
                        onChange={(e) => onSaveSettings({ ...appSettings, sessionToastEnabled: e.currentTarget.checked })} />
                      {t('settings.system.notifications')}
                    </label>
                    <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
                      <input type="checkbox" checked={appSettings.trayTooltipEnabled}
                        onChange={(e) => onSaveSettings({ ...appSettings, trayTooltipEnabled: e.currentTarget.checked })} />
                      {t('settings.system.tray_tooltip')}
                    </label>
                    <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
                      <input type="checkbox" checked={appSettings.surpriseLaunchesImmediately}
                        onChange={(e) => onSaveSettings({ ...appSettings, surpriseLaunchesImmediately: e.currentTarget.checked })} />
                      {t('settings.system.surprise_launch')}
                    </label>
                    <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
                      <input type="checkbox" checked={appSettings.blurNsfwContent}
                        onChange={(e) => onSaveSettings({ ...appSettings, blurNsfwContent: e.currentTarget.checked })} />
                      {t('settings.system.blur_nsfw')}
                    </label>
                    <label className="text-sm block" style={{ color: "var(--color-text-muted)" }}>
                      {t('settings.system.rating_scale')}
                      <select
                        value={appSettings.ratingScale}
                        onChange={(e) => onSaveSettings({ ...appSettings, ratingScale: (e.currentTarget.value as RatingScale) })}
                        className="mt-1 w-full px-2 py-2 rounded text-xs outline-none"
                        style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
                      >
                        <option value="10">{t('settings.system.rating_scale_options.10')}</option>
                        <option value="10_decimal">{t('settings.system.rating_scale_options.10_decimal')}</option>
                        <option value="100">{t('settings.system.rating_scale_options.100')}</option>
                        <option value="5_star">{t('settings.system.rating_scale_options.5_star')}</option>
                        <option value="3_smiley">{t('settings.system.rating_scale_options.3_smiley')}</option>
                      </select>
                    </label>
                    <label className="text-sm block" style={{ color: "var(--color-text-muted)" }}>
                      Game detail layout preset
                      <select
                        value={appSettings.gameDetailLayoutPreset || "metadata-first"}
                        onChange={(e) => onSaveSettings({ ...appSettings, gameDetailLayoutPreset: e.currentTarget.value as GameDetailLayoutPreset })}
                        className="mt-1 w-full px-2 py-2 rounded text-xs outline-none"
                        style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
                      >
                        <option value="metadata-first">Metadata first</option>
                        <option value="screenshots-first">Screenshots first</option>
                        <option value="notes-first">Notes first</option>
                      </select>
                    </label>
                    <label className="text-sm block" style={{ color: "var(--color-text-muted)" }}>
                      {t('settings.system.auto_screenshot')}
                      <div className="flex items-center gap-2 mt-1">
                        <input type="number" min="0" className="w-20 px-2 py-2 bg-transparent border rounded outline-none text-center"
                          style={{ color: "var(--color-text)", borderColor: "var(--color-border)" }}
                          value={appSettings.autoScreenshotInterval || 0}
                          onChange={e => onSaveSettings({ ...appSettings, autoScreenshotInterval: Math.max(0, parseInt(e.currentTarget.value) || 0) })} />
                        <span className="text-[11px]" style={{ color: "var(--color-text-dim)" }}>{t('settings.system.disable_hint')}</span>
                      </div>
                    </label>
                    <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
                      <input type="checkbox" checked={appSettings.saveBackupOnExit}
                        onChange={(e) => onSaveSettings({ ...appSettings, saveBackupOnExit: e.currentTarget.checked })} />
                      {t('settings.system.backup_on_exit')}
                    </label>
                  </div>
                </SettingsSurface>

                <SettingsSurface
                  title={t('settings.appearance.title')}
                  description="Theme scheduling, seasonal variants, accent color, and custom-theme overrides."
                  wide
                >
                  <div className="space-y-3">
                    <label className="flex items-center gap-2 text-sm flex-wrap" style={{ color: "var(--color-text-muted)" }}>
                      {t('settings.appearance.schedule')}
                      <select
                        className="ml-0 sm:ml-2 bg-transparent border rounded px-2 py-1 outline-none text-(--color-text)"
                        style={{ borderColor: "var(--color-border)" }}
                        value={appSettings.themeScheduleMode || "manual"}
                        onChange={(e) => onSaveSettings({ ...appSettings, themeScheduleMode: e.currentTarget.value as "manual" | "os" | "time" })}
                      >
                        <option value="manual" style={{ background: "var(--color-panel-2)" }}>{t('settings.appearance.schedule_options.manual')}</option>
                        <option value="os" style={{ background: "var(--color-panel-2)" }}>{t('settings.appearance.schedule_options.os')}</option>
                        <option value="time" style={{ background: "var(--color-panel-2)" }}>{t('settings.appearance.schedule_options.time')}</option>
                      </select>
                    </label>
                    {(appSettings.themeScheduleMode || "manual") === "manual" && (
                      <label className="flex items-center gap-2 text-sm flex-wrap" style={{ color: "var(--color-text-muted)" }}>
                        {t('settings.appearance.theme')}
                        <select
                          className="ml-0 sm:ml-2 bg-transparent border rounded px-2 py-1 outline-none text-(--color-text)"
                          style={{ borderColor: "var(--color-border)" }}
                          value={appSettings.themeMode || "dark"}
                          onChange={(e) => onSaveSettings({ ...appSettings, themeMode: e.currentTarget.value as ThemeMode })}
                        >
                          {THEME_OPTIONS.map((theme) => (
                            <option key={theme.value} value={theme.value} style={{ background: "var(--color-panel-2)" }}>
                              {t(theme.label)}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    {(appSettings.themeScheduleMode || "manual") === "time" && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <label className="flex items-center gap-2 text-sm flex-wrap" style={{ color: "var(--color-text-muted)" }}>
                          {t('settings.appearance.day_theme')}
                          <select
                            className="ml-0 sm:ml-2 bg-transparent border rounded px-2 py-1 outline-none text-(--color-text)"
                            style={{ borderColor: "var(--color-border)" }}
                            value={appSettings.dayThemeMode || "light"}
                            onChange={(e) => onSaveSettings({ ...appSettings, dayThemeMode: e.currentTarget.value as ThemeMode })}
                          >
                            {DAY_THEME_OPTIONS.map((theme) => (
                              <option key={theme.value} value={theme.value} style={{ background: "var(--color-panel-2)" }}>
                                {t(theme.label)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="flex items-center gap-2 text-sm flex-wrap" style={{ color: "var(--color-text-muted)" }}>
                          {t('settings.appearance.night_theme')}
                          <select
                            className="ml-0 sm:ml-2 bg-transparent border rounded px-2 py-1 outline-none text-(--color-text)"
                            style={{ borderColor: "var(--color-border)" }}
                            value={appSettings.nightThemeMode || "dark"}
                            onChange={(e) => onSaveSettings({ ...appSettings, nightThemeMode: e.currentTarget.value as ThemeMode })}
                          >
                            {NIGHT_THEME_OPTIONS.map((theme) => (
                              <option key={theme.value} value={theme.value} style={{ background: "var(--color-panel-2)" }}>
                                {t(theme.label)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="flex items-center gap-2 text-sm flex-wrap" style={{ color: "var(--color-text-muted)" }}>
                          {t('settings.appearance.light_starts')}
                          <input
                            type="number"
                            min="0"
                            max="23"
                            className="ml-0 sm:ml-2 w-16 bg-transparent border rounded px-2 py-1 outline-none text-(--color-text)"
                            style={{ borderColor: "var(--color-border)" }}
                            value={Math.max(0, Math.min(23, appSettings.lightStartHour ?? defaultSettings.lightStartHour))}
                            onChange={(e) => onSaveSettings({ ...appSettings, lightStartHour: Math.max(0, Math.min(23, parseInt(e.currentTarget.value) || 0)) })}
                          />
                        </label>
                        <label className="flex items-center gap-2 text-sm flex-wrap" style={{ color: "var(--color-text-muted)" }}>
                          {t('settings.appearance.night_theme')}
                          <input
                            type="number"
                            min="0"
                            max="23"
                            className="ml-0 sm:ml-2 w-16 bg-transparent border rounded px-2 py-1 outline-none text-(--color-text)"
                            style={{ borderColor: "var(--color-border)" }}
                            value={Math.max(0, Math.min(23, appSettings.darkStartHour ?? defaultSettings.darkStartHour))}
                            onChange={(e) => onSaveSettings({ ...appSettings, darkStartHour: Math.max(0, Math.min(23, parseInt(e.currentTarget.value) || 0)) })}
                          />
                        </label>
                      </div>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-end">
                      <label className="text-sm block" style={{ color: "var(--color-text-muted)" }}>
                        {t('settings.appearance.seasonal')}
                        <select
                          className="mt-1 w-full bg-transparent border rounded px-2 py-1 outline-none text-(--color-text)"
                          style={{ borderColor: "var(--color-border)" }}
                          value={appSettings.seasonalTheme || "auto"}
                          onChange={(e) => onSaveSettings({ ...appSettings, seasonalTheme: e.currentTarget.value as "auto" | "winter" | "summer" | "halloween" | "none" })}
                        >
                          <option value="auto" style={{ background: "var(--color-panel-2)" }}>{t('settings.appearance.schedule_options.os')}</option>
                          <option value="winter" style={{ background: "var(--color-panel-2)" }}>Winter</option>
                          <option value="summer" style={{ background: "var(--color-panel-2)" }}>Summer</option>
                          <option value="halloween" style={{ background: "var(--color-panel-2)" }}>Halloween</option>
                          <option value="none" style={{ background: "var(--color-panel-2)" }}>Off</option>
                        </select>
                      </label>
                      <label className="text-sm block" style={{ color: "var(--color-text-muted)" }}>
                        {t('settings.appearance.accent')}
                        <div className="flex items-center gap-2 mt-1">
                          <input
                            type="color"
                            className="w-10 h-9 border rounded cursor-pointer"
                            style={{ borderColor: "var(--color-border)", background: "transparent" }}
                            value={normalizeHexColor(appSettings.accentColor || defaultSettings.accentColor, defaultSettings.accentColor)}
                            onChange={(e) => {
                              const accent = e.currentTarget.value;
                              const nextStep = { ...appSettings, accentColor: accent };
                              if (appSettings.themeMode === "custom") {
                                const nextColors = { ...(appSettings.customThemeColors || {}), accent };
                                nextStep.customThemeColors = nextColors;
                              }
                              onSaveSettings(nextStep);
                            }}
                          />
                          <input
                            type="text"
                            className="w-28 bg-transparent border rounded px-2 py-1 outline-none text-(--color-text) font-mono text-xs"
                            style={{ borderColor: "var(--color-border)" }}
                            value={normalizeHexColor(appSettings.accentColor || defaultSettings.accentColor, defaultSettings.accentColor)}
                            onChange={(e) => {
                              const accent = normalizeHexColor(e.currentTarget.value, defaultSettings.accentColor);
                              const nextStep = { ...appSettings, accentColor: accent };
                              if (appSettings.themeMode === "custom") {
                                const nextColors = { ...(appSettings.customThemeColors || {}), accent };
                                nextStep.customThemeColors = nextColors;
                              }
                              onSaveSettings(nextStep);
                            }}
                          />
                        </div>
                      </label>
                      <div className="rounded-lg p-3 space-y-2" style={{ background: "var(--color-bg-overlay)", border: "1px solid var(--color-border-soft)" }}>
                        <div className="text-xs font-semibold" style={{ color: "var(--color-text)" }}>Theme Marketplace / Gallery</div>
                        <p className="text-[11px]" style={{ color: "var(--color-text-dim)" }}>
                          Browse and install community JSON themes from a trusted relay.
                        </p>
                        <label className="text-[11px] block" style={{ color: "var(--color-text-muted)" }}>
                          Trusted relay URL
                          <div className="mt-1 flex gap-2">
                            <input
                              type="text"
                              value={appSettings.themeMarketplaceRelayUrl || defaultSettings.themeMarketplaceRelayUrl || ""}
                              onInput={(e) => onSaveSettings({ ...appSettings, themeMarketplaceRelayUrl: (e.target as HTMLInputElement).value })}
                              className="flex-1 px-2 py-1.5 rounded text-xs outline-none font-mono"
                              style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
                            />
                            <button
                              type="button"
                              onClick={() => { void loadThemeMarketplace(); }}
                              disabled={themeMarketplaceLoading}
                              className="px-3 py-1.5 rounded text-xs disabled:opacity-50"
                              style={{ background: "var(--color-panel-3)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
                            >
                              {themeMarketplaceLoading ? "Loading..." : "Refresh"}
                            </button>
                          </div>
                        </label>

                        <input
                          type="text"
                          placeholder="Filter themes by name/tag/author"
                          value={themeMarketplaceFilter}
                          onInput={(e) => setThemeMarketplaceFilter((e.target as HTMLInputElement).value)}
                          className="w-full px-2 py-1.5 rounded text-xs outline-none"
                          style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
                        />

                        {themeMarketplaceStatus && (
                          <p className="text-[11px]" style={{ color: themeMarketplaceStatus.startsWith("Could not") || themeMarketplaceStatus.includes("not trusted") ? "var(--color-danger)" : "var(--color-text-dim)" }}>
                            {themeMarketplaceStatus}
                          </p>
                        )}

                        <div className="max-h-64 overflow-y-auto space-y-2 pr-1" style={{ scrollbarWidth: "thin", scrollbarColor: "var(--color-border) transparent" }}>
                          {filteredThemeMarketplaceItems.length === 0 && !themeMarketplaceLoading && (
                            <p className="text-[11px]" style={{ color: "var(--color-text-dim)" }}>No themes to show.</p>
                          )}
                          {filteredThemeMarketplaceItems.map((entry) => (
                            <div key={entry.id} className="rounded p-2" style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border-soft)" }}>
                              <div className="flex gap-2">
                                {entry.previewImage ? (
                                  <img src={entry.previewImage} alt={entry.name} className="w-20 h-12 rounded object-cover shrink-0" style={{ border: "1px solid var(--color-border-subtle)" }} />
                                ) : (
                                  <div className="w-20 h-12 rounded shrink-0 flex items-center justify-center text-[9px]" style={{ background: "var(--color-bg)", color: "var(--color-text-dim)", border: "1px solid var(--color-border-subtle)" }}>
                                    No preview
                                  </div>
                                )}
                                <div className="min-w-0 flex-1">
                                  <div className="text-xs font-semibold truncate" style={{ color: "var(--color-text)" }}>{entry.name}</div>
                                  <div className="text-[10px]" style={{ color: "var(--color-text-dim)" }}>{entry.author || "Community"}</div>
                                  {entry.description && (
                                    <p className="text-[10px] mt-1 line-clamp-2" style={{ color: "var(--color-text-muted)" }}>{entry.description}</p>
                                  )}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => installMarketplaceTheme(entry)}
                                  className="px-2 py-1 rounded text-[10px] font-semibold shrink-0"
                                  style={{ background: "var(--color-accent-dark)", color: "var(--color-white)" }}
                                >
                                  Install
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                    {appSettings.themeMode === "custom" && (
                      <div className="mt-2 p-3 rounded-lg space-y-4" style={{ background: "var(--color-panel-alt)", border: "1px dashed var(--color-border-strong)" }}>
                        <div>
                          <h4 className="text-xs font-bold mb-1" style={{ color: "var(--color-white)" }}>{t('settings.custom_theme.title')}</h4>
                          <p className="text-[10px]" style={{ color: "var(--color-text-dim)" }}>
                            {t('settings.custom_theme.hint')}
                          </p>
                        </div>
                        <div className="space-y-4">
                          <div>
                            <div className="text-[9px] uppercase tracking-widest font-bold mb-2" style={{ color: "var(--color-text-dim)" }}>Background image</div>
                            <div className="space-y-2">
                              <input
                                type="text"
                                placeholder="https://.../wallpaper.jpg"
                                className="w-full bg-transparent border rounded px-2 py-1 text-[11px] outline-none font-mono"
                                style={{ borderColor: "var(--color-border)", color: "var(--color-text)" }}
                                value={appSettings.themeBackgroundImageUrl || ""}
                                onInput={e => onSaveSettings({ ...appSettings, themeBackgroundImageUrl: (e.target as HTMLInputElement).value })}
                              />
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                <label className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                                  Overlay
                                  <input
                                    type="text"
                                    className="mt-1 w-full bg-transparent border rounded px-2 py-1 text-[10px] outline-none font-mono"
                                    style={{ borderColor: "var(--color-border)", color: "var(--color-text)" }}
                                    value={appSettings.themeBackgroundImageOverlay || defaultSettings.themeBackgroundImageOverlay || "rgba(0,0,0,0.36)"}
                                    onInput={e => onSaveSettings({ ...appSettings, themeBackgroundImageOverlay: (e.target as HTMLInputElement).value })}
                                  />
                                </label>
                                <label className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                                  Opacity ({(appSettings.themeBackgroundImageOpacity ?? defaultSettings.themeBackgroundImageOpacity ?? 0.2).toFixed(2)})
                                  <input
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.01"
                                    className="mt-1 w-full"
                                    value={appSettings.themeBackgroundImageOpacity ?? defaultSettings.themeBackgroundImageOpacity ?? 0.2}
                                    onInput={e => onSaveSettings({ ...appSettings, themeBackgroundImageOpacity: parseFloat((e.target as HTMLInputElement).value) || 0 })}
                                  />
                                </label>
                                <label className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                                  Blur px ({Math.round(appSettings.themeBackgroundImageBlurPx ?? defaultSettings.themeBackgroundImageBlurPx ?? 0)})
                                  <input
                                    type="range"
                                    min="0"
                                    max="20"
                                    step="1"
                                    className="mt-1 w-full"
                                    value={appSettings.themeBackgroundImageBlurPx ?? defaultSettings.themeBackgroundImageBlurPx ?? 0}
                                    onInput={e => onSaveSettings({ ...appSettings, themeBackgroundImageBlurPx: parseInt((e.target as HTMLInputElement).value, 10) || 0 })}
                                  />
                                </label>
                              </div>
                            </div>
                          </div>
                          <div>
                            <div className="text-[9px] uppercase tracking-widest font-bold mb-2" style={{ color: "var(--color-text-dim)" }}>{t('settings.custom_theme.backgrounds')}</div>
                            <div className="grid grid-cols-2 gap-3">
                              {[
                                { key: "bg", label: t('settings.custom_theme.labels.bg') },
                                { key: "bg-elev", label: t('settings.custom_theme.labels.bg-elev') },
                                { key: "bg-deep", label: t('settings.custom_theme.labels.bg-deep') },
                                { key: "bg-overlay", label: t('settings.custom_theme.labels.bg-overlay') },
                              ].map(cfg => (
                                <div key={cfg.key} className="flex flex-col gap-1">
                                  <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>{cfg.label}</span>
                                  <div className="flex items-center gap-1.5">
                                    <input type="color" className="w-6 h-6 border-none bg-transparent cursor-pointer"
                                      value={normalizeHexColor(appSettings.customThemeColors?.[cfg.key] || "", "#000000")}
                                      onChange={e => onSaveSettings({
                                        ...appSettings,
                                        customThemeColors: { ...(appSettings.customThemeColors || {}), [cfg.key]: e.currentTarget.value }
                                      })} />
                                    <input type="text" className="flex-1 bg-transparent border rounded px-1.5 py-0.5 text-[10px] outline-none font-mono"
                                      style={{ borderColor: "var(--color-border)", color: "var(--color-text)" }}
                                      value={appSettings.customThemeColors?.[cfg.key] || ""}
                                      onInput={e => onSaveSettings({
                                        ...appSettings,
                                        customThemeColors: { ...(appSettings.customThemeColors || {}), [cfg.key]: (e.target as HTMLInputElement).value }
                                      })} />
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                          <div>
                            <div className="text-[9px] uppercase tracking-widest font-bold mb-2" style={{ color: "var(--color-text-dim)" }}>{t('settings.custom_theme.panels')}</div>
                            <div className="grid grid-cols-3 gap-3">
                              {[
                                { key: "panel", label: t('settings.custom_theme.labels.panel') },
                                { key: "panel-2", label: t('settings.custom_theme.labels.panel-2') },
                                { key: "panel-3", label: t('settings.custom_theme.labels.panel-3') },
                              ].map(cfg => (
                                <div key={cfg.key} className="flex flex-col gap-1">
                                  <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>{cfg.label}</span>
                                  <div className="flex items-center gap-1.5">
                                    <input type="color" className="w-5 h-5 border-none bg-transparent cursor-pointer"
                                      value={normalizeHexColor(appSettings.customThemeColors?.[cfg.key] || "", "#000000")}
                                      onChange={e => onSaveSettings({
                                        ...appSettings,
                                        customThemeColors: { ...(appSettings.customThemeColors || {}), [cfg.key]: e.currentTarget.value }
                                      })} />
                                    <input type="text" className="flex-1 min-w-0 bg-transparent border rounded px-1 py-0.5 text-[9px] outline-none font-mono"
                                      style={{ borderColor: "var(--color-border)", color: "var(--color-text)" }}
                                      value={appSettings.customThemeColors?.[cfg.key] || ""}
                                      onInput={e => onSaveSettings({
                                        ...appSettings,
                                        customThemeColors: { ...(appSettings.customThemeColors || {}), [cfg.key]: (e.target as HTMLInputElement).value }
                                      })} />
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                          <div>
                            <div className="text-[9px] uppercase tracking-widest font-bold mb-2" style={{ color: "var(--color-text-dim)" }}>{t('settings.custom_theme.typography')}</div>
                            <div className="grid grid-cols-2 gap-3">
                              {[
                                { key: "text", label: t('settings.custom_theme.labels.text') },
                                { key: "text-soft", label: t('settings.custom_theme.labels.text-soft') },
                                { key: "text-muted", label: t('settings.custom_theme.labels.text-muted') },
                                { key: "text-dim", label: t('settings.custom_theme.labels.text-dim') },
                              ].map(cfg => (
                                <div key={cfg.key} className="flex flex-col gap-1">
                                  <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>{cfg.label}</span>
                                  <div className="flex items-center gap-1.5">
                                    <input type="color" className="w-6 h-6 border-none bg-transparent cursor-pointer"
                                      value={normalizeHexColor(appSettings.customThemeColors?.[cfg.key] || "", "#ffffff")}
                                      onChange={e => onSaveSettings({
                                        ...appSettings,
                                        customThemeColors: { ...(appSettings.customThemeColors || {}), [cfg.key]: e.currentTarget.value }
                                      })} />
                                    <input type="text" className="flex-1 bg-transparent border rounded px-1.5 py-0.5 text-[10px] outline-none font-mono"
                                      style={{ borderColor: "var(--color-border)", color: "var(--color-text)" }}
                                      value={appSettings.customThemeColors?.[cfg.key] || ""}
                                      onInput={e => onSaveSettings({
                                        ...appSettings,
                                        customThemeColors: { ...(appSettings.customThemeColors || {}), [cfg.key]: (e.target as HTMLInputElement).value }
                                      })} />
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                          <div>
                            <div className="text-[9px] uppercase tracking-widest font-bold mb-2" style={{ color: "var(--color-text-dim)" }}>{t('settings.custom_theme.borders')}</div>
                            <div className="grid grid-cols-2 gap-3">
                              {[
                                { key: "border", label: t('settings.custom_theme.labels.border') },
                                { key: "border-soft", label: t('settings.custom_theme.labels.border-soft') },
                                { key: "border-strong", label: t('settings.custom_theme.labels.border-strong') },
                                { key: "border-subtle", label: t('settings.custom_theme.labels.border-subtle') },
                              ].map(cfg => (
                                <div key={cfg.key} className="flex flex-col gap-1">
                                  <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>{cfg.label}</span>
                                  <div className="flex items-center gap-1.5">
                                    <input type="color" className="w-6 h-6 border-none bg-transparent cursor-pointer"
                                      value={normalizeHexColor(appSettings.customThemeColors?.[cfg.key] || "", "#000000")}
                                      onChange={e => onSaveSettings({
                                        ...appSettings,
                                        customThemeColors: { ...(appSettings.customThemeColors || {}), [cfg.key]: e.currentTarget.value }
                                      })} />
                                    <input type="text" className="flex-1 bg-transparent border rounded px-1.5 py-0.5 text-[10px] outline-none font-mono"
                                      style={{ borderColor: "var(--color-border)", color: "var(--color-text)" }}
                                      value={appSettings.customThemeColors?.[cfg.key] || ""}
                                      onInput={e => onSaveSettings({
                                        ...appSettings,
                                        customThemeColors: { ...(appSettings.customThemeColors || {}), [cfg.key]: (e.target as HTMLInputElement).value }
                                      })} />
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                        <div className="pt-2 border-t" style={{ borderColor: "var(--color-border-soft)" }}>
                          <button className="text-[10px] uppercase font-bold" style={{ color: "var(--color-accent)" }}
                            onClick={() => {
                              if (confirm(t('settings.custom_theme.reset_confirm'))) {
                                onSaveSettings({ ...appSettings, customThemeColors: {} });
                              }
                            }}>
                            {t('settings.custom_theme.reset')}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </SettingsSurface>

                <SettingsSurface
                  title={t('settings.system.sidebar_layout')}
                  description={t('settings.system.sidebar_description')}
                >
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <label className="text-xs block" style={{ color: "var(--color-text-muted)" }}>
                        Library view mode
                        <select
                          value={viewMode}
                          onChange={(e) => onViewModeChange(e.currentTarget.value as LayoutViewMode)}
                          className="mt-1 w-full px-3 py-2 rounded text-sm outline-none"
                          style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
                        >
                          <option value="list" style={{ background: "var(--color-panel-2)" }}>List</option>
                          <option value="compact" style={{ background: "var(--color-panel-2)" }}>Compact</option>
                          <option value="grid" style={{ background: "var(--color-panel-2)" }}>Grid</option>
                        </select>
                      </label>
                      <label className="text-xs block" style={{ color: "var(--color-text-muted)" }}>
                        Sidebar width
                        <div className="mt-2 flex items-center gap-3">
                          <input
                            type="range"
                            min="200"
                            max="600"
                            step="10"
                            value={sidebarWidth}
                            onInput={(e) => onSidebarWidthChange(parseInt((e.target as HTMLInputElement).value, 10) || 256)}
                            className="flex-1"
                          />
                          <span className="text-[11px] font-mono" style={{ color: "var(--color-text)" }}>{sidebarWidth}px</span>
                        </div>
                      </label>
                    </div>
                    <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
                      <input
                        type="checkbox"
                        checked={!!appSettings.sidebarMinimalMode}
                        onChange={(e) => onSaveSettings({ ...appSettings, sidebarMinimalMode: e.currentTarget.checked })}
                      />
                      {t('settings.system.sidebar_minimal_mode')}
                    </label>
                    <div className="grid grid-cols-2 gap-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
                      {[
                        ["sidebarShowNews", "settings.system.sidebar_show_news"],
                        ["sidebarShowStats", "settings.system.sidebar_show_stats"],
                        ["sidebarShowSearchTools", "settings.system.sidebar_show_search_tools"],
                        ["sidebarShowCollections", "settings.system.sidebar_show_collections"],
                        ["sidebarShowDevelopers", "settings.system.sidebar_show_developers"],
                        ["sidebarShowWishlist", "settings.system.sidebar_show_wishlist"],
                        ["sidebarShowSurpriseButton", "settings.system.sidebar_show_surprise"],
                        ["sidebarShowGlobalNotes", "settings.system.sidebar_show_global_notes"],
                        ["sidebarShowAddButton", "settings.system.sidebar_show_add"],
                        ["sidebarShowSettingsButton", "settings.system.sidebar_show_settings"],
                        ["sidebarShowLogsButton", "settings.system.sidebar_show_logs"],
                      ].map(([key, label]) => (
                        <label key={key} className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={(appSettings as any)[key] !== false}
                            onChange={(e) => onSaveSettings({ ...appSettings, [key]: e.currentTarget.checked } as AppSettingsLike)}
                          />
                          <span>{t(label)}</span>
                        </label>
                      ))}
                    </div>
                    <div className="pt-3 border-t space-y-3" style={{ borderColor: "var(--color-border-soft)" }}>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>Layout presets</div>
                          <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
                            Save the current sidebar layout and switch between built-in or custom workspace profiles.
                          </p>
                        </div>
                        {activeLayoutPresetId && (
                          <span className="px-2 py-1 rounded text-[10px] font-semibold uppercase tracking-wide"
                            style={{ background: "var(--color-accent-deep)", color: "var(--color-accent-soft)", border: "1px solid var(--color-accent)" }}>
                            Active preset
                          </span>
                        )}
                      </div>
                      <div className="grid gap-2 md:grid-cols-3">
                        {layoutPresets.map((preset) => {
                          const isActive = preset.id === activeLayoutPresetId;
                          return (
                            <div
                              key={preset.id}
                              className="rounded-lg p-3 space-y-2"
                              style={{
                                background: isActive ? "var(--color-panel)" : "var(--color-panel-2)",
                                border: `1px solid ${isActive ? "var(--color-accent)" : "var(--color-border-soft)"}`,
                              }}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <div className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>{preset.name}</div>
                                  {preset.description && (
                                    <p className="mt-1 text-[11px] leading-relaxed" style={{ color: "var(--color-text-dim)" }}>{preset.description}</p>
                                  )}
                                </div>
                                {preset.readOnly && (
                                  <span className="text-[9px] uppercase tracking-wide" style={{ color: "var(--color-text-dim)" }}>Built-in</span>
                                )}
                              </div>
                              <div className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                                {preset.config.viewMode} · {preset.config.sidebarWidth}px · {preset.config.sidebarMinimalMode ? "minimal sidebar" : "full sidebar"}
                              </div>
                              <div className="flex gap-2 flex-wrap">
                                <button
                                  onClick={() => { onApplyLayoutPreset(preset.config); setLayoutPresetStatus(`Applied '${preset.name}'.`); }}
                                  className="px-2.5 py-1.5 rounded text-[11px] font-semibold"
                                  style={{ background: "var(--color-accent-dark)", color: "var(--color-white)" }}
                                >
                                  Apply
                                </button>
                                {!preset.readOnly && (
                                  <>
                                    <button
                                      onClick={() => handleUpdateLayoutPresetClick(preset.id, preset.name)}
                                      className="px-2.5 py-1.5 rounded text-[11px]"
                                      style={{ background: "var(--color-panel-3)", color: "var(--color-text)" }}
                                    >
                                      Update
                                    </button>
                                    <button
                                      onClick={() => handleDeleteLayoutPresetClick(preset.id, preset.name)}
                                      className="px-2.5 py-1.5 rounded text-[11px]"
                                      style={{ background: "var(--color-danger-bg)", color: "var(--color-danger)", border: "1px solid var(--color-danger-border)" }}
                                    >
                                      Delete
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-2 items-end">
                        <label className="text-xs block" style={{ color: "var(--color-text-muted)" }}>
                          Save current layout as
                          <input
                            type="text"
                            value={layoutPresetName}
                            onInput={(e) => setLayoutPresetName((e.target as HTMLInputElement).value)}
                            placeholder="My focused layout"
                            className="mt-1 w-full px-3 py-2 rounded text-sm outline-none"
                            style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
                          />
                        </label>
                        <button
                          onClick={handleSaveLayoutPresetClick}
                          disabled={!layoutPresetName.trim()}
                          className="px-3 py-2 rounded text-xs font-semibold disabled:opacity-50"
                          style={{ background: "var(--color-accent-dark)", color: "var(--color-white)" }}
                        >
                          Save preset
                        </button>
                        {selectedCustomLayoutPreset && (
                          <button
                            onClick={() => handleUpdateLayoutPresetClick(selectedCustomLayoutPreset.id, selectedCustomLayoutPreset.name)}
                            className="px-3 py-2 rounded text-xs"
                            style={{ background: "var(--color-panel-3)", color: "var(--color-text)" }}
                          >
                            Update active
                          </button>
                        )}
                      </div>
                      {layoutPresetStatus && (
                        <p className="text-[11px]" style={{ color: "var(--color-text-dim)" }}>{layoutPresetStatus}</p>
                      )}
                    </div>
                  </div>
                </SettingsSurface>

                <SettingsSurface
                  title={t('settings.system.discord_sdk')}
                  description={t('settings.system.discord_description')}
                >
                  <div className="space-y-2.5">
                    <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
                      <input
                        type="checkbox"
                        checked={!!appSettings.discordEnabled}
                        onChange={(e) => onSaveSettings({ ...appSettings, discordEnabled: e.currentTarget.checked })}
                      />
                      {t('settings.system.discord_enable')}
                    </label>
                    <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
                      <input
                        type="checkbox"
                        checked={appSettings.discordShowElapsedTime !== false}
                        disabled={!appSettings.discordEnabled}
                        onChange={(e) => onSaveSettings({ ...appSettings, discordShowElapsedTime: e.currentTarget.checked })}
                      />
                      {t('settings.system.discord_show_elapsed')}
                    </label>
                    <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
                      <input
                        type="checkbox"
                        checked={!!appSettings.discordShowIdlePresence}
                        disabled={!appSettings.discordEnabled}
                        onChange={(e) => onSaveSettings({ ...appSettings, discordShowIdlePresence: e.currentTarget.checked })}
                      />
                      {t('settings.system.discord_show_idle')}
                    </label>
                    <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
                      <input
                        type="checkbox"
                        checked={appSettings.discordAllowActivityJoin !== false}
                        disabled={!appSettings.discordEnabled}
                        onChange={(e) => onSaveSettings({ ...appSettings, discordAllowActivityJoin: e.currentTarget.checked })}
                      />
                      {t('settings.system.discord_allow_join')}
                    </label>
                    <div className="rounded-lg px-3 py-2 text-xs" style={{ background: "var(--color-bg-overlay)", border: "1px solid var(--color-border-soft)", color: "var(--color-text-muted)" }}>
                      <div>{t('settings.system.discord_status_label')}: <span style={{ color: "var(--color-text)" }}>{discordStatusSummary}</span></div>
                      {discordSnapshot && (
                        <div className="mt-1">
                          {t('settings.system.discord_presence_label')}: <span style={{ color: "var(--color-text)" }}>{discordSnapshot.richPresenceActive ? t('settings.system.discord_presence_active') : t('settings.system.discord_presence_idle')}</span>
                        </div>
                      )}
                      {discordSnapshot?.currentUser && (
                        <div className="mt-1">
                          {t('settings.system.discord_account_label')}: <span style={{ color: "var(--color-text)" }}>{discordSnapshot.currentUser.displayName || discordSnapshot.currentUser.username}</span>
                          {" · "}
                          <span>{discordSnapshot.currentUser.status}</span>
                        </div>
                      )}
                      {discordSnapshot && (
                        <div className="mt-1">
                          {t('settings.system.discord_friends_snapshot', {
                            playing: discordSnapshot.relationshipCounts.onlinePlayingGame,
                            online: discordSnapshot.relationshipCounts.onlineElsewhere,
                            offline: discordSnapshot.relationshipCounts.offline,
                          })}
                        </div>
                      )}
                      {showDiscordError && (
                        <div className="mt-1" style={{ color: "var(--color-danger)" }}>
                          {t('settings.system.discord_last_error')}: {discordSnapshot?.lastError}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={onOpenDiscordSettings}
                      disabled={!appSettings.discordEnabled}
                      className="w-full py-2 rounded-lg text-sm font-medium disabled:opacity-50"
                      style={{ background: "#26314e", color: "#b9c7ff", border: "1px solid #4a5f94" }}
                    >
                      {t('settings.system.discord_open_settings')}
                    </button>
                  </div>
                </SettingsSurface>

                <SettingsSurface
                  title="Maintenance"
                  description="Retention policy and storage cleanup live here instead of being mixed with first-run toggles."
                >
                  <div className="space-y-3">
                    <div>
                      <div className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>{t('settings.system.backup_retention')}</div>
                      <p className="mt-1 text-xs" style={{ color: "var(--color-text-muted)" }}>
                        {t('settings.system.backup_retention_hint')}
                      </p>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <label className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                        {t('settings.system.daily')}
                        <input type="number" min="0" className="mt-1 w-full px-2 py-1 bg-transparent border rounded outline-none text-center"
                          style={{ color: "var(--color-text)", borderColor: "var(--color-border)" }}
                          value={appSettings.backupRetentionDailyKeep || 0}
                          onChange={(e) => onSaveSettings({ ...appSettings, backupRetentionDailyKeep: Math.max(0, parseInt(e.currentTarget.value) || 0) })} />
                      </label>
                      <label className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                        {t('settings.system.weekly')}
                        <input type="number" min="0" className="mt-1 w-full px-2 py-1 bg-transparent border rounded outline-none text-center"
                          style={{ color: "var(--color-text)", borderColor: "var(--color-border)" }}
                          value={appSettings.backupRetentionWeeklyKeep || 0}
                          onChange={(e) => onSaveSettings({ ...appSettings, backupRetentionWeeklyKeep: Math.max(0, parseInt(e.currentTarget.value) || 0) })} />
                      </label>
                      <label className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                        {t('settings.system.monthly')}
                        <input type="number" min="0" className="mt-1 w-full px-2 py-1 bg-transparent border rounded outline-none text-center"
                          style={{ color: "var(--color-text)", borderColor: "var(--color-border)" }}
                          value={appSettings.backupRetentionMonthlyKeep || 0}
                          onChange={(e) => onSaveSettings({ ...appSettings, backupRetentionMonthlyKeep: Math.max(0, parseInt(e.currentTarget.value) || 0) })} />
                      </label>
                    </div>
                    <button onClick={onApplyBackupRetentionPolicy} disabled={isBackupRetentionBusy}
                      className="w-full py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-40"
                      style={{ background: "var(--color-panel-3)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}>
                      {backupRetentionStatus || t('settings.system.apply_backup')}
                    </button>
                    <button onClick={onRunDbVacuum} disabled={isDbVacuumBusy}
                      id="settings-optimize-storage-btn"
                      className="w-full py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-40"
                      style={{ background: "var(--color-panel-3)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
                        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                      </svg>
                      {dbVacuumStatus || "Optimize Storage"}
                    </button>
                  </div>
                </SettingsSurface>

                <SettingsSurface
                  title={t('settings.panic.title')}
                  description="Emergency hide/kill behavior when you need Libmaly gone immediately."
                >
                  <div className="space-y-3">
                    <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
                      <input type="checkbox" checked={appSettings.bossKeyEnabled}
                        onChange={(e) => onSaveSettings({ ...appSettings, bossKeyEnabled: e.currentTarget.checked })} />
                      {t('settings.panic.enable')}
                    </label>
                    {appSettings.bossKeyEnabled && (
                      <div className="space-y-3 pl-1">
                        <label className="flex items-center gap-2 text-xs flex-wrap" style={{ color: "var(--color-text-muted)" }}>
                          {t('settings.panic.hotkey')}:
                          <select value={appSettings.bossKeyCode || 0x7A}
                            onChange={(e) => onSaveSettings({ ...appSettings, bossKeyCode: parseInt(e.currentTarget.value) })}
                            className="bg-transparent border rounded px-2 py-1 outline-none text-(--color-text)" style={{ borderColor: "var(--color-border)" }}>
                            {[...Array(11)].map((_, i) => (
                              <option key={i} value={0x70 + i} style={{ background: "var(--color-panel-2)" }}>F{i + 1}</option>
                            ))}
                          </select>
                        </label>
                        <label className="flex items-center gap-2 text-xs flex-wrap" style={{ color: "var(--color-text-muted)" }}>
                          {t('settings.panic.action')}:
                          <select value={appSettings.bossKeyAction || "hide"}
                            onChange={(e) => onSaveSettings({ ...appSettings, bossKeyAction: e.currentTarget.value as "hide" | "kill" })}
                            className="bg-transparent border rounded px-2 py-1 outline-none text-(--color-text)" style={{ borderColor: "var(--color-border)" }}>
                            <option value="hide" style={{ background: "var(--color-panel-2)" }}>{t('settings.panic.action_hide')}</option>
                            <option value="kill" style={{ background: "var(--color-panel-2)" }}>{t('settings.panic.action_kill')}</option>
                          </select>
                        </label>
                        <label className="flex items-center gap-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
                          <input type="checkbox" checked={appSettings.bossKeyMuteSystem}
                            onChange={(e) => onSaveSettings({ ...appSettings, bossKeyMuteSystem: e.currentTarget.checked })} />
                          {t('settings.panic.mute')}
                        </label>
                        <label className="text-xs block" style={{ color: "var(--color-text-muted)" }}>
                          {t('settings.panic.fallback')}
                          <input type="text" placeholder="e.g. notepad.exe or https://google.com" className="mt-1 w-full bg-transparent border rounded px-2 py-1 outline-none text-(--color-text)"
                            style={{ borderColor: "var(--color-border)" }} value={appSettings.bossKeyFallbackUrl || ""}
                            onChange={(e) => onSaveSettings({ ...appSettings, bossKeyFallbackUrl: e.currentTarget.value })} />
                        </label>
                      </div>
                    )}
                  </div>
                </SettingsSurface>

                <SettingsSurface
                  title={`${t('settings.export.title')} & ${t('settings.folders.title')}`}
                  description="Exports, library-folder visibility, update affordances, and changelog access."
                >
                  <div className="space-y-3">
                    <div className="flex gap-2">
                      <button onClick={onExportCSV} className="flex-1 py-2 rounded text-xs font-semibold" style={{ background: "var(--color-panel-3)", color: "var(--color-text)" }}>{t('settings.export.csv')}</button>
                      <button onClick={onExportHTML} className="flex-1 py-2 rounded text-xs font-semibold" style={{ background: "var(--color-panel-3)", color: "var(--color-text)" }}>{t('settings.export.html')}</button>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={onExportCloudState} className="flex-1 py-2 rounded text-xs font-semibold" style={{ background: "var(--color-panel-3)", color: "var(--color-text)" }}>
                        {t('settings.export.cloud_export')}
                      </button>
                      <button onClick={onImportCloudState} className="flex-1 py-2 rounded text-xs font-semibold" style={{ background: "var(--color-panel-3)", color: "var(--color-text)" }}>
                        {t('settings.export.cloud_import')}
                      </button>
                    </div>
                    <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--color-border)" }}>
                      {libraryFolders.length === 0 ? (
                        <p className="px-3 py-3 text-xs" style={{ color: "var(--color-text-dim)" }}>{t('settings.folders.none')}</p>
                      ) : (
                        libraryFolders.map((f) => {
                          const label = f.path.replace(/\\/g, "/").split("/").pop() ?? f.path;
                          return (
                            <div key={f.path} className="flex items-center gap-2 px-3 py-2 border-b last:border-0"
                              style={{ borderColor: "var(--color-border-soft)" }}>
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-dim)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                              </svg>
                              <span className="flex-1 text-xs truncate" style={{ color: "var(--color-text-muted)" }} title={f.path}>{label}</span>
                              <button onClick={() => onRemoveFolder(f.path)}
                                className="text-[11px] px-1.5 rounded"
                                style={{ color: "var(--color-text-dim)" }}
                                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--color-danger)")}
                                onMouseLeave={(e) => (e.currentTarget.style.color = "var(--color-text-dim)")}>×</button>
                            </div>
                          );
                        })
                      )}
                    </div>
                    {appUpdate && (
                      <button onClick={() => { onClose(); onAppUpdate(); }}
                        className="w-full py-2 rounded-lg text-sm px-3 flex items-center gap-2 font-semibold"
                        style={{ background: "var(--color-success-bg)", color: "var(--color-success)", border: "1px solid var(--color-success-border)" }}>
                        ↑ {t('settings.system.update_available', { version: appUpdate.version })}
                      </button>
                    )}
                    <button onClick={onOpenWhatsNew}
                      className="w-full py-2 rounded-lg text-sm px-3 flex items-center gap-2 font-semibold"
                      style={{ background: "var(--color-panel-3)", color: "var(--color-accent)", border: "1px solid var(--color-border)" }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 2L2 7l10 5 10-5-10-5z" />
                        <path d="M2 17l10 5 10-5" />
                        <path d="M2 12l10 5 10-5" />
                      </svg>
                      {t('whats_new.button')}
                    </button>
                  </div>
                </SettingsSurface>
              </div>
            </>
          )}

          {tab === "rss" && (
            <section className="space-y-4">
              <h3 className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>{t('settings.rss.title')}</h3>
              <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>{t('settings.rss.hint')}</p>
              <p className="text-[11px]" style={{ color: "var(--color-text-dim)" }}>
                {t('settings.rss.proxy_hint')}
              </p>

              <div className="space-y-2">
                {(appSettings.rssFeeds || defaultSettings.rssFeeds).map((feed, idx) => (
                  <div key={idx} className="flex gap-2 p-3 rounded" style={{ background: "var(--color-panel-alt)", border: "1px solid var(--color-border)" }}>
                    <div className="flex-1 space-y-2">
                      <label className="flex items-center gap-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
                        <input
                          type="checkbox"
                          checked={feed.enabled !== false}
                          onChange={(e) => {
                            const nextFeeds = [...(appSettings.rssFeeds || defaultSettings.rssFeeds)];
                            nextFeeds[idx] = { ...feed, enabled: e.currentTarget.checked };
                            onSaveSettings({ ...appSettings, rssFeeds: nextFeeds });
                          }}
                        />
                        {t('common.enabled')}
                      </label>
                      <input type="text" value={feed.name} placeholder={t('settings.rss.name')}
                        className="w-full bg-transparent text-sm font-semibold outline-none" style={{ color: "var(--color-text)" }}
                        onChange={(e) => {
                          const nextFeeds = [...(appSettings.rssFeeds || defaultSettings.rssFeeds)];
                          nextFeeds[idx] = { ...feed, name: (e.target as HTMLInputElement).value };
                          onSaveSettings({ ...appSettings, rssFeeds: nextFeeds });
                        }} />
                      <input type="text" value={feed.url} placeholder={t('settings.rss.url')}
                        className="w-full bg-transparent text-xs outline-none" style={{ color: "var(--color-text-muted)" }}
                        onChange={(e) => {
                          const nextFeeds = [...(appSettings.rssFeeds || defaultSettings.rssFeeds)];
                          nextFeeds[idx] = { ...feed, url: (e.target as HTMLInputElement).value };
                          onSaveSettings({ ...appSettings, rssFeeds: nextFeeds });
                        }} />
                    </div>
                    <button onClick={() => {
                      const nextFeeds = (appSettings.rssFeeds || defaultSettings.rssFeeds).filter((_, i) => i !== idx);
                      onSaveSettings({ ...appSettings, rssFeeds: nextFeeds });
                    }}
                      className="text-(--color-danger) hover:text-white mt-1" style={{ width: 24, height: 24 }}>✕</button>
                  </div>
                ))}

                <button onClick={() => {
                  const nextFeeds = [...(appSettings.rssFeeds || defaultSettings.rssFeeds), { name: "New Feed", url: "", enabled: true }];
                  onSaveSettings({ ...appSettings, rssFeeds: nextFeeds });
                }}
                  className="w-full py-2 flex items-center justify-center gap-2 rounded text-sm text-(--color-text) hover:text-white"
                  style={{ border: "1px dashed var(--color-border)" }}>
                  {t('settings.rss.add')}
                </button>
              </div>
            </section>
          )}

          {tab === "scanner" && (
            <section className="space-y-6">
              <div className="space-y-3">
                <h3 className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>{t('settings.scanner.title')}</h3>
                <p className="text-xs leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
                  {t('settings.scanner.force_rescan_hint')}
                </p>
                <div className="rounded-lg px-3 py-2.5 space-y-2"
                  style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>{t('settings.scanner.status')}</span>
                    <span className="text-[11px]" style={{ color: syncState === "idle" ? "var(--color-text-dim)" : "var(--color-accent)" }}>
                      {syncStatusText === "Idle" ? t('settings.scanner.idle') : syncStatusText}
                    </span>
                  </div>
                  {backgroundJobs.length > 0 && (
                    <div className="space-y-2">
                      {backgroundJobs.slice(0, 4).map((job) => {
                        const tone = jobTone(job.status);
                        return (
                          <div key={job.id} className="rounded px-2.5 py-2"
                            style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border-soft)" }}>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium flex-1" style={{ color: "var(--color-text)" }}>{job.label}</span>
                              <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide"
                                style={{ color: tone.fg, background: tone.bg }}>
                                {jobStatusLabel(job.status)}
                              </span>
                            </div>
                            {job.detail && (
                              <p className="text-[11px] mt-1 break-all" style={{ color: "var(--color-text-muted)" }}>{job.detail}</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                <button onClick={() => { onRescanAll(); onClose(); }}
                  disabled={syncState !== "idle"}
                  className="w-full py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-40"
                  style={{ background: "var(--color-border)", color: "var(--color-text)", border: "1px solid #3d7a9b" }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                  </svg>
                  {t('settings.scanner.force_rescan')}
                </button>
                <button onClick={() => { onClose(); onOpenMigrationWizard(); }}
                  className="w-full py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2"
                  style={{ background: "var(--color-panel-3)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 7h18" /><path d="M3 17h18" /><path d="M7 3l-4 4 4 4" /><path d="M17 13l4 4-4 4" />
                  </svg>
                  {t('common.migration.title')}
                </button>
                <button onClick={onRunIntegrityCheck} disabled={isIntegrityCheckBusy}
                  className="w-full py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-40"
                  style={{ background: "var(--color-panel-3)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 11l3 3L22 4" />
                    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                  </svg>
                  {integrityCheckStatus || t('settings.scanner.integrity_check')}
                </button>
                <button onClick={onAutoHealPaths} disabled={isAutoHealPathsBusy}
                  className="w-full py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-40"
                  style={{ background: "var(--color-panel-3)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 12a9 9 0 1 1-3.2-6.9" />
                    <path d="M21 3v6h-6" />
                    <path d="M9 12l2 2 4-4" />
                  </svg>
                  {autoHealPathsStatus || t('settings.scanner.auto_heal')}
                </button>
                <button onClick={() => { onClose(); onOpenRestoreSnapshots(); }}
                  className="w-full py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2"
                  style={{ background: "var(--color-panel-3)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 7v6h6" />
                    <path d="M21 17a9 9 0 1 1-2.64-6.36L21 13" />
                  </svg>
                  {t('settings.scanner.restore_snapshot')}
                </button>
              </div>

              <div className="space-y-3 border-t pt-4" style={{ borderColor: "var(--color-border-soft)" }}>
                <h3 className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>{t('settings.scanner.refetch_all')}</h3>
                <p className="text-xs leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
                  {t('settings.scanner.refetch_all_hint')}
                </p>
                <button onClick={onBatchMetadataRefresh} disabled={isBatchMetadataRefreshBusy}
                  className="w-full py-2.5 rounded text-sm font-semibold disabled:opacity-50"
                  style={{ background: "var(--color-accent-dark)", color: "var(--color-white)", border: "1px solid var(--color-accent-mid)" }}>
                  {batchRefreshStatus || t('settings.scanner.refetch_all')}
                </button>
                <label className="flex items-center gap-2 text-sm mt-3" style={{ color: "var(--color-text-muted)" }}>
                  {t('settings.scanner.metadata_older')}
                  <input type="number" min="0" className="w-12 px-1 py-1 bg-transparent border rounded outline-none text-center"
                    style={{ color: "var(--color-text)", borderColor: "var(--color-border)" }}
                    value={appSettings.metadataAutoRefetchDays || 0}
                    onChange={e => onSaveSettings({ ...appSettings, metadataAutoRefetchDays: Math.max(0, parseInt(e.currentTarget.value) || 0) })} />
                  {t('settings.scanner.days_disable')}
                </label>
              </div>
            </section>
          )}

          {tab === "import" && (
            <section className="space-y-3">
              <h3 className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>{t('settings.import.steam_playtime')}</h3>
              <p className="text-xs leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
                {t('settings.import.steam_playtime_hint')}
              </p>
              <button onClick={() => { onSteamImport(); onClose(); }}
                className="w-full py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2"
                style={{ background: "#1a3050", color: "var(--color-accent)", border: "1px solid #2a5080" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#1e3a60")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "#1a3050")}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12l5.84 2.41c.53-.32 1.14-.51 1.8-.51.07 0 .14 0 .21.01L12 10.5V10.42c0-2.52 2.04-4.58 4.56-4.58 2.52 0 4.56 2.04 4.56 4.58 0 2.52-2.04 4.56-4.56 4.56h-.1l-3.5 2.53c0 .06.01.12.01.18 0 1.89-1.53 3.42-3.42 3.42-1.67 0-3.07-1.2-3.36-2.79L2.17 14C3.14 18.55 7.15 22 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2z" />
                </svg>
                {t('settings.import.steam_playtime')}
              </button>
              <button onClick={() => { onSteamLibraryImport(); onClose(); }}
                className="w-full mt-2 py-2 rounded-lg text-sm font-medium"
                style={{ background: "#16263c", color: "#9ed2ff", border: "1px solid #2f4f76" }}>
                {t('settings.import.steam_library')}
              </button>

              <div className="pt-3 border-t" style={{ borderColor: "var(--color-border-soft)" }}>
                <h3 className="text-[10px] uppercase tracking-widest mb-2" style={{ color: "var(--color-text-dim)" }}>Epic Games Store / Legendary</h3>
                <p className="text-xs leading-relaxed mb-2" style={{ color: "var(--color-text-muted)" }}>
                  Fetch your Epic ownership list via Legendary, import installed titles, and keep uninstalled games as Legendary-backed placeholders.
                </p>
                <button
                  onClick={() => { onEpicImport(); onClose(); }}
                  className="w-full py-2 rounded-lg text-sm font-medium"
                  style={{ background: "#202630", color: "#f4f5f7", border: "1px solid #505766" }}
                >
                  Import Epic Games Store Library
                </button>
              </div>

              <div className="pt-3 border-t" style={{ borderColor: "var(--color-border-soft)" }}>
                <h3 className="text-[10px] uppercase tracking-widest mb-2" style={{ color: "var(--color-text-dim)" }}>{t('settings.import.lutris')}</h3>
                <p className="text-xs leading-relaxed mb-2" style={{ color: "var(--color-text-muted)" }}>
                  {t('settings.import.lutris_hint')}
                </p>
                <button
                  onClick={() => { onLutrisImport(); onClose(); }}
                  className="w-full py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2"
                  style={{ background: "#2a1f3a", color: "#b08ee8", border: "1px solid #5a3a8a" }}
                >
                  {t('settings.import.lutris')}
                </button>
              </div>

              <div className="pt-3 border-t" style={{ borderColor: "var(--color-border-soft)" }}>
                <h3 className="text-[10px] uppercase tracking-widest mb-2" style={{ color: "var(--color-text-dim)" }}>itch.io Butler</h3>
                <p className="text-xs leading-relaxed mb-2" style={{ color: "var(--color-text-muted)" }}>
                  Browse owned itch.io purchases, install them with butler, and apply updates inside Libmaly.
                </p>
                <button
                  onClick={() => { onItchImport(); onClose(); }}
                  className="w-full py-2 rounded-lg text-sm font-medium"
                  style={{ background: "#2b2316", color: "#ffcf8d", border: "1px solid #7b5a25" }}
                >
                  Open itch.io Butler
                </button>
              </div>

              <div className="pt-3 border-t" style={{ borderColor: "var(--color-border-soft)" }}>
                <h3 className="text-[10px] uppercase tracking-widest mb-2" style={{ color: "var(--color-text-dim)" }}>EA App / Ubisoft / Rockstar</h3>
                <p className="text-xs leading-relaxed mb-2" style={{ color: "var(--color-text-muted)" }}>
                  Detect installed launcher-managed games from Windows registry and local manifests, then keep a launcher protocol for "Launch from Store".
                </p>
                <button
                  onClick={() => { onProtocolStoreImport(); onClose(); }}
                  className="w-full py-2 rounded-lg text-sm font-medium"
                  style={{ background: "#2b1820", color: "#ffb4c9", border: "1px solid #7b3951" }}
                >
                  Import EA App / Ubisoft / Rockstar
                </button>
              </div>

              <div className="pt-3 border-t" style={{ borderColor: "var(--color-border-soft)" }}>
                <h3 className="text-[10px] uppercase tracking-widest mb-2" style={{ color: "var(--color-text-dim)" }}>GameJolt / Battle.net</h3>
                <p className="text-xs leading-relaxed mb-2" style={{ color: "var(--color-text-muted)" }}>
                  Experimental: scan local manifests and registry hints for installed titles, then enrich them with best-effort public store metadata.
                </p>
                <button
                  onClick={() => { onExoticImport(); onClose(); }}
                  className="w-full py-2 rounded-lg text-sm font-medium"
                  style={{ background: "#30261a", color: "#f2c97a", border: "1px solid #856634" }}
                >
                  Import GameJolt / Battle.net
                </button>
              </div>

              <div className="pt-3 border-t" style={{ borderColor: "var(--color-border-soft)" }}>
                <h3 className="text-[10px] uppercase tracking-widest mb-2" style={{ color: "var(--color-text-dim)" }}>{t('settings.import.playnite_gog')}</h3>
                <p className="text-xs leading-relaxed mb-2" style={{ color: "var(--color-text-muted)" }}>
                  {t('settings.import.playnite_gog_hint')}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => { onPlayniteImport(); onClose(); }}
                    className="flex-1 py-2 rounded-lg text-sm font-medium"
                    style={{ background: "#2a2440", color: "#bca8ff", border: "1px solid #4b3f79" }}
                  >
                    {t('settings.import.playnite')}
                  </button>
                  <button
                    onClick={() => { onGogImport(); onClose(); }}
                    className="flex-1 py-2 rounded-lg text-sm font-medium"
                    style={{ background: "#1e293f", color: "#89c4ff", border: "1px solid #3a567d" }}
                  >
                    {t('settings.import.gog')}
                  </button>
                </div>
              </div>
            </section>
          )}

          {tab === "ghost" && (
            <section className="space-y-4">
              <h3 className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>Ghost Mode (Local Only)</h3>
              <p className="text-xs leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
                Games marked as Ghost will never perform any network requests: no metadata refreshes, no update checks, no Discord RPC. All data stays local only.
              </p>

              <div className="flex gap-2">
                <button onClick={() => onToggleAllGhost(true)}
                  className="flex-1 py-2 rounded-lg text-sm font-medium"
                  style={{
                    background: "var(--color-accent-dark)",
                    color: "var(--color-white)",
                    border: "1px solid var(--color-accent)",
                  }}>
                  🔒 Enable Ghost Mode for ALL games
                </button>
                <button onClick={() => onToggleAllGhost(false)}
                  className="flex-1 py-2 rounded-lg text-sm font-medium"
                  style={{
                    background: "var(--color-panel-3)",
                    color: "var(--color-text)",
                    border: "1px solid var(--color-border)",
                  }}>
                  🔓 Disable Ghost Mode for ALL games
                </button>
              </div>

              <div className="space-y-2 max-h-100 overflow-y-auto pr-1" style={{ scrollbarWidth: "thin", scrollbarColor: "var(--color-border) transparent" }}>
                {games.length === 0 ? (
                  <p className="text-xs text-center py-4" style={{ color: "var(--color-text-dim)" }}>No games in library yet.</p>
                ) : (
                  games.map(game => (
                    <div key={game.path} className="flex items-center justify-between px-3 py-2 rounded" style={{ background: "var(--color-panel-3)" }}>
                      <span className="text-xs truncate flex-1" style={{ color: "var(--color-text)" }}>{game.name}</span>
                      <button onClick={() => onToggleGhost(game.path)}
                        className="px-2 py-1 rounded text-[10px] font-semibold"
                        style={{
                          background: ghostGames[game.path] ? "rgba(100, 150, 255, 0.2)" : "var(--color-panel-2)",
                          color: ghostGames[game.path] ? "var(--color-accent-soft)" : "var(--color-text-muted)",
                          border: `1px solid ${ghostGames[game.path] ? "var(--color-accent-soft)" : "var(--color-border)"}`,
                        }}>
                        {ghostGames[game.path] ? "👻 Ghost" : "Normal"}
                      </button>
                    </div>
                  ))
                )}
              </div>

              <p className="text-xs" style={{ color: "var(--color-text-dim)" }}>
                {Object.keys(ghostGames).length} / {games.length} games in Ghost mode
              </p>
            </section>
          )}

          {tab === "sync" && (
            <section className="space-y-3">
              <h3 className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>Sync Configuration</h3>
              
              {/* Provider Type Selection */}
              <div>
                <label className="block text-xs mb-1" style={{ color: "var(--color-text-muted)" }}>Provider Type</label>
                <select
                  value={syncProviderType}
                  onChange={(e) => setSyncProviderType((e.currentTarget as HTMLSelectElement).value as "webdav" | "nextcloud" | "s3" | "git" | "google-drive" | "dropbox")}
                  className="w-full px-2 py-1.5 rounded outline-none text-sm"
                  style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
                >
                  <option value="webdav">WebDAV</option>
                  <option value="nextcloud">Nextcloud</option>
                  <option value="google-drive">Google Drive</option>
                  <option value="dropbox">Dropbox</option>
                  <option value="s3">S3</option>
                  <option value="git">Git</option>
                </select>
              </div>

              {syncGuide && (
                <div className="rounded-lg p-3 space-y-2" style={{ background: "linear-gradient(180deg, var(--color-panel) 0%, var(--color-panel-2) 100%)", border: "1px solid var(--color-border)" }}>
                  <div>
                    <div className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>Mini Guide</div>
                    <div className="mt-1 text-sm font-semibold" style={{ color: "var(--color-text)" }}>{syncGuide.title}</div>
                    <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--color-text-muted)" }}>{syncGuide.intro}</p>
                  </div>
                  <div className="space-y-1">
                    {syncGuide.steps.map((step, index) => (
                      <div key={`step-${index}`} className="flex gap-2 text-xs leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
                        <span style={{ color: "var(--color-accent)", minWidth: 16 }}>{index + 1}.</span>
                        <span>{step}</span>
                      </div>
                    ))}
                  </div>
                  <div className="rounded p-2 space-y-1 text-xs" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--color-border-soft)", color: "var(--color-text-muted)" }}>
                    {syncGuide.tips.map((tip, index) => (
                      <div key={`tip-${index}`}>Tip: {tip}</div>
                    ))}
                  </div>
                </div>
              )}

              <div className="rounded-lg p-3 space-y-3" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
                <div>
                  <div className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>Auto-backup</div>
                  <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
                    Periodically uploads the current library state using the configured sync provider. Automatic scheduling is only enabled for Google Drive and Dropbox.
                  </p>
                </div>
                <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
                  <input
                    type="checkbox"
                    checked={appSettings.cloudAutoBackupEnabled}
                    disabled={!isAutoBackupProvider(syncProviderType) && !appSettings.cloudAutoBackupEnabled}
                    onChange={(e) => onSaveSettings({ ...appSettings, cloudAutoBackupEnabled: e.currentTarget.checked })}
                  />
                  Enable periodic cloud auto-backup
                </label>
                <label className="text-xs block" style={{ color: "var(--color-text-muted)" }}>
                  Interval (minutes)
                  <input
                    type="number"
                    min="5"
                    value={appSettings.cloudAutoBackupIntervalMinutes || 60}
                    onChange={(e) => onSaveSettings({
                      ...appSettings,
                      cloudAutoBackupIntervalMinutes: Math.max(5, parseInt(e.currentTarget.value) || 60),
                    })}
                    className="mt-1 w-full px-2 py-1.5 rounded outline-none text-sm"
                    style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
                  />
                </label>
                <div className="text-xs space-y-1" style={{ color: "var(--color-text-muted)" }}>
                  <div>Current provider: <span style={{ color: "var(--color-text)" }}>{getSyncProviderLabel(syncProviderType)}</span></div>
                  <div>Last successful auto-backup: <span style={{ color: "var(--color-text)" }}>{formatTimestamp(appSettings.cloudAutoBackupLastSuccessAt)}</span></div>
                  {autoCloudBackupStatus && (
                    <div>Background status: <span style={{ color: "var(--color-text)" }}>{autoCloudBackupStatus}</span></div>
                  )}
                  {!isAutoBackupProvider(syncProviderType) && (
                    <div style={{ color: "var(--color-warning)" }}>
                      Switch the provider to Google Drive or Dropbox to enable scheduled auto-backups.
                    </div>
                  )}
                </div>
                <button
                  onClick={onRunCloudBackupNow}
                  disabled={isCloudBackupNowBusy || !isAutoBackupProvider(syncProviderType)}
                  className="w-full py-2 rounded text-xs font-semibold disabled:opacity-50"
                  style={{ background: "var(--color-success)", color: "var(--color-white)" }}
                >
                  {isCloudBackupNowBusy ? (cloudBackupNowStatus || "Running backup...") : "Run Backup Now"}
                </button>
              </div>

              <div className="rounded-lg p-3 space-y-2" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
                <div className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>Save-file cloud sync</div>
                <p className="text-xs leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
                  Save zips can now be uploaded to the configured cloud provider. Open any game and use the new Cloud Save Zip action to create a fresh zip and push it into that provider's save-backups area.
                </p>
                <p className="text-[11px]" style={{ color: "var(--color-text-dim)" }}>
                  Path behavior: WebDAV, Nextcloud, S3, Git, and Dropbox store zips under a save-backups location next to the main state path. Google Drive stores them in the app data area with a save-backups prefix.
                </p>
              </div>

              {/* WebDAV / Nextcloud Configuration */}
              {(syncProviderType === "webdav" || syncProviderType === "nextcloud") && (
                <div className="space-y-2">
                  <div>
                    <label className="block text-xs mb-1" style={{ color: "var(--color-text-muted)" }}>URL</label>
                    <input
                      type="text"
                      value={webdavUrl}
                      onChange={(e) => setWebdavUrl((e.target as HTMLInputElement).value)}
                      placeholder={syncProviderType === "nextcloud" ? "https://nextcloud.example.com" : "https://dav.example.com"}
                      className="w-full px-2 py-1.5 rounded outline-none text-sm"
                      style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
                    />
                  </div>
                  <div>
                    <label className="block text-xs mb-1" style={{ color: "var(--color-text-muted)" }}>Username</label>
                    <input
                      type="text"
                      value={webdavUsername}
                      onChange={(e) => setWebdavUsername((e.target as HTMLInputElement).value)}
                      className="w-full px-2 py-1.5 rounded outline-none text-sm"
                      style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
                    />
                  </div>
                  <div>
                    <label className="block text-xs mb-1" style={{ color: "var(--color-text-muted)" }}>Password</label>
                    <input
                      type="password"
                      value={webdavPassword}
                      onChange={(e) => setWebdavPassword((e.target as HTMLInputElement).value)}
                      className="w-full px-2 py-1.5 rounded outline-none text-sm"
                      style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
                    />
                  </div>
                  <div>
                    <label className="block text-xs mb-1" style={{ color: "var(--color-text-muted)" }}>Path</label>
                    <input
                      type="text"
                      value={webdavPath}
                      onChange={(e) => setWebdavPath((e.target as HTMLInputElement).value)}
                      className="w-full px-2 py-1.5 rounded outline-none text-sm"
                      style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
                    />
                  </div>
                </div>
              )}

              {syncProviderType === "google-drive" && (
                <div className="space-y-2">
                  <div>
                    <label className="block text-xs mb-1" style={{ color: "var(--color-text-muted)" }}>Auth Method</label>
                    <select
                      value={googleDriveAuthMode}
                      onChange={(e) => setGoogleDriveAuthMode((e.currentTarget as HTMLSelectElement).value as "oauth" | "manual")}
                      className="w-full px-2 py-1.5 rounded outline-none text-sm"
                      style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
                    >
                      <option value="oauth">OAuth in browser</option>
                      <option value="manual">Manual access token</option>
                    </select>
                  </div>
                  {googleDriveAuthMode === "manual" && (
                    <div>
                      <label className="block text-xs mb-1" style={{ color: "var(--color-text-muted)" }}>Access Token</label>
                      <input
                        type="password"
                        value={googleDriveAccessToken}
                        onChange={(e) => setGoogleDriveAccessToken((e.target as HTMLInputElement).value)}
                        placeholder="Paste Google Drive access token"
                        className="w-full px-2 py-1.5 rounded outline-none text-sm"
                        style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
                      />
                    </div>
                  )}
                  {googleDriveAuthMode === "oauth" && (
                    <>
                  <div>
                    <label className="block text-xs mb-1" style={{ color: "var(--color-text-muted)" }}>OAuth Client ID</label>
                    <input
                      type="text"
                      value={googleDriveClientId}
                      onChange={(e) => setGoogleDriveClientId((e.target as HTMLInputElement).value)}
                      placeholder="Google desktop OAuth client ID"
                      className="w-full px-2 py-1.5 rounded outline-none text-sm"
                      style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
                    />
                  </div>
                  <div>
                    <label className="block text-xs mb-1" style={{ color: "var(--color-text-muted)" }}>AppData file name</label>
                    <input
                      type="text"
                      value={googleDriveFileName}
                      onChange={(e) => setGoogleDriveFileName((e.target as HTMLInputElement).value)}
                      className="w-full px-2 py-1.5 rounded outline-none text-sm"
                      style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
                    />
                  </div>
                  <div className="rounded p-2 text-xs" style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border)", color: "var(--color-text-muted)" }}>
                    <div>Connection status: <span style={{ color: "var(--color-text)" }}>{googleDriveAccessToken ? "Connected" : "Not connected"}</span></div>
                    <div>Refresh token: <span style={{ color: "var(--color-text)" }}>{googleDriveRefreshToken ? "Available" : "Missing"}</span></div>
                  </div>
                  <button
                    onClick={() => { void handleStartOAuth("google-drive"); }}
                    disabled={syncLoading}
                    className="w-full py-2 rounded text-xs font-semibold disabled:opacity-50"
                    style={{ background: "var(--color-accent)", color: "var(--color-white)" }}
                  >
                    {googleDriveAccessToken ? "Reconnect Google Drive" : "Connect Google Drive"}
                  </button>
                    </>
                  )}
                  <p className="text-xs" style={{ color: "var(--color-text-dim)" }}>
                    {googleDriveAuthMode === "oauth"
                      ? "The state file is stored in the account's hidden Drive app data folder. Create a desktop OAuth client in Google Cloud Console and paste its client ID here before connecting."
                      : "If getting an access token manually is easier for you, paste it here and save the configuration without using the browser OAuth flow."}
                  </p>
                </div>
              )}

              {syncProviderType === "dropbox" && (
                <div className="space-y-2">
                  <div>
                    <label className="block text-xs mb-1" style={{ color: "var(--color-text-muted)" }}>Auth Method</label>
                    <select
                      value={dropboxAuthMode}
                      onChange={(e) => setDropboxAuthMode((e.currentTarget as HTMLSelectElement).value as "oauth" | "manual")}
                      className="w-full px-2 py-1.5 rounded outline-none text-sm"
                      style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
                    >
                      <option value="oauth">OAuth in browser</option>
                      <option value="manual">Manual access token</option>
                    </select>
                  </div>
                  {dropboxAuthMode === "manual" && (
                    <div>
                      <label className="block text-xs mb-1" style={{ color: "var(--color-text-muted)" }}>Access Token</label>
                      <input
                        type="password"
                        value={dropboxAccessToken}
                        onChange={(e) => setDropboxAccessToken((e.target as HTMLInputElement).value)}
                        placeholder="Paste Dropbox access token"
                        className="w-full px-2 py-1.5 rounded outline-none text-sm"
                        style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
                      />
                    </div>
                  )}
                  {dropboxAuthMode === "oauth" && (
                    <>
                  <div>
                    <label className="block text-xs mb-1" style={{ color: "var(--color-text-muted)" }}>Dropbox App Key</label>
                    <input
                      type="text"
                      value={dropboxClientId}
                      onChange={(e) => setDropboxClientId((e.target as HTMLInputElement).value)}
                      placeholder="Dropbox app key"
                      className="w-full px-2 py-1.5 rounded outline-none text-sm"
                      style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
                    />
                  </div>
                  <div>
                    <label className="block text-xs mb-1" style={{ color: "var(--color-text-muted)" }}>Dropbox path</label>
                    <input
                      type="text"
                      value={dropboxPath}
                      onChange={(e) => setDropboxPath((e.target as HTMLInputElement).value)}
                      className="w-full px-2 py-1.5 rounded outline-none text-sm"
                      style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
                    />
                  </div>
                  <div className="rounded p-2 text-xs" style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border)", color: "var(--color-text-muted)" }}>
                    <div>Connection status: <span style={{ color: "var(--color-text)" }}>{dropboxAccessToken ? "Connected" : "Not connected"}</span></div>
                    <div>Refresh token: <span style={{ color: "var(--color-text)" }}>{dropboxRefreshToken ? "Available" : "Missing"}</span></div>
                  </div>
                  <button
                    onClick={() => { void handleStartOAuth("dropbox"); }}
                    disabled={syncLoading}
                    className="w-full py-2 rounded text-xs font-semibold disabled:opacity-50"
                    style={{ background: "var(--color-accent)", color: "var(--color-white)" }}
                  >
                    {dropboxAccessToken ? "Reconnect Dropbox" : "Connect Dropbox"}
                  </button>
                    </>
                  )}
                  <p className="text-xs" style={{ color: "var(--color-text-dim)" }}>
                    {dropboxAuthMode === "oauth"
                      ? "Use an absolute Dropbox path such as /Apps/Libmaly/libmaly-state.json. Create a scoped Dropbox app and paste its app key here before connecting."
                      : "If manual token management is easier for you, paste the Dropbox access token directly and save the configuration."}
                  </p>
                </div>
              )}

              {/* S3 Configuration */}
              {syncProviderType === "s3" && (
                <div className="space-y-2">
                  <div>
                    <label className="block text-xs mb-1" style={{ color: "var(--color-text-muted)" }}>Bucket</label>
                    <input
                      type="text"
                      value={s3Bucket}
                      onChange={(e) => setS3Bucket((e.target as HTMLInputElement).value)}
                      placeholder="my-libmaly-bucket"
                      className="w-full px-2 py-1.5 rounded outline-none text-sm"
                      style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
                    />
                  </div>
                  <div>
                    <label className="block text-xs mb-1" style={{ color: "var(--color-text-muted)" }}>Region</label>
                    <input
                      type="text"
                      value={s3Region}
                      onChange={(e) => setS3Region((e.target as HTMLInputElement).value)}
                      placeholder="us-east-1"
                      className="w-full px-2 py-1.5 rounded outline-none text-sm"
                      style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
                    />
                  </div>
                  <div>
                    <label className="block text-xs mb-1" style={{ color: "var(--color-text-muted)" }}>Access Key</label>
                    <input
                      type="text"
                      value={s3AccessKey}
                      onChange={(e) => setS3AccessKey((e.target as HTMLInputElement).value)}
                      className="w-full px-2 py-1.5 rounded outline-none text-sm"
                      style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
                    />
                  </div>
                  <div>
                    <label className="block text-xs mb-1" style={{ color: "var(--color-text-muted)" }}>Secret Key</label>
                    <input
                      type="password"
                      value={s3SecretKey}
                      onChange={(e) => setS3SecretKey((e.target as HTMLInputElement).value)}
                      className="w-full px-2 py-1.5 rounded outline-none text-sm"
                      style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
                    />
                  </div>
                  <div>
                    <label className="block text-xs mb-1" style={{ color: "var(--color-text-muted)" }}>Endpoint (optional for AWS, required for many S3-compatible providers)</label>
                    <input
                      type="text"
                      value={s3Endpoint}
                      onChange={(e) => setS3Endpoint((e.target as HTMLInputElement).value)}
                      placeholder="https://<account>.r2.cloudflarestorage.com"
                      className="w-full px-2 py-1.5 rounded outline-none text-sm"
                      style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
                    />
                  </div>
                  <div>
                    <label className="block text-xs mb-1" style={{ color: "var(--color-text-muted)" }}>Object Path</label>
                    <input
                      type="text"
                      value={s3Path}
                      onChange={(e) => setS3Path((e.target as HTMLInputElement).value)}
                      placeholder="libmaly-state.json"
                      className="w-full px-2 py-1.5 rounded outline-none text-sm"
                      style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
                    />
                  </div>
                </div>
              )}

              {/* Git Configuration */}
              {syncProviderType === "git" && (
                <div className="space-y-2">
                  <div>
                    <label className="block text-xs mb-1" style={{ color: "var(--color-text-muted)" }}>Repository URL</label>
                    <input
                      type="text"
                      value={gitUrl}
                      onChange={(e) => setGitUrl((e.target as HTMLInputElement).value)}
                      placeholder="https://github.com/user/repo.git"
                      className="w-full px-2 py-1.5 rounded outline-none text-sm"
                      style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
                    />
                  </div>
                  <div>
                    <label className="block text-xs mb-1" style={{ color: "var(--color-text-muted)" }}>Branch</label>
                    <input
                      type="text"
                      value={gitBranch}
                      onChange={(e) => setGitBranch((e.target as HTMLInputElement).value)}
                      className="w-full px-2 py-1.5 rounded outline-none text-sm"
                      style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
                    />
                  </div>
                  <div>
                    <label className="block text-xs mb-1" style={{ color: "var(--color-text-muted)" }}>Username (optional)</label>
                    <input
                      type="text"
                      value={gitUsername}
                      onChange={(e) => setGitUsername((e.target as HTMLInputElement).value)}
                      className="w-full px-2 py-1.5 rounded outline-none text-sm"
                      style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
                    />
                  </div>
                  <div>
                    <label className="block text-xs mb-1" style={{ color: "var(--color-text-muted)" }}>Password/Token (optional)</label>
                    <input
                      type="password"
                      value={gitPassword}
                      onChange={(e) => setGitPassword((e.target as HTMLInputElement).value)}
                      className="w-full px-2 py-1.5 rounded outline-none text-sm"
                      style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
                    />
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-2">
                <button
                  onClick={handleSyncSave}
                  disabled={syncLoading}
                  className="flex-1 py-2 rounded text-xs font-semibold disabled:opacity-50"
                  style={{ background: "var(--color-accent-dark)", color: "var(--color-white)" }}
                >
                  {syncLoading ? "Saving..." : "Save Configuration"}
                </button>
                <button
                  onClick={handleCheckRemote}
                  disabled={syncLoading || !syncConfig}
                  className="flex-1 py-2 rounded text-xs font-semibold disabled:opacity-50"
                  style={{ background: "var(--color-panel-3)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
                >
                  Check Remote
                </button>
              </div>

              {/* Remote Status */}
              {remoteExists !== null && (
                <div className={`p-2 rounded text-xs ${remoteExists ? "bg-green-900/50" : "bg-yellow-900/50"}`}>
                  <p style={{ color: "var(--color-white)" }}>
                    {remoteExists ? "Remote state exists" : "Remote state does not exist"}
                  </p>
                </div>
              )}

              {/* Sync Actions */}
              {syncConfig && (
                <div className="flex gap-2">
                  <button
                    onClick={handleSyncUpload}
                    disabled={syncLoading}
                    className="flex-1 py-2 rounded text-xs font-semibold disabled:opacity-50"
                    style={{ background: "var(--color-success)", color: "var(--color-white)" }}
                  >
                    {syncLoading ? "Uploading..." : "Upload"}
                  </button>
                  <button
                    onClick={handleSyncDownload}
                    disabled={syncLoading}
                    className="flex-1 py-2 rounded text-xs font-semibold disabled:opacity-50"
                    style={{ background: "var(--color-accent)", color: "var(--color-white)" }}
                  >
                    {syncLoading ? "Downloading..." : "Download"}
                  </button>
                </div>
              )}

              {/* Result Message */}
              {syncResult && (
                <div className={`p-2 rounded text-xs ${syncResult.success ? "bg-green-900/50" : "bg-red-900/50"}`}>
                  <p style={{ color: "var(--color-white)" }}>{syncResult.message}</p>
                  {syncResult.conflictsDetected && (
                    <p style={{ color: "var(--color-warning)" }} className="mt-1">
                      Conflicts detected. Please resolve manually.
                    </p>
                  )}
                </div>
              )}
            </section>
          )}

          {tab === "customcss" && (
            <section className="space-y-3">
              <h3 className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>Custom CSS</h3>
              <p className="text-xs leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
                Inject custom CSS to override the application's styling. Changes are applied immediately and persisted in localStorage.
              </p>
              <div className="space-y-2">
                <label className="block text-xs mb-1" style={{ color: "var(--color-text-muted)" }}>CSS Styles</label>
                <textarea
                  value={customCss}
                  onChange={(e) => setCustomCss((e.target as HTMLTextAreaElement).value)}
                  placeholder="/* Your custom CSS here */\n/* Example: .game-card { background: red; } */"
                  className="w-full h-64 px-3 py-2 rounded outline-none text-xs font-mono resize-none"
                  style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleSaveCustomCss}
                  disabled={cssSaving}
                  className="flex-1 py-2 rounded text-xs font-semibold disabled:opacity-50"
                  style={{ background: "var(--color-accent-dark)", color: "var(--color-white)" }}
                >
                  {cssSaving ? "Saving..." : "Apply CSS"}
                </button>
                <button
                  onClick={handleResetCustomCss}
                  className="flex-1 py-2 rounded text-xs font-semibold"
                  style={{ background: "var(--color-panel-3)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
                >
                  Reset
                </button>
              </div>
              <p className="text-xs" style={{ color: "var(--color-text-dim)" }}>
                💡 Tip: Use browser DevTools to inspect elements and find CSS selectors to override.
              </p>
            </section>
          )}

          {tab === "sources" && (
            <section className="space-y-4">
              <div className="space-y-2">
                <h3 className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>Universal Data-Source Engine</h3>
                <p className="text-xs leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
                  Import JSON templates that match URL patterns and extract metadata with CSS selectors, regex rules, or lightweight JS hooks.
                </p>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="p-3 rounded" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
                  <div className="text-[11px] font-semibold mb-2" style={{ color: "var(--color-text)" }}>Installed templates</div>
                  <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                    {customMetadataTemplates.length === 0 && (
                      <div className="text-xs" style={{ color: "var(--color-text-muted)" }}>No custom metadata templates installed yet.</div>
                    )}
                    {customMetadataTemplates.map((template) => (
                      <div key={template.id} className="p-3 rounded" style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border-soft)" }}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-xs font-semibold" style={{ color: "var(--color-text)" }}>{template.name}</div>
                            <div className="text-[11px] mt-1" style={{ color: "var(--color-text-dim)" }}>{template.id}</div>
                          </div>
                          <button
                            onClick={() => void handleDeleteCustomMetadataTemplate(template.id)}
                            disabled={customMetadataBusy}
                            className="px-2 py-1 rounded text-[11px] font-semibold disabled:opacity-50"
                            style={{ background: "var(--color-danger-bg)", color: "var(--color-danger-strong)", border: "1px solid var(--color-warning-border)" }}
                          >
                            Remove
                          </button>
                        </div>
                        {template.description && (
                          <p className="text-[11px] mt-2 leading-relaxed" style={{ color: "var(--color-text-muted)" }}>{template.description}</p>
                        )}
                        <div className="flex flex-wrap gap-2 mt-2 text-[10px] uppercase tracking-wide" style={{ color: "var(--color-text-dim)" }}>
                          <span>{template.fieldCount} field group(s)</span>
                          <span>{template.enabled ? "enabled" : "disabled"}</span>
                          {template.overrideBuiltin && <span>overrides built-ins</span>}
                        </div>
                        <div className="mt-2 text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                          {template.urlPatterns.slice(0, 2).join("\n")}
                          {template.urlPatterns.length > 2 && `\n+${template.urlPatterns.length - 2} more pattern(s)`}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="p-3 rounded space-y-3" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
                  <div className="text-[11px] font-semibold" style={{ color: "var(--color-text)" }}>Template JSON</div>
                  <textarea
                    value={customMetadataJson}
                    onChange={(e) => setCustomMetadataJson((e.target as HTMLTextAreaElement).value)}
                    placeholder={[
                      '{',
                      '  "id": "example-store",',
                      '  "name": "Example Store",',
                      '  "urlPatterns": ["https://example\\.com/game/.+"],',
                      '  "fields": {',
                      '    "title": [{ "type": "css", "selector": "h1" }],',
                      '    "cover_url": [{ "type": "css", "selector": "meta[property=\\"og:image\\"]", "attr": "content", "absoluteUrl": true }],',
                      '    "tags": [{ "type": "regex", "pattern": "Tags?:\\s*([^<]+)", "group": 1, "split": ",", "multiple": true }],',
                      '    "screenshots": [{ "type": "js", "selector": ".gallery img", "attr": "src", "multiple": true, "absoluteUrl": true, "script": "return values.filter(Boolean);" }]',
                      '  }',
                      '}'
                    ].join('\n')}
                    className="w-full h-72 px-3 py-2 rounded outline-none text-[11px] font-mono resize-none"
                    style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => void handleImportCustomMetadataJson()}
                      disabled={customMetadataBusy}
                      className="px-3 py-2 rounded text-xs font-semibold disabled:opacity-50"
                      style={{ background: "var(--color-accent-dark)", color: "var(--color-white)" }}
                    >
                      {customMetadataBusy ? "Working..." : "Import JSON"}
                    </button>
                    <button
                      onClick={() => void handleImportCustomMetadataFile()}
                      disabled={customMetadataBusy}
                      className="px-3 py-2 rounded text-xs font-semibold disabled:opacity-50"
                      style={{ background: "var(--color-panel-3)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
                    >
                      Import File
                    </button>
                    <button
                      onClick={() => void handleLoadInstalledCustomMetadataJson()}
                      disabled={customMetadataBusy}
                      className="px-3 py-2 rounded text-xs font-semibold disabled:opacity-50"
                      style={{ background: "var(--color-panel-3)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
                    >
                      Load Installed JSON
                    </button>
                    <button
                      onClick={() => void handleExportCustomMetadata()}
                      disabled={customMetadataBusy || customMetadataTemplates.length === 0}
                      className="px-3 py-2 rounded text-xs font-semibold disabled:opacity-50"
                      style={{ background: "var(--color-panel-3)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
                    >
                      Export All
                    </button>
                  </div>
                  {customMetadataStatus && (
                    <div className="p-2 rounded text-xs leading-relaxed" style={{ background: "var(--color-panel-2)", color: "var(--color-text-muted)", border: "1px solid var(--color-border-soft)" }}>
                      {customMetadataStatus}
                    </div>
                  )}
                  <div className="text-[11px] leading-relaxed" style={{ color: "var(--color-text-dim)" }}>
                    Supported field names: title, version, developer, publisher, overview, overview_html, cover_url, screenshots, tags, genres, relations, engine, os, language, censored, release_date, last_updated, rating, price, circle, series, author, illustration, voice_actor, music, age_rating, product_format, file_format, file_size.
                  </div>
                </div>
              </div>
            </section>
          )}

          {tab === "consistency" && (
            <section className="space-y-3">
              <h3 className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>Data & Release Reliability Tests</h3>
              <p className="text-xs leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
                Run storage integrity checks plus dry-run release scenarios for crash recovery, auto-heal, sync merge, metadata fallback, and backup restore.
              </p>
              
              <button
                onClick={runConsistencyTests}
                disabled={testsRunning}
                className="w-full py-2 rounded text-xs font-semibold disabled:opacity-50"
                style={{ background: "var(--color-accent-dark)", color: "var(--color-white)" }}
              >
                {testsRunning ? "Running Tests..." : "Run Consistency & Reliability Tests"}
              </button>

              {Object.keys(testResults).length > 0 && (
                <div className="space-y-2">
                  {Object.entries(testResults).map(([testName, result]) => (
                    <div
                      key={testName}
                      className="p-3 rounded"
                      style={{
                        background: result.passed ? "rgba(34, 197, 94, 0.1)" : "rgba(239, 68, 68, 0.1)",
                        border: `1px solid ${result.passed ? "var(--color-success-border)" : "var(--color-warning-border)"}`
                      }}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className={result.passed ? "text-green-400" : "text-red-400"}>
                          {result.passed ? "✓" : "✗"}
                        </span>
                        <span className="text-xs font-semibold" style={{ color: "var(--color-text)" }}>
                          {testName.replace(/_/g, " ").toUpperCase()}
                        </span>
                      </div>
                      <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                        {result.message}
                      </p>
                      {result.details && result.details.length > 0 && (
                        <ul className="text-xs mt-1 space-y-1" style={{ color: "var(--color-text-dim)" }}>
                          {result.details.map((detail, i) => (
                            <li key={i}>• {detail}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <p className="text-xs" style={{ color: "var(--color-text-dim)" }}>
                Tip: Run these checks before release candidates, after path migrations, and after changing sync or metadata configuration.
              </p>
            </section>
          )}

          {tab === "vault" && (
            <section className="space-y-4">
              <div className="rounded-lg p-4 space-y-3" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
                <h3 className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>OAuth & API Vault</h3>
                <p className="text-xs leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
                  Secrets now live in the OS credential vault and are scoped to the active Libmaly profile instead of plaintext files.
                </p>
                <div className="text-xs" style={{ color: "var(--color-text-dim)" }}>
                  Active profile: <span style={{ color: "var(--color-text)" }}>{activeLibraryProfileId || vaultSummary?.profileId || "default"}</span>
                </div>
                {vaultSummary && (
                  <div className="grid gap-2">
                    {Array.from(new Set(vaultSummary.entries.map((entry) => entry.group))).map((group) => {
                      const groupEntries = vaultSummary.entries.filter((entry) => entry.group === group);
                      const storedCount = groupEntries.filter((entry) => entry.hasValue).length;
                      return (
                        <div key={group} className="rounded p-2 text-xs" style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border-soft)", color: "var(--color-text-muted)" }}>
                          <div style={{ color: "var(--color-text)" }}>{group}</div>
                          <div>{storedCount}/{groupEntries.length} entries currently present in the secure vault.</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="rounded-lg p-4 space-y-3" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
                <h4 className="text-xs font-semibold" style={{ color: "var(--color-text)" }}>Storefront Sessions</h4>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3 text-xs" style={{ color: "var(--color-text-muted)" }}>
                    <span>F95zone cookies</span>
                    {f95LoggedIn ? (
                      <button onClick={onF95Logout} className="px-3 py-1 rounded" style={{ background: "var(--color-warning-bg)", color: "var(--color-warning)", border: "1px solid var(--color-warning-border)" }}>Clear Session</button>
                    ) : (
                      <button onClick={() => { onClose(); onF95Login(); }} className="px-3 py-1 rounded" style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}>Sign In</button>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-3 text-xs" style={{ color: "var(--color-text-muted)" }}>
                    <span>DLsite cookies</span>
                    {dlsiteLoggedIn ? (
                      <button onClick={onDLsiteLogout} className="px-3 py-1 rounded" style={{ background: "var(--color-danger-bg)", color: "var(--color-danger-strong)", border: "1px solid var(--color-danger-border)" }}>Clear Session</button>
                    ) : (
                      <button onClick={() => { onClose(); onDLsiteLogin(); }} className="px-3 py-1 rounded" style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}>Sign In</button>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-3 text-xs" style={{ color: "var(--color-text-muted)" }}>
                    <span>FAKKU cookies</span>
                    {fakkuLoggedIn ? (
                      <button onClick={onFakkuLogout} className="px-3 py-1 rounded" style={{ background: "#3b1f2f", color: "#da4c96", border: "1px solid #6a2d4b" }}>Clear Session</button>
                    ) : (
                      <button onClick={() => { onClose(); onFakkuLogin(); }} className="px-3 py-1 rounded" style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}>Sign In</button>
                    )}
                  </div>
                </div>
              </div>

              <h3 className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>Third-party API Keys</h3>
              <p className="text-xs leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
                Configure API keys for third-party metadata providers and helper integrations. These values are stored in the active profile's secure vault.
              </p>

              {/* IGDB */}
              <div className="rounded-lg p-4 space-y-3" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
                <h4 className="text-xs font-semibold" style={{ color: "var(--color-text)" }}>IGDB (Internet Game Database)</h4>
                <p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                  Requires Twitch Client ID and Client Secret. Get credentials from <a href="https://dev.twitch.tv/console" target="_blank" rel="noopener noreferrer" style={{ color: "var(--color-accent)" }}>Twitch Developer Console</a>.
                </p>
                <div className="space-y-2">
                  <div>
                    <label className="text-[11px] block mb-1" style={{ color: "var(--color-text-dim)" }}>Client ID</label>
                    <input
                      type="text"
                      value={igdbClientId}
                      onChange={(e) => setIgdbClientId((e.target as HTMLInputElement).value)}
                      placeholder="Enter IGDB Client ID"
                      className="w-full px-3 py-2 rounded text-xs bg-transparent border outline-none"
                      style={{ background: "var(--color-panel-2)", color: "var(--color-text)", borderColor: "var(--color-border)" }}
                    />
                  </div>
                  <div>
                    <label className="text-[11px] block mb-1" style={{ color: "var(--color-text-dim)" }}>Client Secret</label>
                    <input
                      type="password"
                      value={igdbClientSecret}
                      onChange={(e) => setIgdbClientSecret((e.target as HTMLInputElement).value)}
                      placeholder="Enter IGDB Client Secret"
                      className="w-full px-3 py-2 rounded text-xs bg-transparent border outline-none"
                      style={{ background: "var(--color-panel-2)", color: "var(--color-text)", borderColor: "var(--color-border)" }}
                    />
                  </div>
                  <button
                    onClick={async () => {
                      setApiKeySaving(true);
                      try {
                        await invoke("set_api_key", { provider: "igdb_client_id", key: igdbClientId });
                        await invoke("set_api_key", { provider: "igdb_client_secret", key: igdbClientSecret });
                        await loadVaultSummary();
                      } catch (e) {
                        console.error("Failed to save IGDB keys:", e);
                      }
                      setApiKeySaving(false);
                    }}
                    disabled={apiKeySaving}
                    className="w-full py-1.5 rounded text-xs font-medium disabled:opacity-50"
                    style={{ background: "var(--color-accent-dark)", color: "var(--color-white)" }}
                  >
                    {apiKeySaving ? "Saving..." : "Save IGDB Keys"}
                  </button>
                </div>
              </div>

              {/* RAWG */}
              <div className="rounded-lg p-4 space-y-3" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
                <h4 className="text-xs font-semibold" style={{ color: "var(--color-text)" }}>RAWG.io</h4>
                <p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                  Requires API key. Get your key from <a href="https://rawg.io/apidocs" target="_blank" rel="noopener noreferrer" style={{ color: "var(--color-accent)" }}>RAWG API documentation</a>.
                </p>
                <div className="space-y-2">
                  <div>
                    <label className="text-[11px] block mb-1" style={{ color: "var(--color-text-dim)" }}>API Key</label>
                    <input
                      type="password"
                      value={rawgApiKey}
                      onChange={(e) => setRawgApiKey((e.target as HTMLInputElement).value)}
                      placeholder="Enter RAWG API Key"
                      className="w-full px-3 py-2 rounded text-xs bg-transparent border outline-none"
                      style={{ background: "var(--color-panel-2)", color: "var(--color-text)", borderColor: "var(--color-border)" }}
                    />
                  </div>
                  <button
                    onClick={async () => {
                      setApiKeySaving(true);
                      try {
                        await invoke("set_api_key", { provider: "rawg", key: rawgApiKey });
                        await loadVaultSummary();
                      } catch (e) {
                        console.error("Failed to save RAWG key:", e);
                      }
                      setApiKeySaving(false);
                    }}
                    disabled={apiKeySaving}
                    className="w-full py-1.5 rounded text-xs font-medium disabled:opacity-50"
                    style={{ background: "var(--color-accent-dark)", color: "var(--color-white)" }}
                  >
                    {apiKeySaving ? "Saving..." : "Save RAWG Key"}
                  </button>
                </div>
              </div>

              {/* MobyGames */}
              <div className="rounded-lg p-4 space-y-3" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
                <h4 className="text-xs font-semibold" style={{ color: "var(--color-text)" }}>MobyGames</h4>
                <p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                  Requires API key. Request your key from <a href="https://www.mobygames.com/info/api/" target="_blank" rel="noopener noreferrer" style={{ color: "var(--color-accent)" }}>MobyGames API page</a>.
                </p>
                <div className="space-y-2">
                  <div>
                    <label className="text-[11px] block mb-1" style={{ color: "var(--color-text-dim)" }}>API Key</label>
                    <input
                      type="password"
                      value={mobygamesApiKey}
                      onChange={(e) => setMobygamesApiKey((e.target as HTMLInputElement).value)}
                      placeholder="Enter MobyGames API Key"
                      className="w-full px-3 py-2 rounded text-xs bg-transparent border outline-none"
                      style={{ background: "var(--color-panel-2)", color: "var(--color-text)", borderColor: "var(--color-border)" }}
                    />
                  </div>
                  <button
                    onClick={async () => {
                      setApiKeySaving(true);
                      try {
                        await invoke("set_api_key", { provider: "mobygames", key: mobygamesApiKey });
                        await loadVaultSummary();
                      } catch (e) {
                        console.error("Failed to save MobyGames key:", e);
                      }
                      setApiKeySaving(false);
                    }}
                    disabled={apiKeySaving}
                    className="w-full py-1.5 rounded text-xs font-medium disabled:opacity-50"
                    style={{ background: "var(--color-accent-dark)", color: "var(--color-white)" }}
                  >
                    {apiKeySaving ? "Saving..." : "Save MobyGames Key"}
                  </button>
                </div>
              </div>

              <div className="rounded-lg p-4 space-y-3" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
                <h4 className="text-xs font-semibold" style={{ color: "var(--color-text)" }}>itch.io Butler</h4>
                <p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                  Optional API key cache for owned-library browsing and install flows. The itch import modal reuses the active profile's vault entry.
                </p>
                <div className="space-y-2">
                  <div>
                    <label className="text-[11px] block mb-1" style={{ color: "var(--color-text-dim)" }}>API Key</label>
                    <input
                      type="password"
                      value={itchApiKey}
                      onChange={(e) => setItchApiKey((e.target as HTMLInputElement).value)}
                      placeholder="Enter itch.io API Key"
                      className="w-full px-3 py-2 rounded text-xs bg-transparent border outline-none"
                      style={{ background: "var(--color-panel-2)", color: "var(--color-text)", borderColor: "var(--color-border)" }}
                    />
                  </div>
                  <button
                    onClick={async () => {
                      setApiKeySaving(true);
                      try {
                        await invoke("set_api_key", { provider: "itch_io", key: itchApiKey });
                        await loadVaultSummary();
                      } catch (e) {
                        console.error("Failed to save itch.io key:", e);
                      }
                      setApiKeySaving(false);
                    }}
                    disabled={apiKeySaving}
                    className="w-full py-1.5 rounded text-xs font-medium disabled:opacity-50"
                    style={{ background: "var(--color-accent-dark)", color: "var(--color-white)" }}
                  >
                    {apiKeySaving ? "Saving..." : "Save itch.io Key"}
                  </button>
                </div>
              </div>

              <div className="rounded-lg p-4 space-y-3" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
                <h4 className="text-xs font-semibold" style={{ color: "var(--color-text)" }}>SteamGridDB</h4>
                <p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                  API key for artwork sync (covers, heroes, logos, icons). Get your key from <a href="https://www.steamgriddb.com/profile/preferences/api" target="_blank" rel="noopener noreferrer" style={{ color: "var(--color-accent)" }}>SteamGridDB API Preferences</a>.
                </p>
                <div className="space-y-2">
                  <div>
                    <label className="text-[11px] block mb-1" style={{ color: "var(--color-text-dim)" }}>API Key</label>
                    <input
                      type="password"
                      value={steamGridDbApiKey}
                      onChange={(e) => setSteamGridDbApiKey((e.target as HTMLInputElement).value)}
                      placeholder="Enter SteamGridDB API Key"
                      className="w-full px-3 py-2 rounded text-xs bg-transparent border outline-none"
                      style={{ background: "var(--color-panel-2)", color: "var(--color-text)", borderColor: "var(--color-border)" }}
                    />
                  </div>
                  <button
                    onClick={async () => {
                      setApiKeySaving(true);
                      try {
                        await invoke("set_api_key", { provider: "steamgriddb", key: steamGridDbApiKey });
                        await loadVaultSummary();
                      } catch (e) {
                        console.error("Failed to save SteamGridDB key:", e);
                      }
                      setApiKeySaving(false);
                    }}
                    disabled={apiKeySaving}
                    className="w-full py-1.5 rounded text-xs font-medium disabled:opacity-50"
                    style={{ background: "var(--color-accent-dark)", color: "var(--color-white)" }}
                  >
                    {apiKeySaving ? "Saving..." : "Save SteamGridDB Key"}
                  </button>
                </div>
              </div>

              <div className="rounded-lg p-4 space-y-2" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
                <h4 className="text-xs font-semibold" style={{ color: "var(--color-text)" }}>Sync Vault Status</h4>
                <p className="text-[11px] leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
                  Sync passwords, access tokens, refresh tokens, and cloud credentials are now stored in the secure OS vault for the current profile. The Sync tab still edits the provider configuration, but secret values are no longer written into plaintext `sync_config.json`.
                </p>
                <div className="text-xs" style={{ color: "var(--color-text-dim)" }}>
                  Current sync provider: <span style={{ color: "var(--color-text)" }}>{syncConfig ? getSyncProviderLabel(syncConfig.provider) : "Not configured"}</span>
                </div>
              </div>
            </section>
          )}

          {tab === "wine" && platform !== "windows" && (
            <section className="space-y-3">
              <h3 className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>{t('settings.wine.title')}</h3>
              <p className="text-xs leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
                Configure the Wine or Proton runtime used to launch Windows games on Linux or macOS.
              </p>
              <button onClick={() => { onWineSettings(); onClose(); }}
                className="w-full py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2"
                style={{
                  background: launchConfig.enabled ? "#2a1f3a" : "var(--color-panel)",
                  color: launchConfig.enabled ? "#b08ee8" : "var(--color-text-muted)",
                  border: `1px solid ${launchConfig.enabled ? "#5a3a8a" : "var(--color-border)"}`,
                }}>
                🍷 {launchConfig.enabled ? `${launchConfig.runner.charAt(0).toUpperCase() + launchConfig.runner.slice(1)} active — Change…` : "Configure Wine / Proton…"}
              </button>
            </section>
          )}

          {tab === "emulators" && (
            <EmulatorProfilesTab
              emulatorProfiles={emulatorProfiles}
              onSaveEmulatorProfiles={onSaveEmulatorProfiles}
            />
          )}

          {tab === "metarules" && (
            <MetadataRulesTab
              metadataRules={metadataRules}
              onSaveMetadataRules={onSaveMetadataRules}
            />
          )}
        </div>
      </div>
      </div>
      {syncConflictReport && (
        <SyncConflictModal
          report={syncConflictReport}
          onResolve={(result) => {
            setSyncConflictReport(null);
            setSyncResult(result);
          }}
          onCancel={() => setSyncConflictReport(null)}
        />
      )}
    </>
  );
}

// ─── Emulator Profiles Tab ───────────────────────────────────────────────────

function createEmulatorProfileDraft(): EmulatorProfile {
  return {
    id: `emu-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: "",
    emulatorPath: "",
    args: "\"{rom}\"",
    corePath: "",
    extensions: [],
  };
}

function EmulatorProfilesTab({
  emulatorProfiles,
  onSaveEmulatorProfiles,
}: {
  emulatorProfiles: EmulatorProfile[];
  onSaveEmulatorProfiles: (profiles: EmulatorProfile[]) => void;
}) {
  const [draft, setDraft] = useState<EmulatorProfile[]>(
    () => emulatorProfiles.map((p) => ({ ...p, extensions: [...(p.extensions ?? [])] }))
  );
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDraft(emulatorProfiles.map((p) => ({ ...p, extensions: [...(p.extensions ?? [])] })));
  }, [emulatorProfiles]);

  const update = (id: string, patch: Partial<EmulatorProfile>) => {
    setDraft((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  const remove = (id: string) => {
    setDraft((prev) => prev.filter((p) => p.id !== id));
  };

  const saveProfiles = () => {
    const cleaned = draft
      .map((p) => ({
        ...p,
        name: p.name.trim(),
        emulatorPath: p.emulatorPath.trim(),
        args: p.args.trim() || "\"{rom}\"",
        corePath: p.corePath?.trim() || undefined,
        extensions: p.extensions.map((e) => e.trim().toLowerCase()).filter(Boolean),
      }))
      .filter((p) => p.name && p.emulatorPath);
    onSaveEmulatorProfiles(cleaned);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <section className="space-y-5">
      <h3 className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>
        Emulator Profiles
      </h3>
      <p className="text-xs leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
        Configure executable + argument templates for ROM launches. Supported tokens: {"{rom}"}, {"{core}"}, {"{dir}"}, {"{name}"}.
      </p>

      <div className="space-y-3">
        {draft.length === 0 && (
          <p className="text-[11px]" style={{ color: "var(--color-text-dim)" }}>No emulator profiles configured.</p>
        )}
        {draft.map((profile) => (
          <div key={profile.id} className="rounded-lg p-4 space-y-2" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
            <div className="flex items-center justify-between gap-2">
              <input
                type="text"
                placeholder="Profile name (e.g. RetroArch GBA)"
                value={profile.name}
                onInput={(e) => update(profile.id, { name: (e.target as HTMLInputElement).value })}
                className="flex-1 px-3 py-2 rounded text-xs outline-none"
                style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
              />
              <button
                onClick={() => remove(profile.id)}
                className="px-2.5 py-2 rounded text-xs"
                style={{ background: "var(--color-panel-3)", color: "var(--color-danger-strong)", border: "1px solid var(--color-border-strong)" }}
              >
                Delete
              </button>
            </div>

            <input
              type="text"
              placeholder="Path to emulator executable..."
              value={profile.emulatorPath}
              onInput={(e) => update(profile.id, { emulatorPath: (e.target as HTMLInputElement).value })}
              className="w-full px-3 py-2 rounded text-xs outline-none font-mono"
              style={{ background: "var(--color-bg-code)", color: "var(--color-text)", border: "1px solid var(--color-border-soft)" }}
            />

            <input
              type="text"
              placeholder='Args template (default: "{rom}")'
              value={profile.args}
              onInput={(e) => update(profile.id, { args: (e.target as HTMLInputElement).value })}
              className="w-full px-3 py-2 rounded text-xs outline-none font-mono"
              style={{ background: "var(--color-bg-code)", color: "var(--color-text)", border: "1px solid var(--color-border-soft)" }}
            />

            <input
              type="text"
              placeholder="RetroArch core path (optional; used by {core})"
              value={profile.corePath ?? ""}
              onInput={(e) => update(profile.id, { corePath: (e.target as HTMLInputElement).value })}
              className="w-full px-3 py-2 rounded text-xs outline-none font-mono"
              style={{ background: "var(--color-bg-code)", color: "var(--color-text)", border: "1px solid var(--color-border-soft)" }}
            />

            <input
              type="text"
              placeholder="Extensions (comma-separated): gba,gb,gbc"
              value={(profile.extensions ?? []).join(", ")}
              onInput={(e) => update(profile.id, { extensions: (e.target as HTMLInputElement).value.split(",") })}
              className="w-full px-3 py-2 rounded text-xs outline-none"
              style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
            />
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => setDraft((prev) => [...prev, createEmulatorProfileDraft()])}
          className="px-3 py-2 rounded text-xs"
          style={{ background: "var(--color-panel-3)", color: "var(--color-text)", border: "1px solid var(--color-border-strong)" }}
        >
          + Add profile
        </button>
        <button
          onClick={saveProfiles}
          className="px-4 py-2 rounded text-xs font-semibold"
          style={{ background: "var(--color-accent-dark)", color: "var(--color-white)" }}
        >
          {saved ? "✓ Saved" : "Save Emulator Profiles"}
        </button>
      </div>
    </section>
  );
}

// ─── Metadata Rules Tab ───────────────────────────────────────────────────────

const ALL_SOURCES = ["f95", "dlsite", "vndb", "mangagamer", "johren", "fakku", "igdb", "rawg", "mobygames"];
const METADATA_CLEANUP_FIELDS: MetadataCleanupField[] = [
  "*", "title", "developer", "publisher", "overview", "engine", "version", "release_date", "circle", "tags", "genres",
];
const CLEANUP_RULE_TYPES: MetadataCleanupRuleType[] = [
  "regex_replace", "trim_prefix", "trim_suffix", "strip_brackets", "exclude_item", "lowercase_all", "uppercase_first",
];

function makeRuleId() {
  return `rule-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function MetadataRulesTab({
  metadataRules,
  onSaveMetadataRules,
}: {
  metadataRules: MetadataPostProcessingConfig;
  onSaveMetadataRules: (cfg: MetadataPostProcessingConfig) => void;
}) {
  const [draft, setDraft] = useState<MetadataPostProcessingConfig>(() => ({
    globalSourceOrder: metadataRules.globalSourceOrder.length
      ? [...metadataRules.globalSourceOrder]
      : [...ALL_SOURCES],
    fieldSourceOverrides: metadataRules.fieldSourceOverrides.map((o) => ({ ...o, sources: [...o.sources] })),
    cleanupRules: metadataRules.cleanupRules.map((r) => ({ ...r })),
  }));
  const [saved, setSaved] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [newOverrideField, setNewOverrideField] = useState<MetadataCleanupField>("title");

  const save = () => {
    const cfg: MetadataPostProcessingConfig = {
      ...draft,
      // If global order is unchanged from default, store empty (use default)
      globalSourceOrder: JSON.stringify(draft.globalSourceOrder) === JSON.stringify(ALL_SOURCES) ? [] : draft.globalSourceOrder,
    };
    onSaveMetadataRules(cfg);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const moveSource = (idx: number, dir: -1 | 1) => {
    const next = [...draft.globalSourceOrder];
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= next.length) return;
    [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
    setDraft({ ...draft, globalSourceOrder: next });
  };

  const resetSourceOrder = () => {
    setDraft({ ...draft, globalSourceOrder: [...ALL_SOURCES] });
  };

  const addFieldOverride = () => {
    if (draft.fieldSourceOverrides.find((o) => o.field === newOverrideField)) return;
    setDraft({
      ...draft,
      fieldSourceOverrides: [
        ...draft.fieldSourceOverrides,
        { field: newOverrideField, sources: [...ALL_SOURCES] },
      ],
    });
  };

  const removeFieldOverride = (field: MetadataCleanupField) => {
    setDraft({ ...draft, fieldSourceOverrides: draft.fieldSourceOverrides.filter((o) => o.field !== field) });
  };

  const moveOverrideSource = (field: MetadataCleanupField, srcIdx: number, dir: -1 | 1) => {
    setDraft({
      ...draft,
      fieldSourceOverrides: draft.fieldSourceOverrides.map((o) => {
        if (o.field !== field) return o;
        const next = [...o.sources];
        const swapIdx = srcIdx + dir;
        if (swapIdx < 0 || swapIdx >= next.length) return o;
        [next[srcIdx], next[swapIdx]] = [next[swapIdx], next[srcIdx]];
        return { ...o, sources: next };
      }),
    });
  };

  const addRule = () => {
    const newRule: MetadataCleanupRule = {
      id: makeRuleId(),
      enabled: true,
      field: "*",
      type: "regex_replace",
      pattern: "",
      replacement: "",
      description: "",
    };
    setDraft({ ...draft, cleanupRules: [...draft.cleanupRules, newRule] });
    setEditingRuleId(newRule.id);
  };

  const deleteRule = (id: string) => {
    setDraft({ ...draft, cleanupRules: draft.cleanupRules.filter((r) => r.id !== id) });
    if (editingRuleId === id) setEditingRuleId(null);
  };

  const toggleRule = (id: string) => {
    setDraft({ ...draft, cleanupRules: draft.cleanupRules.map((r) => r.id === id ? { ...r, enabled: !r.enabled } : r) });
  };

  const updateRule = (id: string, patch: Partial<MetadataCleanupRule>) => {
    setDraft({ ...draft, cleanupRules: draft.cleanupRules.map((r) => r.id === id ? { ...r, ...patch } : r) });
  };

  const inputCls = "w-full px-2 py-1.5 rounded text-xs bg-transparent border outline-none";
  const inputStyle = { background: "var(--color-panel-2)", color: "var(--color-text)", borderColor: "var(--color-border)" };
  const selectStyle = { background: "var(--color-panel-2)", color: "var(--color-text)", borderColor: "var(--color-border)" };

  const needsPattern = (type: MetadataCleanupRuleType) =>
    ["regex_replace", "trim_prefix", "trim_suffix", "exclude_item"].includes(type);
  const needsReplacement = (type: MetadataCleanupRuleType) => type === "regex_replace";

  return (
    <section className="space-y-6">
      <h3 className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>
        Metadata Post-processing Rules
      </h3>

      {/* ── Global Source Priority ───────────────────────────────────── */}
      <div className="rounded-lg p-4 space-y-3" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold" style={{ color: "var(--color-text)" }}>Source Priority</h4>
          <button
            onClick={resetSourceOrder}
            className="text-[11px] px-2 py-0.5 rounded"
            style={{ color: "var(--color-text-dim)", background: "var(--color-panel-2)", border: "1px solid var(--color-border)" }}
          >
            Reset to default
          </button>
        </div>
        <p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
          Drag-free reorder: use arrows. Topmost sources are preferred when no per-field override applies.
        </p>
        <div className="space-y-1">
          {draft.globalSourceOrder.map((src, idx) => (
            <div key={src} className="flex items-center gap-2 px-2 py-1 rounded" style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border-soft)" }}>
              <span className="text-xs font-mono flex-1" style={{ color: "var(--color-text)" }}>{src}</span>
              <button onClick={() => moveSource(idx, -1)} disabled={idx === 0} className="text-xs px-1 disabled:opacity-30" style={{ color: "var(--color-text-dim)" }}>▲</button>
              <button onClick={() => moveSource(idx, 1)} disabled={idx === draft.globalSourceOrder.length - 1} className="text-xs px-1 disabled:opacity-30" style={{ color: "var(--color-text-dim)" }}>▼</button>
            </div>
          ))}
        </div>
      </div>

      {/* ── Per-field Source Overrides ────────────────────────────────── */}
      <div className="rounded-lg p-4 space-y-3" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
        <h4 className="text-xs font-semibold" style={{ color: "var(--color-text)" }}>Per-field Source Overrides</h4>
        <p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
          Override which source is preferred for a specific field, independent of the global order.
        </p>
        <div className="flex items-center gap-2">
          <select
            value={newOverrideField}
            onChange={(e) => setNewOverrideField((e.target as HTMLSelectElement).value as MetadataCleanupField)}
            className="flex-1 px-2 py-1.5 rounded text-xs border outline-none"
            style={selectStyle}
          >
            {METADATA_CLEANUP_FIELDS.filter((f) => f !== "*").map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
          <button
            onClick={addFieldOverride}
            disabled={!!draft.fieldSourceOverrides.find((o) => o.field === newOverrideField)}
            className="px-3 py-1.5 rounded text-xs font-medium disabled:opacity-40"
            style={{ background: "var(--color-accent-dark)", color: "var(--color-white)" }}
          >
            Add override
          </button>
        </div>
        {draft.fieldSourceOverrides.length === 0 && (
          <p className="text-[11px]" style={{ color: "var(--color-text-dim)" }}>No overrides configured.</p>
        )}
        {draft.fieldSourceOverrides.map((override) => (
          <div key={override.field} className="rounded p-3 space-y-2" style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border-soft)" }}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold" style={{ color: "var(--color-accent)" }}>{override.field}</span>
              <button onClick={() => removeFieldOverride(override.field)} className="text-[11px]" style={{ color: "var(--color-danger-strong)" }}>Remove</button>
            </div>
            <div className="space-y-1">
              {override.sources.map((src, idx) => (
                <div key={src} className="flex items-center gap-2 px-2 py-0.5 rounded" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border-soft)" }}>
                  <span className="text-xs font-mono flex-1" style={{ color: "var(--color-text)" }}>{src}</span>
                  <button onClick={() => moveOverrideSource(override.field, idx, -1)} disabled={idx === 0} className="text-xs px-1 disabled:opacity-30" style={{ color: "var(--color-text-dim)" }}>▲</button>
                  <button onClick={() => moveOverrideSource(override.field, idx, 1)} disabled={idx === override.sources.length - 1} className="text-xs px-1 disabled:opacity-30" style={{ color: "var(--color-text-dim)" }}>▼</button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* ── Cleanup Rules ─────────────────────────────────────────────── */}
      <div className="rounded-lg p-4 space-y-3" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold" style={{ color: "var(--color-text)" }}>Cleanup Rules</h4>
          <button
            onClick={addRule}
            className="px-3 py-1 rounded text-xs font-medium"
            style={{ background: "var(--color-accent-dark)", color: "var(--color-white)" }}
          >
            + Add Rule
          </button>
        </div>
        <p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
          Applied in order after metadata is merged. String fields support regex replace, trim, case transforms. Array fields support all of the above plus exclude-by-pattern.
        </p>
        {draft.cleanupRules.length === 0 && (
          <p className="text-[11px]" style={{ color: "var(--color-text-dim)" }}>No cleanup rules defined.</p>
        )}
        {draft.cleanupRules.map((rule) => (
          <div key={rule.id} className="rounded p-3 space-y-2" style={{ background: "var(--color-panel-2)", border: `1px solid ${rule.enabled ? "var(--color-border)" : "var(--color-border-soft)"}`, opacity: rule.enabled ? 1 : 0.6 }}>
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={rule.enabled} onChange={() => toggleRule(rule.id)} className="accent-[var(--color-accent)]" />
              <span className="text-[11px] flex-1 truncate" style={{ color: "var(--color-text-muted)" }}>
                {rule.description || `${rule.type} on ${rule.field}`}
              </span>
              <button onClick={() => setEditingRuleId(editingRuleId === rule.id ? null : rule.id)} className="text-[11px] px-2 py-0.5 rounded" style={{ color: "var(--color-text-dim)", background: "var(--color-panel)", border: "1px solid var(--color-border-soft)" }}>
                {editingRuleId === rule.id ? "Collapse" : "Edit"}
              </button>
              <button onClick={() => deleteRule(rule.id)} className="text-[11px] px-2 py-0.5 rounded" style={{ color: "var(--color-danger-strong)", background: "var(--color-panel)", border: "1px solid var(--color-border-soft)" }}>
                Delete
              </button>
            </div>
            {editingRuleId === rule.id && (
              <div className="space-y-2 pt-1">
                <div className="flex gap-2">
                  <div className="flex-1 space-y-1">
                    <label className="text-[11px]" style={{ color: "var(--color-text-dim)" }}>Field</label>
                    <select value={rule.field} onChange={(e) => updateRule(rule.id, { field: (e.target as HTMLSelectElement).value as MetadataCleanupField })} className="w-full px-2 py-1.5 rounded text-xs border outline-none" style={selectStyle}>
                      {METADATA_CLEANUP_FIELDS.map((f) => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </div>
                  <div className="flex-1 space-y-1">
                    <label className="text-[11px]" style={{ color: "var(--color-text-dim)" }}>Type</label>
                    <select value={rule.type} onChange={(e) => updateRule(rule.id, { type: (e.target as HTMLSelectElement).value as MetadataCleanupRuleType })} className="w-full px-2 py-1.5 rounded text-xs border outline-none" style={selectStyle}>
                      {CLEANUP_RULE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                </div>
                {needsPattern(rule.type) && (
                  <div className="space-y-1">
                    <label className="text-[11px]" style={{ color: "var(--color-text-dim)" }}>Pattern {rule.type === "regex_replace" || rule.type === "exclude_item" ? "(regex)" : "(literal)"}</label>
                    <input value={rule.pattern ?? ""} onChange={(e) => updateRule(rule.id, { pattern: (e.target as HTMLInputElement).value })} placeholder="pattern…" className={inputCls} style={inputStyle} />
                  </div>
                )}
                {needsReplacement(rule.type) && (
                  <div className="space-y-1">
                    <label className="text-[11px]" style={{ color: "var(--color-text-dim)" }}>Replacement (leave empty to delete matches)</label>
                    <input value={rule.replacement ?? ""} onChange={(e) => updateRule(rule.id, { replacement: (e.target as HTMLInputElement).value })} placeholder="replacement…" className={inputCls} style={inputStyle} />
                  </div>
                )}
                <div className="space-y-1">
                  <label className="text-[11px]" style={{ color: "var(--color-text-dim)" }}>Description (optional)</label>
                  <input value={rule.description ?? ""} onChange={(e) => updateRule(rule.id, { description: (e.target as HTMLInputElement).value })} placeholder="Description…" className={inputCls} style={inputStyle} />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ── Save ──────────────────────────────────────────────────────── */}
      <button
        onClick={save}
        className="w-full py-2 rounded-lg text-sm font-medium"
        style={{ background: "var(--color-accent-dark)", color: "var(--color-white)" }}
      >
        {saved ? "✓ Saved" : "Save Metadata Rules"}
      </button>
    </section>
  );
}

// ─── Version Timeline ─────────────────────────────────────────────────────────

// ─── Game Detail ──────────────────────────────────────────────────────────────

// ─── Main App ─────────────────────────────────────────────────────────────────

export { MigrationWizardModal, SettingsModal };
