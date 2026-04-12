import { useEffect, useMemo, useState } from "preact/hooks";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { addCustomLanguage, loadCustomLanguages, removeCustomLanguage } from "../../i18n";
import {
  syncConfigure,
  syncGetConfig,
  syncUpload,
  syncDownload,
  syncCheckRemote,
  type SyncProviderConfig,
  type SyncResult,
  type WebdavConfig,
  type NextcloudConfig,
  type S3Config,
  type GitConfig,
  createWebdavConfig,
  createNextcloudConfig,
  createS3Config,
  createGitConfig,
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
type ThemeMode = "dark" | "light" | "oled" | "mint-apple" | "hanami" | "dawn" | "sunset" | "crimson-moon" | "sepia" | "cotton-candy" | "ocean-deep"
  | "citrus-sherbert" | "retro-raincloud" | "sunrise" | "lofi-vibes" | "desert-khaki"
  | "chroma-glow" | "forest" | "midnight-blurple" | "mars" | "dusk" | "retro-storm" | "neon-nights" | "strawberry-lemonade" | "aurora" | "blurple-twilight"
  | "custom";
interface AppSettingsLike {
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
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.8)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="rounded-xl shadow-2xl w-[640px] max-w-[92vw] max-h-[85vh] flex flex-col"
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

// ─── Settings Modal ────────────────────────────────────────────────────────────
function SettingsModal({
  games, ghostGames, onToggleGhost, onToggleAllGhost,
  f95LoggedIn, dlsiteLoggedIn, fakkuLoggedIn, libraryFolders, syncState, platform, launchConfig,
  appUpdate, appSettings,
  defaultSettings,
  onF95Login, onF95Logout, onDLsiteLogin, onDLsiteLogout, onFakkuLogin, onFakkuLogout, onRemoveFolder,
  onRescanAll, onWineSettings, onSteamImport, onSteamLibraryImport, onLutrisImport, onPlayniteImport, onGogImport, onAppUpdate, onOpenWhatsNew, onSaveSettings, onOpenMigrationWizard, onClose,
  onRunIntegrityCheck, onOpenRestoreSnapshots, onExportCSV, onExportHTML, onExportCloudState, onImportCloudState, onBatchMetadataRefresh, batchRefreshStatus, integrityCheckStatus,
  backgroundJobs, syncStatusText, isIntegrityCheckBusy, isBatchMetadataRefreshBusy, onAutoHealPaths, autoHealPathsStatus, isAutoHealPathsBusy,
  onApplyBackupRetentionPolicy, backupRetentionStatus, isBackupRetentionBusy,
  onRunDbVacuum, dbVacuumStatus, isDbVacuumBusy,
  discordSnapshot, onOpenDiscordSettings
  , libraryProfiles, activeLibraryProfileId, onSwitchLibraryProfile, onSaveLibraryProfile, onDeleteLibraryProfile
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
  onRescanAll: () => void; onWineSettings: () => void; onSteamImport: () => void; onSteamLibraryImport: () => void; onLutrisImport: () => void; onPlayniteImport: () => void; onGogImport: () => void;
  onAppUpdate: () => void; onOpenWhatsNew: () => void; onSaveSettings: (s: AppSettingsLike) => void; onOpenMigrationWizard: () => void; onClose: () => void;
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
  discordSnapshot: DiscordSdkSnapshotLike | null;
  onOpenDiscordSettings: () => void;
  libraryProfiles: LibraryProfileLike[];
  activeLibraryProfileId: string;
  onSwitchLibraryProfile: (profileId: string) => void;
  onSaveLibraryProfile: (profile: LibraryProfileDraftLike) => Promise<void> | void;
  onDeleteLibraryProfile: (profileId: string) => Promise<void> | void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"general" | "scanner" | "import" | "rss" | "ghost" | "sync" | "customcss" | "wine">("general");
  const [customLangs, setCustomLangs] = useState<Record<string, { name: string; translation: Record<string, unknown> }>>({});
  const [langImporting, setLangImporting] = useState(false);

  // Sync state
  const [syncProviderType, setSyncProviderType] = useState<"webdav" | "nextcloud" | "s3" | "git">("webdav");
  const [syncConfig, setSyncConfig] = useState<SyncProviderConfig | null>(null);
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
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

  // Custom CSS state
  const [customCss, setCustomCss] = useState("");
  const [cssSaving, setCssSaving] = useState(false);

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
        }
      }
    } catch (error) {
      console.error("Failed to load sync config:", error);
    } finally {
      setSyncLoading(false);
    }
  };

  useEffect(() => {
    loadSyncConfig();
  }, []);

  // Load custom CSS from localStorage and apply it
  useEffect(() => {
    const savedCss = localStorage.getItem("libmaly_custom_css") || "";
    setCustomCss(savedCss);
    applyCustomCss(savedCss);
  }, []);

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
      setSyncResult({ success: true, message: "Configuration saved", conflictsDetected: false, entriesSynced: 0 });
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
  const tabs: { id: typeof tab; label: string }[] = [
    { id: "general", label: t('settings.tabs.general') },
    { id: "scanner", label: t('settings.tabs.scanner') },
    { id: "import", label: t('settings.tabs.import') },
    { id: "rss", label: t('settings.tabs.rss') },
    { id: "ghost", label: "👻 Ghost Mode" },
    { id: "sync", label: "🔄 Sync" },
    { id: "customcss", label: "🎨 Custom CSS" },
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
  return (
    <div className="fixed inset-0 z-[9990] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.75)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rounded-xl shadow-2xl flex flex-col overflow-hidden"
        style={{ width: 480, maxHeight: "80vh", background: "var(--color-bg)", border: "1px solid var(--color-border)" }}>

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b flex-shrink-0" style={{ borderColor: "var(--color-border-soft)" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          <h2 className="font-bold text-base flex-1" style={{ color: "var(--color-white)" }}>{t('common.settings')}</h2>
          <button onClick={onClose} style={{ color: "var(--color-text-dim)", fontSize: 18, lineHeight: 1 }}>✕</button>
        </div>

        {/* Tab bar */}
        <div className="flex gap-0.5 px-4 pt-3 flex-shrink-0">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className="px-3 py-1.5 rounded-t text-xs font-medium"
              style={{
                background: tab === t.id ? "var(--color-bg-elev)" : "transparent",
                color: tab === t.id ? "var(--color-accent)" : "var(--color-text-dim)",
                borderBottom: tab === t.id ? "2px solid var(--color-accent)" : "2px solid transparent",
              }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4"
          style={{ background: "var(--color-bg-elev)", scrollbarWidth: "thin", scrollbarColor: "var(--color-border) transparent" }}>

          {tab === "general" && (
            <>
              <section className="space-y-2">
                <h3 className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>{t('settings.language')}</h3>
                <select
                  value={appSettings.language || "en"}
                  onChange={(e) => onSaveSettings({ ...appSettings, language: e.currentTarget.value })}
                  className="w-full px-3 py-2 rounded-lg text-sm bg-transparent border outline-none"
                  style={{ background: "var(--color-panel)", color: "var(--color-text)", borderColor: "var(--color-border)" }}
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
                <div className="flex gap-2">
                  <button
                    onClick={handleImportLanguage}
                    disabled={langImporting}
                    className="flex-1 py-1.5 rounded text-xs flex items-center justify-center gap-1.5 disabled:opacity-50"
                    style={{ background: "var(--color-panel-3)", color: "var(--color-accent)", border: "1px solid var(--color-border)" }}
                    title="Import a custom language JSON file"
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
                      className="py-1.5 px-3 rounded text-xs flex items-center justify-center gap-1"
                      style={{ background: "var(--color-danger-bg)", color: "var(--color-danger)", border: "1px solid var(--color-danger-border)" }}
                      title="Remove this custom language"
                    >
                      ✕
                    </button>
                  )}
                </div>
                {Object.keys(customLangs).length > 0 && (
                  <p className="text-[9px]" style={{ color: "var(--color-text-dim)" }}>
                    💡 Custom languages: {Object.keys(customLangs).map(c => customLangs[c].name).join(", ")}
                  </p>
                )}
              </section>

              <section className="space-y-3">
                <h3 className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>{t('settings.profiles.title')}</h3>
                <div className="rounded-lg p-3 space-y-3" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
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
                      style={{ background: "var(--color-panel-2)", color: "var(--color-text)", borderColor: "var(--color-border)" }}
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
                  <p className="text-[11px] leading-relaxed" style={{ color: "var(--color-text-dim)" }}>
                    {t('settings.profiles.description')}
                  </p>
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>F95zone</h3>
                {f95LoggedIn ? (
                  <div className="flex items-center justify-between rounded-lg px-3 py-2.5"
                    style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full" style={{ background: "var(--color-warning)" }} />
                      <span className="text-sm" style={{ color: "var(--color-warning)" }}>{t('settings.accounts.logged_in')}</span>
                    </div>
                    <button onClick={onF95Logout}
                      className="text-xs px-3 py-1 rounded"
                      style={{ background: "var(--color-warning-bg)", color: "var(--color-warning)", border: "1px solid var(--color-warning-border)" }}>
                      {t('settings.accounts.sign_out')}
                    </button>
                  </div>
                ) : (
                  <button onClick={() => { onClose(); onF95Login(); }}
                    className="w-full py-2 rounded-lg text-sm text-left px-3 flex items-center gap-2"
                    style={{ background: "var(--color-panel)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><polyline points="10 17 15 12 10 7" /><line x1="15" y1="12" x2="3" y2="12" />
                    </svg>
                    {t('settings.accounts.sign_in', { name: "F95zone" })}
                  </button>
                )}
              </section>

              {/* DLsite */}
              <section className="space-y-2">
                <h3 className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>DLsite</h3>
                {dlsiteLoggedIn ? (
                  <div className="flex items-center justify-between rounded-lg px-3 py-2.5"
                    style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full" style={{ background: "var(--color-danger-strong)" }} />
                      <span className="text-sm" style={{ color: "var(--color-danger-strong)" }}>{t('settings.accounts.logged_in')}</span>
                    </div>
                    <button onClick={onDLsiteLogout}
                      className="text-xs px-3 py-1 rounded"
                      style={{ background: "var(--color-danger-bg)", color: "var(--color-danger-strong)", border: "1px solid #6a2020" }}>
                      {t('settings.accounts.sign_out')}
                    </button>
                  </div>
                ) : (
                  <button onClick={() => { onClose(); onDLsiteLogin(); }}
                    className="w-full py-2 rounded-lg text-sm text-left px-3 flex items-center gap-2"
                    style={{ background: "var(--color-panel)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>
                    <div className="w-5 h-5 rounded flex items-center justify-center text-[9px] font-bold flex-shrink-0"
                      style={{ background: "var(--color-danger-strong)", color: "var(--color-white)" }}>DL</div>
                    {t('settings.accounts.sign_in', { name: "DLsite" })}
                    <span className="ml-auto text-[9px]" style={{ color: "var(--color-text-dim)" }}>{t('settings.accounts.age_gate')}</span>
                  </button>
                )}
              </section>

              <section className="space-y-2">
                <h3 className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>FAKKU</h3>
                {fakkuLoggedIn ? (
                  <div className="flex items-center justify-between rounded-lg px-3 py-2.5"
                    style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full" style={{ background: "#da4c96" }} />
                      <span className="text-sm" style={{ color: "#da4c96" }}>{t('settings.accounts.logged_in')}</span>
                    </div>
                    <button onClick={onFakkuLogout}
                      className="text-xs px-3 py-1 rounded"
                      style={{ background: "#3b1f2f", color: "#da4c96", border: "1px solid #6a2d4b" }}>
                      {t('settings.accounts.sign_out')}
                    </button>
                  </div>
                ) : (
                  <button onClick={() => { onClose(); onFakkuLogin(); }}
                    className="w-full py-2 rounded-lg text-sm text-left px-3 flex items-center gap-2"
                    style={{ background: "var(--color-panel)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>
                    <div className="w-5 h-5 rounded flex items-center justify-center text-[9px] font-bold flex-shrink-0"
                      style={{ background: "#da4c96", color: "var(--color-white)" }}>FK</div>
                    {t('settings.accounts.sign_in', { name: "FAKKU" })}
                    <span className="ml-auto text-[9px]" style={{ color: "var(--color-text-dim)" }}>{t('settings.accounts.age_check_bypass')}</span>
                  </button>
                )}
              </section>

              <section className="space-y-3 mt-4 border-t pt-4" style={{ borderColor: "var(--color-border-soft)" }}>
                <h3 className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>{t('settings.system.title')}</h3>
                <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
                  <input type="checkbox" checked={appSettings.startupWithWindows}
                    onChange={(e) => onSaveSettings({ ...appSettings, startupWithWindows: e.currentTarget.checked })} />
                  {t('settings.system.startup')}
                </label>
                <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
                  <input type="checkbox" checked={appSettings.updateCheckerEnabled}
                    onChange={(e) => onSaveSettings({ ...appSettings, updateCheckerEnabled: e.currentTarget.checked })} />
                  {t('settings.system.updates')}
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
                <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-text-muted)" }} title="When disabled, Surprise me only opens a random game page without launching it">
                  <input type="checkbox" checked={appSettings.surpriseLaunchesImmediately}
                    onChange={(e) => onSaveSettings({ ...appSettings, surpriseLaunchesImmediately: e.currentTarget.checked })} />
                  {t('settings.system.surprise_launch')}
                </label>
                <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
                  <input type="checkbox" checked={appSettings.blurNsfwContent}
                    onChange={(e) => onSaveSettings({ ...appSettings, blurNsfwContent: e.currentTarget.checked })} />
                  {t('settings.system.blur_nsfw')}
                </label>
                <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
                  {t('settings.system.rating_scale')}
                  <select
                    value={appSettings.ratingScale}
                    onChange={(e) => onSaveSettings({ ...appSettings, ratingScale: (e.currentTarget.value as RatingScale) })}
                    className="ml-2 px-2 py-1 rounded text-xs outline-none"
                    style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
                  >
                    <option value="10">{t('settings.system.rating_scale_options.10')}</option>
                    <option value="10_decimal">{t('settings.system.rating_scale_options.10_decimal')}</option>
                    <option value="100">{t('settings.system.rating_scale_options.100')}</option>
                    <option value="5_star">{t('settings.system.rating_scale_options.5_star')}</option>
                    <option value="3_smiley">{t('settings.system.rating_scale_options.3_smiley')}</option>
                  </select>
                </label>
                <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-text-muted)" }} title="Automatically take a screenshot while a game is running">
                  {t('settings.system.auto_screenshot')}
                  <input type="number" min="0" className="w-12 px-1 py-1 bg-transparent border rounded outline-none text-center ml-2"
                    style={{ color: "var(--color-text)", borderColor: "var(--color-border)" }}
                    value={appSettings.autoScreenshotInterval || 0}
                    onChange={e => onSaveSettings({ ...appSettings, autoScreenshotInterval: Math.max(0, parseInt(e.currentTarget.value) || 0) })} />
                  <span className="text-[10px] ml-2" style={{ color: "var(--color-text-dim)" }}>{t('settings.system.disable_hint')}</span>
                </label>
                <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-text-muted)" }} title="Create a ZIP backup of detected save files when a game session ends">
                  <input
                    type="checkbox"
                    checked={appSettings.saveBackupOnExit}
                    onChange={(e) => onSaveSettings({ ...appSettings, saveBackupOnExit: e.currentTarget.checked })}
                  />
                  {t('settings.system.backup_on_exit')}
                </label>
                <div className="rounded-lg p-3 space-y-3" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
                  <div>
                    <div className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>{t('settings.system.sidebar_layout')}</div>
                    <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
                      {t('settings.system.sidebar_description')}
                    </p>
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
                </div>
                <div className="rounded-lg p-3 space-y-3" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
                  <div>
                    <div className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>{t('settings.system.discord_sdk')}</div>
                    <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
                      {t('settings.system.discord_description')}
                    </p>
                  </div>
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
                        {t('settings.system.discord_last_error')}: {discordSnapshot.lastError}
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
                <div className="rounded-lg p-3 space-y-3" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
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
                    style={{ background: "var(--color-panel-3)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
                    title="Prune old logs, trim the file-ops journal, and remove any orphaned temp files from the app data folder">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
                      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                    </svg>
                    {dbVacuumStatus || "Optimize Storage"}
                  </button>
                </div>
              </section>

              <section className="space-y-3 mt-4 border-t pt-4" style={{ borderColor: "var(--color-border-soft)" }}>
                <h3 className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>{t('settings.appearance.title')}</h3>
                <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
                  {t('settings.appearance.schedule')}
                  <select
                    className="ml-2 bg-transparent border rounded px-2 py-1 outline-none text-[var(--color-text)]"
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
                  <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
                    {t('settings.appearance.theme')}
                    <select
                      className="ml-2 bg-transparent border rounded px-2 py-1 outline-none text-[var(--color-text)]"
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
                  <>
                    <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
                      {t('settings.appearance.day_theme')}
                      <select
                        className="ml-2 bg-transparent border rounded px-2 py-1 outline-none text-[var(--color-text)]"
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
                    <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
                      {t('settings.appearance.night_theme')}
                      <select
                        className="ml-2 bg-transparent border rounded px-2 py-1 outline-none text-[var(--color-text)]"
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
                    <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
                      {t('settings.appearance.light_starts')}
                      <input
                        type="number"
                        min="0"
                        max="23"
                        className="ml-2 w-14 bg-transparent border rounded px-2 py-1 outline-none text-[var(--color-text)]"
                        style={{ borderColor: "var(--color-border)" }}
                        value={Math.max(0, Math.min(23, appSettings.lightStartHour ?? defaultSettings.lightStartHour))}
                        onChange={(e) => onSaveSettings({ ...appSettings, lightStartHour: Math.max(0, Math.min(23, parseInt(e.currentTarget.value) || 0)) })}
                      />
                      <span className="text-[11px]" style={{ color: "var(--color-text-dim)" }}>00-23</span>
                    </label>
                    <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
                      {t('settings.appearance.night_theme')}
                      <input
                        type="number"
                        min="0"
                        max="23"
                        className="ml-2 w-14 bg-transparent border rounded px-2 py-1 outline-none text-[var(--color-text)]"
                        style={{ borderColor: "var(--color-border)" }}
                        value={Math.max(0, Math.min(23, appSettings.darkStartHour ?? defaultSettings.darkStartHour))}
                        onChange={(e) => onSaveSettings({ ...appSettings, darkStartHour: Math.max(0, Math.min(23, parseInt(e.currentTarget.value) || 0)) })}
                      />
                      <span className="text-[11px]" style={{ color: "var(--color-text-dim)" }}>00-23</span>
                    </label>
                  </>
                )}
                <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
                  {t('settings.appearance.seasonal')}
                  <select
                    className="ml-2 bg-transparent border rounded px-2 py-1 outline-none text-[var(--color-text)]"
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
                <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
                  {t('settings.appearance.accent')}
                  <input
                    type="color"
                    className="ml-2 w-8 h-6 border rounded cursor-pointer"
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
                    className="ml-1 w-24 bg-transparent border rounded px-2 py-1 outline-none text-[var(--color-text)] font-mono text-xs"
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
                </label>

                {appSettings.themeMode === "custom" && (
                  <div className="mt-4 p-3 rounded-lg space-y-4" style={{ background: "var(--color-panel-alt)", border: "1px dashed var(--color-border-strong)" }}>
                    <div>
                      <h4 className="text-xs font-bold mb-1" style={{ color: "var(--color-white)" }}>{t('settings.custom_theme.title')}</h4>
                      <p className="text-[10px]" style={{ color: "var(--color-text-dim)" }}>
                        {t('settings.custom_theme.hint')}
                      </p>
                    </div>

                    <div className="space-y-4">
                      {/* --- Backgrounds --- */}
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

                      {/* --- Panels --- */}
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

                      {/* --- Text --- */}
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

                      {/* --- Borders --- */}
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
              </section>

              <section className="space-y-3 mt-4 border-t pt-4" style={{ borderColor: "var(--color-border-soft)" }}>
                <h3 className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>{t('settings.panic.title')}</h3>
                <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-text-muted)" }} title={t('settings.panic.hint')}>
                  <input type="checkbox" checked={appSettings.bossKeyEnabled}
                    onChange={(e) => onSaveSettings({ ...appSettings, bossKeyEnabled: e.currentTarget.checked })} />
                  {t('settings.panic.enable')}
                </label>
                {appSettings.bossKeyEnabled && (
                  <div className="pl-6 space-y-3 mt-2">
                    <label className="flex items-center gap-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
                      {t('settings.panic.hotkey')}:
                      <select value={appSettings.bossKeyCode || 0x7A}
                        onChange={(e) => onSaveSettings({ ...appSettings, bossKeyCode: parseInt(e.currentTarget.value) })}
                        className="bg-transparent border rounded px-2 py-1 outline-none text-[var(--color-text)]" style={{ borderColor: "var(--color-border)" }}>
                        {[...Array(11)].map((_, i) => (
                          <option key={i} value={0x70 + i} style={{ background: "var(--color-panel-2)" }}>F{i + 1}</option>
                        ))}
                      </select>
                    </label>
                    <label className="flex items-center gap-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
                      {t('settings.panic.action')}:
                      <select value={appSettings.bossKeyAction || "hide"}
                        onChange={(e) => onSaveSettings({ ...appSettings, bossKeyAction: e.currentTarget.value as "hide" | "kill" })}
                        className="bg-transparent border rounded px-2 py-1 outline-none text-[var(--color-text)]" style={{ borderColor: "var(--color-border)" }}>
                        <option value="hide" style={{ background: "var(--color-panel-2)" }}>{t('settings.panic.action_hide')}</option>
                        <option value="kill" style={{ background: "var(--color-panel-2)" }}>{t('settings.panic.action_kill')}</option>
                      </select>
                    </label>
                    <label className="flex items-center gap-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
                      <input type="checkbox" checked={appSettings.bossKeyMuteSystem}
                        onChange={(e) => onSaveSettings({ ...appSettings, bossKeyMuteSystem: e.currentTarget.checked })} />
                      {t('settings.panic.mute')}
                    </label>
                    <label className="flex items-center gap-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
                      {t('settings.panic.fallback')}:
                      <input type="text" placeholder="e.g. notepad.exe or https://google.com" className="bg-transparent border rounded px-2 py-1 outline-none flex-1 text-[var(--color-text)]"
                        style={{ borderColor: "var(--color-border)" }} value={appSettings.bossKeyFallbackUrl || ""}
                        onChange={(e) => onSaveSettings({ ...appSettings, bossKeyFallbackUrl: e.currentTarget.value })} />
                    </label>
                  </div>
                )}
              </section>

              <section className="space-y-4 mt-4 border-t pt-4" style={{ borderColor: "var(--color-border-soft)" }}>
                <h3 className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>{t('settings.export.title')}</h3>
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
                <p className="text-[10px]" style={{ color: "var(--color-text-dim)" }}>
                  {t('settings.export.hint')}
                </p>
              </section>

              <section className="space-y-2 mt-4 border-t pt-4" style={{ borderColor: "var(--color-border-soft)" }}>
                <h3 className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>{t('settings.folders.title')}</h3>
                <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--color-border)" }}>
                  {libraryFolders.length === 0 ? (
                    <p className="px-3 py-3 text-xs" style={{ color: "var(--color-text-dim)" }}>{t('settings.folders.none')}</p>
                  ) : (
                    libraryFolders.map((f) => {
                      const label = f.path.replace(/\\/g, "/").split("/").pop() ?? f.path;
                      return (
                        <div key={f.path} className="flex items-center gap-2 px-3 py-2 border-b last:border-0"
                          style={{ borderColor: "var(--color-border-soft)" }}>
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-dim)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
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
              </section>

              {appUpdate && (
                <section className="space-y-2">
                  <h3 className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>{t('common.nav.logs')}</h3>
                  <button onClick={() => { onClose(); onAppUpdate(); }}
                    className="w-full py-2 rounded-lg text-sm px-3 flex items-center gap-2 font-semibold"
                    style={{ background: "var(--color-success-bg)", color: "var(--color-success)", border: "1px solid var(--color-success-border)" }}>
                    ↑ {t('settings.system.update_available', { version: appUpdate.version })}
                  </button>
                </section>
              )}
              <section className="space-y-2">
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
              </section>
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
                        className="w-full bg-transparent text-xs w-full outline-none" style={{ color: "var(--color-text-muted)" }}
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
                      className="text-[var(--color-danger)] hover:text-white mt-1" style={{ width: 24, height: 24 }}>✕</button>
                  </div>
                ))}

                <button onClick={() => {
                  const nextFeeds = [...(appSettings.rssFeeds || defaultSettings.rssFeeds), { name: "New Feed", url: "", enabled: true }];
                  onSaveSettings({ ...appSettings, rssFeeds: nextFeeds });
                }}
                  className="w-full py-2 flex items-center justify-center gap-2 rounded text-sm text-[var(--color-text)] hover:text-white"
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

              <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1" style={{ scrollbarWidth: "thin", scrollbarColor: "var(--color-border) transparent" }}>
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
                  onChange={(e) => setSyncProviderType(e.target.value as "webdav" | "nextcloud" | "s3" | "git")}
                  className="w-full px-2 py-1.5 rounded outline-none text-sm"
                  style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
                >
                  <option value="webdav">WebDAV</option>
                  <option value="nextcloud">Nextcloud</option>
                  <option value="s3">S3 (Coming Soon)</option>
                  <option value="git">Git</option>
                </select>
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

              {/* S3 Configuration */}
              {syncProviderType === "s3" && (
                <div className="space-y-2">
                  <p className="text-xs" style={{ color: "var(--color-warning)" }}>S3 provider requires AWS SDK integration. Please use WebDAV, Nextcloud, or Git for now.</p>
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
        </div>
      </div>
    </div >
  );
}

// ─── Version Timeline ─────────────────────────────────────────────────────────

// ─── Game Detail ──────────────────────────────────────────────────────────────

// ─── Main App ─────────────────────────────────────────────────────────────────

export { MigrationWizardModal, SettingsModal };
