import { useState, useEffect, useRef, useMemo } from "preact/hooks";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { marked } from "marked";
import "./App.css";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Game { name: string; path: string; }
interface DirMtime { path: string; mtime: number; }
interface GameStats { totalTime: number; lastPlayed: number; lastSession: number; }
interface GameMetadata {
  source: string;
  source_url: string;
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
}

interface GameCustomization {
  displayName?: string;
  coverUrl?: string;
  backgroundUrl?: string;
}

// ─── Storage keys ─────────────────────────────────────────────────────────────
const SK_GAMES  = "games-list-v2";
const SK_MTIMES = "dir-mtimes-v2";
const SK_PATH   = "scanned-path";
const SK_STATS  = "game-stats";
const SK_META   = "game-metadata";
const SK_HIDDEN = "hidden-games-v1";
const SK_FAVS   = "fav-games-v1";
const SK_CUSTOM = "game-custom-v1";
const SK_NOTES  = "game-notes-v1";
const SK_COLLECTIONS = "collections-v1";
const SK_LAUNCH      = "launch-config-v1";
const SK_RECENT      = "recent-games-v1";

interface RecentGame { name: string; path: string; }

interface LaunchConfig {
  enabled:    boolean;        // false = always run directly
  runner:     "wine" | "proton" | "custom";
  runnerPath: string;         // path to wine/proton binary
  prefixPath: string;         // WINEPREFIX / STEAM_COMPAT_DATA_PATH
}

const DEFAULT_LAUNCH_CONFIG: LaunchConfig = { enabled: false, runner: "wine", runnerPath: "", prefixPath: "" };

const COLLECTION_COLORS = ["#66c0f4","#c8a951","#a170c8","#e8734a","#5ba85b","#d45252","#4a8ee8","#e85480"];

interface Collection {
  id: string;
  name: string;
  color: string;
  gamePaths: string[];
}

type SortMode = "name" | "lastPlayed" | "playtime";
type FilterMode = "all" | "favs" | "hidden" | "f95" | "dlsite" | "unlinked";

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
  const [user, setUser]     = useState("");
  const [pass, setPass]     = useState("");
  const [error, setError]   = useState("");
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

// ─── Link Page Modal ──────────────────────────────────────────────────────────
function LinkPageModal({ gameName, onClose, onFetched, f95LoggedIn, onOpenF95Login }: {
  gameName: string;
  onClose: () => void;
  onFetched: (meta: GameMetadata) => void;
  f95LoggedIn: boolean;
  onOpenF95Login: () => void;
}) {
  const [url, setUrl]         = useState("");
  const [error, setError]     = useState("");
  const [loading, setLoading] = useState(false);

  const src = isF95Url(url) ? "f95" : isDLsiteUrl(url) ? "dlsite" : null;

  const doFetch = async () => {
    if (!src) { setError("Paste a valid F95zone or DLsite URL."); return; }
    setLoading(true); setError("");
    try {
      const cmd = src === "f95" ? "fetch_f95_metadata" : "fetch_dlsite_metadata";
      const meta = await invoke<GameMetadata>(cmd, { url: url.trim() });
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
        {error && <p className="text-xs mb-2" style={{ color: "#e57373" }}>{error}</p>}
        <div className="flex gap-3 justify-end mt-2">
          <button onClick={onClose} disabled={loading}
            className="px-4 py-2 rounded text-sm"
            style={{ background: "#152232", color: "#8f98a0", border: "1px solid #2a475e" }}>Cancel</button>
          <button onClick={doFetch} disabled={loading || !url.trim()}
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
  const [phase, setPhase]       = useState<Phase>("idle");
  const [sourcePath, setSourcePath] = useState("");
  const [preview, setPreview]   = useState<UpdatePreview | null>(null);
  const [result, setResult]     = useState<UpdateResult | null>(null);
  const [errMsg, setErrMsg]     = useState("");

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
  const [text, setText]       = useState(initialNote);
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
            <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
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
  const [coverUrl, setCoverUrl]       = useState(custom.coverUrl ?? "");
  const [bgUrl, setBgUrl]             = useState(custom.backgroundUrl ?? "");

  const pickFile = async (setter: (s: string) => void) => {
    const sel = await open({
      multiple: false, directory: false,
      filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
    }).catch(() => null);
    if (sel && typeof sel === "string") setter(convertFileSrc(sel));
  };

  const doSave = () => {
    onSave({
      displayName: displayName.trim() || undefined,
      coverUrl: coverUrl.trim() || undefined,
      backgroundUrl: bgUrl.trim() || undefined,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.85)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rounded-lg shadow-2xl w-[500px] max-h-[90vh] overflow-y-auto"
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
            <input type="text" value={displayName}
              onInput={(e) => setDisplayName((e.target as HTMLInputElement).value)}
              className="w-full px-3 py-2 rounded text-sm outline-none"
              style={{ background: "#152232", color: "#c6d4df", border: "1px solid #2a475e" }} />
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
              <button onClick={() => pickFile(setCoverUrl)}
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
              <button onClick={() => pickFile(setBgUrl)}
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
function InGameGallery({ shots, onTake, onOpenFolder }: {
  shots: Screenshot[];
  onTake: () => void;
  onOpenFolder: () => void;
}) {
  const [lightbox, setLightbox] = useState<Screenshot | null>(null);

  return (
    <section>
      <div className="flex items-center gap-2 mb-2">
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

      {shots.length === 0 ? (
        <div className="rounded px-3 py-4 text-center" style={{ background: "#16202d", border: "1px dashed #2a3f54" }}>
          <p className="text-xs" style={{ color: "#4a5568" }}>
            Press <kbd style={{ background: "#2a3f54", color: "#8f98a0", padding: "1px 5px", borderRadius: "3px", fontSize: "10px" }}>F12</kbd> while a game is running, or click Capture above.
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {shots.map((s) => (
            <button key={s.filename} onClick={() => setLightbox(s)}
              className="rounded overflow-hidden flex-shrink-0 relative group"
              style={{ width: "90px", height: "60px", background: "#0d1117" }}>
              <img
                src={convertFileSrc(s.path)}
                alt={s.filename}
                className="w-full h-full object-cover"
                style={{ display: "block" }}
              />
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"
                style={{ background: "rgba(0,0,0,0.5)" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                  <line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" />
                </svg>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.92)" }}
          onClick={() => setLightbox(null)}>
          <div onClick={(e) => e.stopPropagation()} className="relative max-w-[90vw] max-h-[90vh]">
            <img
              src={convertFileSrc(lightbox.path)}
              alt={lightbox.filename}
              style={{ maxWidth: "90vw", maxHeight: "85vh", objectFit: "contain", display: "block" }}
              className="rounded shadow-2xl"
            />
            <div className="flex items-center justify-between mt-2 px-1">
              <span className="text-xs font-mono" style={{ color: "#8f98a0" }}>{lightbox.filename}</span>
              <button onClick={() => setLightbox(null)}
                className="text-xs px-3 py-1 rounded"
                style={{ background: "#2a3f54", color: "#c6d4df" }}>Close</button>
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
  const [cfg, setCfg]       = useState<LaunchConfig>(config);
  const [detected, setDetected] = useState<{name:string;path:string;kind:string}[]>([]);
  const [detecting, setDetecting] = useState(false);

  useEffect(() => {
    setDetecting(true);
    invoke<{name:string;path:string;kind:string}[]>("detect_wine_runners")
      .then(setDetected).catch(() => {}).finally(() => setDetecting(false));
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
                {(["wine","proton","custom"] as const).map((r) => (
                  <button key={r} onClick={() => upd({ runner: r })}
                    className="flex-1 py-2 rounded text-xs font-semibold capitalize"
                    style={{
                      background: cfg.runner===r ? "#2a6db5" : "#1b2d3d",
                      color:      cfg.runner===r ? "#fff"    : "#5a6a7a",
                      border:     `1px solid ${cfg.runner===r ? "#3d7dc8" : "#253545"}`,
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
                      onClick={() => upd({ runnerPath: d.path, runner: d.kind as "wine"|"proton"|"custom" })}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded text-xs text-left"
                      style={{
                        background: cfg.runnerPath===d.path ? "#1a3a5c" : "#1b2d3d",
                        border: `1px solid ${cfg.runnerPath===d.path ? "#3d7dc8" : "#253545"}`,
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
                <p>The <code style={{ color:"#f88379" }}>proton</code> script requires <strong>python3</strong> and a Steam installation.</p>
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
  const [newName, setNewName]   = useState("");
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
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
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
                    style={{ background: c, outline: newColor === c ? "2px solid #fff" : "none", outlineOffset: "1px",
                      transform: newColor === c ? "scale(1.25)" : "scale(1)", transition: "transform 0.1s" }} />
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

// ─── Game Detail ──────────────────────────────────────────────────────────────
function GameDetail({ game, stat, meta, customization, f95LoggedIn, screenshots, isHidden, isFav,
  onPlay, onStop, isRunning, runnerLabel, onDelete, onLinkPage, onOpenF95Login, onClearMeta, onUpdate,
  onTakeScreenshot, onOpenScreenshotsFolder, onToggleHide, onToggleFav, onOpenCustomize, onOpenNotes, hasNotes, onManageCollections }: {
  game: Game; stat: GameStats; meta?: GameMetadata;
  customization: GameCustomization; f95LoggedIn: boolean;
  screenshots: Screenshot[]; isHidden: boolean; isFav: boolean;
  onPlay: () => void; onStop: () => void; isRunning: boolean; runnerLabel?: string;
  onDelete: () => void; onLinkPage: () => void;
  onOpenF95Login: () => void; onClearMeta: () => void; onUpdate: () => void;
  onTakeScreenshot: () => void; onOpenScreenshotsFolder: () => void;
  onToggleHide: () => void; onToggleFav: () => void; onOpenCustomize: () => void;
  onOpenNotes: () => void; hasNotes: boolean; onManageCollections: () => void;
}) {
  const [activeShot, setActiveShot] = useState(0);
  const cover        = customization.coverUrl ?? meta?.cover_url;
  const heroBg       = customization.backgroundUrl ?? cover;
  const displayTitle = customization.displayName ?? meta?.title ?? game.name;
  const shots        = meta?.screenshots ?? [];

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">

      {/* Hero banner */}
      <div className="relative flex-shrink-0 overflow-hidden" style={{ height: "240px" }}>
        {heroBg
          ? <img src={heroBg} alt={displayTitle} className="absolute inset-0 w-full h-full object-cover"
              style={{ filter: "brightness(0.5)" }} />
          : <div className="absolute inset-0" style={{ background: heroGradient(game.name) }} />}
        <div className="absolute inset-0"
          style={{ background: "linear-gradient(to top,#1b2838 0%,rgba(27,40,56,0.15) 60%,transparent 100%)" }} />
        <div className="absolute bottom-0 left-0 right-0 px-8 pb-5">
          <div className="flex items-end justify-between">
            <div>
              {meta?.source && (
                <span className="inline-block text-xs px-2 py-0.5 rounded mb-1.5 font-semibold"
                  style={{ background: meta.source === "f95" ? "#c8a951" : "#e0534a", color: meta.source === "f95" ? "#1a1a1a" : "#fff" }}>
                  {meta.source === "f95" ? "F95zone" : "DLsite"}
                </span>
              )}
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
        <button onClick={isRunning ? onStop : onPlay}
          className="flex items-center gap-2 px-7 py-2 rounded font-bold text-sm uppercase tracking-wider"
          style={{ background: isRunning ? "#6b2222" : "#4c6b22", color: isRunning ? "#e88585" : "#d2e885" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = isRunning ? "#8a1e1e" : "#5c8a1e")}
          onMouseLeave={(e) => (e.currentTarget.style.background = isRunning ? "#6b2222" : "#4c6b22")}>
          {isRunning
            ? <><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" /></svg>Stop</>
            : <><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
               Play{runnerLabel && <span className="ml-1 text-[10px] font-normal normal-case opacity-80">via {runnerLabel}</span>}</>
          }
        </button>
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
            <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
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
                      style={{ width: "78px", height: "50px", opacity: i === activeShot ? 1 : 0.5,
                        outline: i === activeShot ? "2px solid #66c0f4" : "none" }}>
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
            />
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
            </div>
            {meta && (
              <div className="rounded-lg p-4 space-y-2" style={{ background: "#16202d", border: "1px solid #1e3a50" }}>
                <h2 className="text-xs uppercase tracking-widest mb-3" style={{ color: "#8f98a0" }}>Game Info</h2>
                {/* F95 fields */}
                <MetaRow label="Developer"      value={meta.developer} />
                <MetaRow label="Version"        value={meta.version} />
                <MetaRow label="Engine"         value={meta.engine} />
                <MetaRow label="OS"             value={meta.os} />
                <MetaRow label="Language"       value={meta.language} />
                <MetaRow label="Censored"       value={meta.censored} />
                <MetaRow label="Released"       value={meta.release_date} />
                <MetaRow label="Updated"        value={meta.last_updated} />
                <MetaRow label="Price"          value={meta.price} />
                {/* DLsite extended fields */}
                <MetaRow label="Circle"         value={meta.circle} />
                <MetaRow label="Series"         value={meta.series} />
                <MetaRow label="Author"         value={meta.author} />
                <MetaRow label="Illustration"   value={meta.illustration} />
                <MetaRow label="Voice Actor"    value={meta.voice_actor} />
                <MetaRow label="Music"          value={meta.music} />
                <MetaRow label="Age Rating"     value={meta.age_rating} />
                <MetaRow label="Format"         value={meta.product_format} />
                <MetaRow label="File Format"    value={meta.file_format} />
                <MetaRow label="File Size"      value={meta.file_size} />
              </div>
            )}
            <div className="rounded-lg p-4 space-y-2" style={{ background: "#16202d", border: "1px solid #1e3a50" }}>
              <h2 className="text-xs uppercase tracking-widest mb-3" style={{ color: "#8f98a0" }}>Files</h2>
              <div>
                <p className="text-xs mb-0.5" style={{ color: "#8f98a0" }}>Executable</p>
                <p className="text-xs font-mono break-all" style={{ color: "#66c0f4" }}>{game.path}</p>
              </div>
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
    </div>
  );
}

// ─── Home View ────────────────────────────────────────────────────────────────
function HomeView({ games, stats, metadata, customizations, favGames, notes, runningGamePath, onSelect, onPlay, onStop }: {
  games: Game[];
  stats: Record<string, GameStats>;
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
              const st  = stats[game.path] ?? { totalTime: 0, lastPlayed: 0, lastSession: 0 };
              const cover = coverSrc(game);
              const name  = displayName(game);
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
                      onMouseEnter={(e) => { e.currentTarget.style.background="#1e4060"; e.currentTarget.style.color="#66c0f4"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background="#2a3f54"; e.currentTarget.style.color="#8f98a0"; }}>
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
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [games, setGames]             = useState<Game[]>(() => loadCache<Game[]>(SK_GAMES, []));
  const [stats, setStats]             = useState<Record<string, GameStats>>(() => loadCache(SK_STATS, {}));
  const [metadata, setMetadata]       = useState<Record<string, GameMetadata>>(() => loadCache(SK_META, {}));
  const [scannedPath, setScannedPath] = useState<string>(() => localStorage.getItem(SK_PATH) ?? "");
  const [selected, setSelected]       = useState<Game | null>(null);
  const [search, setSearch]           = useState("");
  const [syncState, setSyncState]     = useState<"idle" | "syncing" | "full-scan">("idle");
  const [deleteTarget, setDeleteTarget] = useState<Game | null>(null);
  const [isDeleting, setIsDeleting]   = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [showF95Login, setShowF95Login]   = useState(false);
  const [f95LoggedIn, setF95LoggedIn]     = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [screenshots, setScreenshots]   = useState<Record<string, Screenshot[]>>({});
  const [hiddenGames, setHiddenGames]   = useState<Record<string, boolean>>(() => loadCache(SK_HIDDEN, {}));
  const [favGames, setFavGames]         = useState<Record<string, boolean>>(() => loadCache(SK_FAVS, {}));
  const [customizations, setCustomizations] = useState<Record<string, GameCustomization>>(() => loadCache(SK_CUSTOM, {}));
  const [notes, setNotes]               = useState<Record<string, string>>(() => loadCache(SK_NOTES, {}));
  const [collections, setCollections]   = useState<Collection[]>(() => loadCache(SK_COLLECTIONS, []));
  const [activeCollectionId, setActiveCollectionId]       = useState<string | null>(null);
  const [showManageCollections, setShowManageCollections] = useState(false);
  const [creatingCollection, setCreatingCollection]       = useState(false);
  const [newCollectionName, setNewCollectionName]         = useState("");
  const [newCollectionColor, setNewCollectionColor]       = useState(COLLECTION_COLORS[0]);
  const [renamingCollectionId, setRenamingCollectionId]   = useState<string | null>(null);
  const [renamingCollectionName, setRenamingCollectionName] = useState("");
  const [showCustomizeModal, setShowCustomizeModal] = useState(false);
  const [showNotesModal, setShowNotesModal]         = useState(false);
  const [filterMode, setFilterMode]     = useState<FilterMode>("all");
  const [sortMode, setSortMode]         = useState<SortMode>("lastPlayed");
  const [runningGamePath, setRunningGamePath] = useState<string | null>(null);
  const [platform, setPlatform]           = useState<string>("windows");
  const [launchConfig, setLaunchConfig]   = useState<LaunchConfig>(() => loadCache(SK_LAUNCH, DEFAULT_LAUNCH_CONFIG));
  const [, setRecentGames]     = useState<RecentGame[]>(() => loadCache(SK_RECENT, []));
  const [showWineSettings, setShowWineSettings] = useState(false);
  const [appUpdate, setAppUpdate]         = useState<{ version: string; url: string } | null>(null);
  const isSyncing = useRef(false);

  // No auto-select: show HomeView when nothing is selected

  useEffect(() => {
    invoke<boolean>("f95_is_logged_in").then(setF95LoggedIn).catch(() => {});
    invoke<string>("get_platform").then(setPlatform).catch(() => {});
    // Check for a newer release on GitHub (once per startup, never again)
    invoke<{ version: string; url: string } | null>("check_app_update")
      .then((u) => { if (u) setAppUpdate(u); })
      .catch(() => {});
    // Push stored recent games into the tray on startup
    const storedRecent = loadCache<RecentGame[]>(SK_RECENT, []);
    if (storedRecent.length > 0) {
      invoke("set_recent_games", { games: storedRecent }).catch(() => {});
    }
    const path = localStorage.getItem(SK_PATH);
    if (path) runIncrementalSync(path);
    const unlistenFinished = listen("game-finished", (ev: any) => {
      const p = ev.payload as { path: string; duration_secs: number };
      updateStats(p.path, p.duration_secs);
      setRunningGamePath(null);
    });
    const unlistenStarted = listen<string>("game-started", (ev) => {
      setRunningGamePath(ev.payload);
    });
    const unlistenShot = listen<{ game_exe: string; screenshot: Screenshot }>("screenshot-taken", (ev) => {
      const { game_exe, screenshot } = ev.payload;
      setScreenshots((prev) => ({
        ...prev,
        [game_exe]: [screenshot, ...(prev[game_exe] ?? [])],
      }));
    });
    return () => {
      unlistenFinished.then((f) => f());
      unlistenStarted.then((f) => f());
      unlistenShot.then((f) => f());
    };
  }, []);

  // Load on-disk screenshots whenever the selected game changes
  useEffect(() => {
    if (!selected) return;
    invoke<Screenshot[]>("get_screenshots", { gameExe: selected.path })
      .then((shots) => setScreenshots((prev) => ({ ...prev, [selected.path]: shots })))
      .catch(() => {});
  }, [selected?.path]);

  const updateStats = (path: string, dur: number) => {
    setStats((prev) => {
      const cur = prev[path] || { totalTime: 0, lastPlayed: 0, lastSession: 0 };
      const next = { ...prev, [path]: { totalTime: cur.totalTime + dur, lastPlayed: Date.now(), lastSession: dur } };
      saveCache(SK_STATS, next); return next;
    });
  };

  const persistGames = (ng: Game[], nm: DirMtime[], path: string) => {
    setGames(ng); saveCache(SK_GAMES, ng); saveCache(SK_MTIMES, nm);
    localStorage.setItem(SK_PATH, path); setScannedPath(path);
  };

  const runIncrementalSync = async (path: string) => {
    if (isSyncing.current) return;
    isSyncing.current = true; setSyncState("syncing");
    try {
      const [ng, nm] = await invoke<[Game[], DirMtime[]]>("scan_games_incremental", {
        path, cachedGames: loadCache<Game[]>(SK_GAMES, []), cachedMtimes: loadCache<DirMtime[]>(SK_MTIMES, []),
      });
      persistGames(ng, nm, path);
    } catch { await runFullScan(path); }
    finally { isSyncing.current = false; setSyncState("idle"); }
  };

  const runFullScan = async (path: string) => {
    setSyncState("full-scan");
    try {
      const [ng, nm] = await invoke<[Game[], DirMtime[]]>("scan_games", { path });
      persistGames(ng, nm, path);
    } catch (e) { alert("Failed to scan: " + e); }
    finally { setSyncState("idle"); }
  };

  const handleSelectFolder = async () => {
    const sel = await open({ directory: true, multiple: false }).catch(() => null);
    if (sel && typeof sel === "string") {
      localStorage.removeItem(SK_GAMES); localStorage.removeItem(SK_MTIMES);
      await runFullScan(sel);
    }
  };

  const launchGame = async (path: string) => {
    const useRunner = launchConfig.enabled && platform !== "windows";
    const runner = useRunner ? (launchConfig.runnerPath || (launchConfig.runner !== "custom" ? launchConfig.runner : null)) : null;
    const prefix = useRunner && launchConfig.prefixPath ? launchConfig.prefixPath : null;
    try {
      await invoke("launch_game", { path, runner, prefix });
      // ── Track recent games (last 5, deduplicated) ────────────────────────
      const game = games.find((g) => g.path === path);
      if (game) {
        const displayName =
          customizations[path]?.displayName ?? metadata[path]?.title ?? game.name;
        setRecentGames((prev) => {
          const filtered = prev.filter((r) => r.path !== path);
          const updated  = [{ name: displayName, path }, ...filtered].slice(0, 5);
          saveCache(SK_RECENT, updated);
          invoke("set_recent_games", { games: updated }).catch(() => {});
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
      const updated = games.filter((g) => g.path !== deleteTarget.path);
      saveCache(SK_GAMES, updated); setGames(updated);
      const nm = { ...metadata }; delete nm[deleteTarget.path];
      saveCache(SK_META, nm); setMetadata(nm);
      if (selected?.path === deleteTarget.path) setSelected(updated[0] ?? null);
    } catch (e) { alert("Failed to delete: " + e); }
    finally { setIsDeleting(false); setDeleteTarget(null); }
  };

  const handleMetaFetched = (meta: GameMetadata) => {
    if (!selected) return;
    const next = { ...metadata, [selected.path]: meta };
    setMetadata(next); saveCache(SK_META, next);
  };

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
    if (!c.displayName && !c.coverUrl && !c.backgroundUrl) delete next[selected.path];
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

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const activeCol = activeCollectionId ? collections.find((c) => c.id === activeCollectionId) : null;
    return games
      .filter((g) => {
        const name = gameDisplayName(g).toLowerCase();
        if (!name.includes(q)) return false;
        if (activeCol && !activeCol.gamePaths.includes(g.path)) return false;
        const isHid = !!hiddenGames[g.path];
        if (filterMode === "all")     { if (isHid && !search && !activeCol) return false; }
        else if (filterMode === "favs")    return !!favGames[g.path];
        else if (filterMode === "hidden")  return isHid;
        else if (filterMode === "f95")     return metadata[g.path]?.source === "f95";
        else if (filterMode === "dlsite")  return metadata[g.path]?.source === "dlsite";
        else if (filterMode === "unlinked") return !metadata[g.path];
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
      });
  }, [games, search, hiddenGames, favGames, customizations, metadata, filterMode, sortMode, stats, collections, activeCollectionId]); // eslint-disable-line

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "#1b2838", color: "#c6d4df", fontFamily: "'Arial', sans-serif" }}>

      {/* ── Sidebar ── */}
      <aside className="flex flex-col flex-shrink-0 w-64 h-full" style={{ background: "#171a21", borderRight: "1px solid #0d1117" }}>
        <button
          onClick={() => setSelected(null)}
          title="Library Home"
          className="flex items-center gap-2.5 px-4 py-3 border-b w-full text-left"
          style={{ borderColor: "#0d1117", background: "transparent", cursor: "pointer" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "#1b2838")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
            stroke={selected === null ? "#66c0f4" : "#4a7a9b"}
            strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 12h4" /><path d="M8 10v4" /><circle cx="17" cy="12" r="1" />
          </svg>
          <span className="font-bold tracking-wide text-sm"
            style={{ color: selected === null ? "#66c0f4" : "#c6d4df" }}>LIBMALY</span>
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
          <div className="flex flex-wrap gap-1 mb-1.5">
            {([
              ["all",     "All"],
              ["favs",    "★ Favs"],
              ["hidden",  "👁 Hidden"],
              ["f95",     "F95"],
              ["dlsite",  "DLsite"],
              ["unlinked","Unlinked"],
            ] as [FilterMode, string][]).map(([mode, label]) => (
              <button key={mode} onClick={() => setFilterMode(mode)}
                className="px-2 py-0.5 rounded text-[10px] font-semibold"
                style={{
                  background: filterMode === mode ? "#2a6db5" : "#1b2d3d",
                  color:      filterMode === mode ? "#fff"    : "#5a6a7a",
                  border:     `1px solid ${filterMode === mode ? "#3d7dc8" : "#253545"}`,
                }}>{label}</button>
            ))}
          </div>
          {/* Sort */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] flex-shrink-0" style={{ color: "#4a5568" }}>Sort:</span>
            {([
              ["lastPlayed", "Recent"],
              ["playtime",   "Time"],
              ["name",       "Name"],
            ] as [SortMode, string][]).map(([mode, label]) => (
              <button key={mode} onClick={() => setSortMode(mode)}
                className="px-2 py-0.5 rounded text-[10px]"
                style={{
                  background: sortMode === mode ? "#2a3f54" : "transparent",
                  color:      sortMode === mode ? "#c6d4df" : "#4a5568",
                  border:     `1px solid ${sortMode === mode ? "#3d5a73" : "transparent"}`,
                }}>{label}</button>
            ))}
          </div>
        </div>
        {/* ── Collections ── */}
        <div className="border-b" style={{ borderColor: "#0d1117" }}>
          <div className="flex items-center px-3 pt-2 pb-1 gap-1">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#4a5568" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            <span className="text-[9px] uppercase tracking-widest font-bold flex-1" style={{ color: "#4a5568" }}>Collections</span>
            {activeCollectionId && (
              <button onClick={() => setActiveCollectionId(null)}
                className="text-[9px] px-1.5 py-0.5 rounded mr-1"
                style={{ background: "#2a3f54", color: "#8f98a0" }}
                title="Clear filter">✕ clear</button>
            )}
            <button onClick={() => setCreatingCollection(true)}
              className="w-5 h-5 flex items-center justify-center rounded text-sm font-bold"
              style={{ color: "#4a5568" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#66c0f4")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "#4a5568")}
              title="New collection">+</button>
          </div>
          {collections.length === 0 && !creatingCollection && (
            <p className="px-3 pb-2 text-[10px]" style={{ color: "#4a5568" }}>No collections yet</p>
          )}
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
        </div>
        <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "thin", scrollbarColor: "#2a475e transparent" }}>
          {syncState === "full-scan" ? (
            <div className="flex flex-col items-center justify-center h-32 gap-2">
              <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2" style={{ borderColor: "#66c0f4" }} />
              <span className="text-xs" style={{ color: "#8f98a0" }}>Scanning…</span>
            </div>
          ) : filtered.length === 0 ? (
            <p className="px-4 py-6 text-xs text-center" style={{ color: "#8f98a0" }}>
              {games.length === 0 ? "Add a library folder" : "No games match"}
            </p>
          ) : filtered.map((game) => {
            const isSelected = selected?.path === game.path;
            const m   = metadata[game.path];
            const cus = customizations[game.path];
            const coverSrc = cus?.coverUrl ?? m?.cover_url;
            const name = gameDisplayName(game);
            const isFavItem = !!favGames[game.path];
            const isHiddenItem = !!hiddenGames[game.path];
            return (
              <button key={game.path} onClick={() => setSelected(game)}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors"
                style={{
                  background: isSelected ? "#2a475e" : "transparent",
                  borderLeft: `3px solid ${isSelected ? "#66c0f4" : isFavItem ? "#c8a951" : "transparent"}`,
                  color: isSelected ? "#fff" : "#8f98a0",
                  opacity: isHiddenItem ? 0.6 : 1,
                }}>
                <div className="w-9 h-9 rounded flex-shrink-0 overflow-hidden relative"
                  style={{ background: heroGradient(game.name) }}>
                  {coverSrc
                    ? <img src={coverSrc} alt="" className="w-full h-full object-cover" />
                    : <div className="w-full h-full flex items-center justify-center text-sm font-bold text-white">
                        {name.charAt(0).toUpperCase()}
                      </div>}
                  {isFavItem && (
                    <span className="absolute top-0 right-0 text-[8px] leading-none p-px"
                      style={{ color: "#c8a951", textShadow: "0 0 3px #000" }}>★</span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1">
                    <p className="text-xs font-medium truncate flex-1">{name}</p>
                    {isHiddenItem && (
                      <span className="text-[9px] px-1 rounded flex-shrink-0"
                        style={{ background: "#2a3f54", color: "#4a5568" }}>hidden</span>
                    )}
                  </div>
                  <p className="text-[10px] truncate" style={{ color: "#4a5568" }}>
                    {stats[game.path]?.totalTime > 0 ? formatTime(stats[game.path].totalTime) : "Never played"}
                  </p>
                  {collections.some((c) => c.gamePaths.includes(game.path)) && (
                    <div className="flex gap-0.5 mt-0.5">
                      {collections.filter((c) => c.gamePaths.includes(game.path)).map((c) => (
                        <span key={c.id} title={c.name} className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: c.color }} />
                      ))}
                    </div>
                  )}
                  {collections.some((c) => c.gamePaths.includes(game.path)) && (
                    <div className="flex gap-0.5 mt-0.5">
                      {collections.filter((c) => c.gamePaths.includes(game.path)).map((c) => (
                        <span key={c.id} title={c.name} className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: c.color }} />
                      ))}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
        <div className="px-3 py-3 space-y-1.5 border-t" style={{ borderColor: "#0d1117" }}>
          {syncState === "syncing" && (
            <div className="flex items-center gap-2 px-1 py-1">
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#66c0f4" }} />
              <span className="text-xs" style={{ color: "#66c0f4" }}>Checking changes…</span>
            </div>
          )}
          {f95LoggedIn ? (
            <button onClick={async () => { await invoke("f95_logout").catch(() => {}); setF95LoggedIn(false); }}
              className="w-full py-1.5 rounded text-xs flex items-center justify-center gap-1.5"
              style={{ background: "#2a1f00", color: "#c8a951", border: "1px solid #5a4200" }}>
              <span className="w-1.5 h-1.5 rounded-full bg-current" /> F95 Logged In — Sign out
            </button>
          ) : (
            <button onClick={() => setShowF95Login(true)}
              className="w-full py-1.5 rounded text-xs"
              style={{ background: "#2a3f54", color: "#8f98a0", border: "1px solid #2a475e" }}>
              Sign in to F95zone
            </button>
          )}
          {appUpdate && (
            <a
              href={appUpdate.url}
              target="_blank"
              rel="noreferrer"
              className="w-full py-1.5 rounded text-xs font-semibold flex items-center justify-center gap-1.5"
              style={{ background: "#1a3a1a", color: "#6dbf6d", border: "1px solid #2a5a2a", animation: "pulse 2s infinite" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#1e4a1e")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "#1a3a1a")}
              title={`v${appUpdate.version} is available — click to open release page`}>
              ↑ v{appUpdate.version} available
            </a>
          )}
          <button onClick={handleSelectFolder}
            className="w-full py-2 rounded text-xs font-semibold"
            style={{ background: "#2a475e", color: "#c6d4df", border: "1px solid #1b3a50" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#3d6b8e")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "#2a475e")}>
            + Add Library Folder
          </button>
          {scannedPath && (
            <button onClick={() => runFullScan(scannedPath)} disabled={syncState !== "idle"}
              className="w-full py-1.5 rounded text-xs disabled:opacity-40"
              style={{ background: "transparent", color: "#8f98a0", border: "1px solid #2a3f54" }}>
              ↺ Force Rescan
            </button>
          )}
          {platform !== "windows" && (
            <button onClick={() => setShowWineSettings(true)}
              className="w-full py-1.5 rounded text-xs flex items-center justify-center gap-1.5"
              style={{
                background: launchConfig.enabled ? "#2a1f3a" : "transparent",
                color:      launchConfig.enabled ? "#b08ee8" : "#4a5568",
                border:     `1px solid ${launchConfig.enabled ? "#5a3a8a" : "#2a3f54"}`,
              }}
              onMouseEnter={(e) => { if (!launchConfig.enabled) { e.currentTarget.style.color="#8f98a0"; e.currentTarget.style.borderColor="#3d5a73"; }}}
              onMouseLeave={(e) => { if (!launchConfig.enabled) { e.currentTarget.style.color="#4a5568"; e.currentTarget.style.borderColor="#2a3f54"; }}}>
              🍷 {launchConfig.enabled ? `${launchConfig.runner.charAt(0).toUpperCase()+launchConfig.runner.slice(1)} active` : "Wine / Proton…"}
            </button>
          )}
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="flex-1 flex flex-col h-full overflow-hidden">
        {!selected ? (
          games.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4" style={{ color: "#8f98a0" }}>
              <svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.2 }}>
                <rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 12h4" /><path d="M8 10v4" /><circle cx="17" cy="12" r="1" />
              </svg>
              <p className="text-base" style={{ opacity: 0.4 }}>Add a library folder to get started</p>
              <button onClick={handleSelectFolder}
                className="px-6 py-2.5 rounded font-semibold text-sm"
                style={{ background: "#2a6db5", color: "#fff" }}>
                Select Library Folder
              </button>
            </div>
          ) : (
            <HomeView
              games={games}
              stats={stats}
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
            onPlay={() => launchGame(selected.path)}
            onStop={killGame}
            isRunning={runningGamePath === selected.path}
            runnerLabel={launchConfig.enabled && platform !== "windows" ? launchConfig.runner.charAt(0).toUpperCase()+launchConfig.runner.slice(1) : undefined}
            onDelete={() => setDeleteTarget(selected)}
            onLinkPage={() => setShowLinkModal(true)}
            onOpenF95Login={() => setShowF95Login(true)}
            onClearMeta={handleClearMeta}
            onUpdate={() => setShowUpdateModal(true)}
            onToggleHide={toggleHide}
            onToggleFav={toggleFav}
            onOpenCustomize={() => setShowCustomizeModal(true)}
            onOpenNotes={() => setShowNotesModal(true)}
            hasNotes={!!(notes[selected.path]?.trim())}
            onManageCollections={() => setShowManageCollections(true)}
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
          />
        )}
      </main>

      {/* ── Modals ── */}
      {showWineSettings && (
        <WineSettingsModal
          config={launchConfig}
          onSave={(c) => { setLaunchConfig(c); saveCache(SK_LAUNCH, c); }}
          onClose={() => setShowWineSettings(false)}
        />
      )}
      {showManageCollections && selected && (
        <ManageCollectionsModal
          gamePath={selected.path}
          displayTitle={customizations[selected.path]?.displayName ?? metadata[selected.path]?.title ?? selected.name}
          collections={collections}
          onToggle={handleToggleGameInCollection}
          onCreate={handleCreateCollection}
          onClose={() => setShowManageCollections(false)}
        />
      )}
      {showNotesModal && selected && (
        <NotesModal
          displayTitle={customizations[selected.path]?.displayName ?? metadata[selected.path]?.title ?? selected.name}
          initialNote={notes[selected.path] ?? ""}
          onSave={handleSaveNote}
          onClose={() => setShowNotesModal(false)}
        />
      )}
      {showCustomizeModal && selected && (
        <CustomizeModal
          game={selected}
          meta={metadata[selected.path]}
          custom={customizations[selected.path] ?? {}}
          onSave={handleSaveCustomization}
          onClose={() => setShowCustomizeModal(false)}
        />
      )}
      {showUpdateModal && selected && (
        <UpdateModal game={selected} onClose={() => setShowUpdateModal(false)} />
      )}
      {showLinkModal && selected && (
        <LinkPageModal
          gameName={selected.name}
          onClose={() => setShowLinkModal(false)}
          onFetched={handleMetaFetched}
          f95LoggedIn={f95LoggedIn}
          onOpenF95Login={() => { setShowLinkModal(false); setShowF95Login(true); }}
        />
      )}
      {showF95Login && (
        <F95LoginModal
          onClose={() => setShowF95Login(false)}
          onSuccess={() => setF95LoggedIn(true)}
        />
      )}
      {deleteTarget && (
        <div className="fixed inset-0 flex items-center justify-center z-50"
          style={{ background: "rgba(0,0,0,0.75)" }}
          onClick={(e) => { if (e.target === e.currentTarget && !isDeleting) setDeleteTarget(null); }}>
          <div className="rounded-lg p-6 w-96 shadow-2xl" style={{ background: "#1e2d3d", border: "1px solid #3d5a73" }}>
            <h2 className="text-lg font-bold mb-2" style={{ color: "#fff" }}>Uninstall Game</h2>
            <p className="text-sm mb-1" style={{ color: "#c6d4df" }}>This will permanently delete:</p>
            <p className="text-xs font-mono mb-4 break-all" style={{ color: "#e57373" }}>
              {deleteTarget.path.replace(/[\\/][^\\/]+$/, "")}
            </p>
            <p className="text-xs mb-5" style={{ color: "#8f98a0" }}>This action cannot be undone.</p>
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
      )}
    </div>
  );
}