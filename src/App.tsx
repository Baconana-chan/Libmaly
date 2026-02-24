import { useState, useEffect, useRef, useMemo, useCallback } from "preact/hooks";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { listen } from "@tauri-apps/api/event";
import { enable as enableAutostart, disable as disableAutostart, isEnabled as isAutostartEnabled } from "@tauri-apps/plugin-autostart";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { marked } from "marked";
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

interface HistoryEntry {
  id: string;
  date: number;
  version: string;
  note: string;
}
type GameHistoryMap = Record<string, HistoryEntry[]>;

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
  /** Game completion status */
  status?: "Playing" | "Completed" | "On Hold" | "Dropped" | "Plan to Play";
  /** Daily/session time budget in minutes */
  timeLimitMins?: number;
  /** Free-form user tags */
  customTags?: string[];
}

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

interface LaunchConfig {
  enabled: boolean;        // false = always run directly
  runner: "wine" | "proton" | "custom";
  runnerPath: string;         // path to wine/proton binary
  prefixPath: string;         // WINEPREFIX / STEAM_COMPAT_DATA_PATH
}

const DEFAULT_LAUNCH_CONFIG: LaunchConfig = { enabled: false, runner: "wine", runnerPath: "", prefixPath: "" };

const SK_SETTINGS = "libmaly_app_settings-v1";
interface AppSettings {
  updateCheckerEnabled: boolean;
  sessionToastEnabled: boolean;
  trayTooltipEnabled: boolean;
  startupWithWindows: boolean;
  blurNsfwContent: boolean;
  rssFeeds: { url: string; name: string }[];
  metadataAutoRefetchDays: number;
  autoScreenshotInterval: number;
  bossKeyEnabled?: boolean;
  bossKeyCode?: number;
  bossKeyAction?: "hide" | "kill";
  bossKeyMuteSystem?: boolean;
  bossKeyFallbackUrl?: string;
}
const DEFAULT_SETTINGS: AppSettings = {
  updateCheckerEnabled: false,
  sessionToastEnabled: false,
  trayTooltipEnabled: false,
  startupWithWindows: false,
  blurNsfwContent: true,
  rssFeeds: [
    { url: "https://f95zone.to/sam/latest_alpha/latest_data.php?cmd=rss&cat=games", name: "F95zone Latest" }
  ],
  metadataAutoRefetchDays: 0,
  autoScreenshotInterval: 0,
  bossKeyEnabled: false,
  bossKeyCode: 0x7A, // F11
  bossKeyAction: "hide",
  bossKeyMuteSystem: false,
  bossKeyFallbackUrl: "",
};

function isGameAdult(meta?: GameMetadata): boolean {
  if (!meta) return false;
  if (meta.source === "f95" || meta.source === "dlsite") return true;
  if (meta.age_rating && meta.age_rating.toLowerCase().includes("18")) return true;
  return meta.tags?.some(t => ["adult", "nsfw", "18+", "18", "eroge"].includes(t.toLowerCase())) ?? false;
}

function NsfwOverlay({
  gamePath, meta, appSettings, revealed, onReveal, small
}: {
  gamePath: string; meta?: GameMetadata; appSettings: AppSettings;
  revealed: Record<string, boolean>; onReveal: (path: string) => void;
  small?: boolean;
}) {
  if (!appSettings.blurNsfwContent || !isGameAdult(meta) || revealed[gamePath]) return null;
  return (
    <div className={`absolute inset-0 z-10 flex flex-col items-center justify-center cursor-pointer ${small ? "backdrop-blur-sm bg-black/20" : "backdrop-blur-xl bg-black/40"}`}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onReveal(gamePath); }}>
      {!small && (
        <>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-70 mb-1">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /><line x1="1" y1="1" x2="23" y2="23" />
          </svg>
          <span className="text-[10px] uppercase font-bold text-white opacity-80 px-2 py-0.5 rounded shadow-sm" style={{ background: "rgba(0,0,0,0.6)" }}>18+ Content</span>
        </>
      )}
    </div>
  );
}

const COLLECTION_COLORS = ["#66c0f4", "#c8a951", "#a170c8", "#e8734a", "#5ba85b", "#d45252", "#4a8ee8", "#e85480"];

interface Collection {
  id: string;
  name: string;
  color: string;
  gamePaths: string[];
}

type SortMode = "name" | "lastPlayed" | "playtime" | "custom";
type FilterMode = "all" | "favs" | "hidden" | "f95" | "dlsite" | "unlinked" | "Playing" | "Completed" | "On Hold" | "Dropped" | "Plan to Play" | string;

function loadCache<T>(key: string, fallback: T): T {
  try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : fallback; }
  catch { return fallback; }
}
function saveCache(key: string, val: unknown) { localStorage.setItem(key, JSON.stringify(val)); }

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatTime(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h} hrs ${m} mins`;
  if (m > 0) return `${m} mins`;
  return "< 1 min";
}
function timeAgo(ts: number) {
  if (!ts) return "Never";
  const d = Math.floor((Date.now() - ts) / 86400000);
  if (d === 0) return "Today"; if (d === 1) return "Yesterday";
  if (d < 30) return `${d} days ago`;
  const mo = Math.floor(d / 30);
  return mo < 12 ? `${mo} mo ago` : `${Math.floor(mo / 12)} yr ago`;
}
function heroGradient(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  const hue = Math.abs(h) % 360;
  return `linear-gradient(135deg,hsl(${hue},40%,15%) 0%,hsl(${(hue + 50) % 360},55%,25%) 100%)`;
}
function isF95Url(url: string) { return url.includes("f95zone.to"); }
function isDLsiteUrl(url: string) { return url.includes("dlsite.com"); }

// ─── Command Palette ────────────────────────────────────────────────────────
function CommandPalette({
  isOpen, onClose, games, metadata, notes, onSelect
}: {
  isOpen: boolean; onClose: () => void; games: Game[]; metadata: Record<string, GameMetadata>; notes: Record<string, string>; onSelect: (g: Game) => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const results = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return games.filter(g => {
      if (g.name.toLowerCase().includes(q)) return true;
      const meta = metadata[g.path];
      if (meta) {
        if (meta.developer?.toLowerCase().includes(q)) return true;
        if (meta.tags?.some(t => t.toLowerCase().includes(q))) return true;
      }
      if (notes[g.path]?.toLowerCase().includes(q)) return true;
      return false;
    }).slice(0, 15);
  }, [games, metadata, notes, query]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[10000] flex items-start justify-center pt-[15vh]"
      style={{ background: "rgba(0,0,0,0.8)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-[600px] rounded-lg shadow-2xl overflow-hidden flex flex-col" style={{ background: "#1b2838", border: "1px solid #2a475e" }}>
        <div className="flex items-center px-4 py-3 border-b" style={{ borderColor: "#1e3a50" }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#66c0f4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            className="flex-1 bg-transparent px-3 text-[15px] outline-none"
            style={{ color: "#fff" }}
            placeholder="Search games, tags, developers, notes... (Ctrl+K)"
            value={query}
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                // Simple version: doesn't include list navigation for the sake of brevity
              }
              if (e.key === "Enter" && results.length > 0) {
                onSelect(results[0]);
                onClose();
              }
            }}
          />
        </div>
        {results.length > 0 && (
          <div className="py-2 max-h-[400px] overflow-y-auto" style={{ scrollbarWidth: "thin", scrollbarColor: "#2a475e transparent" }}>
            {results.map(g => (
              <button key={g.path}
                className="w-full flex items-center gap-3 px-4 py-2 hover:bg-[#2a475e] text-left transition-colors"
                onClick={() => { onSelect(g); onClose(); }}>
                <div className="w-8 h-8 rounded shrink-0 bg-[#0d1b2a] border border-[#1e3a50] overflow-hidden flex items-center justify-center font-bold text-xs" style={{ color: "#fff" }}>
                  {metadata[g.path]?.cover_url ? <img src={metadata[g.path].cover_url} className="w-full h-full object-cover" alt="" /> : g.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: "#c6d4df" }}>{metadata[g.path]?.title ?? g.name}</p>
                  <p className="text-[10px] truncate" style={{ color: "#8f98a0" }}>
                    {metadata[g.path]?.developer || "Unknown Developer"}
                    {metadata[g.path]?.tags?.length ? ` · ${metadata[g.path].tags.slice(0, 3).join(", ")}` : ""}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
        {query.trim() && results.length === 0 && (
          <div className="py-8 text-center text-sm" style={{ color: "#8f98a0" }}>No results found for "{query}"</div>
        )}
      </div>
    </div>
  );
}

// ─── TagBadge ─────────────────────────────────────────────────────────────────
function TagBadge({ text }: { text: string }) {
  return (
    <span className="inline-block text-xs px-2 py-0.5 rounded"
      style={{ background: "#1e3a50", color: "#8cb4d5", border: "1px solid #264d68" }}>
      {text}
    </span>
  );
}

// ─── MetaRow ──────────────────────────────────────────────────────────────────
function MetaRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="flex gap-2 text-xs">
      <span className="flex-shrink-0 w-24 text-right" style={{ color: "#8f98a0" }}>{label}</span>
      <span style={{ color: "#c6d4df" }}>{value}</span>
    </div>
  );
}

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
      <div className="rounded-lg p-6 w-96 shadow-2xl" style={{ background: "#1e2d3d", border: "1px solid #2a475e" }}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded flex items-center justify-center font-bold text-sm"
            style={{ background: "#c8a951", color: "#1a1a1a" }}>F95</div>
          <h2 className="text-lg font-bold" style={{ color: "#fff" }}>Sign in to F95zone</h2>
        </div>
        <p className="text-xs mb-4" style={{ color: "#8f98a0" }}>
          Logging in allows fetching restricted metadata (adult content, spoilers, etc.).
        </p>
        <div className="space-y-3">
          <input type="text" placeholder="Username" value={user}
            onInput={(e) => setUser((e.target as HTMLInputElement).value)}
            className="w-full px-3 py-2 rounded text-sm outline-none"
            style={{ background: "#152232", color: "#c6d4df", border: "1px solid #2a475e" }} />
          <input type="password" placeholder="Password" value={pass}
            onInput={(e) => setPass((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => e.key === "Enter" && doLogin()}
            className="w-full px-3 py-2 rounded text-sm outline-none"
            style={{ background: "#152232", color: "#c6d4df", border: "1px solid #2a475e" }} />
        </div>
        {error && <p className="mt-2 text-xs" style={{ color: "#e57373" }}>{error}</p>}
        <div className="flex gap-3 justify-end mt-5">
          <button onClick={onClose}
            className="px-4 py-2 rounded text-sm"
            style={{ background: "#152232", color: "#8f98a0", border: "1px solid #2a475e" }}>Cancel</button>
          <button onClick={doLogin} disabled={loading || !user || !pass}
            className="px-5 py-2 rounded text-sm font-semibold disabled:opacity-50 flex items-center gap-2"
            style={{ background: "#c8a951", color: "#1a1a1a" }}>
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
      <div className="rounded-lg p-6 w-96 shadow-2xl" style={{ background: "#1e2d3d", border: "1px solid #2a475e" }}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded flex items-center justify-center font-bold text-[11px]"
            style={{ background: "#e0534a", color: "#fff" }}>DL</div>
          <h2 className="text-lg font-bold" style={{ color: "#fff" }}>Sign in to DLsite</h2>
        </div>
        <p className="text-xs mb-1" style={{ color: "#8f98a0" }}>
          Logging in unlocks age-gated product pages, so metadata can be fetched without the age-gate redirect.
        </p>
        <p className="text-xs mb-4" style={{ color: "#4a5568" }}>
          Your credentials are sent directly to DLsite (login.dlsite.com) and are never stored by LIBMALY.
        </p>
        <div className="space-y-3">
          <div>
            <label className="text-[10px] uppercase tracking-widest block mb-1" style={{ color: "#4a5568" }}>Login ID (email or username)</label>
            <input type="text" placeholder="Login ID" value={loginId}
              onInput={(e) => setLoginId((e.target as HTMLInputElement).value)}
              className="w-full px-3 py-2 rounded text-sm outline-none"
              style={{ background: "#152232", color: "#c6d4df", border: "1px solid #2a475e" }} />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-widest block mb-1" style={{ color: "#4a5568" }}>Password</label>
            <input type="password" placeholder="Password" value={pass}
              onInput={(e) => setPass((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => e.key === "Enter" && doLogin()}
              className="w-full px-3 py-2 rounded text-sm outline-none"
              style={{ background: "#152232", color: "#c6d4df", border: "1px solid #2a475e" }} />
          </div>
        </div>
        {error && <p className="mt-2 text-xs" style={{ color: "#e57373" }}>{error}</p>}
        <div className="flex gap-3 justify-end mt-5">
          <button onClick={onClose}
            className="px-4 py-2 rounded text-sm"
            style={{ background: "#152232", color: "#8f98a0", border: "1px solid #2a475e" }}>Cancel</button>
          <button onClick={doLogin} disabled={loading || !loginId || !pass}
            className="px-5 py-2 rounded text-sm font-semibold disabled:opacity-50 flex items-center gap-2"
            style={{ background: "#e0534a", color: "#fff" }}>
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
      <div className="rounded-lg p-6 w-[480px] shadow-2xl" style={{ background: "#1e2d3d", border: "1px solid #2a475e" }}>
        <h2 className="text-lg font-bold mb-4" style={{ color: "#fff" }}>Metadata Update</h2>

        <div className="space-y-3 mb-6">
          {versionChanged ? (
            <div className="p-3 rounded" style={{ background: "#2a3f54" }}>
              <p className="text-sm" style={{ color: "#c6d4df" }}>
                Version changed: <span className="font-mono text-[#e57373] line-through">{oldV}</span> → <span className="font-mono text-[#6dbf6d] font-bold">{newV}</span>
              </p>
            </div>
          ) : (
            <div className="p-3 rounded" style={{ background: "#152232" }}>
              <p className="text-sm" style={{ color: "#8f98a0" }}>
                No version change detected (remains <span className="font-mono">{newV}</span>). The metadata fields will be refreshed.
              </p>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm" style={{ color: "#c6d4df" }}>
            <input type="checkbox" checked={wantsToLog} onChange={(e) => setWantsToLog(e.currentTarget.checked)} />
            Log this update in the game's version history
          </label>

          {wantsToLog && (
            <textarea
              className="w-full h-20 p-2 rounded text-sm outline-none resize-none"
              style={{ background: "#152232", color: "#c6d4df", border: "1px solid #2a475e" }}
              placeholder={`Notes for version ${newV} update (e.g. "Downloaded from F95", "Added new route")...`}
              value={note}
              onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)}
            />
          )}
        </div>

        <div className="flex gap-3 justify-end">
          <button onClick={onClose}
            className="px-4 py-2 rounded text-sm hover:opacity-80 transition-opacity"
            style={{ background: "#152232", color: "#8f98a0", border: "1px solid #2a475e" }}>Cancel</button>
          <button onClick={() => onConfirm(wantsToLog ? note : null)}
            className="px-5 py-2 rounded text-sm font-semibold hover:opacity-80 transition-opacity"
            style={{ background: "#66c0f4", color: "#1a1a1a" }}>
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

  const src = isF95Url(url) ? "f95" : isDLsiteUrl(url) ? "dlsite" : null;

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
    const targetSrc = isF95Url(targetUrl) ? "f95" : isDLsiteUrl(targetUrl) ? "dlsite" : null;
    if (!targetSrc) { setError("Paste a valid F95zone or DLsite URL."); return; }
    setLoading(true); setError("");
    try {
      const cmd = targetSrc === "f95" ? "fetch_f95_metadata" : "fetch_dlsite_metadata";
      const meta = await invoke<GameMetadata>(cmd, { url: targetUrl.trim() });
      onFetched(meta); onClose();
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.8)" }}
      onClick={(e) => { if (e.target === e.currentTarget && !loading) onClose(); }}>
      <div className="rounded-lg p-6 w-[480px] shadow-2xl" style={{ background: "#1e2d3d", border: "1px solid #2a475e" }}>
        <h2 className="text-lg font-bold mb-1" style={{ color: "#fff" }}>Link a Game Page</h2>
        <p className="text-xs mb-4" style={{ color: "#8f98a0" }}>
          Paste an F95zone thread URL or DLsite product page URL to fetch cover art,
          description and tags for <b style={{ color: "#c6d4df" }}>{gameName}</b>.
        </p>
        <div className="flex gap-2 mb-4">
          {(["f95", "dlsite"] as const).map((s) => (
            <span key={s} className="px-2 py-0.5 rounded text-xs font-semibold"
              style={{
                background: src === s ? (s === "f95" ? "#c8a951" : "#e0534a") : "#1e3a50",
                color: src === s ? (s === "f95" ? "#1a1a1a" : "#fff") : "#8f98a0",
              }}>
              {s === "f95" ? "F95zone" : "DLsite"}
            </span>
          ))}
        </div>
        <input type="text"
          placeholder="https://f95zone.to/threads/…   or   https://www.dlsite.com/…"
          value={url}
          onInput={(e) => { setUrl((e.target as HTMLInputElement).value); setError(""); }}
          onKeyDown={(e) => e.key === "Enter" && doFetch()}
          className="w-full px-3 py-2 rounded text-sm outline-none mb-3"
          style={{ background: "#152232", color: "#c6d4df", border: "1px solid #2a475e" }} />
        {src === "f95" && !f95LoggedIn && (
          <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded"
            style={{ background: "#2a1f00", border: "1px solid #5a4200" }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#c8a951" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span className="text-xs flex-1" style={{ color: "#c8a951" }}>Some F95zone content requires login.</span>
            <button onClick={onOpenF95Login} className="text-xs underline" style={{ color: "#c8a951" }}>Sign in</button>
          </div>
        )}
        {!url && (
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <p className="text-[10px] uppercase text-[#8f98a0] font-bold tracking-widest flex-1">Auto-Link Suggestions</p>
              <input type="text" value={query} onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
                className="bg-[#152232] border border-[#2a475e] text-[11px] px-2 py-0.5 rounded outline-none text-[#c6d4df]"
                placeholder="Search query..."
                onKeyDown={(e) => e.key === "Enter" && fetchSuggestions()} />
              <button onClick={fetchSuggestions} disabled={isLoadingSuggestions} className="bg-[#2a475e] hover:bg-[#3d5a73] text-[11px] px-2 py-0.5 rounded text-[#c6d4df] disabled:opacity-50">
                {isLoadingSuggestions ? "Searching…" : "Search"}
              </button>
            </div>
            {isLoadingSuggestions ? (
              <p className="text-xs text-[#8f98a0]">Searching for matches...</p>
            ) : suggestions && suggestions.length > 0 ? (
              <div className="space-y-2 max-h-[160px] overflow-y-auto pr-1">
                {suggestions.map((s) => (
                  <div key={s.url} onClick={() => doFetch(s.url)}
                    className="group flex gap-3 p-2 rounded cursor-pointer transition-colors"
                    style={{ background: "#152232", border: "1px solid #1e3a50" }}
                    onMouseEnter={e => e.currentTarget.style.background = "#1b2838"}
                    onMouseLeave={e => e.currentTarget.style.background = "#152232"}>
                    {s.cover_url ? (
                      <img src={s.cover_url} alt="" className="w-10 h-10 object-cover rounded" />
                    ) : (
                      <div className="w-10 h-10 rounded flex items-center justify-center font-bold" style={{ background: "#1e2d3d", color: "#66c0f4" }}>
                        {s.source[0]}
                      </div>
                    )}
                    <div className="flex flex-col flex-1 min-w-0 justify-center">
                      <p className="text-xs text-[#c6d4df] truncate font-medium group-hover:text-[#fff]" title={s.title}>{s.title}</p>
                      <p className="text-[10px] text-[#8f98a0] uppercase">{s.source}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : suggestions && suggestions.length === 0 ? (
              <p className="text-xs text-[#8f98a0]">No suggestions found.</p>
            ) : null}
          </div>
        )}
        {error && <p className="text-xs mb-2" style={{ color: "#e57373" }}>{error}</p>}
        <div className="flex gap-3 justify-end mt-2">
          <button onClick={onClose} disabled={loading}
            className="px-4 py-2 rounded text-sm"
            style={{ background: "#152232", color: "#8f98a0", border: "1px solid #2a475e" }}>Cancel</button>
          <button onClick={() => doFetch()} disabled={loading || !url.trim()}
            className="px-5 py-2 rounded text-sm font-semibold disabled:opacity-50 flex items-center gap-2"
            style={{ background: "#2a6db5", color: "#fff" }}>
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
        style={{ background: "#1e2d3d", border: "1px solid #2a475e" }}>

        {/* Header */}
        <div className="flex items-center gap-3 px-6 pt-5 pb-4 border-b" style={{ borderColor: "#1b3a50" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#66c0f4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="16 16 12 12 8 16" /><line x1="12" y1="12" x2="12" y2="21" />
            <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
          </svg>
          <div>
            <h2 className="font-bold text-base" style={{ color: "#fff" }}>Update Game</h2>
            <p className="text-xs" style={{ color: "#8f98a0" }}>{game.name}</p>
          </div>
        </div>

        <div className="px-6 py-5 space-y-4">

          {/* Step 1: pick source */}
          {phase === "idle" && (
            <>
              <p className="text-sm" style={{ color: "#8f98a0" }}>
                Point to the folder or <code>.zip</code> archive containing the new version.
                Save files and configs will be preserved automatically.
              </p>
              <div className="flex gap-3">
                <button onClick={pickFolder}
                  className="flex-1 py-2.5 rounded font-semibold text-sm"
                  style={{ background: "#2a475e", color: "#c6d4df", border: "1px solid #3d6b8e" }}>
                  📁 Select Folder
                </button>
                <button onClick={pickSource}
                  className="flex-1 py-2.5 rounded font-semibold text-sm"
                  style={{ background: "#2a475e", color: "#c6d4df", border: "1px solid #3d6b8e" }}>
                  🗜 Select ZIP
                </button>
              </div>
            </>
          )}

          {/* Previewing / loading */}
          {phase === "previewing" && (
            <div className="flex items-center gap-3 py-4">
              <span className="w-5 h-5 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
              <span className="text-sm" style={{ color: "#8f98a0" }}>Analysing…</span>
            </div>
          )}

          {/* Preview ready — show plan */}
          {phase === "ready" && preview && (
            <>
              <div className="rounded p-3 space-y-1 text-xs" style={{ background: "#152232", border: "1px solid #2a3f54" }}>
                <p className="text-xs font-mono break-all mb-2" style={{ color: "#66c0f4" }}>{sourcePath}</p>
                <div className="flex gap-4">
                  <span style={{ color: "#8f98a0" }}>Files to update</span>
                  <span className="font-semibold" style={{ color: "#c6d4df" }}>
                    {preview.source_is_zip
                      ? `~${preview.zip_entry_count ?? "?"} (archive)`
                      : `${preview.files_to_update} existing + ${preview.new_files} new`}
                  </span>
                </div>
              </div>

              {preview.protected_dirs.length > 0 && (
                <div className="rounded p-3" style={{ background: "#1a2e1a", border: "1px solid #2a4a2a" }}>
                  <p className="text-xs font-semibold mb-2" style={{ color: "#6dbf6d" }}>🛡 Protected (will NOT be overwritten)</p>
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
                <div className="rounded p-3" style={{ background: "#1e2d3d", border: "1px solid #4a3a1a" }}>
                  <p className="text-xs" style={{ color: "#c8a951" }}>
                    ⚠ No save directories detected. The update will overwrite all files.
                    Make sure you have a manual backup if needed.
                  </p>
                </div>
              )}

              <div className="flex gap-3 justify-end pt-1">
                <button onClick={() => { setPhase("idle"); setPreview(null); setSourcePath(""); }}
                  className="px-4 py-2 rounded text-sm"
                  style={{ background: "#152232", color: "#8f98a0", border: "1px solid #2a475e" }}>Back</button>
                <button onClick={doUpdate}
                  className="px-5 py-2 rounded text-sm font-bold"
                  style={{ background: "#4c6b22", color: "#d2e885" }}>Apply Update</button>
              </div>
            </>
          )}

          {/* Updating */}
          {phase === "updating" && (
            <div className="flex flex-col items-center gap-3 py-6">
              <span className="w-8 h-8 rounded-full border-4 border-blue-400 border-t-transparent animate-spin" />
              <p className="text-sm" style={{ color: "#8f98a0" }}>Updating… please wait</p>
            </div>
          )}

          {/* Done */}
          {phase === "done" && result && (
            <>
              <div className="rounded p-4" style={{ background: "#1a2e1a", border: "1px solid #2a4a2a" }}>
                <p className="font-semibold mb-3" style={{ color: "#6dbf6d" }}>✓ Update complete</p>
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
                <div className="rounded p-3" style={{ background: "#2a1f00", border: "1px solid #5a4200" }}>
                  <p className="text-xs font-semibold mb-1" style={{ color: "#c8a951" }}>Warnings</p>
                  {result.warnings.map((w, i) => <p key={i} className="text-xs font-mono" style={{ color: "#a08030" }}>{w}</p>)}
                </div>
              )}
              <div className="flex justify-end">
                <button onClick={onClose}
                  className="px-5 py-2 rounded text-sm font-semibold"
                  style={{ background: "#2a475e", color: "#c6d4df" }}>Close</button>
              </div>
            </>
          )}

          {/* Error */}
          {phase === "error" && (
            <>
              <div className="rounded p-3" style={{ background: "#3a1010", border: "1px solid #8b2020" }}>
                <p className="text-xs font-semibold mb-1" style={{ color: "#e57373" }}>Error</p>
                <p className="text-xs font-mono break-all" style={{ color: "#c89090" }}>{errMsg}</p>
              </div>
              <div className="flex gap-3 justify-end">
                <button onClick={() => { setPhase("idle"); setErrMsg(""); setPreview(null); setSourcePath(""); }}
                  className="px-4 py-2 rounded text-sm"
                  style={{ background: "#152232", color: "#8f98a0", border: "1px solid #2a475e" }}>Back</button>
                <button onClick={onClose}
                  className="px-4 py-2 rounded text-sm"
                  style={{ background: "#2a3f54", color: "#c6d4df" }}>Close</button>
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
        style={{ background: "#1e2d3d", border: "1px solid #2a475e", width: "760px", height: "76vh" }}>

        {/* Header */}
        <div className="flex items-center gap-3 px-5 pt-4 pb-3 flex-shrink-0 border-b" style={{ borderColor: "#1b3a50" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#66c0f4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
          <span className="font-bold flex-1" style={{ color: "#fff" }}>Notes — {displayTitle}</span>
          <div className="flex rounded overflow-hidden" style={{ border: "1px solid #2a475e" }}>
            <button onClick={() => setPreview(false)}
              className="px-3 py-1 text-xs"
              style={{ background: !preview ? "#2a6db5" : "#152232", color: !preview ? "#fff" : "#8f98a0" }}>
              Edit
            </button>
            <button onClick={() => setPreview(true)}
              className="px-3 py-1 text-xs"
              style={{ background: preview ? "#2a6db5" : "#152232", color: preview ? "#fff" : "#8f98a0" }}>
              Preview
            </button>
          </div>
          <button onClick={() => { onSave(text); onClose(); }}
            className="ml-1 text-xs px-3 py-1.5 rounded"
            style={{ background: "#2a3f54", color: "#c6d4df", border: "1px solid #3d5a73" }}>Close</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-hidden flex">
          {!preview ? (
            <textarea
              className="w-full h-full p-4 text-sm outline-none resize-none font-mono"
              style={{
                background: "#131d28", color: "#c6d4df",
                scrollbarWidth: "thin", scrollbarColor: "#2a475e transparent",
                lineHeight: "1.65",
              }}
              placeholder={"# Game Notes\n\nWrite anything here — Markdown is supported.\n\n- Quest progress\n- Tips & secrets\n- Save locations\n"}
              value={text}
              onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
            />
          ) : (
            <div
              className="w-full h-full overflow-y-auto p-5 text-sm markdown-body"
              style={{ background: "#131d28", color: "#c6d4df", scrollbarWidth: "thin", scrollbarColor: "#2a475e transparent" }}
              dangerouslySetInnerHTML={{ __html: renderedHtml || "<p style=\"opacity:0.3\">Nothing to preview yet.</p>" }}
            />
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center px-5 py-2 flex-shrink-0 border-t" style={{ borderColor: "#1b3a50" }}>
          <span className="text-[10px]" style={{ color: "#4a5568" }}>
            Supports Markdown · Auto-saved as you type · {text.length} chars
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Settings Mini-Menu ───────────────────────────────────────────────────────
function MenuEntry({ icon, label, color, onClick }: {
  icon: string; label: string; color?: string; onClick: () => void;
}) {
  const [hov, setHov] = useState(false);
  return (
    <button onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left"
      style={{ color: color ?? "#c6d4df", background: hov ? "#2a3f54" : "transparent" }}>
      <span style={{ fontSize: "13px" }}>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function SettingsMenu({ isHidden, isFav, onDelete, onToggleHide, onToggleFav, onCustomize, onManageCollections }: {
  isHidden: boolean; isFav: boolean;
  onDelete: () => void; onToggleHide: () => void; onToggleFav: () => void; onCustomize: () => void; onManageCollections: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        onClick={() => setOpen((p) => !p)}
        className="flex items-center gap-1 px-3 py-2 rounded text-sm"
        style={{ background: open ? "#3d5a73" : "#2a3f54", color: open ? "#c6d4df" : "#8f98a0", border: "1px solid #3d5a73" }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "#3d5a73"; e.currentTarget.style.color = "#c6d4df"; }}
        onMouseLeave={(e) => { if (!open) { e.currentTarget.style.background = "#2a3f54"; e.currentTarget.style.color = "#8f98a0"; } }}
        title="Game settings">
        {/* Gear icon */}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 rounded-lg py-1 shadow-2xl"
          style={{ background: "#1e2d3d", border: "1px solid #2a475e", minWidth: "180px" }}>
          <MenuEntry icon="⭐" label={isFav ? "Remove from Favorites" : "Add to Favorites"}
            color={isFav ? "#c8a951" : undefined}
            onClick={() => { setOpen(false); onToggleFav(); }} />
          <MenuEntry icon={isHidden ? "👁" : "🙈"} label={isHidden ? "Unhide Game" : "Hide Game"}
            onClick={() => { setOpen(false); onToggleHide(); }} />
          <MenuEntry icon="🎨" label="Customise…"
            onClick={() => { setOpen(false); onCustomize(); }} />
          <MenuEntry icon="📁" label="Collections…"
            onClick={() => { setOpen(false); onManageCollections(); }} />
          <div style={{ borderTop: "1px solid #2a3f54", margin: "3px 0" }} />
          <MenuEntry icon="🗑" label="Uninstall" color="#e57373"
            onClick={() => { setOpen(false); onDelete(); }} />
        </div>
      )}
    </div>
  );
}

// ─── Customise Modal ──────────────────────────────────────────────────────────
function CustomizeModal({ game, meta, custom, onSave, onClose }: {
  game: Game; meta?: GameMetadata; custom: GameCustomization;
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

  // Derive game folder from its exe path
  const gameFolder = game.path.replace(/[\\/][^\\/]+$/, "");

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
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.85)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rounded-lg shadow-2xl w-[520px] max-h-[90vh] overflow-y-auto"
        style={{ background: "#1e2d3d", border: "1px solid #2a475e" }}>
        <div className="flex items-center gap-3 px-6 pt-5 pb-4 border-b" style={{ borderColor: "#1b3a50" }}>
          <span style={{ fontSize: "20px" }}>🎨</span>
          <div>
            <h2 className="font-bold text-base" style={{ color: "#fff" }}>Customise Game</h2>
            <p className="text-xs" style={{ color: "#8f98a0" }}>{game.name}</p>
          </div>
        </div>
        <div className="px-6 py-5 space-y-5">
          {/* Display name */}
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: "#8f98a0" }}>
              Display Name <span style={{ fontWeight: "normal", color: "#4a5568" }}>(used in list &amp; search)</span>
            </label>
            <div className="flex gap-2">
              <input type="text" value={displayName}
                onInput={(e) => setDisplayName((e.target as HTMLInputElement).value)}
                className="flex-1 px-3 py-2 rounded text-sm outline-none"
                style={{ background: "#152232", color: "#c6d4df", border: "1px solid #2a475e" }} />
              {/* Quick-fill: use the parent folder name as the game title */}
              <button
                title="Use the parent folder name as the game title"
                onClick={() => {
                  const folder = game.path.replace(/[\\/][^\\/]+$/, "");
                  const folderName = folder.replace(/\\/g, "/").split("/").pop() ?? folder;
                  setDisplayName(folderName);
                }}
                className="px-2.5 py-2 rounded text-xs flex-shrink-0 flex items-center gap-1"
                style={{ background: "#2a3f54", color: "#8f98a0", border: "1px solid #3d5a73" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "#1e4060"; e.currentTarget.style.color = "#66c0f4"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "#2a3f54"; e.currentTarget.style.color = "#8f98a0"; }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
                Folder
              </button>
            </div>
            {/* Hint when the exe name is generic */}
            {GENERIC_EXE_NAMES.has((game.path.replace(/\\/g, "/").split("/").pop() ?? "").replace(/\.[^.]+$/, "").toLowerCase()) && (
              <p className="mt-1 text-[10px]" style={{ color: "#c8a951" }}>
                ⚠ Generic exe detected — folder name was used as the title automatically during scan.
              </p>
            )}
          </div>

          {/* ── Executable Override ───────────────────────────────────── */}
          <div>
            <label className="block text-xs font-semibold mb-1" style={{ color: "#8f98a0" }}>
              Launch Executable
              <span style={{ fontWeight: "normal", color: "#4a5568" }}> (override scanned .exe)</span>
            </label>
            {/* current / override path */}
            <div className="rounded px-3 py-2 mb-2 text-xs font-mono break-all"
              style={{ background: "#0d1b2a", border: "1px solid #1e3a50", color: exeOverride ? "#c8a951" : "#4a5568" }}>
              {exeOverride || game.path}
              {exeOverride && (
                <span className="ml-2 font-sans"
                  style={{ color: "#4a5568", fontSize: "10px" }}>
                  (override active)
                </span>
              )}
            </div>
            <div className="flex gap-2 mb-2">
              <button onClick={pickExe}
                className="flex-1 py-1.5 rounded text-xs flex items-center justify-center gap-1.5"
                style={{ background: "#2a3f54", color: "#c6d4df", border: "1px solid #3d5a73" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "#1e4060"; e.currentTarget.style.color = "#66c0f4"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "#2a3f54"; e.currentTarget.style.color = "#c6d4df"; }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                Browse…
              </button>
              <button onClick={detectSiblings} disabled={detectingExes}
                className="flex-1 py-1.5 rounded text-xs flex items-center justify-center gap-1.5 disabled:opacity-50"
                style={{ background: "#2a3f54", color: "#c6d4df", border: "1px solid #3d5a73" }}
                onMouseEnter={(e) => { if (!detectingExes) { e.currentTarget.style.background = "#1e4060"; e.currentTarget.style.color = "#66c0f4"; } }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "#2a3f54"; e.currentTarget.style.color = "#c6d4df"; }}>
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
                  style={{ background: "transparent", color: "#e57373", border: "1px solid #3a1010" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "#3a1010"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                  title="Clear override — use the originally scanned exe">
                  ✕ Clear
                </button>
              )}
            </div>
            {/* Sibling exe picker list */}
            {siblingExes.length > 0 && (
              <div className="rounded border overflow-hidden" style={{ borderColor: "#1e3a50" }}>
                <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest"
                  style={{ background: "#0d1b2a", color: "#4a5568" }}>
                  Executables found in game folder — click to select
                </p>
                {siblingExes.map((exe) => {
                  const fname = exe.replace(/\\/g, "/").split("/").pop() ?? exe;
                  const isActive = exeOverride === exe;
                  return (
                    <button key={exe} onClick={() => setExeOverride(exe)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left"
                      style={{
                        background: isActive ? "#1a3a5c" : "#131d28",
                        color: isActive ? "#66c0f4" : "#8f98a0",
                        borderTop: "1px solid #1e3a50",
                      }}
                      onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "#1b2d3d"; }}
                      onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "#131d28"; }}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                        stroke={isActive ? "#66c0f4" : "#4a5568"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 12h4" /><path d="M8 10v4" /><circle cx="17" cy="12" r="1" />
                      </svg>
                      <span className="font-mono flex-1 truncate">{fname}</span>
                      {isActive && (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#66c0f4" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </button>
                  );
                })}
                {siblingExes.length === 0 && (
                  <p className="px-3 py-3 text-xs text-center" style={{ color: "#4a5568", background: "#131d28" }}>
                    No other executables found in this folder.
                  </p>
                )}
              </div>
            )}
            {!detectingExes && siblingExes.length === 0 && exeOverride === "" && (
              <p className="text-[10px]" style={{ color: "#4a5568" }}>
                By default the game launches the scanned .exe above. Use this to pick a different launcher in the same folder.
              </p>
            )}

            <div className="mt-4">
              <label className="block text-xs font-semibold mb-1" style={{ color: "#8f98a0" }}>
                Launch Arguments
              </label>
              <input type="text" placeholder="e.g. -fullscreen -w 1920" value={launchArgs}
                onInput={(e) => setLaunchArgs((e.target as HTMLInputElement).value)}
                className="w-full px-3 py-2 rounded text-sm outline-none font-mono"
                style={{ background: "#152232", color: "#c6d4df", border: "1px solid #2a475e" }} />
            </div>

            <div className="mt-4">
              <label className="block text-xs font-semibold mb-1" style={{ color: "#8f98a0" }}>
                Pinned Executables <span style={{ fontWeight: "normal", color: "#4a5568" }}>(e.g. Server, Config)</span>
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
                      className="w-1/3 px-2 py-1.5 rounded text-xs outline-none bg-[#152232] border border-[#2a475e] text-[#c6d4df]" />
                    <input type="text" placeholder="Exe path" value={pe.path} readOnly
                      className="flex-1 px-2 py-1.5 rounded text-[10px] outline-none bg-[#0d1b2a] border border-[#1e3a50] text-[#8f98a0] font-mono break-all" />
                    <button onClick={() => setPinnedExes(pinnedExes.filter((_, idx) => idx !== i))}
                      className="px-2 rounded text-xs text-[#e57373] hover:bg-[#3a1010]" title="Remove pin">✕</button>
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
                className="mt-2 px-3 py-1.5 rounded text-xs" style={{ background: "#2a3f54", color: "#66c0f4", border: "1px dashed #3d5a73" }}>
                + Add pinned executable
              </button>
            </div>
          </div>

          {/* Cover image */}
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: "#8f98a0" }}>
              Custom Cover <span style={{ fontWeight: "normal", color: "#4a5568" }}>(thumbnail in sidebar)</span>
            </label>
            <div className="flex gap-2">
              <input type="text" placeholder="Paste URL or pick a file…" value={coverUrl}
                onInput={(e) => setCoverUrl((e.target as HTMLInputElement).value)}
                className="flex-1 px-3 py-2 rounded text-sm outline-none"
                style={{ background: "#152232", color: "#c6d4df", border: "1px solid #2a475e" }} />
              <button onClick={() => pickImage(setCoverUrl)}
                className="px-3 py-2 rounded text-xs flex-shrink-0"
                style={{ background: "#2a475e", color: "#c6d4df", border: "1px solid #3d5a73" }}>Browse</button>
            </div>
            {coverUrl && (
              <img src={coverUrl} alt="" className="mt-2 rounded h-20 w-auto object-cover"
                style={{ border: "1px solid #2a475e", maxWidth: "100%" }} />
            )}
          </div>
          {/* Hero background */}
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: "#8f98a0" }}>
              Hero Background <span style={{ fontWeight: "normal", color: "#4a5568" }}>(banner on detail page)</span>
            </label>
            <div className="flex gap-2">
              <input type="text" placeholder="Paste URL or pick a file…" value={bgUrl}
                onInput={(e) => setBgUrl((e.target as HTMLInputElement).value)}
                className="flex-1 px-3 py-2 rounded text-sm outline-none"
                style={{ background: "#152232", color: "#c6d4df", border: "1px solid #2a475e" }} />
              <button onClick={() => pickImage(setBgUrl)}
                className="px-3 py-2 rounded text-xs flex-shrink-0"
                style={{ background: "#2a475e", color: "#c6d4df", border: "1px solid #3d5a73" }}>Browse</button>
            </div>
            {bgUrl && (
              <img src={bgUrl} alt="" className="mt-2 rounded h-20 w-full object-cover"
                style={{ border: "1px solid #2a475e" }} />
            )}
          </div>
        </div>
        <div className="flex items-center justify-between px-6 pb-5">
          <button onClick={() => { onSave({}); onClose(); }}
            className="px-4 py-2 rounded text-xs"
            style={{ background: "transparent", color: "#4a5568", border: "1px solid #2a3f54" }}>
            Reset to defaults
          </button>
          <div className="flex gap-2">
            <button onClick={onClose}
              className="px-4 py-2 rounded text-sm"
              style={{ background: "#152232", color: "#8f98a0", border: "1px solid #2a475e" }}>Cancel</button>
            <button onClick={doSave}
              className="px-5 py-2 rounded text-sm font-semibold"
              style={{ background: "#2a6db5", color: "#fff" }}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── In-Game Screenshots Gallery ─────────────────────────────────────────────
function InGameGallery({ shots, onTake, onOpenFolder, onUpdateTags }: {
  shots: Screenshot[];
  onTake: () => void;
  onOpenFolder: () => void;
  onUpdateTags: (filename: string, tags: string[]) => void;
}) {
  const [lightbox, setLightbox] = useState<Screenshot | null>(null);
  const [activeTagFilter, setActiveTagFilter] = useState<string | null>(null);

  // Derived filtered shots
  const filteredShots = activeTagFilter
    ? shots.filter(s => s.tags?.includes(activeTagFilter))
    : shots;

  // Collect all unique tags from all screenshots
  const allShotTags = useMemo(() => {
    const tags = new Set<string>();
    shots.forEach(s => s.tags?.forEach(t => tags.add(t)));
    return Array.from(tags).sort();
  }, [shots]);

  return (
    <section>
      <div className="flex flex-col gap-2 mb-2">
        <div className="flex items-center gap-2">
          <h2 className="text-xs uppercase tracking-widest flex-1" style={{ color: "#8f98a0" }}>
            In-Game Screenshots {shots.length > 0 && <span style={{ color: "#4a5568" }}>({shots.length})</span>}
          </h2>
          <button onClick={onTake}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs"
            style={{ background: "#2a3f54", color: "#8f98a0", border: "1px solid #3a5469" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#1e4060"; e.currentTarget.style.color = "#66c0f4"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "#2a3f54"; e.currentTarget.style.color = "#8f98a0"; }}
            title="Capture game window now (F12 hotkey works while game is running)">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
            Capture
          </button>
          <button onClick={onOpenFolder}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs"
            style={{ background: "#2a3f54", color: "#8f98a0", border: "1px solid #3a5469" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#1e4060"; e.currentTarget.style.color = "#66c0f4"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "#2a3f54"; e.currentTarget.style.color = "#8f98a0"; }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            Folder
          </button>
        </div>

        {allShotTags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            <button
              onClick={() => setActiveTagFilter(null)}
              className="text-[10px] px-1.5 py-0.5 rounded transition-colors"
              style={{
                background: !activeTagFilter ? "#3d5a73" : "#1a2734",
                color: !activeTagFilter ? "#fff" : "#8f98a0",
                border: "1px solid #2a3f54"
              }}
            >ALL</button>
            {allShotTags.map(tag => (
              <button
                key={tag}
                onClick={() => setActiveTagFilter(activeTagFilter === tag ? null : tag)}
                className="text-[10px] px-1.5 py-0.5 rounded transition-colors uppercase tracking-tight"
                style={{
                  background: activeTagFilter === tag ? "#2a6db5" : "#1a2734",
                  color: activeTagFilter === tag ? "#fff" : "#4cb5ff",
                  border: `1px solid ${activeTagFilter === tag ? "#3d8ee6" : "#2a3f54"}`
                }}
              >{tag}</button>
            ))}
          </div>
        )}
      </div>

      {shots.length === 0 ? (
        <div className="rounded px-3 py-4 text-center" style={{ background: "#16202d", border: "1px dashed #2a3f54" }}>
          <p className="text-xs" style={{ color: "#4a5568" }}>
            Press <kbd style={{ background: "#2a3f54", color: "#8f98a0", padding: "1px 5px", borderRadius: "3px", fontSize: "10px" }}>F12</kbd> while a game is running, or click Capture above.
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {filteredShots.map((s) => (
            <button key={s.filename} onClick={() => setLightbox(s)}
              className="rounded overflow-hidden flex-shrink-0 relative group"
              style={{ width: "90px", height: "60px", background: "#0d1117" }}>
              <img
                src={convertFileSrc(s.path)}
                alt={s.filename}
                className="w-full h-full object-cover"
                style={{ display: "block" }}
              />
              {s.tags?.length > 0 && (
                <div className="absolute top-0 right-0 p-0.5 bg-black/60 rounded-bl">
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="#66c0f4" stroke="#66c0f4" strokeWidth="1">
                    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                    <line x1="7" y1="7" x2="7.01" y2="7" />
                  </svg>
                </div>
              )}
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"
                style={{ background: "rgba(0,0,0,0.5)" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                  <line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" />
                </svg>
              </div>
            </button>
          ))}
          {filteredShots.length === 0 && (
            <div className="text-[10px] py-4 text-center w-full" style={{ color: "#4a5568" }}>
              No shots match the selected tag.
            </div>
          )}
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.92)" }}
          onClick={() => setLightbox(null)}>
          <div onClick={(e) => e.stopPropagation()} className="relative flex flex-col items-center max-w-full max-h-full">
            <div className="relative">
              <img
                src={convertFileSrc(lightbox.path)}
                alt={lightbox.filename}
                style={{ maxWidth: "90vw", maxHeight: "80vh", objectFit: "contain", display: "block" }}
                className="rounded shadow-2xl"
              />
            </div>

            <div className="w-full max-w-[90vw] mt-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-mono" style={{ color: "#8cb4d5" }}>{lightbox.filename}</span>
                <button onClick={() => setLightbox(null)}
                  className="text-xs px-4 py-1.5 rounded font-semibold transition-colors"
                  style={{ background: "#2a475e", color: "#fff" }}
                  onMouseEnter={(e) => e.currentTarget.style.background = "#3d5a73"}
                  onMouseLeave={(e) => e.currentTarget.style.background = "#2a475e"}>CLOSE</button>
              </div>

              {/* Tags Section */}
              <div className="bg-[#16202d] p-3 rounded-lg border border-[#2a3f54]">
                <div className="flex items-center gap-2 mb-2">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#8f98a0" strokeWidth="2">
                    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                    <line x1="7" y1="7" x2="7.01" y2="7" />
                  </svg>
                  <span className="text-[10px] uppercase tracking-widest font-bold" style={{ color: "#8f98a0" }}>Labels / Tags</span>
                </div>

                <div className="flex flex-wrap gap-1.5 items-center">
                  {lightbox.tags?.map(t => (
                    <span key={t} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-[#2a475e] text-[#c6d4df] border border-[#3d5a73] group hover:border-[#66c0f4] cursor-default transition-colors">
                      {t}
                      <button
                        onClick={() => {
                          const next = lightbox.tags.filter(x => x !== t);
                          onUpdateTags(lightbox.filename, next);
                          setLightbox({ ...lightbox, tags: next });
                        }}
                        className="hover:text-red-400 opacity-60 hover:opacity-100 transition-opacity"
                      >✕</button>
                    </span>
                  ))}

                  <input
                    type="text"
                    placeholder="Add label (Bug, Ending, Funny...)"
                    className="bg-transparent border border-dashed border-[#2a475e] text-[#8f98a0] text-[11px] px-2 py-0.5 rounded outline-none w-48 focus:w-64 focus:border-solid focus:border-[#66c0f4] focus:text-[#fff] transition-all"
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        const val = e.currentTarget.value.trim().toLowerCase();
                        if (val && !lightbox.tags?.includes(val)) {
                          const next = [...(lightbox.tags || []), val];
                          onUpdateTags(lightbox.filename, next);
                          setLightbox({ ...lightbox, tags: next });
                        }
                        e.currentTarget.value = '';
                      }
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ─── Wine / Proton Settings Modal ──────────────────────────────────────────────
function WineSettingsModal({ config, onSave, onClose }: {
  config: LaunchConfig;
  onSave: (c: LaunchConfig) => void;
  onClose: () => void;
}) {
  const [cfg, setCfg] = useState<LaunchConfig>(config);
  const [detected, setDetected] = useState<{ name: string; path: string; kind: string }[]>([]);
  const [detecting, setDetecting] = useState(false);

  useEffect(() => {
    setDetecting(true);
    invoke<{ name: string; path: string; kind: string }[]>("detect_wine_runners")
      .then(setDetected).catch(() => { }).finally(() => setDetecting(false));
  }, []);

  const upd = (patch: Partial<LaunchConfig>) => setCfg((p) => ({ ...p, ...patch }));

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: "rgba(0,0,0,0.8)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rounded-xl shadow-2xl w-[500px] flex flex-col" style={{ background: "#1e2d3d", border: "1px solid #3d5a73", maxHeight: "80vh" }}>

        {/* Header */}
        <div className="flex items-center gap-2.5 px-5 py-4 border-b flex-shrink-0" style={{ borderColor: "#0d1117" }}>
          <span className="text-lg">🍷</span>
          <span className="font-bold flex-1" style={{ color: "#fff" }}>Wine / Proton Settings</span>
          <button onClick={onClose} style={{ color: "#8f98a0", fontSize: "18px" }}>✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Enable toggle */}
          <label className="flex items-center gap-3 cursor-pointer">
            <div className="relative w-10 h-5 flex-shrink-0">
              <input type="checkbox" className="sr-only" checked={cfg.enabled}
                onChange={(e) => upd({ enabled: e.currentTarget.checked })} />
              <div className="w-10 h-5 rounded-full transition-colors"
                style={{ background: cfg.enabled ? "#2a6db5" : "#2a3f54", border: "1px solid #3d5a73" }} />
              <div className="absolute top-0.5 rounded-full w-4 h-4 transition-transform"
                style={{ background: "#fff", left: cfg.enabled ? "22px" : "2px", transition: "left 0.15s" }} />
            </div>
            <div>
              <p className="text-sm font-semibold" style={{ color: "#c6d4df" }}>Run via Wine / Proton</p>
              <p className="text-[11px]" style={{ color: "#4a5568" }}>When disabled, games launch directly (use on Linux-native builds)</p>
            </div>
          </label>

          {cfg.enabled && (<>
            {/* Runner type */}
            <div>
              <p className="text-xs font-semibold mb-2" style={{ color: "#8f98a0" }}>Runner type</p>
              <div className="flex gap-2">
                {(["wine", "proton", "custom"] as const).map((r) => (
                  <button key={r} onClick={() => upd({ runner: r })}
                    className="flex-1 py-2 rounded text-xs font-semibold capitalize"
                    style={{
                      background: cfg.runner === r ? "#2a6db5" : "#1b2d3d",
                      color: cfg.runner === r ? "#fff" : "#5a6a7a",
                      border: `1px solid ${cfg.runner === r ? "#3d7dc8" : "#253545"}`,
                    }}>{r === "wine" ? "🍷 Wine" : r === "proton" ? "⚙ Proton" : "🔧 Custom"}</button>
                ))}
              </div>
            </div>

            {/* Auto-detected runners */}
            {detected.length > 0 && (
              <div>
                <p className="text-xs font-semibold mb-1.5" style={{ color: "#8f98a0" }}>Detected on this system</p>
                <div className="space-y-1">
                  {detected.map((d) => (
                    <button key={d.path}
                      onClick={() => upd({ runnerPath: d.path, runner: d.kind as "wine" | "proton" | "custom" })}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded text-xs text-left"
                      style={{
                        background: cfg.runnerPath === d.path ? "#1a3a5c" : "#1b2d3d",
                        border: `1px solid ${cfg.runnerPath === d.path ? "#3d7dc8" : "#253545"}`,
                        color: "#c6d4df",
                      }}>
                      <span>{d.kind === "wine" ? "🍷" : "⚙"}</span>
                      <span className="font-semibold">{d.name}</span>
                      <span className="ml-auto font-mono text-[10px] truncate max-w-[220px]" style={{ color: "#4a5568" }}>{d.path}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {detecting && <p className="text-xs" style={{ color: "#4a5568" }}>Detecting runners…</p>}
            {!detecting && detected.length === 0 && (
              <p className="text-xs" style={{ color: "#4a5568" }}>No Wine or Proton installations detected automatically.</p>
            )}

            {/* Runner path */}
            <div>
              <p className="text-xs font-semibold mb-1.5" style={{ color: "#8f98a0" }}>
                {cfg.runner === "wine" ? "Wine executable path" : cfg.runner === "proton" ? "Proton executable path" : "Runner executable path"}
              </p>
              <input
                placeholder={cfg.runner === "wine" ? "/usr/bin/wine" : cfg.runner === "proton" ? "/path/to/proton" : "/path/to/runner"}
                value={cfg.runnerPath}
                onInput={(e) => upd({ runnerPath: (e.target as HTMLInputElement).value })}
                className="w-full px-3 py-1.5 rounded text-xs font-mono outline-none"
                style={{ background: "#0d1b2a", color: "#c6d4df", border: "1px solid #2a3f54" }} />
              <p className="text-[10px] mt-0.5" style={{ color: "#4a5568" }}>
                Leave blank to use system-wide binary from PATH
              </p>
            </div>

            {/* Prefix path */}
            <div>
              <p className="text-xs font-semibold mb-1.5" style={{ color: "#8f98a0" }}>
                {cfg.runner === "proton" ? "Steam Compat Data Path (STEAM_COMPAT_DATA_PATH)" : "Wine Prefix (WINEPREFIX)"}
              </p>
              <input
                placeholder={cfg.runner === "proton" ? "~/.steam/steam/steamapps/compatdata/custom" : "~/.wine"}
                value={cfg.prefixPath}
                onInput={(e) => upd({ prefixPath: (e.target as HTMLInputElement).value })}
                className="w-full px-3 py-1.5 rounded text-xs font-mono outline-none"
                style={{ background: "#0d1b2a", color: "#c6d4df", border: "1px solid #2a3f54" }} />
              <p className="text-[10px] mt-0.5" style={{ color: "#4a5568" }}>
                Leave blank to use the default prefix
              </p>
            </div>

            {/* Proton hint */}
            {cfg.runner === "proton" && (
              <div className="rounded-lg px-3 py-2.5 text-xs" style={{ background: "#1a2636", border: "1px solid #2a3f54", color: "#8f98a0", lineHeight: 1.6 }}>
                <p className="font-semibold mb-1" style={{ color: "#66c0f4" }}>Proton notes</p>
                <p>The <code style={{ color: "#f88379" }}>proton</code> script requires <strong>python3</strong> and a Steam installation.</p>
                <p>Set the data path to a folder that will hold the Proton prefix (Wine bottle) for your games.</p>
              </div>
            )}
          </>)}
        </div>

        {/* Footer */}
        <div className="flex gap-2 justify-end px-5 py-3 border-t flex-shrink-0" style={{ borderColor: "#0d1117" }}>
          <button onClick={onClose}
            className="px-4 py-2 rounded text-sm"
            style={{ background: "#152232", color: "#c6d4df", border: "1px solid #3d5a73" }}>Cancel</button>
          <button onClick={() => { onSave(cfg); onClose(); }}
            className="px-5 py-2 rounded text-sm font-semibold"
            style={{ background: "#2a6db5", color: "#fff" }}>Save</button>
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
      <div className="rounded-xl shadow-2xl w-96 flex flex-col" style={{ background: "#1e2d3d", border: "1px solid #3d5a73", maxHeight: "72vh" }}>
        <div className="flex items-center gap-2 px-5 py-4 border-b flex-shrink-0" style={{ borderColor: "#0d1117" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#66c0f4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          <span className="font-bold flex-1 text-sm truncate" style={{ color: "#fff" }}>Collections — {displayTitle}</span>
          <button onClick={onClose} className="text-lg leading-none" style={{ color: "#8f98a0" }}>✕</button>
        </div>
        <div className="flex-1 overflow-y-auto py-1" style={{ scrollbarWidth: "thin" }}>
          {collections.length === 0 && !creating && (
            <p className="px-5 py-5 text-sm text-center" style={{ color: "#8f98a0" }}>No collections yet.</p>
          )}
          {collections.map((col) => {
            const inCol = col.gamePaths.includes(gamePath);
            return (
              <label key={col.id} className="flex items-center gap-3 px-5 py-2.5 cursor-pointer"
                onMouseEnter={(e) => (e.currentTarget.style.background = "#253545")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: col.color }} />
                <span className="flex-1 text-sm" style={{ color: "#c6d4df" }}>{col.name}</span>
                <span className="text-[10px] mr-1" style={{ color: "#4a5568" }}>{col.gamePaths.length}</span>
                <input type="checkbox" checked={inCol}
                  onChange={(e) => onToggle(col.id, gamePath, e.currentTarget.checked)}
                  style={{ accentColor: col.color, width: "14px", height: "14px", cursor: "pointer" }} />
              </label>
            );
          })}
        </div>
        <div className="px-5 py-3 border-t flex-shrink-0" style={{ borderColor: "#0d1117" }}>
          {creating ? (
            <div className="space-y-2">
              <input autoFocus placeholder="Collection name…" value={newName}
                onInput={(e) => setNewName((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") setCreating(false); }}
                className="w-full px-3 py-1.5 rounded text-xs outline-none"
                style={{ background: "#2a3f54", color: "#c6d4df", border: "1px solid #3d5a73" }} />
              <div className="flex items-center gap-2">
                <span className="text-[10px]" style={{ color: "#8f98a0" }}>Color:</span>
                {COLLECTION_COLORS.map((c) => (
                  <button key={c} onClick={() => setNewColor(c)}
                    className="w-4 h-4 rounded-full flex-shrink-0"
                    style={{
                      background: c, outline: newColor === c ? "2px solid #fff" : "none", outlineOffset: "1px",
                      transform: newColor === c ? "scale(1.25)" : "scale(1)", transition: "transform 0.1s"
                    }} />
                ))}
              </div>
              <div className="flex gap-2">
                <button onClick={handleCreate}
                  className="flex-1 py-1.5 rounded text-xs font-semibold"
                  style={{ background: "#2a6db5", color: "#fff" }}>Create</button>
                <button onClick={() => setCreating(false)}
                  className="px-3 py-1.5 rounded text-xs"
                  style={{ background: "#2a3f54", color: "#8f98a0" }}>Cancel</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setCreating(true)}
              className="w-full py-1.5 rounded text-xs flex items-center justify-center gap-1.5"
              style={{ background: "#1b2d3d", color: "#8f98a0", border: "1px dashed #3d5a73" }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#66c0f4"; e.currentTarget.style.color = "#66c0f4"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#3d5a73"; e.currentTarget.style.color = "#8f98a0"; }}>
              + New Collection
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Stats helpers ────────────────────────────────────────────────────────────

/** Returns sessions grouped by calendar day (last N days) for charting. */
function sessionsPerDay(sessions: SessionEntry[], gamePath: string | null, days = 7): { label: string; secs: number }[] {
  const now = new Date();
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - (days - 1 - i));
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const dayEnd = dayStart + 86_400_000;
    const secs = sessions
      .filter(s => (!gamePath || s.path === gamePath) && s.startedAt >= dayStart && s.startedAt < dayEnd)
      .reduce((acc, s) => acc + s.duration, 0);
    const label = d.toLocaleDateString("en", { weekday: "short" });
    return { label, secs };
  });
}

const MILESTONES = [
  { hours: 1, label: "1h", color: "#66c0f4" },
  { hours: 5, label: "5h", color: "#4e9bd0" },
  { hours: 10, label: "10h", color: "#c8a951" },
  { hours: 25, label: "25h", color: "#e8904a" },
  { hours: 50, label: "50h", color: "#e05050" },
  { hours: 100, label: "100h", color: "#a060d8" },
];

// ─── PlayChart ────────────────────────────────────────────────────────────────
function PlayChart({ sessions, gamePath, days = 7 }: { sessions: SessionEntry[]; gamePath: string | null; days?: number }) {
  const data = sessionsPerDay(sessions, gamePath, days);
  const maxSecs = Math.max(...data.map(d => d.secs), 1);
  const H = 80;

  return (
    <div className="w-full">
      <svg width="100%" height={H + 20} style={{ overflow: "visible" }}>
        {data.map((d, i) => {
          const barH = Math.max(d.secs > 0 ? 4 : 0, Math.round((d.secs / maxSecs) * H));
          const wPct = 100 / days;
          const gapPct = 1.5;
          const xPct = i * wPct + (gapPct / 2);
          const barWPct = wPct - gapPct;

          return (
            <g key={i}>
              <rect x={`${xPct}%`} y={H - barH} width={`${barWPct}%`} height={barH}
                rx="2"
                fill={d.secs > 0 ? "#2a6db5" : "#1a2d3d"}
                style={{ transition: "height 0.3s" }}>
                {d.secs > 0 && <title>{formatTime(d.secs)}</title>}
              </rect>
              <text x={`${i * wPct + (wPct / 2)}%`} y={H + 14} textAnchor="middle"
                fontSize="9" fill="#4a5568">{d.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─── Milestones ───────────────────────────────────────────────────────────────
function Milestones({ totalSecs }: { totalSecs: number }) {
  const totalH = totalSecs / 3600;
  const achieved = MILESTONES.filter(m => totalH >= m.hours);
  const next = MILESTONES.find(m => totalH < m.hours);
  if (achieved.length === 0 && !next) return null;
  return (
    <div>
      <p className="text-xs uppercase tracking-widest mb-2" style={{ color: "#8f98a0" }}>Milestones</p>
      <div className="flex flex-wrap gap-1.5 mb-1">
        {achieved.map(m => (
          <span key={m.label}
            className="px-2 py-0.5 rounded-full text-[10px] font-bold"
            style={{ background: m.color + "22", color: m.color, border: `1px solid ${m.color}55` }}
            title={`${m.hours}h played`}>
            ★ {m.label}
          </span>
        ))}
      </div>
      {next && (
        <div className="mt-1">
          <div className="flex justify-between text-[9px] mb-0.5" style={{ color: "#4a5568" }}>
            <span>Next: {next.label}</span>
            <span>{Math.round((totalH / next.hours) * 100)}%</span>
          </div>
          <div className="h-1 rounded-full overflow-hidden" style={{ background: "#1a2d3d" }}>
            <div className="h-full rounded-full" style={{
              width: `${Math.min(100, (totalH / next.hours) * 100)}%`,
              background: next.color,
              transition: "width 0.4s",
            }} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── SessionTimeline ──────────────────────────────────────────────────────────
function SessionTimeline({ sessions, gamePath, onEditNote }: {
  sessions: SessionEntry[];
  gamePath: string;
  onEditNote: (entry: SessionEntry) => void;
}) {
  const entries = useMemo(() =>
    sessions.filter(s => s.path === gamePath).sort((a, b) => b.startedAt - a.startedAt).slice(0, 50),
    [sessions, gamePath]
  );

  if (entries.length === 0) {
    return (
      <div className="rounded px-3 py-4 text-center text-xs" style={{ background: "#0f1923", color: "#4a5568" }}>
        No sessions recorded yet — play the game to see history here.
      </div>
    );
  }

  return (
    <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1"
      style={{ scrollbarWidth: "thin", scrollbarColor: "#2a475e transparent" }}>
      {entries.map((s) => {
        const d = new Date(s.startedAt);
        const dateStr = d.toLocaleDateString("en", { month: "short", day: "numeric" });
        const timeStr = d.toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" });
        return (
          <div key={s.id} className="flex items-start gap-2 rounded px-2.5 py-2 group"
            style={{ background: "#0f1923" }}>
            {/* Timeline dot */}
            <div className="flex flex-col items-center flex-shrink-0 mt-0.5">
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: "#2a6db5" }} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px]" style={{ color: "#66c0f4" }}>{dateStr} {timeStr}</span>
                <span className="text-[10px] font-semibold" style={{ color: "#c6d4df" }}>{formatTime(s.duration)}</span>
              </div>
              {s.note && (
                <p className="text-xs mt-0.5 italic" style={{ color: "#8f98a0" }}>"{s.note}"</p>
              )}
            </div>
            <button
              onClick={() => onEditNote(s)}
              className="text-[9px] flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity px-1.5 py-0.5 rounded"
              style={{ color: "#66c0f4", background: "#1a2d3d" }}
              title={s.note ? "Edit note" : "Add note"}>
              {s.note ? "✎" : "+ note"}
            </button>
          </div>
        );
      })}
    </div>
  );
}

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
          background: "#1e2d3d", border: "1px solid #2a475e",
          pointerEvents: "all",
          animation: "slideInUp 0.25s ease-out",
        }}>
        <div className="flex items-start gap-3 px-4 pt-4 pb-3 border-b" style={{ borderColor: "#1b3a50" }}>
          <div className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0"
            style={{ background: "#0f1923" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#66c0f4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold" style={{ color: "#fff" }}>Session complete</p>
            <p className="text-[10px]" style={{ color: "#8f98a0" }}>
              {gameName} · {formatTime(session.duration)}
            </p>
          </div>
          <button onClick={onDismiss} style={{ color: "#4a5568" }} className="text-sm">✕</button>
        </div>
        <div className="px-4 py-3">
          <p className="text-[10px] mb-1.5" style={{ color: "#8f98a0" }}>Add a session note (optional)</p>
          <textarea
            value={note}
            onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)}
            placeholder="e.g. finished chapter 3, found secret ending…"
            rows={2}
            className="w-full rounded px-2 py-1.5 text-xs resize-none"
            style={{
              background: "#0f1923", border: "1px solid #2a475e", color: "#c6d4df",
              outline: "none", fontFamily: "inherit",
            }}
          />
          <div className="flex gap-2 justify-end mt-2">
            <button onClick={onDismiss} className="px-3 py-1 rounded text-xs"
              style={{ background: "transparent", color: "#4a5568" }}>Skip</button>
            <button onClick={() => onSave(note.trim())}
              className="px-4 py-1 rounded text-xs font-semibold"
              style={{ background: "#2a6db5", color: "#fff" }}>Save</button>
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
        style={{ background: "#1e2d3d", border: "1px solid #2a475e" }}>
        {/* Header */}
        <div className="flex items-center gap-3 px-6 pt-5 pb-4 border-b flex-shrink-0" style={{ borderColor: "#1b3a50" }}>
          <div className="w-9 h-9 rounded flex items-center justify-center" style={{ background: "#171a21" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="#66c0f4">
              <path d="M12 2C6.48 2 2 6.48 2 12l5.84 2.41c.53-.32 1.14-.51 1.8-.51.07 0 .14 0 .21.01L12 10.5V10.42c0-2.52 2.04-4.58 4.56-4.58 2.52 0 4.56 2.04 4.56 4.58 0 2.52-2.04 4.56-4.56 4.56h-.1l-3.5 2.53c0 .06.01.12.01.18 0 1.89-1.53 3.42-3.42 3.42-1.67 0-3.07-1.2-3.36-2.79L2.17 14C3.14 18.55 7.15 22 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2z" />
            </svg>
          </div>
          <div>
            <h2 className="font-bold text-base" style={{ color: "#fff" }}>Import from Steam</h2>
            <p className="text-xs" style={{ color: "#8f98a0" }}>Pre-fill playtime from localconfig.vdf</p>
          </div>
          <button onClick={onClose} className="ml-auto text-xl" style={{ color: "#4a5568" }}>✕</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4"
          style={{ scrollbarWidth: "thin", scrollbarColor: "#2a475e transparent" }}>
          {loading && (
            <div className="flex items-center justify-center h-24 gap-3">
              <div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "#66c0f4" }} />
              <span className="text-sm" style={{ color: "#8f98a0" }}>Reading Steam data…</span>
            </div>
          )}
          {error && <p className="text-sm" style={{ color: "#e57373" }}>{error}</p>}
          {!loading && !error && steamEntries.length === 0 && (
            <p className="text-sm text-center py-8" style={{ color: "#8f98a0" }}>
              No Steam data found. Make sure Steam is installed and you've launched at least one game.
            </p>
          )}
          {!loading && !error && matched.length > 0 && (
            <div>
              <p className="text-xs mb-3" style={{ color: "#8f98a0" }}>
                Found {matched.length} matching game{matched.length !== 1 ? "s" : ""}. Select which to import:
              </p>
              <div className="space-y-2">
                {matched.map(m => (
                  <label key={m.path} className="flex items-center gap-3 rounded-lg px-3 py-2 cursor-pointer"
                    style={{ background: "#152232" }}>
                    <input type="checkbox" checked={m.checked} onChange={() => toggle(m.path)}
                      className="rounded" style={{ accentColor: "#66c0f4" }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate" style={{ color: "#c6d4df" }}>{m.name}</p>
                      <p className="text-[10px]" style={{ color: "#4a5568" }}>
                        Steam: "{m.steamName}" · {formatTime(m.addSecs)}
                      </p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}
          {!loading && !error && steamEntries.length > 0 && matched.length === 0 && (
            <p className="text-sm text-center py-4" style={{ color: "#8f98a0" }}>
              Found {steamEntries.length} Steam entries but none match your library by name.
            </p>
          )}
        </div>

        {/* Footer */}
        {!loading && matched.length > 0 && (
          <div className="flex gap-3 justify-end px-6 py-4 border-t flex-shrink-0" style={{ borderColor: "#1b3a50" }}>
            <button onClick={onClose} className="px-4 py-2 rounded text-sm"
              style={{ background: "transparent", color: "#8f98a0", border: "1px solid #2a475e" }}>Cancel</button>
            <button onClick={handleApply}
              className="px-5 py-2 rounded text-sm font-semibold"
              style={{ background: "#2a6db5", color: "#fff" }}>
              Apply {matched.filter(m => m.checked).length} import{matched.filter(m => m.checked).length !== 1 ? "s" : ""}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Settings Modal ────────────────────────────────────────────────────────────
function SettingsModal({
  f95LoggedIn, dlsiteLoggedIn, libraryFolders, syncState, platform, launchConfig,
  appUpdate, appSettings,
  onF95Login, onF95Logout, onDLsiteLogin, onDLsiteLogout, onRemoveFolder,
  onRescanAll, onWineSettings, onSteamImport, onAppUpdate, onSaveSettings, onClose,
  onExportCSV, onExportHTML, onBatchMetadataRefresh, batchRefreshStatus
}: {
  f95LoggedIn: boolean; dlsiteLoggedIn: boolean; libraryFolders: { path: string }[]; syncState: string;
  platform: string; launchConfig: { enabled: boolean; runner: string };
  appUpdate: { version: string } | null; appSettings: AppSettings;
  onF95Login: () => void; onF95Logout: () => void;
  onDLsiteLogin: () => void; onDLsiteLogout: () => void;
  onRemoveFolder: (p: string) => void;
  onRescanAll: () => void; onWineSettings: () => void; onSteamImport: () => void;
  onAppUpdate: () => void; onSaveSettings: (s: AppSettings) => void; onClose: () => void;
  onExportCSV: () => void; onExportHTML: () => void;
  onBatchMetadataRefresh: () => void;
  batchRefreshStatus: string | null;
}) {
  const [tab, setTab] = useState<"general" | "scanner" | "import" | "rss" | "wine">("general");
  const tabs: { id: typeof tab; label: string }[] = [
    { id: "general", label: "General" },
    { id: "scanner", label: "Scanner" },
    { id: "import", label: "Import" },
    { id: "rss", label: "RSS Feeds" },
    ...(platform !== "windows" ? [{ id: "wine" as const, label: "Wine / Proton" }] : []),
  ];
  return (
    <div className="fixed inset-0 z-[9990] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.75)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rounded-xl shadow-2xl flex flex-col overflow-hidden"
        style={{ width: 480, maxHeight: "80vh", background: "#1b2838", border: "1px solid #2a475e" }}>

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b flex-shrink-0" style={{ borderColor: "#1e3a50" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#66c0f4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          <h2 className="font-bold text-base flex-1" style={{ color: "#fff" }}>Settings</h2>
          <button onClick={onClose} style={{ color: "#4a5568", fontSize: 18, lineHeight: 1 }}>✕</button>
        </div>

        {/* Tab bar */}
        <div className="flex gap-0.5 px-4 pt-3 flex-shrink-0">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className="px-3 py-1.5 rounded-t text-xs font-medium"
              style={{
                background: tab === t.id ? "#16202d" : "transparent",
                color: tab === t.id ? "#66c0f4" : "#4a5568",
                borderBottom: tab === t.id ? "2px solid #66c0f4" : "2px solid transparent",
              }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4"
          style={{ background: "#16202d", scrollbarWidth: "thin", scrollbarColor: "#2a475e transparent" }}>

          {tab === "general" && (
            <>
              <section className="space-y-2">
                <h3 className="text-[10px] uppercase tracking-widest" style={{ color: "#4a5568" }}>F95zone</h3>
                {f95LoggedIn ? (
                  <div className="flex items-center justify-between rounded-lg px-3 py-2.5"
                    style={{ background: "#1e2d3d", border: "1px solid #2a475e" }}>
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full" style={{ background: "#c8a951" }} />
                      <span className="text-sm" style={{ color: "#c8a951" }}>Logged in</span>
                    </div>
                    <button onClick={onF95Logout}
                      className="text-xs px-3 py-1 rounded"
                      style={{ background: "#3a2a00", color: "#c8a951", border: "1px solid #5a4200" }}>
                      Sign out
                    </button>
                  </div>
                ) : (
                  <button onClick={() => { onClose(); onF95Login(); }}
                    className="w-full py-2 rounded-lg text-sm text-left px-3 flex items-center gap-2"
                    style={{ background: "#1e2d3d", color: "#8f98a0", border: "1px solid #2a475e" }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#66c0f4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><polyline points="10 17 15 12 10 7" /><line x1="15" y1="12" x2="3" y2="12" />
                    </svg>
                    Sign in to F95zone
                  </button>
                )}
              </section>

              {/* DLsite */}
              <section className="space-y-2">
                <h3 className="text-[10px] uppercase tracking-widest" style={{ color: "#4a5568" }}>DLsite</h3>
                {dlsiteLoggedIn ? (
                  <div className="flex items-center justify-between rounded-lg px-3 py-2.5"
                    style={{ background: "#1e2d3d", border: "1px solid #2a475e" }}>
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full" style={{ background: "#e0534a" }} />
                      <span className="text-sm" style={{ color: "#e0534a" }}>Logged in</span>
                    </div>
                    <button onClick={onDLsiteLogout}
                      className="text-xs px-3 py-1 rounded"
                      style={{ background: "#3a1010", color: "#e0534a", border: "1px solid #6a2020" }}>
                      Sign out
                    </button>
                  </div>
                ) : (
                  <button onClick={() => { onClose(); onDLsiteLogin(); }}
                    className="w-full py-2 rounded-lg text-sm text-left px-3 flex items-center gap-2"
                    style={{ background: "#1e2d3d", color: "#8f98a0", border: "1px solid #2a475e" }}>
                    <div className="w-5 h-5 rounded flex items-center justify-center text-[9px] font-bold flex-shrink-0"
                      style={{ background: "#e0534a", color: "#fff" }}>DL</div>
                    Sign in to DLsite
                    <span className="ml-auto text-[9px]" style={{ color: "#4a5568" }}>age-gate bypass</span>
                  </button>
                )}
              </section>

              <section className="space-y-3 mt-4 border-t pt-4" style={{ borderColor: "#1e3a50" }}>
                <h3 className="text-[10px] uppercase tracking-widest" style={{ color: "#4a5568" }}>System & Notifications</h3>
                <label className="flex items-center gap-2 text-sm" style={{ color: "#8f98a0" }}>
                  <input type="checkbox" checked={appSettings.startupWithWindows}
                    onChange={(e) => onSaveSettings({ ...appSettings, startupWithWindows: e.currentTarget.checked })} />
                  Start minimized in tray with Windows
                </label>
                <label className="flex items-center gap-2 text-sm" style={{ color: "#8f98a0" }}>
                  <input type="checkbox" checked={appSettings.updateCheckerEnabled}
                    onChange={(e) => onSaveSettings({ ...appSettings, updateCheckerEnabled: e.currentTarget.checked })} />
                  Check for game updates (F95/DLsite)
                </label>
                <label className="flex items-center gap-2 text-sm" style={{ color: "#8f98a0" }}>
                  <input type="checkbox" checked={appSettings.sessionToastEnabled}
                    onChange={(e) => onSaveSettings({ ...appSettings, sessionToastEnabled: e.currentTarget.checked })} />
                  Show system notification on session end
                </label>
                <label className="flex items-center gap-2 text-sm" style={{ color: "#8f98a0" }}>
                  <input type="checkbox" checked={appSettings.trayTooltipEnabled}
                    onChange={(e) => onSaveSettings({ ...appSettings, trayTooltipEnabled: e.currentTarget.checked })} />
                  Live session duration in tray tooltip
                </label>
                <label className="flex items-center gap-2 text-sm" style={{ color: "#8f98a0" }}>
                  <input type="checkbox" checked={appSettings.blurNsfwContent}
                    onChange={(e) => onSaveSettings({ ...appSettings, blurNsfwContent: e.currentTarget.checked })} />
                  Blur adult/NSFW covers (Click to reveal)
                </label>
                <label className="flex items-center gap-2 text-sm" style={{ color: "#8f98a0" }} title="Automatically take a screenshot while a game is running">
                  Auto-screenshot interval (mins)
                  <input type="number" min="0" className="w-12 px-1 py-1 bg-transparent border rounded outline-none text-center ml-2"
                    style={{ color: "#c6d4df", borderColor: "#2a475e" }}
                    value={appSettings.autoScreenshotInterval || 0}
                    onChange={e => onSaveSettings({ ...appSettings, autoScreenshotInterval: Math.max(0, parseInt(e.currentTarget.value) || 0) })} />
                  <span className="text-[10px] ml-2" style={{ color: "#4a5568" }}>(0 to disable)</span>
                </label>
              </section>

              <section className="space-y-3 mt-4 border-t pt-4" style={{ borderColor: "#1e3a50" }}>
                <h3 className="text-[10px] uppercase tracking-widest" style={{ color: "#4a5568" }}>Panic Button (Boss Key)</h3>
                <label className="flex items-center gap-2 text-sm" style={{ color: "#8f98a0" }} title="Press a global hotkey to instantly hide the game and open something else.">
                  <input type="checkbox" checked={appSettings.bossKeyEnabled}
                    onChange={(e) => onSaveSettings({ ...appSettings, bossKeyEnabled: e.currentTarget.checked })} />
                  Enable Panic Button
                </label>
                {appSettings.bossKeyEnabled && (
                  <div className="pl-6 space-y-3 mt-2">
                    <label className="flex items-center gap-2 text-xs" style={{ color: "#8f98a0" }}>
                      Hotkey:
                      <select value={appSettings.bossKeyCode || 0x7A}
                        onChange={(e) => onSaveSettings({ ...appSettings, bossKeyCode: parseInt(e.currentTarget.value) })}
                        className="bg-transparent border rounded px-2 py-1 outline-none text-[#c6d4df]" style={{ borderColor: "#2a475e" }}>
                        {[...Array(11)].map((_, i) => (
                          <option key={i} value={0x70 + i} style={{ background: "#152232" }}>F{i + 1}</option>
                        ))}
                      </select>
                    </label>
                    <label className="flex items-center gap-2 text-xs" style={{ color: "#8f98a0" }}>
                      Action:
                      <select value={appSettings.bossKeyAction || "hide"}
                        onChange={(e) => onSaveSettings({ ...appSettings, bossKeyAction: e.currentTarget.value as "hide" | "kill" })}
                        className="bg-transparent border rounded px-2 py-1 outline-none text-[#c6d4df]" style={{ borderColor: "#2a475e" }}>
                        <option value="hide" style={{ background: "#152232" }}>Hide Window (Smooth, but audio keeps playing)</option>
                        <option value="kill" style={{ background: "#152232" }}>Force Close Game (Stops audio instantly)</option>
                      </select>
                    </label>
                    <label className="flex items-center gap-2 text-xs" style={{ color: "#8f98a0" }}>
                      <input type="checkbox" checked={appSettings.bossKeyMuteSystem}
                        onChange={(e) => onSaveSettings({ ...appSettings, bossKeyMuteSystem: e.currentTarget.checked })} />
                      Also mute system volume (Shows Windows volume overlay)
                    </label>
                    <label className="flex items-center gap-2 text-xs" style={{ color: "#8f98a0" }}>
                      Fallback App / URL:
                      <input type="text" placeholder="e.g. notepad.exe or https://google.com" className="bg-transparent border rounded px-2 py-1 outline-none flex-1 text-[#c6d4df]"
                        style={{ borderColor: "#2a475e" }} value={appSettings.bossKeyFallbackUrl || ""}
                        onChange={(e) => onSaveSettings({ ...appSettings, bossKeyFallbackUrl: e.currentTarget.value })} />
                    </label>
                  </div>
                )}
              </section>

              <section className="space-y-4 mt-4 border-t pt-4" style={{ borderColor: "#1e3a50" }}>
                <h3 className="text-[10px] uppercase tracking-widest" style={{ color: "#4a5568" }}>Export Library</h3>
                <div className="flex gap-2">
                  <button onClick={onExportCSV} className="flex-1 py-2 rounded text-xs font-semibold" style={{ background: "#2a3f54", color: "#c6d4df" }}>CSV Spreadsheet</button>
                  <button onClick={onExportHTML} className="flex-1 py-2 rounded text-xs font-semibold" style={{ background: "#2a3f54", color: "#c6d4df" }}>HTML Webpage</button>
                </div>
              </section>

              <section className="space-y-2 mt-4 border-t pt-4" style={{ borderColor: "#1e3a50" }}>
                <h3 className="text-[10px] uppercase tracking-widest" style={{ color: "#4a5568" }}>Library Folders</h3>
                <div className="rounded-lg overflow-hidden" style={{ border: "1px solid #2a475e" }}>
                  {libraryFolders.length === 0 ? (
                    <p className="px-3 py-3 text-xs" style={{ color: "#4a5568" }}>No folders added yet.</p>
                  ) : (
                    libraryFolders.map((f) => {
                      const label = f.path.replace(/\\/g, "/").split("/").pop() ?? f.path;
                      return (
                        <div key={f.path} className="flex items-center gap-2 px-3 py-2 border-b last:border-0"
                          style={{ borderColor: "#1e3a50" }}>
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#4a5568" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                          </svg>
                          <span className="flex-1 text-xs truncate" style={{ color: "#8f98a0" }} title={f.path}>{label}</span>
                          <button onClick={() => onRemoveFolder(f.path)}
                            className="text-[11px] px-1.5 rounded"
                            style={{ color: "#4a5568" }}
                            onMouseEnter={(e) => (e.currentTarget.style.color = "#e57373")}
                            onMouseLeave={(e) => (e.currentTarget.style.color = "#4a5568")}>×</button>
                        </div>
                      );
                    })
                  )}
                </div>
              </section>

              {appUpdate && (
                <section className="space-y-2">
                  <h3 className="text-[10px] uppercase tracking-widest" style={{ color: "#4a5568" }}>Updates</h3>
                  <button onClick={() => { onClose(); onAppUpdate(); }}
                    className="w-full py-2 rounded-lg text-sm px-3 flex items-center gap-2 font-semibold"
                    style={{ background: "#1a3a1a", color: "#6dbf6d", border: "1px solid #2a5a2a" }}>
                    ↑ v{appUpdate.version} available — click to install
                  </button>
                </section>
              )}
            </>
          )}

          {tab === "rss" && (
            <section className="space-y-4">
              <h3 className="text-[10px] uppercase tracking-widest" style={{ color: "#4a5568" }}>RSS Feeds</h3>
              <p className="text-xs" style={{ color: "#8f98a0" }}>Track game updates and discovering new releases.</p>

              <div className="space-y-2">
                {(appSettings.rssFeeds || DEFAULT_SETTINGS.rssFeeds).map((feed, idx) => (
                  <div key={idx} className="flex gap-2 p-3 rounded" style={{ background: "#1b2d3d", border: "1px solid #2a475e" }}>
                    <div className="flex-1 space-y-2">
                      <input type="text" value={feed.name} placeholder="Feed Name"
                        className="w-full bg-transparent text-sm font-semibold outline-none" style={{ color: "#c6d4df" }}
                        onChange={(e) => {
                          const nextFeeds = [...(appSettings.rssFeeds || DEFAULT_SETTINGS.rssFeeds)];
                          nextFeeds[idx] = { ...feed, name: (e.target as HTMLInputElement).value };
                          onSaveSettings({ ...appSettings, rssFeeds: nextFeeds });
                        }} />
                      <input type="text" value={feed.url} placeholder="Feed URL"
                        className="w-full bg-transparent text-xs w-full outline-none" style={{ color: "#8f98a0" }}
                        onChange={(e) => {
                          const nextFeeds = [...(appSettings.rssFeeds || DEFAULT_SETTINGS.rssFeeds)];
                          nextFeeds[idx] = { ...feed, url: (e.target as HTMLInputElement).value };
                          onSaveSettings({ ...appSettings, rssFeeds: nextFeeds });
                        }} />
                    </div>
                    <button onClick={() => {
                      const nextFeeds = (appSettings.rssFeeds || DEFAULT_SETTINGS.rssFeeds).filter((_, i) => i !== idx);
                      onSaveSettings({ ...appSettings, rssFeeds: nextFeeds });
                    }}
                      className="text-[#e57373] hover:text-white mt-1" style={{ width: 24, height: 24 }}>✕</button>
                  </div>
                ))}

                <button onClick={() => {
                  const nextFeeds = [...(appSettings.rssFeeds || DEFAULT_SETTINGS.rssFeeds), { name: "New Feed", url: "" }];
                  onSaveSettings({ ...appSettings, rssFeeds: nextFeeds });
                }}
                  className="w-full py-2 flex items-center justify-center gap-2 rounded text-sm text-[#c6d4df] hover:text-white"
                  style={{ border: "1px dashed #2a475e" }}>
                  + Add RSS Feed
                </button>
              </div>
            </section>
          )}

          {tab === "scanner" && (
            <section className="space-y-6">
              <div className="space-y-3">
                <h3 className="text-[10px] uppercase tracking-widest" style={{ color: "#4a5568" }}>Library Scanner</h3>
                <p className="text-xs leading-relaxed" style={{ color: "#8f98a0" }}>
                  Force a full re-scan of all library folders. Use this if new games were added to the folders outside of LIBMALY, or if some entries are missing.
                </p>
                <button onClick={() => { onRescanAll(); onClose(); }}
                  disabled={syncState !== "idle"}
                  className="w-full py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-40"
                  style={{ background: "#2a475e", color: "#c6d4df", border: "1px solid #3d7a9b" }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                  </svg>
                  Force Rescan All Folders
                </button>
              </div>

              <div className="space-y-3 border-t pt-4" style={{ borderColor: "#1e3a50" }}>
                <h3 className="text-[10px] uppercase tracking-widest" style={{ color: "#4a5568" }}>Metadata Refetch</h3>
                <p className="text-xs leading-relaxed" style={{ color: "#8f98a0" }}>
                  Update metadata for all currently linked games (runs in the background).
                </p>
                <button onClick={onBatchMetadataRefresh} disabled={!!batchRefreshStatus}
                  className="w-full py-2.5 rounded text-sm font-semibold disabled:opacity-50"
                  style={{ background: "#2a6db5", color: "#fff", border: "1px solid #3d7dc8" }}>
                  {batchRefreshStatus || "Refetch All Linked Games"}
                </button>
                <label className="flex items-center gap-2 text-sm mt-3" style={{ color: "#8f98a0" }}>
                  Auto-refetch metadata older than
                  <input type="number" min="0" className="w-12 px-1 py-1 bg-transparent border rounded outline-none text-center"
                    style={{ color: "#c6d4df", borderColor: "#2a475e" }}
                    value={appSettings.metadataAutoRefetchDays || 0}
                    onChange={e => onSaveSettings({ ...appSettings, metadataAutoRefetchDays: Math.max(0, parseInt(e.currentTarget.value) || 0) })} />
                  days (0 to disable)
                </label>
              </div>
            </section>
          )}

          {tab === "import" && (
            <section className="space-y-3">
              <h3 className="text-[10px] uppercase tracking-widest" style={{ color: "#4a5568" }}>Steam Playtime Import</h3>
              <p className="text-xs leading-relaxed" style={{ color: "#8f98a0" }}>
                Read playtime data from Steam's <code style={{ color: "#f88379" }}>localconfig.vdf</code> and pre-fill hours for games that match titles in your library. Only overrides your tracked time if Steam's value is higher.
              </p>
              <button onClick={() => { onSteamImport(); onClose(); }}
                className="w-full py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2"
                style={{ background: "#1a3050", color: "#66c0f4", border: "1px solid #2a5080" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#1e3a60")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "#1a3050")}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12l5.84 2.41c.53-.32 1.14-.51 1.8-.51.07 0 .14 0 .21.01L12 10.5V10.42c0-2.52 2.04-4.58 4.56-4.58 2.52 0 4.56 2.04 4.56 4.58 0 2.52-2.04 4.56-4.56 4.56h-.1l-3.5 2.53c0 .06.01.12.01.18 0 1.89-1.53 3.42-3.42 3.42-1.67 0-3.07-1.2-3.36-2.79L2.17 14C3.14 18.55 7.15 22 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2z" />
                </svg>
                Import from Steam…
              </button>
            </section>
          )}

          {tab === "wine" && platform !== "windows" && (
            <section className="space-y-3">
              <h3 className="text-[10px] uppercase tracking-widest" style={{ color: "#4a5568" }}>Wine / Proton</h3>
              <p className="text-xs leading-relaxed" style={{ color: "#8f98a0" }}>
                Configure the Wine or Proton runtime used to launch Windows games on Linux or macOS.
              </p>
              <button onClick={() => { onWineSettings(); onClose(); }}
                className="w-full py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2"
                style={{
                  background: launchConfig.enabled ? "#2a1f3a" : "#1e2d3d",
                  color: launchConfig.enabled ? "#b08ee8" : "#8f98a0",
                  border: `1px solid ${launchConfig.enabled ? "#5a3a8a" : "#2a475e"}`,
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
function VersionTimeline({ history, onAddHistory }: {
  history: HistoryEntry[];
  onAddHistory: (v: string, n: string) => void;
}) {
  const [isAdding, setIsAdding] = useState(false);
  const [draftV, setDraftV] = useState("");
  const [draftN, setDraftN] = useState("");

  const submit = () => {
    if (!draftV.trim() || !draftN.trim()) return;
    onAddHistory(draftV.trim(), draftN.trim());
    setIsAdding(false);
    setDraftV("");
    setDraftN("");
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center mb-2">
        <h2 className="text-xs uppercase tracking-widest text-[#8f98a0]">Version History</h2>
        <button onClick={() => setIsAdding(!isAdding)} className="text-xs text-[#66c0f4] hover:underline">
          {isAdding ? "Cancel" : "+ Log update"}
        </button>
      </div>

      {isAdding && (
        <div className="p-3 rounded mb-4" style={{ background: "#2a3f54", border: "1px solid #3d5a73" }}>
          <div className="flex gap-2 mb-2">
            <input type="text" placeholder="Vers" value={draftV} onChange={e => setDraftV(e.currentTarget.value)}
              className="w-16 px-2 py-1 bg-[#152232] border border-[#1b3a50] rounded text-xs outline-none focus:border-[#66c0f4] text-white" />
            <input type="text" placeholder="Update notes (e.g. Added patch)" value={draftN} onChange={e => setDraftN(e.currentTarget.value)}
              onKeyDown={e => e.key === "Enter" && submit()}
              className="flex-1 px-2 py-1 bg-[#152232] border border-[#1b3a50] rounded text-xs outline-none focus:border-[#66c0f4] text-white" />
            <button onClick={submit} className="px-3 py-1 bg-[#66c0f4] text-black text-xs font-semibold rounded">Log</button>
          </div>
        </div>
      )}

      {history.length === 0 ? (
        <p className="text-xs text-[#4a5568] italic">No version history logged yet.</p>
      ) : (
        <div className="relative border-l border-[#2a475e] ml-2 pl-4 pb-1">
          {history.map((h) => (
            <div key={h.id} className="relative mb-5 last:mb-0 group">
              {/* timeline dot */}
              <div className="absolute w-2 h-2 rounded-full bg-[#66c0f4] -left-[21px] top-1 transition-transform group-hover:scale-125" />
              <div className="flex items-baseline gap-2 mb-0.5">
                <span className="font-mono text-sm font-bold text-[#e57373]">{h.version}</span>
                <span className="text-[10px] text-[#4a5568]" title={new Date(h.date).toLocaleString()}>
                  {timeAgo(h.date)}
                </span>
              </div>
              <p className="text-xs text-[#b8c8d4] leading-relaxed">{h.note}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Game Detail ──────────────────────────────────────────────────────────────
function GameDetail({ game, stat, meta, customization, f95LoggedIn, screenshots, isHidden, isFav,
  onPlay, onStop, isRunning, runnerLabel, onDelete, onLinkPage, onOpenF95Login, onClearMeta, onUpdate,
  onTakeScreenshot, onOpenScreenshotsFolder, onUpdateScreenshotTags, onToggleHide, onToggleFav, onOpenCustomize, onSaveCustomization, onOpenNotes, hasNotes, onManageCollections,
  sessions, onEditSessionNote, appSettings, revealedNsfw, onRevealNsfw, history, onAddHistory }: {
    game: Game; stat: GameStats; meta?: GameMetadata;
    customization: GameCustomization; f95LoggedIn: boolean;
    screenshots: Screenshot[]; isHidden: boolean; isFav: boolean;
    onPlay: (overridePath?: string, overrideArgs?: string) => void; onStop: () => void; isRunning: boolean; runnerLabel?: string;
    onDelete: () => void; onLinkPage: () => void;
    onOpenF95Login: () => void; onClearMeta: () => void; onUpdate: () => void;
    onTakeScreenshot: () => void; onOpenScreenshotsFolder: () => void; onUpdateScreenshotTags: (filename: string, tags: string[]) => void;
    onToggleHide: () => void; onToggleFav: () => void; onOpenCustomize: () => void;
    onSaveCustomization: (changes: Partial<GameCustomization>) => void;
    onOpenNotes: () => void; hasNotes: boolean; onManageCollections: () => void;
    sessions: SessionEntry[]; onEditSessionNote: (entry: SessionEntry) => void;
    appSettings: AppSettings; revealedNsfw: Record<string, boolean>; onRevealNsfw: (path: string) => void;
    history: HistoryEntry[]; onAddHistory: (version: string, note: string) => void;
  }) {
  const [activeShot, setActiveShot] = useState(0);
  const cover = customization.coverUrl ?? meta?.cover_url;
  const heroBg = customization.backgroundUrl ?? cover;
  const displayTitle = customization.displayName ?? meta?.title ?? game.name;
  const shots = meta?.screenshots ?? [];

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">

      {/* Hero banner */}
      <div className="relative flex-shrink-0 overflow-hidden" style={{ height: "240px" }}>
        {heroBg
          ? <img src={heroBg} alt={displayTitle} className="absolute inset-0 w-full h-full object-cover"
            style={{ filter: "brightness(0.5)" }} />
          : <div className="absolute inset-0" style={{ background: heroGradient(game.name) }} />}

        <NsfwOverlay gamePath={game.path} meta={meta} appSettings={appSettings} revealed={revealedNsfw} onReveal={onRevealNsfw} />
        <div className="absolute inset-0"
          style={{ background: "linear-gradient(to top,#1b2838 0%,rgba(27,40,56,0.15) 60%,transparent 100%)" }} />
        <div className="absolute bottom-0 left-0 right-0 px-8 pb-5">
          <div className="flex items-end justify-between">
            <div>
              <div className="flex gap-2 mb-1.5">
                {meta?.source && (
                  <span className="inline-block text-xs px-2 py-0.5 rounded font-semibold"
                    style={{ background: meta.source === "f95" ? "#c8a951" : "#e0534a", color: meta.source === "f95" ? "#1a1a1a" : "#fff" }}>
                    {meta.source === "f95" ? "F95zone" : "DLsite"}
                  </span>
                )}
                {isHidden && (
                  <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded font-semibold"
                    style={{ background: "rgba(0,0,0,0.6)", color: "#8f98a0", border: "1px solid #3d5a73" }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                    Hidden
                  </span>
                )}
              </div>
              <h1 className="text-3xl font-bold" style={{ color: "#fff", textShadow: "0 2px 8px rgba(0,0,0,.9)" }}>{displayTitle}</h1>
              {meta?.version && <span className="text-sm mt-0.5 block" style={{ color: "#8cb4d5" }}>{meta.version}</span>}
            </div>
            {meta?.rating && (
              <div className="text-right mb-1">
                <p className="text-xs mb-0.5" style={{ color: "#8f98a0" }}>Rating</p>
                <p className="font-bold" style={{ color: "#c8a951" }}>★ {meta.rating}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Action bar */}
      <div className="flex items-center gap-2 px-8 py-3 flex-shrink-0"
        style={{ background: "#16202d", borderBottom: "1px solid #0d1117" }}>
        <button onClick={game.uninstalled ? undefined : (isRunning ? onStop : () => onPlay())}
          disabled={game.uninstalled}
          title={game.uninstalled ? "Reinstall the game or check folder to play" : ""}
          className="flex items-center gap-2 px-7 py-2 rounded font-bold text-sm uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ background: game.uninstalled ? "#3a3a3a" : (isRunning ? "#6b2222" : "#4c6b22"), color: game.uninstalled ? "#8f98a0" : (isRunning ? "#e88585" : "#d2e885") }}
          onMouseEnter={(e) => { if (!game.uninstalled) e.currentTarget.style.background = isRunning ? "#8a1e1e" : "#5c8a1e" }}
          onMouseLeave={(e) => { if (!game.uninstalled) e.currentTarget.style.background = isRunning ? "#6b2222" : "#4c6b22" }}>
          {game.uninstalled ? "Folder missing" : isRunning
            ? <><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" /></svg>Stop</>
            : <><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
              Play{runnerLabel && <span className="ml-1 text-[10px] font-normal normal-case opacity-80">via {runnerLabel}</span>}</>
          }
        </button>
        {customization?.pinnedExes?.map((ex, i) => (
          <button key={i} onClick={() => onPlay(ex.path, undefined)} disabled={isRunning}
            className="flex items-center gap-1.5 px-3 py-2 rounded text-sm disabled:opacity-50"
            style={{ background: "#2a3f54", color: "#c6d4df", border: "1px solid #3d5a73" }}
            onMouseEnter={(e) => { if (!isRunning) { e.currentTarget.style.background = "#1e4060"; e.currentTarget.style.color = "#66c0f4"; } }}
            onMouseLeave={(e) => { if (!isRunning) { e.currentTarget.style.background = "#2a3f54"; e.currentTarget.style.color = "#c6d4df"; } }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
            {ex.name}
          </button>
        ))}
        <button onClick={onLinkPage}
          className="flex items-center gap-1.5 px-3 py-2 rounded text-sm"
          style={{ background: "#2a3f54", color: "#8f98a0", border: "1px solid #3d5a73" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "#1e4060"; e.currentTarget.style.color = "#66c0f4"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "#2a3f54"; e.currentTarget.style.color = "#8f98a0"; }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
          {meta ? "Re-link" : "Link Page"}
        </button>
        <button onClick={onUpdate}
          className="flex items-center gap-1.5 px-3 py-2 rounded text-sm"
          style={{ background: "#2a3f54", color: "#8f98a0", border: "1px solid #3d5a73" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "#1e3020"; e.currentTarget.style.color = "#6dbf6d"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "#2a3f54"; e.currentTarget.style.color = "#8f98a0"; }}
          title="Install a new version safely (preserves saves)">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="16 16 12 12 8 16" /><line x1="12" y1="12" x2="12" y2="21" />
            <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
          </svg>
          Update
        </button>
        <button onClick={onOpenNotes}
          className="flex items-center gap-1.5 px-3 py-2 rounded text-sm"
          style={{ background: hasNotes ? "#1e2d1a" : "#2a3f54", color: hasNotes ? "#6dbf6d" : "#8f98a0", border: `1px solid ${hasNotes ? "#2a5a2a" : "#3d5a73"}` }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "#1e2d1a"; e.currentTarget.style.color = "#6dbf6d"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = hasNotes ? "#1e2d1a" : "#2a3f54"; e.currentTarget.style.color = hasNotes ? "#6dbf6d" : "#8f98a0"; }}
          title="Game notes (Markdown supported)">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
          Notes{hasNotes && <span className="w-1.5 h-1.5 rounded-full bg-current ml-0.5" />}
        </button>
        {meta && (
          <a href={meta.source_url} target="_blank" rel="noreferrer"
            className="flex items-center gap-1 px-3 py-2 rounded text-xs"
            style={{ background: "#152232", color: "#66c0f4", border: "1px solid #2a475e" }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
            </svg>
            Open {meta.source === "f95" ? "F95" : "DLsite"}
          </a>
        )}
        {!f95LoggedIn && (
          <button onClick={onOpenF95Login}
            className="flex items-center gap-1 px-3 py-2 rounded text-xs"
            style={{ background: "#2a1f00", color: "#c8a951", border: "1px solid #5a4200" }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            F95 Login
          </button>
        )}
        <div className="flex-1" />
        {meta && (
          <button onClick={onClearMeta}
            className="px-3 py-2 rounded text-xs"
            style={{ background: "transparent", color: "#4a5568" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#e57373")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#4a5568")}
            title="Remove linked metadata">✕ Unlink</button>
        )}
        <SettingsMenu
          isHidden={isHidden}
          isFav={isFav}
          onDelete={onDelete}
          onToggleHide={onToggleHide}
          onToggleFav={onToggleFav}
          onCustomize={onOpenCustomize}
          onManageCollections={onManageCollections}
        />
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-8 py-5"
        style={{ scrollbarWidth: "thin", scrollbarColor: "#2a475e transparent" }}>
        <div className="flex gap-6 max-w-5xl">

          {/* Left: overview, screenshots, tags */}
          <div className="flex-1 min-w-0 space-y-5">
            {(meta?.overview_html || meta?.overview) && (
              <section>
                <h2 className="text-xs uppercase tracking-widest mb-2" style={{ color: "#8f98a0" }}>Overview</h2>
                {meta.overview_html ? (
                  // DLsite: rich HTML (may contain inline images / character sprites)
                  <div
                    className="text-sm leading-relaxed dlsite-overview"
                    style={{ color: "#b8c8d4" }}
                    dangerouslySetInnerHTML={{ __html: meta.overview_html }}
                  />
                ) : (
                  // F95: plain text with paragraph breaks
                  <div className="text-sm leading-relaxed" style={{ color: "#b8c8d4" }}>
                    {meta.overview!.split("\n\n").map((para, i) => (
                      <p key={i} className={i > 0 ? "mt-3" : ""}>{para}</p>
                    ))}
                  </div>
                )}
              </section>
            )}
            {shots.length > 0 && (
              <section>
                <h2 className="text-xs uppercase tracking-widest mb-2" style={{ color: "#8f98a0" }}>Screenshots</h2>
                <div className="rounded overflow-hidden mb-2" style={{ background: "#0d1117" }}>
                  <img src={shots[activeShot]} alt="screenshot" className="w-full object-contain" style={{ maxHeight: "240px" }} />
                </div>
                <div className="flex gap-2 flex-wrap">
                  {shots.map((s, i) => (
                    <button key={i} onClick={() => setActiveShot(i)}
                      className="rounded overflow-hidden flex-shrink-0"
                      style={{
                        width: "78px", height: "50px", opacity: i === activeShot ? 1 : 0.5,
                        outline: i === activeShot ? "2px solid #66c0f4" : "none"
                      }}>
                      <img src={s} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              </section>
            )}
            {meta?.tags && meta.tags.length > 0 && (
              <section>
                <h2 className="text-xs uppercase tracking-widest mb-2" style={{ color: "#8f98a0" }}>Tags</h2>
                <div className="flex flex-wrap gap-1.5">
                  {meta.tags.map((t) => <TagBadge key={t} text={t} />)}
                </div>
              </section>
            )}
            <section>
              <h2 className="text-xs uppercase tracking-widest mb-2 flex items-center justify-between" style={{ color: "#8f98a0" }}>
                <span>Custom Tags</span>
              </h2>
              <div className="flex flex-wrap gap-1.5 items-center">
                {customization.customTags?.map((t) => (
                  <span key={t} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded cursor-pointer group"
                    style={{ background: "#2a475e", color: "#c6d4df", border: "1px solid #3d5a73" }}
                    onClick={() => {
                      const tags = customization.customTags?.filter(x => x !== t) || [];
                      onSaveCustomization({ customTags: tags });
                    }}>
                    {t} <span className="text-[10px] opacity-0 group-hover:opacity-100 transition-opacity">✕</span>
                  </span>
                ))}
                <input type="text" placeholder="+ add tag"
                  className="bg-transparent border border-dashed border-[#2a475e] text-[#8f98a0] hover:text-[#c6d4df] hover:border-[#3d5a73] transition-colors text-xs px-2 py-0.5 rounded outline-none w-24 focus:w-32 focus:border-solid focus:border-[#66c0f4] focus:text-[#fff]"
                  onKeyDown={e => {
                    if (e.key === "Enter") {
                      const val = e.currentTarget.value.trim().toLowerCase();
                      if (val) {
                        const tags = new Set(customization.customTags || []);
                        tags.add(val);
                        onSaveCustomization({ customTags: Array.from(tags) });
                        e.currentTarget.value = "";
                      }
                    }
                  }} />
              </div>
            </section>
            {!meta && (
              <div className="rounded-lg px-6 py-8 text-center" style={{ background: "#16202d", border: "2px dashed #2a3f54" }}>
                <p className="text-sm mb-1" style={{ color: "#8f98a0" }}>No metadata linked yet.</p>
                <p className="text-xs mb-4" style={{ color: "#4a5568" }}>
                  Link an F95zone or DLsite page to get cover art, description, tags and more.
                </p>
                <button onClick={onLinkPage}
                  className="px-5 py-2 rounded text-sm font-semibold"
                  style={{ background: "#2a6db5", color: "#fff" }}>
                  Link a Page
                </button>
              </div>
            )}
            <InGameGallery
              shots={screenshots}
              onTake={onTakeScreenshot}
              onOpenFolder={onOpenScreenshotsFolder}
              onUpdateTags={onUpdateScreenshotTags}
            />
            {/* Play History */}
            <section>
              <h2 className="text-xs uppercase tracking-widest mb-2" style={{ color: "#8f98a0" }}>Play History</h2>
              <SessionTimeline sessions={sessions} gamePath={game.path} onEditNote={onEditSessionNote} />
            </section>
            {/* Version History */}
            <section>
              <VersionTimeline history={history} onAddHistory={onAddHistory} />
            </section>
          </div>

          {/* Right: stats + info */}
          <div className="flex-shrink-0 w-60 space-y-4">
            <div className="rounded-lg p-4 space-y-3" style={{ background: "#16202d", border: "1px solid #1e3a50" }}>
              <h2 className="text-xs uppercase tracking-widest" style={{ color: "#8f98a0" }}>Your Stats</h2>
              <div>
                <p className="text-xs" style={{ color: "#8f98a0" }}>Total playtime</p>
                <p className="text-base font-semibold" style={{ color: "#c6d4df" }}>
                  {stat.totalTime > 0 ? formatTime(stat.totalTime) : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs" style={{ color: "#8f98a0" }}>Last played</p>
                <p className="text-sm" style={{ color: "#c6d4df" }}>{timeAgo(stat.lastPlayed)}</p>
              </div>
              {stat.lastSession > 0 && (
                <div>
                  <p className="text-xs" style={{ color: "#8f98a0" }}>Last session</p>
                  <p className="text-sm" style={{ color: "#c6d4df" }}>{formatTime(stat.lastSession)}</p>
                </div>
              )}
              {(stat.launchCount ?? 0) > 0 && (
                <div>
                  <p className="text-xs" style={{ color: "#8f98a0" }}>Times played</p>
                  <p className="text-sm font-semibold" style={{ color: "#66c0f4" }}>
                    {stat.launchCount} {stat.launchCount === 1 ? "session" : "sessions"}
                  </p>
                </div>
              )}
              {/* 7-day playtime chart */}
              {sessions.some(s => s.path === game.path) && (
                <div>
                  <p className="text-xs mb-2" style={{ color: "#8f98a0" }}>This week</p>
                  <PlayChart sessions={sessions} gamePath={game.path} />
                </div>
              )}
            </div>
            {/* Status & Budget */}
            <div className="rounded-lg p-4 space-y-4" style={{ background: "#16202d", border: "1px solid #1e3a50" }}>
              <div>
                <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: "#8f98a0" }}>Completion Status</label>
                <select
                  value={customization.status || ""}
                  onChange={(e) => onSaveCustomization({ status: ((e.target as HTMLSelectElement).value || undefined) as any })}
                  className="w-full bg-[#1b2838] border border-[#2a475e] rounded px-2 py-1.5 text-xs outline-none text-[#c6d4df] cursor-pointer"
                  style={{ backgroundImage: "none" }}>
                  <option value="">- Not Set -</option>
                  <option value="Playing">▶ Playing</option>
                  <option value="Completed">✓ Completed</option>
                  <option value="On Hold">⏸ On Hold</option>
                  <option value="Dropped">⏹ Dropped</option>
                  <option value="Plan to Play">📅 Plan to Play</option>
                </select>
              </div>
              <div>
                <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: "#8f98a0" }} title="Show a toast warning when you exceed this time in a single launch">Time Budget (mins)</label>
                <input
                  type="number"
                  min="0"
                  placeholder="No limit"
                  value={customization.timeLimitMins || ""}
                  onChange={(e) => {
                    const el = e.target as HTMLInputElement;
                    onSaveCustomization({ timeLimitMins: el.value ? parseInt(el.value) : undefined });
                  }}
                  className="w-full bg-[#1b2838] border border-[#2a475e] rounded px-2 py-1.5 text-xs outline-none text-[#c6d4df]" />
              </div>
            </div>
            {/* Milestones */}
            {stat.totalTime > 0 && (
              <div className="rounded-lg p-4" style={{ background: "#16202d", border: "1px solid #1e3a50" }}>
                <Milestones totalSecs={stat.totalTime} />
              </div>
            )}
            {meta && (
              <div className="rounded-lg p-4 space-y-2" style={{ background: "#16202d", border: "1px solid #1e3a50" }}>
                <h2 className="text-xs uppercase tracking-widest mb-3" style={{ color: "#8f98a0" }}>Game Info</h2>
                {/* F95 fields */}
                <MetaRow label="Developer" value={meta.developer} />
                <MetaRow label="Version" value={meta.version} />
                <MetaRow label="Engine" value={meta.engine} />
                <MetaRow label="OS" value={meta.os} />
                <MetaRow label="Language" value={meta.language} />
                <MetaRow label="Censored" value={meta.censored} />
                <MetaRow label="Released" value={meta.release_date} />
                <MetaRow label="Updated" value={meta.last_updated} />
                <MetaRow label="Price" value={meta.price} />
                {/* DLsite extended fields */}
                <MetaRow label="Circle" value={meta.circle} />
                <MetaRow label="Series" value={meta.series} />
                <MetaRow label="Author" value={meta.author} />
                <MetaRow label="Illustration" value={meta.illustration} />
                <MetaRow label="Voice Actor" value={meta.voice_actor} />
                <MetaRow label="Music" value={meta.music} />
                <MetaRow label="Age Rating" value={meta.age_rating} />
                <MetaRow label="Format" value={meta.product_format} />
                <MetaRow label="File Format" value={meta.file_format} />
                <MetaRow label="File Size" value={meta.file_size} />
              </div>
            )}
            <div className="rounded-lg p-4 space-y-2" style={{ background: "#16202d", border: "1px solid #1e3a50" }}>
              <h2 className="text-xs uppercase tracking-widest mb-3" style={{ color: "#8f98a0" }}>Files</h2>
              {customization.exeOverride ? (
                <>
                  <div>
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <p className="text-xs" style={{ color: "#c8a951" }}>Launch override</p>
                      <span className="text-[9px] px-1.5 py-px rounded font-semibold"
                        style={{ background: "#3a2800", color: "#c8a951", border: "1px solid #5a4200" }}>active</span>
                    </div>
                    <p className="text-xs font-mono break-all" style={{ color: "#c8a951" }}>
                      {customization.exeOverride}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs mb-0.5" style={{ color: "#8f98a0" }}>Scanned exe</p>
                    <p className="text-xs font-mono break-all" style={{ color: "#4a5568" }}>{game.path}</p>
                  </div>
                </>
              ) : (
                <div>
                  <p className="text-xs mb-0.5" style={{ color: "#8f98a0" }}>Executable</p>
                  <p className="text-xs font-mono break-all" style={{ color: "#66c0f4" }}>{game.path}</p>
                </div>
              )}
              <div>
                <p className="text-xs mb-0.5" style={{ color: "#8f98a0" }}>Folder</p>
                <p className="text-xs font-mono break-all" style={{ color: "#c6d4df" }}>
                  {game.path.replace(/[\\/][^\\/]+$/, "")}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div >
  );
}

interface RssItem {
  id: string;
  sourceName: string;
  title: string;
  link: string;
  pubDate: number;
  description: string;
}

function FeedView({ appSettings, wishlist, onToggleWishlist }: {
  appSettings: AppSettings;
  wishlist: WishlistItem[];
  onToggleWishlist: (item: Omit<WishlistItem, 'addedAt'>) => void;
}) {
  const [items, setItems] = useState<RssItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const fetchAll = async () => {
      setLoading(true);
      const allItems: RssItem[] = [];
      const feeds = appSettings.rssFeeds || DEFAULT_SETTINGS.rssFeeds;

      for (const feed of feeds) {
        if (!feed.url.trim()) continue;
        try {
          const xmlText = await invoke<string>("fetch_rss", { url: feed.url });
          const parser = new DOMParser();
          const doc = parser.parseFromString(xmlText, "text/xml");
          const itemNodes = doc.querySelectorAll("item");
          for (const node of itemNodes) {
            const title = node.querySelector("title")?.textContent || "No Title";
            const link = node.querySelector("link")?.textContent || "";
            const desc = node.querySelector("description")?.textContent || "";
            const pubDateStr = node.querySelector("pubDate")?.textContent;
            const pubDate = pubDateStr ? new Date(pubDateStr).getTime() : 0;
            const guid = node.querySelector("guid")?.textContent || link || title;
            allItems.push({
              sourceName: feed.name || "Unknown Source",
              title, link, description: desc, pubDate, id: guid
            });
          }
        } catch (e) {
          console.error("Failed to fetch RSS for", feed.name, e);
        }
      }
      if (!active) return;
      allItems.sort((a, b) => b.pubDate - a.pubDate);
      setItems(allItems);
      setLoading(false);
    };
    fetchAll();
    return () => { active = false; };
  }, [appSettings.rssFeeds]);

  return (
    <div className="flex-1 overflow-y-auto px-10 py-8" style={{ scrollbarWidth: "thin", scrollbarColor: "#2a475e transparent" }}>
      <div className="max-w-3xl mx-auto space-y-6">
        <h1 className="text-3xl font-bold mb-8" style={{ color: "#fff", textShadow: "0 2px 8px rgba(0,0,0,.9)" }}>News & Updates</h1>
        {loading ? (
          <div className="flex justify-center p-12">
            <div className="w-8 h-8 rounded-full border-2 border-[#66c0f4] border-t-transparent animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <p className="text-center py-12" style={{ color: "#8f98a0" }}>No updates found in your configured feeds.</p>
        ) : (
          items.map(item => (
            <div key={item.id} className="p-5 rounded-lg text-left" style={{ background: "#1b2838", border: "1px solid #2a475e" }}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded" style={{ background: "#2a475e", color: "#66c0f4" }}>{item.sourceName}</span>
                <span className="text-[11px]" style={{ color: "#8f98a0" }}>{item.pubDate > 0 ? new Date(item.pubDate).toLocaleString() : ""}</span>
              </div>
              <h2 className="text-lg font-bold mb-2 leading-tight flex items-start justify-between gap-4">
                <a href={item.link} target="_blank" rel="noreferrer" className="hover:underline flex-1" style={{ color: "#c6d4df" }}>{item.title}</a>
                <button
                  onClick={() => {
                    const statusMatch = item.title.match(/\[(Completed|Abandoned|On Hold|WIP|Alpha|Beta|Demo|Early Access)[^\]]*\]/i);
                    const releaseStatus = statusMatch ? statusMatch[1] : "Unknown";
                    onToggleWishlist({ id: item.link || item.id, title: item.title, source: item.sourceName, releaseStatus });
                  }}
                  className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full transition-colors"
                  style={{
                    background: wishlist.some(w => w.id === (item.link || item.id)) ? "#1a2c1a" : "#2a3f54",
                    color: wishlist.some(w => w.id === (item.link || item.id)) ? "#6dbf6d" : "#8f98a0"
                  }}
                  title={wishlist.some(w => w.id === (item.link || item.id)) ? "Remove from wishlist" : "Add to wishlist"}
                >
                  {wishlist.some(w => w.id === (item.link || item.id)) ? "★" : "+"}
                </button>
              </h2>
              <div className="text-sm prose prose-invert max-w-none opacity-80"
                style={{ color: "#8f98a0" }}
                dangerouslySetInnerHTML={{ __html: item.description }} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Stats View ────────────────────────────────────────────────────────────────
function StatsView({ games, stats, sessions, customizations, metadata }: {
  games: Game[]; stats: Record<string, GameStats>; sessions: SessionEntry[];
  customizations: Record<string, GameCustomization>; metadata: Record<string, GameMetadata>;
}) {
  const totalPlaytime = Object.values(stats).reduce((acc, s) => acc + (s.totalTime || 0), 0);
  const hours = Math.floor(totalPlaytime / 3600);
  const mins = Math.floor((totalPlaytime % 3600) / 60);

  const longestSession = sessions.length ? sessions.reduce((max, s) => s.duration > max.duration ? s : max, sessions[0]) : null;
  const lsGame = longestSession ? (customizations[longestSession.path]?.displayName || metadata[longestSession.path]?.title || games.find(g => g.path === longestSession.path)?.name || "Unknown") : "-";
  const lsHrs = longestSession ? Math.floor(longestSession.duration / 3600) : 0;
  const lsMins = longestSession ? Math.floor((longestSession.duration % 3600) / 60) : 0;

  let maxLaunches = 0;
  let mostLaunchedGame = "-";
  for (const path of Object.keys(stats)) {
    if ((stats[path].launchCount || 0) > maxLaunches) {
      maxLaunches = stats[path].launchCount;
      mostLaunchedGame = customizations[path]?.displayName || metadata[path]?.title || games.find(g => g.path === path)?.name || "Unknown";
    }
  }

  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const dayCounts = [0, 0, 0, 0, 0, 0, 0];
  sessions.forEach(s => {
    dayCounts[new Date(s.startedAt).getDay()]++;
  });
  let maxDayIdx = 0;
  for (let i = 1; i < 7; i++) {
    if (dayCounts[i] > dayCounts[maxDayIdx]) maxDayIdx = i;
  }
  const busiestDay = dayCounts[maxDayIdx] > 0 ? days[maxDayIdx] : "-";

  return (
    <div className="flex-1 overflow-y-auto px-10 py-8" style={{ background: "linear-gradient(to bottom, #1b2838 0%, #17212e 100%)", color: "#c6d4df" }}>
      <h2 className="text-2xl font-bold mb-8 tracking-wide" style={{ color: "#fff" }}>LIBRALY STATS</h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="p-6 rounded-lg shadow-sm" style={{ background: "#2a3f54", border: "1px solid #3d5a73" }}>
          <h3 className="text-xs uppercase tracking-widest mb-2" style={{ color: "#8f98a0" }}>Total Library Time</h3>
          <p className="text-3xl font-bold" style={{ color: "#66c0f4" }}>{hours}h {mins}m</p>
        </div>
        <div className="p-6 rounded-lg shadow-sm" style={{ background: "#2a3f54", border: "1px solid #3d5a73" }}>
          <h3 className="text-xs uppercase tracking-widest mb-2" style={{ color: "#8f98a0" }}>Longest Session</h3>
          <p className="text-xl font-bold mb-1" style={{ color: "#c8a951" }}>{lsHrs}h {lsMins}m</p>
          <p className="text-xs truncate text-ellipsis overflow-hidden" style={{ color: "#8f98a0" }}>{lsGame}</p>
        </div>
        <div className="p-6 rounded-lg shadow-sm" style={{ background: "#2a3f54", border: "1px solid #3d5a73" }}>
          <h3 className="text-xs uppercase tracking-widest mb-2" style={{ color: "#8f98a0" }}>Most Played Game</h3>
          <p className="text-xl font-bold mb-1" style={{ color: "#e57373" }}>{maxLaunches} launches</p>
          <p className="text-xs truncate text-ellipsis overflow-hidden" style={{ color: "#8f98a0" }}>{mostLaunchedGame}</p>
        </div>
        <div className="p-6 rounded-lg shadow-sm" style={{ background: "#2a3f54", border: "1px solid #3d5a73" }}>
          <h3 className="text-xs uppercase tracking-widest mb-2" style={{ color: "#8f98a0" }}>Busiest Day</h3>
          <p className="text-2xl font-bold" style={{ color: "#6dbf6d" }}>{busiestDay}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Home View ────────────────────────────────────────────────────────────────
function HomeView({ games, stats, sessions, metadata, customizations, favGames, notes, runningGamePath, onSelect, onPlay, onStop }: {
  games: Game[];
  stats: Record<string, GameStats>;
  sessions: SessionEntry[];
  metadata: Record<string, GameMetadata>;
  customizations: Record<string, GameCustomization>;
  favGames: Record<string, boolean>;
  notes: Record<string, string>;
  runningGamePath: string | null;
  onSelect: (g: Game) => void;
  onPlay: (path: string) => void;
  onStop: () => void;
}) {
  const cutoff = Date.now() - 60 * 24 * 60 * 60 * 1000; // 60 days ago

  const recent = useMemo(() =>
    games
      .filter((g) => (stats[g.path]?.lastPlayed ?? 0) > cutoff)
      .sort((a, b) => (stats[b.path]?.lastPlayed ?? 0) - (stats[a.path]?.lastPlayed ?? 0))
      .slice(0, 20),
    [games, stats]
  );

  const totalTime = useMemo(() =>
    Object.values(stats).reduce((s, v) => s + v.totalTime, 0),
    [stats]
  );

  // Most played this week — top 5 by session seconds in the last 7 days
  const weekAgo = Date.now() - 7 * 86_400_000;
  const mostPlayedThisWeek = useMemo(() => {
    const byPath: Record<string, number> = {};
    for (const s of sessions) {
      if (s.startedAt >= weekAgo) {
        byPath[s.path] = (byPath[s.path] ?? 0) + s.duration;
      }
    }
    return Object.entries(byPath)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([path, secs]) => ({ game: games.find(g => g.path === path), secs, path }))
      .filter(e => e.game != null) as { game: Game; secs: number; path: string }[];
  }, [sessions, games]);

  const displayName = (g: Game) =>
    customizations[g.path]?.displayName ?? metadata[g.path]?.title ?? g.name;
  const coverSrc = (g: Game) =>
    customizations[g.path]?.coverUrl ?? metadata[g.path]?.cover_url;

  return (
    <div className="flex-1 overflow-y-auto px-8 py-6"
      style={{ scrollbarWidth: "thin", scrollbarColor: "#2a475e transparent" }}>

      {/* Library stats banner */}
      <div className="flex items-center gap-6 mb-8 pb-5 border-b" style={{ borderColor: "#1b3a50" }}>
        <div>
          <p className="text-3xl font-bold" style={{ color: "#fff" }}>{games.length}</p>
          <p className="text-xs mt-0.5" style={{ color: "#8f98a0" }}>Games in library</p>
        </div>
        <div style={{ width: "1px", height: "36px", background: "#2a3f54" }} />
        <div>
          <p className="text-3xl font-bold" style={{ color: "#fff" }}>{Object.keys(stats).filter(k => stats[k].totalTime > 0).length}</p>
          <p className="text-xs mt-0.5" style={{ color: "#8f98a0" }}>Played</p>
        </div>
        <div style={{ width: "1px", height: "36px", background: "#2a3f54" }} />
        <div>
          <p className="text-3xl font-bold" style={{ color: "#fff" }}>{formatTime(totalTime)}</p>
          <p className="text-xs mt-0.5" style={{ color: "#8f98a0" }}>Total playtime</p>
        </div>
        <div style={{ width: "1px", height: "36px", background: "#2a3f54" }} />
        <div>
          <p className="text-3xl font-bold" style={{ color: "#fff" }}>{Object.keys(favGames).length}</p>
          <p className="text-xs mt-0.5" style={{ color: "#8f98a0" }}>Favourites</p>
        </div>
        <div style={{ width: "1px", height: "36px", background: "#2a3f54" }} />
        <div>
          <p className="text-3xl font-bold" style={{ color: "#fff" }}>{Object.keys(notes).filter(k => notes[k].trim()).length}</p>
          <p className="text-xs mt-0.5" style={{ color: "#8f98a0" }}>With notes</p>
        </div>
      </div>

      {/* Recent Games */}
      <section>
        <h2 className="text-xs uppercase tracking-widest mb-4" style={{ color: "#8f98a0" }}>
          Recent Games
          <span className="ml-2 font-normal normal-case" style={{ color: "#4a5568" }}>— played in the last 60 days</span>
        </h2>

        {recent.length === 0 ? (
          <div className="rounded-lg px-6 py-12 text-center" style={{ background: "#16202d", border: "2px dashed #2a3f54" }}>
            <p className="text-sm" style={{ color: "#8f98a0" }}>No games played recently.</p>
            <p className="text-xs mt-1" style={{ color: "#4a5568" }}>Launch a game to see it here.</p>
          </div>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
            {recent.map((game) => {
              const st = stats[game.path] ?? { totalTime: 0, lastPlayed: 0, lastSession: 0 };
              const cover = coverSrc(game);
              const name = displayName(game);
              const isFav = !!favGames[game.path];
              return (
                <div key={game.path}
                  className="rounded-lg overflow-hidden flex flex-col"
                  style={{ background: "#16202d", border: "1px solid #1e3a50" }}>
                  {/* Banner */}
                  <div className="relative flex-shrink-0 overflow-hidden cursor-pointer" style={{ height: "110px" }}
                    onClick={() => onSelect(game)}>
                    {cover
                      ? <img src={cover} alt="" className="w-full h-full object-cover" style={{ filter: "brightness(0.65)" }} />
                      : <div className="w-full h-full" style={{ background: heroGradient(game.name) }} />}
                    <div className="absolute inset-0"
                      style={{ background: "linear-gradient(to top,rgba(22,32,45,0.9) 0%,transparent 60%)" }} />
                    <div className="absolute bottom-0 left-0 px-3 pb-2 pr-2 right-0 flex items-end justify-between">
                      <p className="font-semibold text-sm line-clamp-2 flex-1 mr-2" style={{ color: "#fff", textShadow: "0 1px 4px rgba(0,0,0,0.9)" }}>
                        {isFav && <span style={{ color: "#c8a951", marginRight: "3px" }}>★</span>}
                        {name}
                      </p>
                    </div>
                  </div>
                  {/* Footer */}
                  <div className="flex items-center gap-2 px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px]" style={{ color: "#8f98a0" }}>
                        {timeAgo(st.lastPlayed)} · {st.totalTime > 0 ? formatTime(st.totalTime) : "—"}
                      </p>
                    </div>
                    <button onClick={() => onSelect(game)}
                      className="px-2.5 py-1 rounded text-xs flex-shrink-0"
                      style={{ background: "#2a3f54", color: "#8f98a0", border: "1px solid #3d5a73" }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "#1e4060"; e.currentTarget.style.color = "#66c0f4"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "#2a3f54"; e.currentTarget.style.color = "#8f98a0"; }}>
                      View
                    </button>
                    <button
                      onClick={() => runningGamePath === game.path ? onStop() : onPlay(game.path)}
                      className="px-2.5 py-1 rounded text-xs flex-shrink-0 flex items-center gap-1"
                      style={{ background: runningGamePath === game.path ? "#6b2222" : "#4c6b22", color: runningGamePath === game.path ? "#e88585" : "#d2e885" }}
                      onMouseEnter={(e) => e.currentTarget.style.background = runningGamePath === game.path ? "#8a1e1e" : "#5c8a1e"}
                      onMouseLeave={(e) => e.currentTarget.style.background = runningGamePath === game.path ? "#6b2222" : "#4c6b22"}>
                      {runningGamePath === game.path
                        ? <><svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" /></svg>Stop</>
                        : <><svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>Play</>}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Most Played This Week */}
      {mostPlayedThisWeek.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xs uppercase tracking-widest mb-4" style={{ color: "#8f98a0" }}>
            Most Played This Week
          </h2>
          <div className="rounded-xl p-4 space-y-3" style={{ background: "#16202d", border: "1px solid #1e3a50" }}>
            {mostPlayedThisWeek.map(({ game, secs, path }) => {
              const maxSecs = mostPlayedThisWeek[0].secs;
              const cover = coverSrc(game);
              const name = displayName(game);
              return (
                <div key={path} className="flex items-center gap-3 cursor-pointer"
                  onClick={() => onSelect(game)}>
                  <div className="w-8 h-8 rounded overflow-hidden flex-shrink-0"
                    style={{ background: heroGradient(game.name) }}>
                    {cover && <img src={cover} alt="" className="w-full h-full object-cover" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <p className="text-xs truncate font-medium" style={{ color: "#c6d4df" }}>{name}</p>
                      <span className="text-[10px] ml-2 flex-shrink-0" style={{ color: "#66c0f4" }}>{formatTime(secs)}</span>
                    </div>
                    <div className="h-1 rounded-full" style={{ background: "#1a2d3d" }}>
                      <div className="h-full rounded-full" style={{
                        width: `${(secs / maxSecs) * 100}%`,
                        background: "linear-gradient(90deg, #2a6db5, #66c0f4)",
                        transition: "width 0.4s",
                      }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Library-wide 7-day playtime chart */}
      {sessions.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xs uppercase tracking-widest mb-4" style={{ color: "#8f98a0" }}>
            Library Activity — Last 7 Days
          </h2>
          <div className="rounded-xl p-4" style={{ background: "#16202d", border: "1px solid #1e3a50" }}>
            <PlayChart sessions={sessions} gamePath={null} days={7} />
          </div>
        </section>
      )}
    </div>
  );
}

// ─── App Update Modal ─────────────────────────────────────────────────────────
function AppUpdateModal({
  version, url, downloadUrl, onClose,
}: { version: string; url: string; downloadUrl: string; onClose: () => void }) {
  type Phase = "idle" | "downloading" | "done" | "error";
  const [phase, setPhase] = useState<Phase>("idle");
  const [errMsg, setErrMsg] = useState("");

  const handleInstall = async () => {
    if (!downloadUrl) return;
    setPhase("downloading");
    try {
      await invoke("apply_update", { downloadUrl });
      // apply_update calls app.exit(0) on success, so we'll never reach here
      setPhase("done");
    } catch (e: any) {
      setErrMsg(String(e));
      setPhase("error");
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.82)" }}
      onClick={(e) => { if (e.target === e.currentTarget && phase !== "downloading") onClose(); }}>
      <div className="rounded-xl shadow-2xl w-[440px]"
        style={{ background: "#1e2d3d", border: "1px solid #2a475e" }}>

        {/* Header */}
        <div className="flex items-center gap-3 px-6 pt-5 pb-4 border-b" style={{ borderColor: "#1b3a50" }}>
          <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: "linear-gradient(135deg,#2a6db5,#1a4a80)" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#66c0f4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="16 16 12 12 8 16" /><line x1="12" y1="12" x2="12" y2="21" />
              <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-base" style={{ color: "#fff" }}>Update Available</h2>
            <p className="text-xs" style={{ color: "#8f98a0" }}>LIBMALY {version}</p>
          </div>
          {phase !== "downloading" && (
            <button onClick={onClose} className="text-xl leading-none" style={{ color: "#4a5568" }}>✕</button>
          )}
        </div>

        <div className="px-6 py-5 space-y-4">
          {phase === "idle" && (
            <>
              <p className="text-sm leading-relaxed" style={{ color: "#b8c8d4" }}>
                A new version of LIBMALY is ready.{" "}
                {downloadUrl
                  ? "Click <strong>Install Now</strong> to download and apply the update automatically — your library data, stats, and covers are stored in AppData and will not be affected."
                  : "No automatic installer is available for this release yet."}
              </p>
              {downloadUrl && (
                <div className="rounded-lg p-3 flex items-start gap-2.5"
                  style={{ background: "#0f1d2a", border: "1px solid #1e3a50" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#66c0f4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 mt-0.5">
                    <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  <p className="text-xs" style={{ color: "#8cb4d5" }}>
                    The app will close automatically after downloading so the update script can safely replace the files, then relaunch.
                  </p>
                </div>
              )}
              <div className="flex gap-3 justify-end pt-1">
                <a href={url} target="_blank" rel="noreferrer"
                  className="px-4 py-2 rounded text-xs flex items-center gap-1.5"
                  style={{ background: "transparent", color: "#8f98a0", border: "1px solid #2a475e" }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                  Changelog
                </a>
                {downloadUrl ? (
                  <button onClick={handleInstall}
                    className="px-5 py-2 rounded text-sm font-semibold flex items-center gap-2"
                    style={{ background: "#2a6db5", color: "#fff" }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="8 17 12 21 16 17" /><line x1="12" y1="12" x2="12" y2="21" />
                      <path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29" />
                    </svg>
                    Install Now
                  </button>
                ) : (
                  <button onClick={onClose}
                    className="px-4 py-2 rounded text-sm"
                    style={{ background: "#2a3f54", color: "#c6d4df" }}>Close</button>
                )}
              </div>
            </>
          )}

          {phase === "downloading" && (
            <div className="space-y-4 py-2">
              <div className="flex items-center gap-3">
                <div className="relative flex-shrink-0">
                  <div className="w-10 h-10 rounded-full" style={{ border: "3px solid #1e3a50" }} />
                  <div className="absolute inset-0 w-10 h-10 rounded-full animate-spin border-t-transparent border-2"
                    style={{ borderColor: "#66c0f4", borderTopColor: "transparent" }} />
                </div>
                <div>
                  <p className="text-sm font-medium" style={{ color: "#fff" }}>Downloading & installing…</p>
                  <p className="text-xs mt-0.5" style={{ color: "#8f98a0" }}>The app will relaunch automatically.</p>
                </div>
              </div>
              {/* Indeterminate progress bar */}
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "#0d1b2a" }}>
                <div className="h-full rounded-full animate-pulse" style={{ background: "linear-gradient(90deg, #2a6db5, #66c0f4)", width: "60%" }} />
              </div>
            </div>
          )}

          {phase === "done" && (
            <p className="text-sm text-center py-3" style={{ color: "#6dbf6d" }}>
              ✓ Update applied! Relaunching…
            </p>
          )}

          {phase === "error" && (
            <div className="space-y-3">
              <div className="rounded p-3" style={{ background: "#3a1010", border: "1px solid #8b2020" }}>
                <p className="text-xs font-semibold mb-1" style={{ color: "#e57373" }}>Auto-install failed</p>
                <p className="text-xs font-mono break-all" style={{ color: "#c89090" }}>{errMsg}</p>
              </div>
              <p className="text-xs" style={{ color: "#8f98a0" }}>
                You can{" "}
                <a href={url} target="_blank" rel="noreferrer" style={{ color: "#66c0f4" }}>download the update manually</a>
                {" "}from the release page.
              </p>
              <div className="flex justify-end gap-3">
                <button onClick={() => { setPhase("idle"); setErrMsg(""); }}
                  className="px-4 py-2 rounded text-sm"
                  style={{ background: "#152232", color: "#8f98a0", border: "1px solid #2a475e" }}>Retry</button>
                <button onClick={onClose}
                  className="px-4 py-2 rounded text-sm"
                  style={{ background: "#2a3f54", color: "#c6d4df" }}>Close</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  // ── Migrate legacy single-path storage to new multi-folder array ────────────
  const [libraryFolders, setLibraryFolders] = useState<LibraryFolder[]>(() => {
    const stored = loadCache<LibraryFolder[]>(SK_FOLDERS, []);
    if (stored.length > 0) return stored;
    // Backward compat: promote old single scanned-path
    const legacy = localStorage.getItem(SK_PATH);
    if (legacy) return [{ path: legacy }];
    return [];
  });

  const [games, setGames] = useState<Game[]>(() => loadCache<Game[]>(SK_GAMES, []));
  const [stats, setStats] = useState<Record<string, GameStats>>(() => loadCache(SK_STATS, {}));
  const [metadata, setMetadata] = useState<Record<string, GameMetadata>>(() => loadCache(SK_META, {}));
  const [selected, setSelected] = useState<Game | null>(null);
  const [activeMainTab, setActiveMainTab] = useState<"library" | "feed" | "stats">("library");
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
    let csv = "Name,Path,Source,Tags,Playtime (s),Uninstalled\n";
    for (const g of games) {
      const name = customizations[g.path]?.displayName || metadata[g.path]?.title || g.name;
      const src = metadata[g.path]?.source || "";
      const tags = (metadata[g.path]?.tags || []).join(";");
      const pt = stats[g.path]?.totalTime || 0;
      csv += `"${name.replace(/"/g, '""')}","${g.path.replace(/"/g, '""')}","${src}","${tags}",${pt},${g.uninstalled ? "yes" : "no"}\n`;
    }
    const savePath = await save({ defaultPath: "libmaly_export.csv", filters: [{ name: "CSV", extensions: ["csv"] }] });
    if (savePath) {
      await invoke("save_string_to_file", { path: savePath, contents: csv });
    }
  };

  const handleExportHTML = async () => {
    let html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
      body { background: #1b2838; color: #c6d4df; font-family: sans-serif; }
      .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 20px; padding: 20px; }
      .card { background: #1e2d3d; padding: 10px; border-radius: 8px; text-align: center; }
      img { width: 100%; aspect-ratio: 2/3; object-fit: cover; border-radius: 4px; }
      h3 { font-size: 14px; margin: 10px 0 0 0; }
    </style></head><body><h1>LIBMALY Library</h1><div class="grid">`;
    for (const g of games) {
      const name = customizations[g.path]?.displayName || metadata[g.path]?.title || g.name;
      const cvr = customizations[g.path]?.coverUrl || metadata[g.path]?.cover_url || "";
      const pt = stats[g.path]?.totalTime || 0;
      const hours = pt >= 3600 ? Math.floor(pt / 3600) + "h " : "";
      const mins = Math.floor((pt % 3600) / 60) + "m";
      const ptStr = pt > 0 ? `<div style="font-size: 11px; color: #8f98a0; margin-top: 5px;">🕓 ${hours}${mins}</div>` : "";

      const src = metadata[g.path]?.source;
      const url = metadata[g.path]?.source_url;
      const sourceStr = src && url ? `<a href="${url}" target="_blank" style="display: inline-block; font-size: 10px; margin-top: 5px; color: #66c0f4; text-decoration: none; border: 1px solid #2a475e; padding: 2px 6px; border-radius: 4px;">↗ ${src}</a>` : "";

      const img = cvr ? `<img src="${cvr}" />` : `<div style="aspect-ratio: 2/3; background: #2a475e; display: flex; align-items: center; justify-content: center; border-radius: 4px; font-size: 12px; font-weight: bold; color: rgba(255,255,255,0.5);">NO COVER</div>`;
      html += `<div class="card">${img}<h3>${name}</h3>${sourceStr}${ptStr}</div>`;
    }
    html += `</div></body></html>`;
    const savePath = await save({ defaultPath: "libmaly_library.html", filters: [{ name: "HTML", extensions: ["html"] }] });
    if (savePath) {
      await invoke("save_string_to_file", { path: savePath, contents: html });
    }
  };

  const [screenshots, setScreenshots] = useState<Record<string, Screenshot[]>>({});
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
  const [showWishlist, setShowWishlist] = useState(false);
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
  const [appSettings, setAppSettings] = useState<AppSettings>(() => loadCache(SK_SETTINGS, DEFAULT_SETTINGS));
  const appSettingsRef = useRef(appSettings);
  useEffect(() => { appSettingsRef.current = appSettings; }, [appSettings]);

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

  const [runningGamePath, setRunningGamePath] = useState<string | null>(null);
  const [platform, setPlatform] = useState<string>("windows");
  const [launchConfig, setLaunchConfig] = useState<LaunchConfig>(() => loadCache(SK_LAUNCH, DEFAULT_LAUNCH_CONFIG));
  const [, setRecentGames] = useState<RecentGame[]>(() => loadCache(SK_RECENT, []));
  const [availableGameUpdates, setAvailableGameUpdates] = useState<Record<string, string>>({});
  const [showWineSettings, setShowWineSettings] = useState(false);
  const [appUpdate, setAppUpdate] = useState<{ version: string; url: string; downloadUrl: string } | null>(null);
  const [showAppUpdateModal, setShowAppUpdateModal] = useState(false);
  const [showCmdPalette, setShowCmdPalette] = useState(false);
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
    invoke<string>("get_platform").then(setPlatform).catch(() => { });
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
    const legacyPath = localStorage.getItem(SK_PATH);
    const roots = folders.length > 0 ? folders : (legacyPath ? [{ path: legacyPath }] : []);
    if (roots.length > 0) {
      runIncrementalSyncAll(roots).finally(() => setIsAppReady(true));
    } else {
      setIsAppReady(true);
    }

    const unlistenFinished = listen("game-finished", (ev: any) => {
      const p = ev.payload as { path: string; duration_secs: number };
      updateStats(p.path, p.duration_secs);
      setRunningGamePath(null);
      if (appSettingsRef.current.sessionToastEnabled) {
        isPermissionGranted().then(granted => {
          if (!granted) return requestPermission().then(r => r === "granted" || r === "default" ? true : false);
          return true;
        }).then(granted => {
          if (granted) {
            const title = customizationsRef.current[p.path]?.displayName ?? metadataRef.current[p.path]?.title ?? gamesRef.current.find(g => g.path === p.path)?.name ?? "Game";
            sendNotification({ title: "Session Ended", body: `Played ${title} for ${formatTime(p.duration_secs)}` });
          }
        });
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

    return () => {
      unlistenFinished.then((f) => f());
      unlistenStarted.then((f) => f());
      unlistenShot.then((f) => f());
      unlistenBoss.then((f) => f());
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

  // Auto-screenshot timer
  useEffect(() => {
    const mins = appSettings.autoScreenshotInterval;
    if (!mins || mins <= 0 || !runningGamePath) return;

    const intervalId = setInterval(async () => {
      try {
        const shot = await invoke<Screenshot>("take_screenshot_manual");
        setScreenshots((prev) => ({
          ...prev,
          [runningGamePath]: [shot, ...(prev[runningGamePath] ?? [])],
        }));
      } catch (e) {
        console.error("Auto-screenshot failed:", e);
      }
    }, mins * 60_000);

    return () => clearInterval(intervalId);
  }, [appSettings.autoScreenshotInterval, runningGamePath]);

  // Background game update checker
  useEffect(() => {
    if (!appSettings.updateCheckerEnabled || games.length === 0) return;
    const checkUpdates = async () => {
      for (const g of games) {
        const m = metadata[g.path];
        if (m && m.source_url) {
          try {
            const res = await invoke<GameMetadata | null>(
              m.source === "f95" ? "fetch_f95_metadata" : "fetch_dlsite_metadata",
              { url: m.source_url }
            );
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


  // ── Persist helpers ─────────────────────────────────────────────────────────
  /** Merge scanned results from one folder into the global game list. */
  const mergeGames = (scanned: Game[], nm: DirMtime[], folderPath: string) => {
    setGames((prev) => {
      const isFromFolder = (gPath: string) => gPath.startsWith(folderPath + "\\") || gPath.startsWith(folderPath + "/") || gPath === folderPath;
      const oldOther = prev.filter((g) => !isFromFolder(g.path));
      const oldFromPath = prev.filter((g) => isFromFolder(g.path));

      const scannedPaths = new Set(scanned.map(g => g.path));

      const missingGhosts = oldFromPath
        .filter((g) => !scannedPaths.has(g.path))
        .filter((g) => (statsRef.current[g.path]?.totalTime ?? 0) > 0 || metadataRef.current[g.path])
        .map(g => ({ ...g, uninstalled: true }));

      const scannedClean = scanned.map(g => ({ ...g, uninstalled: false }));
      const merged = [...oldOther, ...missingGhosts, ...scannedClean];
      saveCache(SK_GAMES, merged);
      return merged;
    });
    saveCache(SK_MTIMES, nm);
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
      for (const f of folders) {
        try {
          const [ng, nm] = await invoke<[Game[], DirMtime[]]>("scan_games_incremental", {
            path: f.path,
            cachedGames: loadCache<Game[]>(SK_GAMES, []),
            cachedMtimes: loadCache<DirMtime[]>(SK_MTIMES, []),
          });
          mergeGames(ng, nm, f.path);
        } catch {
          // Fall back to full scan for this folder
          const [ng, nm] = await invoke<[Game[], DirMtime[]]>("scan_games", { path: f.path }).catch(() => [[], []] as [Game[], DirMtime[]]);
          mergeGames(ng, nm, f.path);
        }
      }
    } finally {
      isSyncing.current = false; setSyncState("idle");
    }
  };

  const runFullScanAll = async (folders: LibraryFolder[]) => {
    setSyncState("full-scan");
    try {
      for (const f of folders) {
        const [ng, nm] = await invoke<[Game[], DirMtime[]]>("scan_games", { path: f.path }).catch(() => [[], []] as [Game[], DirMtime[]]);
        mergeGames(ng, nm, f.path);
      }
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
      mergeGames(ng, nm, sel);
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
    setSelected(newGame);
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

  const launchGame = async (path: string, overridePath?: string, overrideArgs?: string) => {
    const useRunner = launchConfig.enabled && platform !== "windows";
    const runner = useRunner ? (launchConfig.runnerPath || (launchConfig.runner !== "custom" ? launchConfig.runner : null)) : null;
    const prefix = useRunner && launchConfig.prefixPath ? launchConfig.prefixPath : null;
    // Honour per-game executable override (keeps original `path` as the cache key)
    const actualPath = overridePath ?? customizations[path]?.exeOverride ?? path;
    const args = overrideArgs !== undefined ? overrideArgs : (customizations[path]?.launchArgs ?? null);
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
        if (m.source === "f95") {
          newMeta = await invoke<GameMetadata>("fetch_f95_metadata", { url: m.source_url });
        } else if (m.source === "dlsite") {
          newMeta = await invoke<GameMetadata>("fetch_dlsite_metadata", { url: m.source_url });
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
          if (m.source === "f95") newMeta = await invoke<GameMetadata>("fetch_f95_metadata", { url: m.source_url });
          else if (m.source === "dlsite") newMeta = await invoke<GameMetadata>("fetch_dlsite_metadata", { url: m.source_url });

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
    if (!c.displayName && !c.coverUrl && !c.backgroundUrl && !c.exeOverride) delete next[selected.path];
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
      mergeGames(ng, nm, folder);
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
        else if (filterMode === "unlinked") return !metadata[g.path];
        else if (filterMode === "Playing" || filterMode === "Completed" || filterMode === "On Hold" || filterMode === "Dropped" || filterMode === "Plan to Play") {
          return customizations[g.path]?.status === filterMode;
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
          setSelected(actionable[next]);
        } else {
          const prev = idx === -1 ? actionable.length - 1 : Math.max(idx - 1, 0);
          setSelected(actionable[prev]);
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

  if (!isAppReady) {
    return (
      <div className="flex flex-col items-center justify-center w-screen h-screen select-none" style={{ background: "#0d1117" }}>
        <h1 className="text-4xl font-black italic tracking-widest mb-6" style={{ background: "linear-gradient(90deg, #66c0f4, #c8a951)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>LIBMALY</h1>
        <div className="w-8 h-8 rounded-full border-4 border-[#2a475e] border-t-[#66c0f4] animate-spin" />
        <p className="mt-4 text-[10px] font-bold uppercase tracking-wider" style={{ color: "#8f98a0" }}>Building your library...</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "#1b2838", color: "#c6d4df", fontFamily: "'Arial', sans-serif" }}>

      {/* ── Context menu (right-click on game) ── */}
      {ctxMenu && (
        <div ref={ctxMenuRef}
          className="fixed z-[9999] rounded-lg py-1 shadow-2xl"
          style={{
            left: Math.min(ctxMenu.x, window.innerWidth - 200),
            top: Math.min(ctxMenu.y, window.innerHeight - 180),
            width: 192,
            background: "#1e2d3d",
            border: "1px solid #2a475e",
          }}>
          {/* game name header */}
          <div className="px-3 py-2 border-b" style={{ borderColor: "#1b3a50" }}>
            <p className="text-[10px] font-semibold truncate" style={{ color: "#8f98a0" }}>
              {gameDisplayName(ctxMenu.game)}
            </p>
          </div>
          {/* Open */}
          <button className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left"
            style={{ color: "#c6d4df" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#2a3f54")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            onClick={() => { setSelected(ctxMenu.game); setCtxMenu(null); }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#66c0f4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 12h4" /><path d="M8 10v4" /><circle cx="17" cy="12" r="1" />
            </svg>
            Open
          </button>
          {/* Rescan folder */}
          <button className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left"
            style={{ color: "#c6d4df" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#2a3f54")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            onClick={() => rescanGameFolder(ctxMenu.game)}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#66c0f4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.5 2v6h-6" /><path d="M2.5 22v-6h6" />
              <path d="M22 11.5A10 10 0 0 0 3.2 7.2M2 12.5a10 10 0 0 0 18.8 4.2" />
            </svg>
            Rescan folder
          </button>
          <div style={{ borderTop: "1px solid #1b3a50", margin: "4px 0" }} />
          {/* Fav toggle */}
          <button className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left"
            style={{ color: favGames[ctxMenu.game.path] ? "#c8a951" : "#c6d4df" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#2a3f54")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            onClick={() => {
              const next = { ...favGames };
              if (next[ctxMenu.game.path]) delete next[ctxMenu.game.path];
              else next[ctxMenu.game.path] = true;
              setFavGames(next); saveCache(SK_FAVS, next);
              setCtxMenu(null);
            }}>
            <svg width="12" height="12" viewBox="0 0 24 24"
              fill={favGames[ctxMenu.game.path] ? "#c8a951" : "none"}
              stroke="#c8a951" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            {favGames[ctxMenu.game.path] ? "Remove from favourites" : "Add to favourites"}
          </button>
          {/* Hide toggle */}
          <button className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left"
            style={{ color: "#c6d4df" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#2a3f54")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            onClick={() => {
              const next = { ...hiddenGames };
              if (next[ctxMenu.game.path]) delete next[ctxMenu.game.path];
              else next[ctxMenu.game.path] = true;
              setHiddenGames(next); saveCache(SK_HIDDEN, next);
              setCtxMenu(null);
            }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#8f98a0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
        <aside className="flex flex-col flex-shrink-0 h-full relative" style={{ width: sidebarWidth, background: "#171a21", borderRight: "1px solid #0d1117" }}>
          <div
            className="absolute top-0 bottom-0 right-0 w-1 cursor-col-resize hover:bg-[#3d7dc8] transition-colors z-[100]"
            style={{ transform: "translateX(50%)" }}
            onMouseDown={() => { isDraggingSidebar.current = true; }}
          />
          <button
            onClick={() => { setActiveMainTab("library"); setSelected(null); }}
            title="Library Home"
            className="flex items-center gap-2.5 px-4 py-3 border-b border-t-0 border-l-0 border-r-0 w-full text-left transition-colors"
            style={{ borderColor: "#0d1117", background: activeMainTab === "library" && selected === null ? "#1b2838" : "transparent", cursor: "pointer" }}
            onMouseEnter={(e) => { if (activeMainTab !== "library" || selected !== null) e.currentTarget.style.background = "#1b2838" }}
            onMouseLeave={(e) => { if (activeMainTab !== "library" || selected !== null) e.currentTarget.style.background = "transparent" }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
              stroke={selected === null && activeMainTab === "library" ? "#66c0f4" : "#4a7a9b"}
              strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
              <rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 12h4" /><path d="M8 10v4" /><circle cx="17" cy="12" r="1" />
            </svg>
            <span className="font-bold tracking-wide text-sm truncate"
              style={{ color: selected === null && activeMainTab === "library" ? "#66c0f4" : "#c6d4df" }}>LIBMALY</span>
          </button>
          <button
            onClick={() => { setActiveMainTab("feed"); setSelected(null); }}
            title="News Feed"
            className="flex items-center gap-2.5 px-4 py-3 border-b border-t-0 border-l-0 border-r-0 w-full text-left transition-colors"
            style={{ borderColor: "#0d1117", background: activeMainTab === "feed" && selected === null ? "#1b2838" : "transparent", cursor: "pointer" }}
            onMouseEnter={(e) => { if (activeMainTab !== "feed" || selected !== null) e.currentTarget.style.background = "#1b2838" }}
            onMouseLeave={(e) => { if (activeMainTab !== "feed" || selected !== null) e.currentTarget.style.background = "transparent" }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
              stroke={activeMainTab === "feed" && selected === null ? "#66c0f4" : "#4a7a9b"}
              strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
              <path d="M4 11a9 9 0 0 1 9 9" /><path d="M4 4a16 16 0 0 1 16 16" /><circle cx="5" cy="19" r="1" />
            </svg>
            <span className="font-bold tracking-wide text-sm truncate"
              style={{ color: activeMainTab === "feed" && selected === null ? "#66c0f4" : "#c6d4df" }}>News & Updates</span>
          </button>
          <button
            onClick={() => { setActiveMainTab("stats"); setSelected(null); }}
            title="All-Time Stats"
            className="flex items-center gap-2.5 px-4 py-3 border-b border-t-0 border-l-0 border-r-0 w-full text-left transition-colors"
            style={{ borderColor: "#0d1117", background: activeMainTab === "stats" && selected === null ? "#1b2838" : "transparent", cursor: "pointer" }}
            onMouseEnter={(e) => { if (activeMainTab !== "stats" || selected !== null) e.currentTarget.style.background = "#1b2838" }}
            onMouseLeave={(e) => { if (activeMainTab !== "stats" || selected !== null) e.currentTarget.style.background = "transparent" }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
              stroke={activeMainTab === "stats" && selected === null ? "#66c0f4" : "#4a7a9b"}
              strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
              <path d="M12 20V10" /><path d="M18 20V4" /><path d="M6 20v-4" />
            </svg>
            <span className="font-bold tracking-wide text-sm truncate"
              style={{ color: activeMainTab === "stats" && selected === null ? "#66c0f4" : "#c6d4df" }}>All-Time Stats</span>
          </button>
          <div className="px-3 py-2 border-b" style={{ borderColor: "#0d1117" }}>
            <div className="relative mb-2">
              <svg className="absolute left-2 top-1/2 -translate-y-1/2" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#8f98a0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
              </svg>
              <input type="text" placeholder="Search games…" value={search}
                onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
                className="w-full pl-7 pr-3 py-1.5 rounded text-xs outline-none"
                style={{ background: "#2a3f54", color: "#c6d4df", border: "1px solid #1b3a50" }} />
            </div>
            {/* Filter chips */}
            <div
              className="flex items-center gap-1 mb-2 mt-1 cursor-pointer text-[10px] uppercase font-bold select-none transition-colors hover:text-[#c6d4df]"
              style={{ color: showFilters ? "#c6d4df" : "#8f98a0" }}
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
                    ["unlinked", "Unlinked"],
                  ] as [FilterMode, string][]).map(([mode, label]) => (
                    <button key={mode} onClick={() => setFilterMode(mode)}
                      className="px-2 py-0.5 rounded text-[10px] font-semibold"
                      style={{
                        background: filterMode === mode ? "#2a6db5" : "#1b2d3d",
                        color: filterMode === mode ? "#fff" : "#5a6a7a",
                        border: `1px solid ${filterMode === mode ? "#3d7dc8" : "#253545"}`,
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
                        background: filterMode === mode ? "#2a6db5" : "#1b2d3d",
                        color: filterMode === mode ? "#fff" : "#5a6a7a",
                        border: `1px solid ${filterMode === mode ? "#3d7dc8" : "#253545"}`,
                      }}>{label}</button>
                  ))}
                </div>
                {allCustomTags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {allCustomTags.map((tag) => (
                      <button key={`tag:${tag}`} onClick={() => setFilterMode(`tag:${tag}`)}
                        className="px-2 py-0.5 rounded text-[10px] font-semibold flex items-center gap-1"
                        style={{
                          background: filterMode === `tag:${tag}` ? "#2a6db5" : "#1b2d3d",
                          color: filterMode === `tag:${tag}` ? "#fff" : "#8cb4d5",
                          border: `1px solid ${filterMode === `tag:${tag}` ? "#3d7dc8" : "#264d68"}`,
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
              <span className="text-[10px] flex-shrink-0" style={{ color: "#4a5568" }}>Sort:</span>
              {([
                ["lastPlayed", "Recent"],
                ["playtime", "Time"],
                ["name", "Name"],
                ["custom", "Custom"],
              ] as [SortMode, string][]).map(([mode, label]) => (
                <button key={mode} onClick={() => setSortMode(mode)}
                  className="px-2 py-0.5 rounded text-[10px]"
                  style={{
                    background: sortMode === mode ? "#2a3f54" : "transparent",
                    color: sortMode === mode ? "#c6d4df" : "#4a5568",
                    border: `1px solid ${sortMode === mode ? "#3d5a73" : "transparent"}`,
                  }}>{label}</button>
              ))}
              {sortMode === "custom" && (
                <span className="text-[9px]" style={{ color: "#4a5568" }} title="Drag rows to reorder">⠿ drag</span>
              )}
              <div className="flex-1" />
              <div className="flex bg-[#1b2d3d] rounded shrink-0 items-center" style={{ padding: "2px" }}>
                <button title="List View" onClick={() => setViewMode("list")} className="p-1 rounded" style={{ background: viewMode === "list" ? "#2a475e" : "transparent" }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={viewMode === "list" ? "#66c0f4" : "#4a5568"} strokeWidth="2.5"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
                </button>
                <button title="Compact List" onClick={() => setViewMode("compact")} className="p-1 rounded" style={{ background: viewMode === "compact" ? "#2a475e" : "transparent" }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={viewMode === "compact" ? "#66c0f4" : "#4a5568"} strokeWidth="2.5"><line x1="4" y1="6" x2="20" y2="6"></line><line x1="4" y1="12" x2="20" y2="12"></line><line x1="4" y1="18" x2="20" y2="18"></line></svg>
                </button>
                <button title="Grid View" onClick={() => setViewMode("grid")} className="p-1 rounded" style={{ background: viewMode === "grid" ? "#2a475e" : "transparent" }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={viewMode === "grid" ? "#66c0f4" : "#4a5568"} strokeWidth="2.5"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
                </button>
              </div>

              <button
                title="Fullscreen Cover Wall"
                onClick={handleToggleKiosk}
                className="px-2 py-0.5 ml-2 rounded text-[9px] uppercase font-bold tracking-wider hover:opacity-100 opacity-60 transition-opacity"
                style={{ background: "#2a3f54", color: "#c6d4df" }}>
                Kiosk
              </button>
            </div>
          </div>
          {/* ── Collections ── */}
          <div className="border-b" style={{ borderColor: "#0d1117" }}>
            <div
              className="flex items-center px-3 pt-2 pb-1 gap-1 cursor-pointer select-none transition-colors hover:text-[#c6d4df]"
              style={{ color: showCollections ? "#c6d4df" : "#4a5568" }}
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
                  style={{ background: "#2a3f54", color: "#8f98a0" }}
                  title="Clear filter">✕ clear</button>
              )}
              <button onClick={(e) => { e.stopPropagation(); setCreatingCollection(true); setShowCollections(true); }}
                className="w-5 h-5 flex items-center justify-center rounded text-sm font-bold opacity-60 hover:opacity-100 transition-opacity"
                title="New collection">+</button>
            </div>
            {showCollections && (
              <>
                {collections.length === 0 && !creatingCollection && (
                  <p className="px-3 pb-2 text-[10px]" style={{ color: "#4a5568" }}>No collections yet</p>
                )}
                {collections.length > 0 && (
                  <div className="overflow-y-auto" style={{ maxHeight: "152px", scrollbarWidth: "thin", scrollbarColor: "#2a475e transparent" }}>
                    {collections.map((col) => (
                      <div key={col.id}
                        className="group flex items-center gap-2 px-3 py-1.5 cursor-pointer"
                        style={{ background: activeCollectionId === col.id ? "#1a2e40" : "transparent" }}
                        onClick={() => setActiveCollectionId(activeCollectionId === col.id ? null : col.id)}
                        onMouseEnter={(e) => { if (activeCollectionId !== col.id) e.currentTarget.style.background = "#1b2838"; }}
                        onMouseLeave={(e) => { if (activeCollectionId !== col.id) e.currentTarget.style.background = "transparent"; }}>
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: col.color }} />
                        {renamingCollectionId === col.id ? (
                          <input autoFocus className="flex-1 text-xs px-1 rounded outline-none"
                            style={{ background: "#2a3f54", color: "#c6d4df", border: "1px solid #3d5a73" }}
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
                            style={{ color: activeCollectionId === col.id ? "#66c0f4" : "#8f98a0" }}
                            onDblClick={(e) => { e.stopPropagation(); setRenamingCollectionId(col.id); setRenamingCollectionName(col.name); }}>
                            {col.name}
                          </span>
                        )}
                        <span className="text-[9px] flex-shrink-0" style={{ color: "#4a5568" }}>
                          {col.gamePaths.filter((p) => games.some((g) => g.path === p)).length}
                        </span>
                        <button
                          className="opacity-0 group-hover:opacity-100 flex-shrink-0 w-4 h-4 flex items-center justify-center rounded"
                          style={{ fontSize: "13px", color: "#4a5568" }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = "#e57373"; e.currentTarget.style.background = "#2a1f1f"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = "#4a5568"; e.currentTarget.style.background = "transparent"; }}
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
                      style={{ background: "#2a3f54", color: "#c6d4df", border: "1px solid #3d5a73" }} />
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {COLLECTION_COLORS.map((c) => (
                        <button key={c} onClick={() => setNewCollectionColor(c)}
                          className="w-3.5 h-3.5 rounded-full flex-shrink-0"
                          style={{ background: c, outline: newCollectionColor === c ? "2px solid #fff" : "none", outlineOffset: "1px" }} />
                      ))}
                      <button className="ml-auto text-[10px] px-2 py-0.5 rounded font-semibold"
                        style={{ background: "#2a6db5", color: "#fff" }}
                        onClick={() => {
                          if (newCollectionName.trim()) {
                            handleCreateCollection(newCollectionName.trim(), newCollectionColor);
                            setNewCollectionName(""); setCreatingCollection(false);
                          }
                        }}>✓</button>
                      <button className="text-[10px] px-2 py-0.5 rounded"
                        style={{ background: "#2a3f54", color: "#8f98a0" }}
                        onClick={() => { setCreatingCollection(false); setNewCollectionName(""); }}>✗</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
          {/* ── Wishlist ── */}
          <div className="border-b" style={{ borderColor: "#0d1117" }}>
            <div
              className="flex items-center px-3 pt-2 pb-1 gap-1 cursor-pointer select-none transition-colors hover:text-[#c6d4df]"
              style={{ color: showWishlist ? "#c6d4df" : "#4a5568" }}
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
                  <p className="px-3 pb-2 text-[10px]" style={{ color: "#4a5568" }}>No wishlisted games</p>
                )}
                {wishlist.length > 0 && (
                  <div className="overflow-y-auto" style={{ maxHeight: "152px", scrollbarWidth: "thin", scrollbarColor: "#2a475e transparent" }}>
                    {wishlist.map((item) => (
                      <a key={item.id} href={item.id} target="_blank" rel="noreferrer" className="group flex items-center justify-between px-3 py-1.5 cursor-pointer"
                        style={{ borderBottom: "1px solid #0d1117", textDecoration: "none" }}
                        onMouseEnter={e => e.currentTarget.style.background = "#1b2838"}
                        onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                        title={item.title}>
                        <div className="flex flex-col overflow-hidden text-left flex-1 min-w-0 pr-2">
                          <span className="text-xs truncate font-medium group-hover:underline" style={{ color: "#c6d4df" }}>{item.title}</span>
                          <span className="text-[9px] truncate mt-0.5" style={{ color: "#8f98a0" }}>{item.source} • <span className={item.releaseStatus === "Completed" ? "text-[#6dbf6d]" : ""}>{item.releaseStatus}</span></span>
                        </div>
                        <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleRemoveWishlist(item.id); }}
                          className="opacity-0 group-hover:opacity-100 px-1 py-0.5 text-[12px] font-bold rounded flex-shrink-0 transition-opacity relative z-10"
                          style={{ color: "#4a5568" }}
                          onMouseEnter={e => { e.currentTarget.style.background = "#2a1f1f"; e.currentTarget.style.color = "#e57373"; }}
                          onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#4a5568"; }}
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
            style={{ scrollbarWidth: "thin", scrollbarColor: "#2a475e transparent" }}
          >
            {syncState === "full-scan" ? (
              <div className="flex flex-col items-center justify-center h-32 gap-2">
                <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2" style={{ borderColor: "#66c0f4" }} />
                <span className="text-xs" style={{ color: "#8f98a0" }}>Scanning…</span>
              </div>
            ) : sidebarItems.length === 0 ? (
              <p className="px-4 py-6 text-xs text-center" style={{ color: "#8f98a0" }}>
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
                          background: "#0d1117", borderBottom: "1px solid #1a2535"
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "#13202e")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "#0d1117")}>
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#4a5568"
                          strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                          style={{ transform: collapsed ? "rotate(-90deg)" : "none", transition: "transform 0.15s", flexShrink: 0 }}>
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#4a7a9b"
                          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                        </svg>
                        <span className="flex-1 text-[10px] font-semibold truncate" style={{ color: "#8f98a0" }}>
                          {item.label}
                        </span>
                        <span className="text-[9px] flex-shrink-0" style={{ color: "#4a5568" }}>{item.count}</span>
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
                    <button key={game.path} onClick={() => setSelected(game)}
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
                        background: isSelected ? "#2a475e" : isDragOver ? "#1e3a52" : "transparent",
                        borderLeft: `3px solid ${isSelected ? "#66c0f4" : isDragOver ? "#4a8ab5" : isFavItem ? "#c8a951" : "transparent"}`,
                        borderTop: isDragOver ? "1px solid #4a8ab5" : undefined,
                        color: isSelected ? "#fff" : "#8f98a0",
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
                          style={{ background: (!coverSrc && syncState === "syncing") ? "#1e3a50" : heroGradient(game.name) }}>
                          {coverSrc
                            ? <img src={coverSrc} alt="" className="w-full h-full object-cover" />
                            : syncState === "syncing"
                              ? <div className="w-full h-full animate-pulse bg-[#2a475e]" />
                              : <div className="w-full h-full flex items-center justify-center text-sm font-bold text-white">
                                {name.charAt(0).toUpperCase()}
                              </div>}
                          {isFavItem && (
                            <span className="absolute top-0 right-0 text-[8px] leading-none p-px"
                              style={{ color: "#c8a951", textShadow: "0 0 3px #000", zIndex: 11 }}>★</span>
                          )}
                          <NsfwOverlay gamePath={game.path} meta={m} appSettings={appSettings} revealed={revealedNsfw} onReveal={revealNsfwPath} small={true} />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1">
                          {sortMode === "custom" && (
                            <span className="text-[11px] flex-shrink-0 leading-none select-none"
                              style={{ color: "#3a5068" }}>⠿</span>
                          )}
                          <p className="text-xs font-medium truncate flex-1">{name}</p>
                          {isHiddenItem && (
                            <span className="text-[9px] px-1 rounded flex-shrink-0"
                              style={{ background: "#2a3f54", color: "#4a5568" }}>hidden</span>
                          )}
                        </div>
                        {viewMode !== "compact" && (
                          <>
                            <p className="text-[10px] truncate" style={{ color: "#4a5568" }}>
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
          <div className="px-3 py-3 space-y-1.5 border-t" style={{ borderColor: "#0d1117" }}>
            {syncState === "syncing" && (
              <div className="flex items-center gap-2 px-1 py-1">
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#66c0f4" }} />
                <span className="text-xs" style={{ color: "#66c0f4" }}>Checking changes…</span>
              </div>
            )}

            {/* ── Add dropdown ── */}
            <div ref={addMenuRef} className="relative">
              <button
                onClick={() => setShowAddMenu((p) => !p)}
                className="w-full py-2 rounded text-xs font-semibold flex items-center justify-center gap-1.5"
                style={{ background: showAddMenu ? "#3d6b8e" : "#2a475e", color: "#c6d4df", border: "1px solid #1b3a50" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#3d6b8e")}
                onMouseLeave={(e) => { if (!showAddMenu) e.currentTarget.style.background = "#2a475e"; }}>
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
                  style={{ background: "#1e2d3d", border: "1px solid #2a475e" }}>
                  <button
                    onClick={handleAddFolder}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left"
                    style={{ color: "#c6d4df" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#2a3f54")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#66c0f4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    </svg>
                    Add Library Folder
                    <span className="ml-auto text-[9px]" style={{ color: "#4a5568" }}>scan dir</span>
                  </button>
                  <button
                    onClick={handleAddGameManually}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left"
                    style={{ color: "#c6d4df" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#2a3f54")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#c8a951" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 12h4" /><path d="M8 10v4" /><circle cx="17" cy="12" r="1" />
                    </svg>
                    Add Game Manually
                    <span className="ml-auto text-[9px]" style={{ color: "#4a5568" }}>.exe / .sh</span>
                  </button>
                </div>
              )}
            </div>

            {/* Settings + app update */}
            <div className="flex gap-1.5">
              <button onClick={() => setShowSettings(true)}
                className="flex-1 py-1.5 rounded text-xs flex items-center justify-center gap-1.5"
                style={{ background: "transparent", color: "#4a5568", border: "1px solid #2a3f54" }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "#8f98a0"; e.currentTarget.style.borderColor = "#3d5a73"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "#4a5568"; e.currentTarget.style.borderColor = "#2a3f54"; }}
                title="Settings">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
                Settings
              </button>
              {appUpdate && (
                <button onClick={() => setShowAppUpdateModal(true)}
                  className="flex-1 py-1.5 rounded text-xs font-semibold flex items-center justify-center gap-1"
                  style={{ background: "#1a3a1a", color: "#6dbf6d", border: "1px solid #2a5a2a" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#1e4a1e")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "#1a3a1a")}
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
          <FeedView appSettings={appSettings} wishlist={wishlist} onToggleWishlist={handleToggleWishlist} />
        ) : selected === null && activeMainTab === "stats" ? (
          <StatsView games={games} stats={stats} sessions={sessionLog} customizations={customizations} metadata={metadata} />
        ) : viewMode === "grid" && !selected ? (
          <div className="flex-1 overflow-y-auto px-6 py-6" style={{ scrollbarWidth: "thin", scrollbarColor: "#2a475e transparent" }}>
            <div className="grid gap-5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}>
              {filtered.map(game => {
                const isFavItem = !!favGames[game.path];
                const cover = customizations[game.path]?.coverUrl ?? metadata[game.path]?.cover_url;
                return (
                  <button key={game.path} onClick={() => setSelected(game)} className="flex flex-col gap-2 group text-left relative transition-transform hover:scale-105">
                    <div className="aspect-[2/3] w-full bg-[#1e2d3d] rounded-lg overflow-hidden border border-[#2a475e] group-hover:border-[#66c0f4] relative shadow-lg">
                      {cover ? (
                        <img src={cover} className="w-full h-full object-cover" alt="" />
                      ) : syncState === "syncing" ? (
                        <div className="w-full h-full animate-pulse bg-[#2a475e]" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center p-4 text-center text-sm font-bold text-white" style={{ background: heroGradient(game.name) }}>
                          {gameDisplayName(game)}
                        </div>
                      )}
                      {isFavItem && (
                        <span className="absolute top-2 right-2 text-sm leading-none" style={{ color: "#c8a951", textShadow: "0 0 3px #000", zIndex: 11 }}>★</span>
                      )}

                      <NsfwOverlay gamePath={game.path} meta={metadata[game.path]} appSettings={appSettings} revealed={revealedNsfw} onReveal={revealNsfwPath} />
                    </div>
                    <p className="text-xs font-semibold text-[#c6d4df] truncate px-1">{gameDisplayName(game)}</p>
                  </button>
                )
              })}
            </div>
            {filtered.length === 0 && <div className="text-center py-12 text-[#8f98a0]">No games match the current filters</div>}
          </div>
        ) : !selected ? (
          games.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4" style={{ color: "#8f98a0" }}>
              <svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.2 }}>
                <rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 12h4" /><path d="M8 10v4" /><circle cx="17" cy="12" r="1" />
              </svg>
              <p className="text-base" style={{ opacity: 0.4 }}>Add a library folder or game to get started</p>
              <div className="flex gap-3">
                <button onClick={handleAddFolder}
                  className="px-5 py-2.5 rounded font-semibold text-sm flex items-center gap-2"
                  style={{ background: "#2a6db5", color: "#fff" }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                  Add Library Folder
                </button>
                <button onClick={handleAddGameManually}
                  className="px-5 py-2.5 rounded font-semibold text-sm flex items-center gap-2"
                  style={{ background: "#2a475e", color: "#c6d4df", border: "1px solid #3d5a73" }}>
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
              onSelect={setSelected}
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
            runnerLabel={launchConfig.enabled && platform !== "windows" ? launchConfig.runner.charAt(0).toUpperCase() + launchConfig.runner.slice(1) : undefined}
            onDelete={() => setDeleteTarget(selected)}
            onLinkPage={() => setShowLinkModal(true)}
            onOpenF95Login={() => setShowF95Login(true)}
            onClearMeta={handleClearMeta}
            onUpdate={() => setShowUpdateModal(true)}
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
                const shot = await invoke<Screenshot>("take_screenshot_manual");
                setScreenshots((prev) => ({
                  ...prev,
                  [selected.path]: [shot, ...(prev[selected.path] ?? [])],
                }));
              } catch (e) {
                alert("Screenshot failed: " + e);
              }
            }}
            onOpenScreenshotsFolder={() =>
              invoke("open_screenshots_folder", { gameExe: selected.path }).catch((e) =>
                alert("Could not open folder: " + e)
              )
            }
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

      {/* ── Modals ── */}
      {
        showSettings && (
          <SettingsModal
            f95LoggedIn={f95LoggedIn}
            dlsiteLoggedIn={dlsiteLoggedIn}
            libraryFolders={libraryFolders}
            syncState={syncState}
            platform={platform}
            launchConfig={launchConfig}
            appUpdate={appUpdate}
            onF95Login={() => setShowF95Login(true)}
            onF95Logout={async () => { await invoke("f95_logout").catch(() => { }); setF95LoggedIn(false); }}
            onDLsiteLogin={() => setShowDLsiteLogin(true)}
            onDLsiteLogout={async () => { await invoke("dlsite_logout").catch(() => { }); setDlsiteLoggedIn(false); }}
            onRemoveFolder={handleRemoveFolder}
            onRescanAll={() => runFullScanAll(libraryFolders)}
            onWineSettings={() => setShowWineSettings(true)}
            onSteamImport={() => setShowSteamImport(true)}
            onAppUpdate={() => setShowAppUpdateModal(true)}
            appSettings={appSettings}
            onSaveSettings={(s) => { setAppSettings(s); saveCache(SK_SETTINGS, s); }}
            onExportCSV={handleExportCSV}
            onExportHTML={handleExportHTML}
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
        deleteTarget && (
          <div className="fixed inset-0 flex items-center justify-center z-50"
            style={{ background: "rgba(0,0,0,0.75)" }}
            onClick={(e) => { if (e.target === e.currentTarget && !isDeleting) setDeleteTarget(null); }}>
            <div className="rounded-lg p-6 w-96 shadow-2xl" style={{ background: "#1e2d3d", border: "1px solid #3d5a73" }}>
              <h2 className="text-lg font-bold mb-2" style={{ color: "#fff" }}>Uninstall Game</h2>
              <p className="text-sm mb-1" style={{ color: "#c6d4df" }}>This will permanently delete:</p>
              <p className="text-xs font-mono mb-4 break-all" style={{ color: "#e57373" }}>
                {deleteTarget.path.replace(/[\\/][^\\/]+$/, "")}
              </p>
              <p className="text-xs mb-3" style={{ color: "#8f98a0" }}>This action cannot be undone unless you reinstall the game later.</p>
              <label className="flex items-center gap-2 text-xs mb-5 cursor-pointer select-none" style={{ color: "#c6d4df" }}>
                <input type="checkbox" checked={keepDataOnDelete} onChange={(e) => setKeepDataOnDelete(e.currentTarget.checked)} />
                Keep playtime and metadata (mark as uninstalled)
              </label>
              <div className="flex gap-3 justify-end">
                <button onClick={() => setDeleteTarget(null)} disabled={isDeleting}
                  className="px-4 py-2 rounded text-sm disabled:opacity-50"
                  style={{ background: "#152232", color: "#c6d4df", border: "1px solid #3d5a73" }}>Cancel</button>
                <button onClick={confirmDelete} disabled={isDeleting}
                  className="px-4 py-2 rounded text-sm font-semibold disabled:opacity-50 flex items-center gap-2"
                  style={{ background: "#c0392b", color: "#fff" }}>
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

      <CommandPalette
        isOpen={showCmdPalette}
        onClose={() => setShowCmdPalette(false)}
        games={games}
        metadata={metadata}
        notes={notes}
        onSelect={(g) => setSelected(g)}
      />
    </div >
  );

}