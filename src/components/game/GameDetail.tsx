import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { InGameGallery } from "../InGameGallery";
import { NsfwOverlay } from "../common/NsfwOverlay";

interface Game {
  name: string;
  path: string;
  uninstalled?: boolean;
}

interface GameStats {
  totalTime: number;
  lastPlayed: number;
  lastSession: number;
  launchCount: number;
}

interface SessionEntry {
  id: string;
  path: string;
  startedAt: number;
  duration: number;
  note: string;
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

interface GameCustomization {
  displayName?: string;
  coverUrl?: string;
  backgroundUrl?: string;
  exeOverride?: string;
  launchArgs?: string;
  pinnedExes?: { name: string; path: string }[];
  status?: "Playing" | "Completed" | "On Hold" | "Dropped" | "Plan to Play";
  timeLimitMins?: number;
  customTags?: string[];
}

interface GameMetadata {
  source: string;
  source_url: string;
  title?: string;
  version?: string;
  developer?: string;
  overview?: string;
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

interface AppSettings {
  blurNsfwContent: boolean;
}

function formatTime(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h} hrs ${m} mins`;
  if (m > 0) return `${m} mins`;
  return "< 1 min";
}

function timeAgo(ts: number) {
  if (!ts) return "Never";
  const d = Math.floor((Date.now() - ts) / 86400000);
  if (d === 0) return "Today";
  if (d === 1) return "Yesterday";
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

function TagBadge({ text }: { text: string }) {
  return (
    <span className="inline-block text-xs px-2 py-0.5 rounded" style={{ background: "var(--color-border-soft)", color: "var(--color-accent-soft)", border: "1px solid #264d68" }}>
      {text}
    </span>
  );
}

function MetaRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="flex gap-2 text-xs">
      <span className="flex-shrink-0 w-24 text-right" style={{ color: "var(--color-text-muted)" }}>{label}</span>
      <span style={{ color: "var(--color-text)" }}>{value}</span>
    </div>
  );
}

function MenuEntry({ icon, label, color, onClick }: { icon: string; label: string; color?: string; onClick: () => void }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left"
      style={{ color: color ?? "var(--color-text)", background: hov ? "var(--color-panel-3)" : "transparent" }}
    >
      <span style={{ fontSize: "13px" }}>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function SettingsMenu({
  isHidden,
  isFav,
  onDelete,
  onToggleHide,
  onToggleFav,
  onCustomize,
  onManageCollections,
}: {
  isHidden: boolean;
  isFav: boolean;
  onDelete: () => void;
  onToggleHide: () => void;
  onToggleFav: () => void;
  onCustomize: () => void;
  onManageCollections: () => void;
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
        style={{ background: open ? "var(--color-border-strong)" : "var(--color-panel-3)", color: open ? "var(--color-text)" : "var(--color-text-muted)", border: "1px solid var(--color-border-strong)" }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--color-border-strong)";
          e.currentTarget.style.color = "var(--color-text)";
        }}
        onMouseLeave={(e) => {
          if (!open) {
            e.currentTarget.style.background = "var(--color-panel-3)";
            e.currentTarget.style.color = "var(--color-text-muted)";
          }
        }}
        title="Game settings"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 rounded-lg py-1 shadow-2xl" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)", minWidth: "180px" }}>
          <MenuEntry icon="⭐" label={isFav ? "Remove from Favorites" : "Add to Favorites"} color={isFav ? "var(--color-warning)" : undefined} onClick={() => { setOpen(false); onToggleFav(); }} />
          <MenuEntry icon={isHidden ? "👁" : "🙈"} label={isHidden ? "Unhide Game" : "Hide Game"} onClick={() => { setOpen(false); onToggleHide(); }} />
          <MenuEntry icon="🎨" label="Customise…" onClick={() => { setOpen(false); onCustomize(); }} />
          <MenuEntry icon="📁" label="Collections…" onClick={() => { setOpen(false); onManageCollections(); }} />
          <div style={{ borderTop: "1px solid var(--color-panel-3)", margin: "3px 0" }} />
          <MenuEntry icon="🗑" label="Uninstall" color="var(--color-danger)" onClick={() => { setOpen(false); onDelete(); }} />
        </div>
      )}
    </div>
  );
}

function sessionsPerDay(sessions: SessionEntry[], gamePath: string | null, days = 7): { label: string; secs: number }[] {
  const now = new Date();
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - (days - 1 - i));
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const dayEnd = dayStart + 86_400_000;
    const secs = sessions
      .filter((s) => (!gamePath || s.path === gamePath) && s.startedAt >= dayStart && s.startedAt < dayEnd)
      .reduce((acc, s) => acc + s.duration, 0);
    const label = d.toLocaleDateString("en", { weekday: "short" });
    return { label, secs };
  });
}

const MILESTONES = [
  { hours: 1, label: "1h", color: "var(--color-accent)" },
  { hours: 5, label: "5h", color: "#4e9bd0" },
  { hours: 10, label: "10h", color: "var(--color-warning)" },
  { hours: 25, label: "25h", color: "#e8904a" },
  { hours: 50, label: "50h", color: "#e05050" },
  { hours: 100, label: "100h", color: "#a060d8" },
];

function PlayChart({ sessions, gamePath, days = 7 }: { sessions: SessionEntry[]; gamePath: string | null; days?: number }) {
  const data = sessionsPerDay(sessions, gamePath, days);
  const maxSecs = Math.max(...data.map((d) => d.secs), 1);
  const H = 80;

  return (
    <div className="w-full">
      <svg width="100%" height={H + 20} style={{ overflow: "visible" }}>
        {data.map((d, i) => {
          const barH = Math.max(d.secs > 0 ? 4 : 0, Math.round((d.secs / maxSecs) * H));
          const wPct = 100 / days;
          const gapPct = 1.5;
          const xPct = i * wPct + gapPct / 2;
          const barWPct = wPct - gapPct;
          return (
            <g key={i}>
              <rect x={`${xPct}%`} y={H - barH} width={`${barWPct}%`} height={barH} rx="2" fill={d.secs > 0 ? "var(--color-accent-dark)" : "var(--color-panel-low)"} style={{ transition: "height 0.3s" }}>
                {d.secs > 0 && <title>{formatTime(d.secs)}</title>}
              </rect>
              <text x={`${i * wPct + wPct / 2}%`} y={H + 14} textAnchor="middle" fontSize="9" fill="var(--color-text-dim)">
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function Milestones({ totalSecs }: { totalSecs: number }) {
  const totalH = totalSecs / 3600;
  const achieved = MILESTONES.filter((m) => totalH >= m.hours);
  const next = MILESTONES.find((m) => totalH < m.hours);
  if (achieved.length === 0 && !next) return null;
  return (
    <div>
      <p className="text-xs uppercase tracking-widest mb-2" style={{ color: "var(--color-text-muted)" }}>Milestones</p>
      <div className="flex flex-wrap gap-1.5 mb-1">
        {achieved.map((m) => (
          <span key={m.label} className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: m.color + "22", color: m.color, border: `1px solid ${m.color}55` }} title={`${m.hours}h played`}>
            ★ {m.label}
          </span>
        ))}
      </div>
      {next && (
        <div className="mt-1">
          <div className="flex justify-between text-[9px] mb-0.5" style={{ color: "var(--color-text-dim)" }}>
            <span>Next: {next.label}</span>
            <span>{Math.round((totalH / next.hours) * 100)}%</span>
          </div>
          <div className="h-1 rounded-full overflow-hidden" style={{ background: "var(--color-panel-low)" }}>
            <div className="h-full rounded-full" style={{ width: `${Math.min(100, (totalH / next.hours) * 100)}%`, background: next.color, transition: "width 0.4s" }} />
          </div>
        </div>
      )}
    </div>
  );
}

function SessionTimeline({ sessions, gamePath, onEditNote }: { sessions: SessionEntry[]; gamePath: string; onEditNote: (entry: SessionEntry) => void }) {
  const entries = useMemo(() => sessions.filter((s) => s.path === gamePath).sort((a, b) => b.startedAt - a.startedAt).slice(0, 50), [sessions, gamePath]);
  if (entries.length === 0) {
    return <div className="rounded px-3 py-4 text-center text-xs" style={{ background: "var(--color-bg-overlay)", color: "var(--color-text-dim)" }}>No sessions recorded yet — play the game to see history here.</div>;
  }
  return (
    <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1" style={{ scrollbarWidth: "thin", scrollbarColor: "var(--color-border) transparent" }}>
      {entries.map((s) => {
        const d = new Date(s.startedAt);
        const dateStr = d.toLocaleDateString("en", { month: "short", day: "numeric" });
        const timeStr = d.toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" });
        return (
          <div key={s.id} className="flex items-start gap-2 rounded px-2.5 py-2 group" style={{ background: "var(--color-bg-overlay)" }}>
            <div className="flex flex-col items-center flex-shrink-0 mt-0.5"><div className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--color-accent-dark)" }} /></div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px]" style={{ color: "var(--color-accent)" }}>{dateStr} {timeStr}</span>
                <span className="text-[10px] font-semibold" style={{ color: "var(--color-text)" }}>{formatTime(s.duration)}</span>
              </div>
              {s.note && <p className="text-xs mt-0.5 italic" style={{ color: "var(--color-text-muted)" }}>"{s.note}"</p>}
            </div>
            <button onClick={() => onEditNote(s)} className="text-[9px] flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity px-1.5 py-0.5 rounded" style={{ color: "var(--color-accent)", background: "var(--color-panel-low)" }} title={s.note ? "Edit note" : "Add note"}>
              {s.note ? "✎" : " note"}
            </button>
          </div>
        );
      })}
    </div>
  );
}

function VersionTimeline({ history, onAddHistory }: { history: HistoryEntry[]; onAddHistory: (v: string, n: string) => void }) {
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
        <h2 className="text-xs uppercase tracking-widest text-[var(--color-text-muted)]">Version History</h2>
        <button onClick={() => setIsAdding(!isAdding)} className="text-xs text-[var(--color-accent)] hover:underline">{isAdding ? "Cancel" : " Log update"}</button>
      </div>
      {isAdding && (
        <div className="p-3 rounded mb-4" style={{ background: "var(--color-panel-3)", border: "1px solid var(--color-border-strong)" }}>
          <div className="flex gap-2 mb-2">
            <input type="text" placeholder="Vers" value={draftV} onChange={(e) => setDraftV(e.currentTarget.value)} className="w-16 px-2 py-1 bg-[var(--color-panel-2)] border border-[var(--color-border-card)] rounded text-xs outline-none focus:border-[var(--color-accent)] text-white" />
            <input type="text" placeholder="Update notes (e.g. Added patch)" value={draftN} onChange={(e) => setDraftN(e.currentTarget.value)} onKeyDown={(e) => e.key === "Enter" && submit()} className="flex-1 px-2 py-1 bg-[var(--color-panel-2)] border border-[var(--color-border-card)] rounded text-xs outline-none focus:border-[var(--color-accent)] text-white" />
            <button onClick={submit} className="px-3 py-1 bg-[var(--color-accent)] text-black text-xs font-semibold rounded">Log</button>
          </div>
        </div>
      )}
      {history.length === 0 ? (
        <p className="text-xs text-[var(--color-text-dim)] italic">No version history logged yet.</p>
      ) : (
        <div className="relative border-l border-[var(--color-border)] ml-2 pl-4 pb-1">
          {history.map((h) => (
            <div key={h.id} className="relative mb-5 last:mb-0 group">
              <div className="absolute w-2 h-2 rounded-full bg-[var(--color-accent)] -left-[21px] top-1 transition-transform group-hover:scale-125" />
              <div className="flex items-baseline gap-2 mb-0.5">
                <span className="font-mono text-sm font-bold text-[var(--color-danger)]">{h.version}</span>
                <span className="text-[10px] text-[var(--color-text-dim)]" title={new Date(h.date).toLocaleString()}>{timeAgo(h.date)}</span>
              </div>
              <p className="text-xs text-[var(--color-text-soft)] leading-relaxed">{h.note}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function GameDetail({
  game,
  stat,
  meta,
  customization,
  f95LoggedIn,
  screenshots,
  isHidden,
  isFav,
  onPlay,
  onStop,
  isRunning,
  runnerLabel,
  onDelete,
  onLinkPage,
  onOpenF95Login,
  onClearMeta,
  onUpdate,
  onTakeScreenshot,
  onOpenScreenshotsFolder,
  onExportGalleryZip,
  onUpdateScreenshotTags,
  onToggleHide,
  onToggleFav,
  onOpenCustomize,
  onSaveCustomization,
  onOpenNotes,
  hasNotes,
  onManageCollections,
  sessions,
  onEditSessionNote,
  appSettings,
  revealedNsfw,
  onRevealNsfw,
  history,
  onAddHistory,
}: {
  game: Game;
  stat: GameStats;
  meta?: GameMetadata;
  customization: GameCustomization;
  f95LoggedIn: boolean;
  screenshots: Screenshot[];
  isHidden: boolean;
  isFav: boolean;
  onPlay: (overridePath?: string, overrideArgs?: string) => void;
  onStop: () => void;
  isRunning: boolean;
  runnerLabel?: string;
  onDelete: () => void;
  onLinkPage: () => void;
  onOpenF95Login: () => void;
  onClearMeta: () => void;
  onUpdate: () => void;
  onTakeScreenshot: () => void;
  onOpenScreenshotsFolder: () => void;
  onExportGalleryZip: () => void;
  onUpdateScreenshotTags: (filename: string, tags: string[]) => void;
  onToggleHide: () => void;
  onToggleFav: () => void;
  onOpenCustomize: () => void;
  onSaveCustomization: (changes: Partial<GameCustomization>) => void;
  onOpenNotes: () => void;
  hasNotes: boolean;
  onManageCollections: () => void;
  sessions: SessionEntry[];
  onEditSessionNote: (entry: SessionEntry) => void;
  appSettings: AppSettings;
  revealedNsfw: Record<string, boolean>;
  onRevealNsfw: (path: string) => void;
  history: HistoryEntry[];
  onAddHistory: (version: string, note: string) => void;
}) {
  const [activeShot, setActiveShot] = useState(0);
  const cover = customization.coverUrl ?? meta?.cover_url;
  const heroBg = customization.backgroundUrl ?? cover;
  const displayTitle = customization.displayName ?? meta?.title ?? game.name;
  const shots = meta?.screenshots ?? [];

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <div className="relative flex-shrink-0 overflow-hidden" style={{ height: "240px" }}>
        {heroBg ? <img src={heroBg} alt={displayTitle} className="absolute inset-0 w-full h-full object-cover" style={{ filter: "brightness(0.5)" }} /> : <div className="absolute inset-0" style={{ background: heroGradient(game.name) }} />}
        <NsfwOverlay gamePath={game.path} meta={meta} appSettings={appSettings} revealed={revealedNsfw} onReveal={onRevealNsfw} />
        <div className="absolute inset-0" style={{ background: "linear-gradient(to top,var(--color-bg) 0%,rgba(27,40,56,0.15) 60%,transparent 100%)" }} />
        <div className="absolute bottom-0 left-0 right-0 px-8 pb-5">
          <div className="flex items-end justify-between">
            <div>
              <div className="flex gap-2 mb-1.5">
                {meta?.source && (
                  <span className="inline-block text-xs px-2 py-0.5 rounded font-semibold" style={{ background: meta.source === "f95" ? "var(--color-warning)" : "var(--color-danger-strong)", color: meta.source === "f95" ? "var(--color-black-strong)" : "var(--color-white)" }}>
                    {meta.source === "f95" ? "F95zone" : "DLsite"}
                  </span>
                )}
                {isHidden && (
                  <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded font-semibold" style={{ background: "rgba(0,0,0,0.6)", color: "var(--color-text-muted)", border: "1px solid var(--color-border-strong)" }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /><line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                    Hidden
                  </span>
                )}
              </div>
              <h1 className="text-3xl font-bold" style={{ color: "var(--color-white)", textShadow: "0 2px 8px rgba(0,0,0,.9)" }}>{displayTitle}</h1>
              {meta?.version && <span className="text-sm mt-0.5 block" style={{ color: "var(--color-accent-soft)" }}>{meta.version}</span>}
            </div>
            {meta?.rating && (
              <div className="text-right mb-1">
                <p className="text-xs mb-0.5" style={{ color: "var(--color-text-muted)" }}>Rating</p>
                <p className="font-bold" style={{ color: "var(--color-warning)" }}>★ {meta.rating}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 px-8 py-3 flex-shrink-0" style={{ background: "var(--color-bg-elev)", borderBottom: "1px solid var(--color-bg-deep)" }}>
        <button
          onClick={game.uninstalled ? undefined : isRunning ? onStop : () => onPlay()}
          disabled={game.uninstalled}
          title={game.uninstalled ? "Reinstall the game or check folder to play" : ""}
          className="flex items-center gap-2 px-7 py-2 rounded font-bold text-sm uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ background: game.uninstalled ? "#3a3a3a" : isRunning ? "var(--color-stop-bg)" : "var(--color-play-bg)", color: game.uninstalled ? "var(--color-text-muted)" : isRunning ? "var(--color-danger-soft)" : "var(--color-play-text)" }}
          onMouseEnter={(e) => { if (!game.uninstalled) e.currentTarget.style.background = isRunning ? "var(--color-stop-hover)" : "var(--color-play-hover)"; }}
          onMouseLeave={(e) => { if (!game.uninstalled) e.currentTarget.style.background = isRunning ? "var(--color-stop-bg)" : "var(--color-play-bg)"; }}
        >
          {game.uninstalled ? (
            "Folder missing"
          ) : isRunning ? (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" /></svg>Stop
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
              Play{runnerLabel && <span className="ml-1 text-[10px] font-normal normal-case opacity-80">via {runnerLabel}</span>}
            </>
          )}
        </button>
        {customization?.pinnedExes?.map((ex, i) => (
          <button
            key={i}
            onClick={() => onPlay(ex.path, undefined)}
            disabled={isRunning}
            className="flex items-center gap-1.5 px-3 py-2 rounded text-sm disabled:opacity-50"
            style={{ background: "var(--color-panel-3)", color: "var(--color-text)", border: "1px solid var(--color-border-strong)" }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
            {ex.name}
          </button>
        ))}
        <button onClick={onLinkPage} className="flex items-center gap-1.5 px-3 py-2 rounded text-sm" style={{ background: "var(--color-panel-3)", color: "var(--color-text-muted)", border: "1px solid var(--color-border-strong)" }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
          {meta ? "Re-link" : "Link Page"}
        </button>
        <button onClick={onUpdate} className="flex items-center gap-1.5 px-3 py-2 rounded text-sm" style={{ background: "var(--color-panel-3)", color: "var(--color-text-muted)", border: "1px solid var(--color-border-strong)" }} title="Install a new version safely (preserves saves)">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="16 16 12 12 8 16" /><line x1="12" y1="12" x2="12" y2="21" /><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
          </svg>
          Update
        </button>
        <button onClick={onOpenNotes} className="flex items-center gap-1.5 px-3 py-2 rounded text-sm" style={{ background: hasNotes ? "#1e2d1a" : "var(--color-panel-3)", color: hasNotes ? "var(--color-success)" : "var(--color-text-muted)", border: `1px solid ${hasNotes ? "var(--color-success-border)" : "var(--color-border-strong)"}` }} title="Game notes (Markdown supported)">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
          Notes{hasNotes && <span className="w-1.5 h-1.5 rounded-full bg-current ml-0.5" />}
        </button>
        {meta && (
          <a href={meta.source_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 px-3 py-2 rounded text-xs" style={{ background: "var(--color-panel-2)", color: "var(--color-accent)", border: "1px solid var(--color-border)" }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
            </svg>
            Open {meta.source === "f95" ? "F95" : "DLsite"}
          </a>
        )}
        {!f95LoggedIn && (
          <button onClick={onOpenF95Login} className="flex items-center gap-1 px-3 py-2 rounded text-xs" style={{ background: "var(--color-warning-bg-2)", color: "var(--color-warning)", border: "1px solid var(--color-warning-border)" }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            F95 Login
          </button>
        )}
        <div className="flex-1" />
        {meta && <button onClick={onClearMeta} className="px-3 py-2 rounded text-xs" style={{ background: "transparent", color: "var(--color-text-dim)" }} title="Remove linked metadata">✕ Unlink</button>}
        <SettingsMenu isHidden={isHidden} isFav={isFav} onDelete={onDelete} onToggleHide={onToggleHide} onToggleFav={onToggleFav} onCustomize={onOpenCustomize} onManageCollections={onManageCollections} />
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-5" style={{ scrollbarWidth: "thin", scrollbarColor: "var(--color-border) transparent" }}>
        <div className="flex gap-6 max-w-5xl">
          <div className="flex-1 min-w-0 space-y-5">
            {(meta?.overview_html || meta?.overview) && (
              <section>
                <h2 className="text-xs uppercase tracking-widest mb-2" style={{ color: "var(--color-text-muted)" }}>Overview</h2>
                {meta.overview_html ? (
                  <div className="text-sm leading-relaxed dlsite-overview" style={{ color: "var(--color-text-soft)" }} dangerouslySetInnerHTML={{ __html: meta.overview_html }} />
                ) : (
                  <div className="text-sm leading-relaxed" style={{ color: "var(--color-text-soft)" }}>
                    {meta.overview!.split("\n\n").map((para, i) => <p key={i} className={i > 0 ? "mt-3" : ""}>{para}</p>)}
                  </div>
                )}
              </section>
            )}
            {shots.length > 0 && (
              <section>
                <h2 className="text-xs uppercase tracking-widest mb-2" style={{ color: "var(--color-text-muted)" }}>Screenshots</h2>
                <div className="rounded overflow-hidden mb-2" style={{ background: "var(--color-bg-deep)" }}>
                  <img src={shots[activeShot]} alt="screenshot" className="w-full object-contain" style={{ maxHeight: "240px" }} />
                </div>
                <div className="flex gap-2 flex-wrap">
                  {shots.map((s, i) => (
                    <button key={i} onClick={() => setActiveShot(i)} className="rounded overflow-hidden flex-shrink-0" style={{ width: "78px", height: "50px", opacity: i === activeShot ? 1 : 0.5, outline: i === activeShot ? "2px solid var(--color-accent)" : "none" }}>
                      <img src={s} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              </section>
            )}
            {meta?.tags && meta.tags.length > 0 && (
              <section>
                <h2 className="text-xs uppercase tracking-widest mb-2" style={{ color: "var(--color-text-muted)" }}>Tags</h2>
                <div className="flex flex-wrap gap-1.5">{meta.tags.map((t) => <TagBadge key={t} text={t} />)}</div>
              </section>
            )}
            <section>
              <h2 className="text-xs uppercase tracking-widest mb-2 flex items-center justify-between" style={{ color: "var(--color-text-muted)" }}><span>Custom Tags</span></h2>
              <div className="flex flex-wrap gap-1.5 items-center">
                {customization.customTags?.map((t) => (
                  <span key={t} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded cursor-pointer group" style={{ background: "var(--color-border)", color: "var(--color-text)", border: "1px solid var(--color-border-strong)" }} onClick={() => { const tags = customization.customTags?.filter((x) => x !== t) || []; onSaveCustomization({ customTags: tags }); }}>
                    {t} <span className="text-[10px] opacity-0 group-hover:opacity-100 transition-opacity">✕</span>
                  </span>
                ))}
                <input
                  type="text"
                  placeholder=" add tag"
                  className="bg-transparent border border-dashed border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-border-strong)] transition-colors text-xs px-2 py-0.5 rounded outline-none w-24 focus:w-32 focus:border-solid focus:border-[var(--color-accent)] focus:text-[var(--color-white)]"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const val = e.currentTarget.value.trim().toLowerCase();
                      if (val) {
                        const tags = new Set(customization.customTags || []);
                        tags.add(val);
                        onSaveCustomization({ customTags: Array.from(tags) });
                        e.currentTarget.value = "";
                      }
                    }
                  }}
                />
              </div>
            </section>
            {!meta && (
              <div className="rounded-lg px-6 py-8 text-center" style={{ background: "var(--color-bg-elev)", border: "2px dashed var(--color-panel-3)" }}>
                <p className="text-sm mb-1" style={{ color: "var(--color-text-muted)" }}>No metadata linked yet.</p>
                <p className="text-xs mb-4" style={{ color: "var(--color-text-dim)" }}>Link an F95zone or DLsite page to get cover art, description, tags and more.</p>
                <button onClick={onLinkPage} className="px-5 py-2 rounded text-sm font-semibold" style={{ background: "var(--color-accent-dark)", color: "var(--color-white)" }}>Link a Page</button>
              </div>
            )}
            <InGameGallery shots={screenshots} onTake={onTakeScreenshot} onOpenFolder={onOpenScreenshotsFolder} onExportZip={onExportGalleryZip} onUpdateTags={onUpdateScreenshotTags} />
            <section>
              <h2 className="text-xs uppercase tracking-widest mb-2" style={{ color: "var(--color-text-muted)" }}>Play History</h2>
              <SessionTimeline sessions={sessions} gamePath={game.path} onEditNote={onEditSessionNote} />
            </section>
            <section>
              <VersionTimeline history={history} onAddHistory={onAddHistory} />
            </section>
          </div>
          <div className="flex-shrink-0 w-60 space-y-4">
            <div className="rounded-lg p-4 space-y-3" style={{ background: "var(--color-bg-elev)", border: "1px solid var(--color-border-soft)" }}>
              <h2 className="text-xs uppercase tracking-widest" style={{ color: "var(--color-text-muted)" }}>Your Stats</h2>
              <div><p className="text-xs" style={{ color: "var(--color-text-muted)" }}>Total playtime</p><p className="text-base font-semibold" style={{ color: "var(--color-text)" }}>{stat.totalTime > 0 ? formatTime(stat.totalTime) : "—"}</p></div>
              <div><p className="text-xs" style={{ color: "var(--color-text-muted)" }}>Last played</p><p className="text-sm" style={{ color: "var(--color-text)" }}>{timeAgo(stat.lastPlayed)}</p></div>
              {stat.lastSession > 0 && <div><p className="text-xs" style={{ color: "var(--color-text-muted)" }}>Last session</p><p className="text-sm" style={{ color: "var(--color-text)" }}>{formatTime(stat.lastSession)}</p></div>}
              {(stat.launchCount ?? 0) > 0 && <div><p className="text-xs" style={{ color: "var(--color-text-muted)" }}>Times played</p><p className="text-sm font-semibold" style={{ color: "var(--color-accent)" }}>{stat.launchCount} {stat.launchCount === 1 ? "session" : "sessions"}</p></div>}
              {sessions.some((s) => s.path === game.path) && <div><p className="text-xs mb-2" style={{ color: "var(--color-text-muted)" }}>This week</p><PlayChart sessions={sessions} gamePath={game.path} /></div>}
            </div>
            <div className="rounded-lg p-4 space-y-4" style={{ background: "var(--color-bg-elev)", border: "1px solid var(--color-border-soft)" }}>
              <div>
                <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: "var(--color-text-muted)" }}>Completion Status</label>
                <select value={customization.status || ""} onChange={(e) => onSaveCustomization({ status: ((e.target as HTMLSelectElement).value || undefined) as any })} className="w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1.5 text-xs outline-none text-[var(--color-text)] cursor-pointer" style={{ backgroundImage: "none" }}>
                  <option value="">- Not Set -</option><option value="Playing">▶ Playing</option><option value="Completed">✓ Completed</option><option value="On Hold">⏸ On Hold</option><option value="Dropped">⏹ Dropped</option><option value="Plan to Play">📅 Plan to Play</option>
                </select>
              </div>
              <div>
                <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: "var(--color-text-muted)" }} title="Show a toast warning when you exceed this time in a single launch">Time Budget (mins)</label>
                <input type="number" min="0" placeholder="No limit" value={customization.timeLimitMins || ""} onChange={(e) => { const el = e.target as HTMLInputElement; onSaveCustomization({ timeLimitMins: el.value ? parseInt(el.value) : undefined }); }} className="w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1.5 text-xs outline-none text-[var(--color-text)]" />
              </div>
            </div>
            {stat.totalTime > 0 && <div className="rounded-lg p-4" style={{ background: "var(--color-bg-elev)", border: "1px solid var(--color-border-soft)" }}><Milestones totalSecs={stat.totalTime} /></div>}
            {meta && (
              <div className="rounded-lg p-4 space-y-2" style={{ background: "var(--color-bg-elev)", border: "1px solid var(--color-border-soft)" }}>
                <h2 className="text-xs uppercase tracking-widest mb-3" style={{ color: "var(--color-text-muted)" }}>Game Info</h2>
                <MetaRow label="Developer" value={meta.developer} /><MetaRow label="Version" value={meta.version} /><MetaRow label="Engine" value={meta.engine} /><MetaRow label="OS" value={meta.os} /><MetaRow label="Language" value={meta.language} /><MetaRow label="Censored" value={meta.censored} /><MetaRow label="Released" value={meta.release_date} /><MetaRow label="Updated" value={meta.last_updated} /><MetaRow label="Price" value={meta.price} />
                <MetaRow label="Circle" value={meta.circle} /><MetaRow label="Series" value={meta.series} /><MetaRow label="Author" value={meta.author} /><MetaRow label="Illustration" value={meta.illustration} /><MetaRow label="Voice Actor" value={meta.voice_actor} /><MetaRow label="Music" value={meta.music} /><MetaRow label="Age Rating" value={meta.age_rating} /><MetaRow label="Format" value={meta.product_format} /><MetaRow label="File Format" value={meta.file_format} /><MetaRow label="File Size" value={meta.file_size} />
              </div>
            )}
            <div className="rounded-lg p-4 space-y-2" style={{ background: "var(--color-bg-elev)", border: "1px solid var(--color-border-soft)" }}>
              <h2 className="text-xs uppercase tracking-widest mb-3" style={{ color: "var(--color-text-muted)" }}>Files</h2>
              {customization.exeOverride ? (
                <>
                  <div>
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <p className="text-xs" style={{ color: "var(--color-warning)" }}>Launch override</p>
                      <span className="text-[9px] px-1.5 py-px rounded font-semibold" style={{ background: "#3a2800", color: "var(--color-warning)", border: "1px solid var(--color-warning-border)" }}>active</span>
                    </div>
                    <p className="text-xs font-mono break-all" style={{ color: "var(--color-warning)" }}>{customization.exeOverride}</p>
                  </div>
                  <div><p className="text-xs mb-0.5" style={{ color: "var(--color-text-muted)" }}>Scanned exe</p><p className="text-xs font-mono break-all" style={{ color: "var(--color-text-dim)" }}>{game.path}</p></div>
                </>
              ) : (
                <div><p className="text-xs mb-0.5" style={{ color: "var(--color-text-muted)" }}>Executable</p><p className="text-xs font-mono break-all" style={{ color: "var(--color-accent)" }}>{game.path}</p></div>
              )}
              <div><p className="text-xs mb-0.5" style={{ color: "var(--color-text-muted)" }}>Folder</p><p className="text-xs font-mono break-all" style={{ color: "var(--color-text)" }}>{game.path.replace(/[\\/][^\\/]$/, "")}</p></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

