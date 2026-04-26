import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { useTranslation } from "react-i18next";
import type { PerGameMediaPlaybackAssessment } from "../../lib/mediaPlaybackKnowledge";
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
  mood?: "hype" | "chill" | "chaos";
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
  personalRating?: number;
  personalReview?: string;
  overallScore100?: number;
  ratingMode?: "manual" | "categories";
  categoryRatings?: Partial<Record<RatingCategoryKey, number>>;
  emulatorProfileId?: string;
  romPath?: string;
}

type RatingScale = "10" | "10_decimal" | "100" | "5_star" | "3_smiley";
type RatingCategoryKey = "gameplay" | "story" | "soundtrack" | "visuals" | "characters" | "performance";
const RATING_CATEGORIES: { key: RatingCategoryKey; labelKey: string }[] = [
  { key: "gameplay", labelKey: "game.rating_categories.gameplay" },
  { key: "story", labelKey: "game.rating_categories.story" },
  { key: "soundtrack", labelKey: "game.rating_categories.soundtrack" },
  { key: "visuals", labelKey: "game.rating_categories.visuals" },
  { key: "characters", labelKey: "game.rating_categories.characters" },
  { key: "performance", labelKey: "game.rating_categories.performance" },
];

interface GameMetadata {
  source: string;
  source_label?: string;
  source_url: string;
  source_links?: { source: string; source_label?: string; source_url: string; fetchedAt?: number }[];
  aggregated_sources?: string[];
  title?: string;
  version?: string;
  developer?: string;
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

interface AppSettings {
  blurNsfwContent: boolean;
  ratingScale: RatingScale;
}

function formatTime(s: number, t: any) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${t('time.hours', { count: h })} ${t('time.minutes', { count: m })}`;
  if (m > 0) return t('time.minutes', { count: m });
  return t('time.less_than_minute');
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

function scaleInputConfig(scale: RatingScale): { min: number; max: number; step: number; suffix: string } {
  if (scale === "10") return { min: 0, max: 10, step: 1, suffix: "/10" };
  if (scale === "10_decimal") return { min: 0, max: 10, step: 0.1, suffix: "/10" };
  if (scale === "100") return { min: 0, max: 100, step: 1, suffix: "/100" };
  if (scale === "5_star") return { min: 0, max: 5, step: 0.1, suffix: "/5" };
  return { min: 1, max: 3, step: 1, suffix: "/3" };
}

function score100ToScaleValue(score100: number, scale: RatingScale): number {
  const s = clampScore100(score100);
  if (scale === "10" || scale === "10_decimal") return s / 10;
  if (scale === "100") return s;
  if (scale === "5_star") return s / 20;
  if (s <= 40) return 1;
  if (s <= 75) return 2;
  return 3;
}

function scaleValueToScore100(value: number, scale: RatingScale): number {
  const cfg = scaleInputConfig(scale);
  const v = Math.max(cfg.min, Math.min(cfg.max, value));
  if (scale === "10" || scale === "10_decimal") return clampScore100(v * 10);
  if (scale === "100") return clampScore100(v);
  if (scale === "5_star") return clampScore100(v * 20);
  if (v <= 1.5) return 33;
  if (v <= 2.5) return 67;
  return 100;
}

function timeAgo(ts: number, t: any) {
  if (!ts) return t('time.never');
  const d = Math.floor((Date.now() - ts) / 86400000);
  if (d === 0) return t('time.today');
  if (d === 1) return t('time.yesterday');
  if (d < 30) return t('time.days_ago', { count: d });
  const mo = Math.floor(d / 30);
  return mo < 12 ? t('time.months_ago', { count: mo }) : t('time.years_ago', { count: Math.floor(mo / 12) });
}

function heroGradient(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  const hue = Math.abs(h) % 360;
  return `linear-gradient(135deg,hsl(${hue},40%,15%) 0%,hsl(${(hue + 50) % 360},55%,25%) 100%)`;
}

const VNDB_RELATION_LABELS: Record<string, string> = {
  seq: "Sequel",
  preq: "Prequel",
  side: "Side story",
  alt: "Alternative version",
  fan: "Fan disc",
  set: "Same setting",
  ser: "Same series",
  char: "Shared cast",
};

interface ParsedRelation {
  raw: string;
  relationKey: string;
  relationLabel: string;
  title: string;
  linkText?: string;
  url?: string;
}

function relationHostLabel(url: string) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes("vndb.org")) return "VNDB";
    if (host.includes("igdb.com")) return "IGDB";
    if (host.includes("rawg.io")) return "RAWG";
    return host.replace(/^www\./, "");
  } catch {
    return "Link";
  }
}

function parseRelationItem(raw: string): ParsedRelation {
  const trimmed = raw.trim();
  const match = trimmed.match(/^([^:]+):\s*(.+?)(?:\s+\(([^()]+)\))?$/i);
  if (!match) {
    return {
      raw,
      relationKey: "related",
      relationLabel: "Related",
      title: trimmed,
    };
  }

  const relationKey = match[1].trim().toLowerCase();
  const title = match[2].trim();
  const token = match[3]?.trim();
  const fallbackLabel = relationKey
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Related";

  const resolved = (() => {
    if (!token) return { linkText: undefined, url: undefined };
    if (/^v\d+$/i.test(token)) {
      return { linkText: token, url: `https://vndb.org/${token}` };
    }
    if (/^https?:\/\//i.test(token)) {
      return { linkText: relationHostLabel(token), url: token };
    }
    return { linkText: token, url: undefined };
  })();

  return {
    raw,
    relationKey,
    relationLabel: VNDB_RELATION_LABELS[relationKey] || fallbackLabel,
    title,
    linkText: resolved.linkText,
    url: resolved.url,
  };
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

function sourceLabel(source?: string, explicitLabel?: string) {
  if (explicitLabel?.trim()) return explicitLabel.trim();
  if (source === "f95") return "F95zone";
  if (source === "dlsite") return "DLsite";
  if (source === "vndb") return "VNDB";
  if (source === "mangagamer") return "MangaGamer";
  if (source === "johren") return "Johren";
  if (source === "fakku") return "FAKKU";
  if (source === "igdb") return "IGDB";
  if (source === "rawg") return "RAWG";
  if (source === "mobygames") return "MobyGames";
  if (source?.startsWith("custom:")) return source.slice("custom:".length).replace(/[-_]+/g, " ").trim() || "Custom Source";
  return "Metadata";
}

function sourceBadgeBg(source?: string) {
  if (source === "f95") return "var(--color-warning)";
  if (source === "dlsite") return "var(--color-danger-strong)";
  if (source === "vndb") return "var(--color-accent-dark)";
  if (source === "mangagamer") return "#7c5cff";
  if (source === "johren") return "#5a6bff";
  if (source === "fakku") return "#da4c96";
  if (source === "igdb") return "#5bc4a5";
  if (source === "rawg") return "#ff7f50";
  if (source === "mobygames") return "#6a89cc";
  return "var(--color-border)";
}

function resolvedMetadataSources(meta?: GameMetadata | null) {
  if (!meta) return [];
  const sourceEntries = meta.source_links?.map((entry) => ({ source: entry.source, sourceLabel: entry.source_label }))
    ?? (meta.source ? [{ source: meta.source, sourceLabel: meta.source_label }] : []);
  const rawSources = meta.aggregated_sources?.length
    ? meta.aggregated_sources.map((source) => ({ source, sourceLabel: sourceEntries.find((entry) => entry.source === source)?.sourceLabel }))
    : sourceEntries;
  const deduped = new Map<string, { source: string; sourceLabel?: string }>();
  for (const entry of rawSources) {
    const normalized = entry.source.trim().toLowerCase();
    if (!normalized || deduped.has(normalized)) continue;
    deduped.set(normalized, { source: normalized, sourceLabel: entry.sourceLabel });
  }
  return Array.from(deduped.values());
}

function resolvedMetadataLinks(meta?: GameMetadata | null) {
  if (!meta) return [];
  const links = meta.source_links?.filter((entry) => entry.source && entry.source_url) ?? [];
  if (links.length > 0) return links;
  return meta.source && meta.source_url ? [{ source: meta.source, source_url: meta.source_url }] : [];
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
  onTransferSaves,
}: {
  isHidden: boolean;
  isFav: boolean;
  onDelete: () => void;
  onToggleHide: () => void;
  onToggleFav: () => void;
  onCustomize: () => void;
  onManageCollections: () => void;
  onTransferSaves: () => void;
}) {
  const { t } = useTranslation();
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
        title={t('game.settings')}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 rounded-lg py-1 shadow-2xl" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)", minWidth: "180px" }}>
          <MenuEntry icon="⭐" label={isFav ? t('game.menu.fav_remove') : t('game.menu.fav_add')} color={isFav ? "var(--color-warning)" : undefined} onClick={() => { setOpen(false); onToggleFav(); }} />
          <MenuEntry icon={isHidden ? "👁" : "🙈"} label={isHidden ? t('game.menu.unhide') : t('game.menu.hide')} onClick={() => { setOpen(false); onToggleHide(); }} />
          <MenuEntry icon="🎨" label={t('game.menu.customize')} onClick={() => { setOpen(false); onCustomize(); }} />
          <MenuEntry icon="📁" label={t('game.menu.collections')} onClick={() => { setOpen(false); onManageCollections(); }} />
          <MenuEntry icon="💾" label={t('game.menu.transfer_saves')} onClick={() => { setOpen(false); onTransferSaves(); }} />
          <div style={{ borderTop: "1px solid var(--color-panel-3)", margin: "3px 0" }} />
          <MenuEntry icon="🗑" label={t('game.menu.uninstall')} color="var(--color-danger)" onClick={() => { setOpen(false); onDelete(); }} />
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
  const { t } = useTranslation();
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
                {d.secs > 0 && <title>{formatTime(d.secs, t)}</title>}
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
  const { t } = useTranslation();
  const totalH = totalSecs / 3600;
  const achieved = MILESTONES.filter((m) => totalH >= m.hours);
  const next = MILESTONES.find((m) => totalH < m.hours);
  if (achieved.length === 0 && !next) return null;
  return (
    <div>
      <p className="text-xs uppercase tracking-widest mb-2" style={{ color: "var(--color-text-muted)" }}>{t('game.milestones')}</p>
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
            <span>{t('game.next_milestone', { label: next.label })}</span>
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
  const { t } = useTranslation();
  const entries = useMemo(() => sessions.filter((s) => s.path === gamePath).sort((a, b) => b.startedAt - a.startedAt).slice(0, 50), [sessions, gamePath]);
  const moodStyles: Record<string, { label: string; color: string; bg: string }> = {
    hype: { label: "hype", color: "var(--color-warning)", bg: "var(--color-warning-bg)" },
    chill: { label: "chill", color: "var(--color-success)", bg: "var(--color-success-bg)" },
    chaos: { label: "chaos", color: "var(--color-danger)", bg: "var(--color-danger-bg)" },
  };
  if (entries.length === 0) {
    return <div className="rounded px-3 py-4 text-center text-xs" style={{ background: "var(--color-bg-overlay)", color: "var(--color-text-dim)" }}>{t('game.no_history')}</div>;
  }
  return (
    <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1" style={{ scrollbarWidth: "thin", scrollbarColor: "var(--color-border) transparent" }}>
      {entries.map((s) => {
        const d = new Date(s.startedAt);
        const dateStr = d.toLocaleDateString("en", { month: "short", day: "numeric" });
        const timeStr = d.toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" });
        const mood = s.mood ? moodStyles[s.mood] : null;
        return (
          <div key={s.id} className="flex items-start gap-2 rounded px-2.5 py-2 group" style={{ background: "var(--color-bg-overlay)" }}>
            <div className="flex flex-col items-center flex-shrink-0 mt-0.5"><div className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--color-accent-dark)" }} /></div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px]" style={{ color: "var(--color-accent)" }}>{dateStr} {timeStr}</span>
                <span className="text-[10px] font-semibold" style={{ color: "var(--color-text)" }}>{formatTime(s.duration, t)}</span>
                {mood && (
                  <span className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide"
                    style={{ color: mood.color, background: mood.bg, border: `1px solid ${mood.color}55` }}>
                    {mood.label}
                  </span>
                )}
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
  const { t } = useTranslation();
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
        <h2 className="text-xs uppercase tracking-widest text-[var(--color-text-muted)]">{t('game.version_history')}</h2>
        <button onClick={() => setIsAdding(!isAdding)} className="text-xs text-[var(--color-accent)] hover:underline">{isAdding ? t('common.cancel') : t('game.log_update')}</button>
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
        <p className="text-xs text-[var(--color-text-dim)] italic">{t('game.no_version_history')}</p>
      ) : (
        <div className="relative border-l border-[var(--color-border)] ml-2 pl-4 pb-1">
          {history.map((h) => (
            <div key={h.id} className="relative mb-5 last:mb-0 group">
              <div className="absolute w-2 h-2 rounded-full bg-[var(--color-accent)] -left-[21px] top-1 transition-transform group-hover:scale-125" />
              <div className="flex items-baseline gap-2 mb-0.5">
                <span className="font-mono text-sm font-bold text-[var(--color-danger)]">{h.version}</span>
                <span className="text-[10px] text-[var(--color-text-dim)]" title={new Date(h.date).toLocaleString()}>{timeAgo(h.date, t)}</span>
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
  launchOptions,
  currentLaunchOptionPath,
  onSelectLaunchOption,
  onPlay,
  onStop,
  isRunning,
  runnerLabel,
  emulatorProfileName,
  onDelete,
  onLinkPage,
  onOpenF95Login,
  onClearMeta,
  onUpdate,
  onLaunchStoreGame,
  launchStoreLabel,
  onRemoteInstall,
  remoteInstallLabel,
  onBackupSaves,
  onBackupSavesToCloud,
  onTakeScreenshot,
  onAnnotateScreenshot,
  onOpenScreenshotsFolder,
  onExportGalleryZip,
  onUpdateScreenshotTags,
  onToggleHide,
  onToggleFav,
  onOpenCustomize,
  onSaveCustomization,
  onOpenNotes,
  hasNotes,
  onOpenAchievements,
  achievementSummary,
  achievementHasOpenGoals,
  onManageCollections,
  onTransferSaves,
  onInstallMediaFixes,
  wineIntroVideoAssessment,
  shaderCachePanel,
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
  launchOptions?: { path: string; label: string }[];
  currentLaunchOptionPath?: string;
  onSelectLaunchOption?: (path: string) => void;
  onPlay: (overridePath?: string, overrideArgs?: string) => void;
  onStop: () => void;
  isRunning: boolean;
  runnerLabel?: string;
  emulatorProfileName?: string;
  onDelete: () => void;
  onLinkPage: () => void;
  onOpenF95Login: () => void;
  onClearMeta: () => void;
  onUpdate: () => void;
  onLaunchStoreGame?: (() => void) | null;
  launchStoreLabel?: string | null;
  onRemoteInstall?: (() => void) | null;
  remoteInstallLabel?: string | null;
  onBackupSaves: () => void;
  onBackupSavesToCloud: () => void;
  onTakeScreenshot: () => void;
  onAnnotateScreenshot: () => void;
  onOpenScreenshotsFolder: () => void;
  onExportGalleryZip: () => void;
  onUpdateScreenshotTags: (filename: string, tags: string[]) => void;
  onToggleHide: () => void;
  onToggleFav: () => void;
  onOpenCustomize: () => void;
  onSaveCustomization: (changes: Partial<GameCustomization>) => void;
  onOpenNotes: () => void;
  hasNotes: boolean;
  onOpenAchievements: () => void;
  /** e.g. "3/7" when the game has checklist rows */
  achievementSummary: string | null;
  /** true when some checklist rows exist and not all are done */
  achievementHasOpenGoals: boolean;
  onManageCollections: () => void;
  onTransferSaves: () => void;
  onInstallMediaFixes?: () => void;
  /** Combined prefix scan + engine/path heuristics (non-Windows + configured prefix only) */
  wineIntroVideoAssessment?: PerGameMediaPlaybackAssessment | null;
  /** DXVK / Steam Fossilize hints and portable cache import/export (non-Windows + Wine path) */
  shaderCachePanel?: {
    warmupLines: string[];
    busy: boolean;
    onRefresh: () => void;
    onExport: () => void;
    onImport: () => void;
    onOpenGameFolder: () => void;
  } | null;
  sessions: SessionEntry[];
  onEditSessionNote: (entry: SessionEntry) => void;
  appSettings: AppSettings;
  revealedNsfw: Record<string, boolean>;
  onRevealNsfw: (path: string) => void;
  history: HistoryEntry[];
  onAddHistory: (version: string, note: string) => void;
}) {
  const { t } = useTranslation();
  const [activeShot, setActiveShot] = useState(0);
  const [metaLightboxShot, setMetaLightboxShot] = useState<string | null>(null);
  const [reviewDraft, setReviewDraft] = useState(customization.personalReview ?? "");
  const sourceBadges = useMemo(() => resolvedMetadataSources(meta), [meta]);
  const sourceLinks = useMemo(() => resolvedMetadataLinks(meta), [meta]);
  const cover = customization.coverUrl ?? meta?.cover_url;
  const heroBg = customization.backgroundUrl ?? cover;
  const displayTitle = customization.displayName ?? meta?.title ?? game.name;
  const romFileName = customization.romPath?.replace(/\\/g, "/").split("/").pop();
  const shots = meta?.screenshots ?? [];
  const ratingScale = appSettings.ratingScale || "10";
  const ratingCfg = scaleInputConfig(ratingScale);
  const categoryValues = RATING_CATEGORIES
    .map((c) => customization.categoryRatings?.[c.key])
    .filter((v): v is number => typeof v === "number" && !Number.isNaN(v))
    .map(clampScore100);
  const categoryAvg = categoryValues.length > 0
    ? Math.round(categoryValues.reduce((a, b) => a + b, 0) / categoryValues.length)
    : undefined;
  const legacyOverall = typeof customization.personalRating === "number"
    ? clampScore100(customization.personalRating * 10)
    : undefined;
  const manualOverall = typeof customization.overallScore100 === "number"
    ? clampScore100(customization.overallScore100)
    : legacyOverall;
  const ratingMode = customization.ratingMode || "categories";
  const overall100 = ratingMode === "categories"
    ? (typeof categoryAvg === "number" ? categoryAvg : manualOverall)
    : manualOverall;

  useEffect(() => {
    if (activeShot >= shots.length) setActiveShot(0);
  }, [activeShot, shots.length]);

  useEffect(() => {
    setReviewDraft(customization.personalReview ?? "");
  }, [customization.personalReview, game.path]);

  const [dominantColor, setDominantColor] = useState<[number, number, number] | null>(null);

  useEffect(() => {
    if (!heroBg) {
      setDominantColor(null);
      return;
    }
    let active = true;
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.src = heroBg;
    img.onload = () => {
      if (!active) return;
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, 1, 1);
        const data = ctx.getImageData(0, 0, 1, 1).data;
        setDominantColor([data[0], data[1], data[2]]);
      }
    };
    return () => { active = false; };
  }, [heroBg]);

  const glassStyle = useMemo(() => {
    if (!dominantColor) return { filter: "brightness(0.5)", blur: "0px", overlay: "rgba(27,40,56,0.15)", glow: "transparent" };
    const [r, g, b] = dominantColor;
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const isBright = luminance > 0.5;
    return {
      filter: isBright ? "brightness(0.4) saturate(1.5)" : "brightness(0.7) saturate(1.2)",
      blur: isBright ? "12px" : "6px",
      overlay: isBright ? `rgba(${Math.floor(r * 0.1)}, ${Math.floor(g * 0.1)}, ${Math.floor(b * 0.1)}, 0.4)` : `rgba(${Math.floor(r * 0.2)}, ${Math.floor(g * 0.2)}, ${Math.floor(b * 0.2)}, 0.2)`,
      glow: `rgba(${r}, ${g}, ${b}, 0.25)`
    };
  }, [dominantColor]);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <div className="relative flex-shrink-0 overflow-hidden" style={{ height: "240px" }}>
        {heroBg ? (
          <>
            <img src={heroBg} alt={displayTitle} className="absolute inset-0 w-full h-full object-cover transition-all duration-1000" style={{ filter: glassStyle.filter, transform: "scale(1.05)" }} />
            <div className="absolute inset-0 transition-all duration-1000" style={{ backdropFilter: `blur(${glassStyle.blur})`, background: glassStyle.overlay }} />
            <div className="absolute inset-0 transition-all duration-1000" style={{ boxShadow: `inset 0 0 120px ${glassStyle.glow}` }} />
          </>
        ) : <div className="absolute inset-0" style={{ background: heroGradient(game.name) }} />}
        <NsfwOverlay gamePath={game.path} meta={meta} appSettings={appSettings} revealed={revealedNsfw} onReveal={onRevealNsfw} />
        <div className="absolute inset-0 transition-all duration-1000" style={{ background: `linear-gradient(to top,var(--color-bg) 0%,${glassStyle.glow !== "transparent" ? glassStyle.overlay : "rgba(27,40,56,0.15)"} 60%,transparent 100%)` }} />
        <div className="absolute bottom-0 left-0 right-0 px-8 pb-5">
          <div className="flex items-end justify-between">
            <div>
              <div className="flex gap-2 mb-1.5">
                {sourceBadges.map((entry) => (
                  <span key={entry.source} className="inline-block text-xs px-2 py-0.5 rounded font-semibold" style={{ background: sourceBadgeBg(entry.source), color: entry.source === "f95" ? "var(--color-black-strong)" : "var(--color-white)" }}>
                    {sourceLabel(entry.source, entry.sourceLabel)}
                  </span>
                ))}
                {isHidden && (
                  <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded font-semibold" style={{ background: "rgba(0,0,0,0.6)", color: "var(--color-text-muted)", border: "1px solid var(--color-border-strong)" }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /><line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                    {t('game.hidden')}
                  </span>
                )}
              </div>
              <h1 className="text-3xl font-bold" style={{ color: "var(--color-white)", textShadow: "0 2px 8px rgba(0,0,0,.9)" }}>{displayTitle}</h1>
              {emulatorProfileName && (
                <div className="mt-1 flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded font-semibold"
                    style={{ background: "rgba(23, 55, 32, 0.8)", color: "#8ef0a7", border: "1px solid rgba(110, 220, 140, 0.65)" }}>
                    🕹 via {emulatorProfileName}
                  </span>
                  {romFileName && (
                    <span className="text-[11px] font-mono" style={{ color: "var(--color-text-dim)" }}>{romFileName}</span>
                  )}
                </div>
              )}
              {meta?.version && <span className="text-sm mt-0.5 block" style={{ color: "var(--color-accent-soft)" }}>{meta.version}</span>}
            </div>
            {meta?.rating && (
              <div className="text-right mb-1">
                <p className="text-xs mb-0.5" style={{ color: "var(--color-text-muted)" }}>{t('game.rating')}</p>
                <p className="font-bold" style={{ color: "var(--color-warning)" }}>★ {meta.rating}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 px-8 py-3 flex-shrink-0" style={{ background: "var(--color-bg-elev)", borderBottom: "1px solid var(--color-bg-deep)" }}>
        <button
          onClick={game.uninstalled ? (onLaunchStoreGame || undefined) : isRunning ? onStop : () => onPlay()}
          disabled={game.uninstalled ? !onLaunchStoreGame : false}
          title={game.uninstalled ? (onLaunchStoreGame ? launchStoreLabel || "Launch this title from its launcher" : "Reinstall the game or check folder to play") : ""}
          className="flex items-center gap-2 px-7 py-2 rounded font-bold text-sm uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ background: game.uninstalled ? "#3a3a3a" : isRunning ? "var(--color-stop-bg)" : "var(--color-play-bg)", color: game.uninstalled ? "var(--color-text-muted)" : isRunning ? "var(--color-danger-soft)" : "var(--color-play-text)" }}
          onMouseEnter={(e) => { if (!game.uninstalled) e.currentTarget.style.background = isRunning ? "var(--color-stop-hover)" : "var(--color-play-hover)"; }}
          onMouseLeave={(e) => { if (!game.uninstalled) e.currentTarget.style.background = isRunning ? "var(--color-stop-bg)" : "var(--color-play-bg)"; }}
        >
          {game.uninstalled ? (
            onLaunchStoreGame ? launchStoreLabel || "Launch from Store" : t('game.folder_missing')
          ) : isRunning ? (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" /></svg>{t('game.stop')}
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
              {t('game.play')}{runnerLabel && <span className="ml-1 text-[10px] font-normal normal-case opacity-80">{t('game.via', { runner: runnerLabel })}</span>}
            </>
          )}
        </button>
        {launchOptions && launchOptions.length > 1 && onSelectLaunchOption && (
          <label className="flex items-center gap-2 px-3 py-2 rounded text-sm"
            style={{ background: "var(--color-panel-3)", color: "var(--color-text-muted)", border: "1px solid var(--color-border-strong)" }}>
            <span className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>Launch via</span>
            <select
              value={currentLaunchOptionPath ?? game.path}
              onChange={(e) => onSelectLaunchOption(e.currentTarget.value)}
              className="bg-transparent outline-none text-sm"
              style={{ color: "var(--color-text)" }}
            >
              {launchOptions.map((option) => (
                <option key={option.path} value={option.path}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {onRemoteInstall && remoteInstallLabel && (
          <button
            onClick={onRemoteInstall}
            className="flex items-center gap-1.5 px-3 py-2 rounded text-sm"
            style={{ background: "var(--color-accent-bg)", color: "var(--color-accent-soft)", border: "1px solid var(--color-accent)" }}
            title={remoteInstallLabel}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            {remoteInstallLabel}
          </button>
        )}
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
          {meta ? t('game.relink_page') : t('game.link_page')}
        </button>
        <button onClick={onUpdate} className="flex items-center gap-1.5 px-3 py-2 rounded text-sm" style={{ background: "var(--color-panel-3)", color: "var(--color-text-muted)", border: "1px solid var(--color-border-strong)" }} title="Install a new version safely (preserves saves)">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="16 16 12 12 8 16" /><line x1="12" y1="12" x2="12" y2="21" /><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
          </svg>
          {t('game.update.label')}
        </button>
        <button onClick={onBackupSaves} className="flex items-center gap-1.5 px-3 py-2 rounded text-sm" style={{ background: "var(--color-panel-3)", color: "var(--color-text-muted)", border: "1px solid var(--color-border-strong)" }} title="Detect and back up save files to zip">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          {t('game.backup_saves')}
        </button>
        <button onClick={onBackupSavesToCloud} className="flex items-center gap-1.5 px-3 py-2 rounded text-sm" style={{ background: "var(--color-panel-3)", color: "var(--color-accent-soft)", border: "1px solid var(--color-accent)" }} title="Create a save zip and upload it to the configured cloud sync provider">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 18a4.6 4.6 0 0 1 .88-9.12A6 6 0 0 1 19 11a4 4 0 0 1-1 7.87" />
            <path d="M12 12v9" />
            <path d="m8.5 15.5 3.5-3.5 3.5 3.5" />
          </svg>
          Cloud Save Zip
        </button>
        {onInstallMediaFixes && (
          <button onClick={onInstallMediaFixes} className="flex items-center gap-1.5 px-3 py-2 rounded text-sm" style={{ background: "var(--color-warning-bg)", color: "var(--color-warning)", border: "1px solid var(--color-warning-border)" }} title="Install media playback fixes for this game's Wine/Proton prefix">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            Fix Video Playback
          </button>
        )}
        <button onClick={onOpenNotes} className="flex items-center gap-1.5 px-3 py-2 rounded text-sm" style={{ background: hasNotes ? "#1e2d1a" : "var(--color-panel-3)", color: hasNotes ? "var(--color-success)" : "var(--color-text-muted)", border: `1px solid ${hasNotes ? "var(--color-success-border)" : "var(--color-border-strong)"}` }} title="Game notes (Markdown supported)">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
          {t('game.notes')}{hasNotes && <span className="w-1.5 h-1.5 rounded-full bg-current ml-0.5" />}
        </button>
        <button
          onClick={onOpenAchievements}
          className="flex items-center gap-1.5 px-3 py-2 rounded text-sm"
          style={{
            background: achievementSummary ? "var(--color-panel-2)" : "var(--color-panel-3)",
            color: achievementSummary ? "var(--color-accent-soft)" : "var(--color-text-muted)",
            border: `1px solid ${achievementSummary ? "var(--color-accent)" : "var(--color-border-strong)"}`,
          }}
          title={t("game.achievements_tooltip")}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
            <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
            <path d="M4 22h16" />
            <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
            <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
            <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
          </svg>
          {t("game.achievements")}
          {achievementSummary && <span className="text-[11px] font-mono opacity-90 ml-0.5">{achievementSummary}</span>}
          {achievementHasOpenGoals && <span className="w-1.5 h-1.5 rounded-full bg-current ml-0.5" />}
        </button>
        {sourceLinks.map((link) => (
          <a key={`${link.source}:${link.source_url}`} href={link.source_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 px-3 py-2 rounded text-xs" style={{ background: "var(--color-panel-2)", color: "var(--color-accent)", border: "1px solid var(--color-border)" }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
            </svg>
            {t('common.open')} {sourceLabel(link.source, link.source_label)}
          </a>
        ))}
        {!f95LoggedIn && (
          <button onClick={onOpenF95Login} className="flex items-center gap-1 px-3 py-2 rounded text-xs" style={{ background: "var(--color-warning-bg-2)", color: "var(--color-warning)", border: "1px solid var(--color-warning-border)" }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            F95 Login
          </button>
        )}
        <div className="flex-1" />
        {meta && <button onClick={onClearMeta} className="px-3 py-2 rounded text-xs" style={{ background: "transparent", color: "var(--color-text-dim)" }}>✕ {t('game.unlink')}</button>}
        <SettingsMenu isHidden={isHidden} isFav={isFav} onDelete={onDelete} onToggleHide={onToggleHide} onToggleFav={onToggleFav} onCustomize={onOpenCustomize} onManageCollections={onManageCollections} onTransferSaves={onTransferSaves} />
      </div>

      {wineIntroVideoAssessment && (
        <div
          className="px-8 py-2.5 text-xs border-b flex flex-wrap items-center gap-x-3 gap-y-1"
          style={{
            background: wineIntroVideoAssessment.effectiveRisk === "minimal"
              ? "rgba(70, 120, 90, 0.14)"
              : wineIntroVideoAssessment.effectiveRisk === "low"
                ? "rgba(120, 110, 60, 0.14)"
                : "rgba(140, 70, 40, 0.16)",
            borderColor: "var(--color-border-soft)",
            color: "var(--color-text-soft)",
          }}
        >
          <span className="font-bold shrink-0" style={{ color: "var(--color-warning)" }}>{t("game.wine_intro_video_panel.title")}</span>
          <span className="flex-1 min-w-[180px]">{wineIntroVideoAssessment.summary}</span>
          {wineIntroVideoAssessment.context.matchedRules.length > 0 && (
            <span className="text-[10px] opacity-85">
              {t("game.wine_intro_video_panel.matched")}: {wineIntroVideoAssessment.context.matchedRules.map((r) => r.label).join(", ")}
            </span>
          )}
          {onInstallMediaFixes && wineIntroVideoAssessment.suggestedVerbs.length > 0 && wineIntroVideoAssessment.effectiveRisk !== "minimal" && (
            <button
              type="button"
              onClick={onInstallMediaFixes}
              className="text-[10px] font-semibold px-2 py-0.5 rounded"
              style={{ background: "var(--color-accent-dark)", color: "var(--color-white)" }}
            >
              {t("game.wine_intro_video_panel.fix_cta")}
            </button>
          )}
        </div>
      )}

      {shaderCachePanel && (
        <div
          className="px-8 py-2.5 text-xs border-b space-y-2"
          style={{
            background: "rgba(45, 75, 110, 0.18)",
            borderColor: "var(--color-border-soft)",
            color: "var(--color-text-soft)",
          }}
        >
          <div className="flex flex-wrap items-center gap-2 gap-y-1">
            <span className="font-bold shrink-0" style={{ color: "var(--color-accent-soft)" }}>{t("game.shader_cache_panel.title")}</span>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                disabled={shaderCachePanel.busy}
                onClick={() => shaderCachePanel.onRefresh()}
                className="text-[10px] font-semibold px-2 py-0.5 rounded disabled:opacity-45"
                style={{ background: "var(--color-panel-3)", color: "var(--color-text)", border: "1px solid var(--color-border-subtle)" }}
              >
                {shaderCachePanel.busy ? t("game.shader_cache_panel.busy") : t("game.shader_cache_panel.refresh")}
              </button>
              <button
                type="button"
                disabled={shaderCachePanel.busy}
                onClick={() => shaderCachePanel.onExport()}
                className="text-[10px] font-semibold px-2 py-0.5 rounded disabled:opacity-45"
                style={{ background: "var(--color-accent-dark)", color: "var(--color-white)" }}
              >
                {t("game.shader_cache_panel.export_zip")}
              </button>
              <button
                type="button"
                disabled={shaderCachePanel.busy}
                onClick={() => shaderCachePanel.onImport()}
                className="text-[10px] font-semibold px-2 py-0.5 rounded disabled:opacity-45"
                style={{ background: "var(--color-panel-2)", color: "var(--color-accent-soft)", border: "1px solid var(--color-border)" }}
              >
                {t("game.shader_cache_panel.import_zip")}
              </button>
              <button
                type="button"
                disabled={shaderCachePanel.busy}
                onClick={() => shaderCachePanel.onOpenGameFolder()}
                className="text-[10px] font-semibold px-2 py-0.5 rounded disabled:opacity-45"
                style={{ background: "var(--color-panel-3)", color: "var(--color-text-muted)", border: "1px solid var(--color-border-subtle)" }}
              >
                {t("game.shader_cache_panel.open_folder")}
              </button>
            </div>
          </div>
          {shaderCachePanel.warmupLines.length > 0 ? (
            <ul className="list-disc pl-4 space-y-0.5 text-[11px] leading-snug opacity-95">
              {shaderCachePanel.warmupLines.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          ) : (
            <p className="text-[11px] leading-snug opacity-85 pl-0.5">{t("game.shader_cache_panel.empty_hint")}</p>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-8 py-5" style={{ scrollbarWidth: "thin", scrollbarColor: "var(--color-border) transparent" }}>
        <div className="flex gap-6 max-w-5xl">
          <div className="flex-1 min-w-0 space-y-5">
            {(meta?.overview_html || meta?.overview) && (
              <section>
                <h2 className="text-xs uppercase tracking-widest mb-2" style={{ color: "var(--color-text-muted)" }}>{t('game.overview')}</h2>
                {meta.overview_html ? (
                  <div className="text-sm leading-relaxed dlsite-overview" style={{ color: "var(--color-text-soft)" }} dangerouslySetInnerHTML={{ __html: meta.overview_html }} />
                ) : (
                  <div className="text-sm leading-relaxed" style={{ color: "var(--color-text-soft)" }}>
                    {meta.overview!.split("\n\n").map((para, i) => <p key={i} className={i > 0 ? "mt-3" : ""}>{para}</p>)}
                  </div>
                )}
              </section>
            )}
            {customization.personalReview && (
              <section>
                <h2 className="text-xs uppercase tracking-widest mb-2 flex items-center gap-2" style={{ color: "var(--color-text-muted)" }}>
                  <span>📝</span> {t('game.short_review')}
                </h2>
                <div className="rounded-lg p-3" style={{ background: "var(--color-bg-elev)", border: "1px solid var(--color-border-soft)" }}>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: "var(--color-text-soft)" }}>
                    {customization.personalReview}
                  </p>
                </div>
              </section>
            )}
            {shots.length > 0 && (
              <section>
                <h2 className="text-xs uppercase tracking-widest mb-2" style={{ color: "var(--color-text-muted)" }}>{t('game.screenshots')}</h2>
                <div className="rounded overflow-hidden mb-2" style={{ background: "var(--color-bg-deep)" }}>
                  <button
                    onClick={() => setMetaLightboxShot(shots[activeShot])}
                    className="block w-full"
                    title="Open full size"
                  >
                    <img src={shots[activeShot]} alt="screenshot" className="w-full object-contain" style={{ maxHeight: "240px" }} />
                  </button>
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
                <h2 className="text-xs uppercase tracking-widest mb-2" style={{ color: "var(--color-text-muted)" }}>{t('game.tags')}</h2>
                <div className="flex flex-wrap gap-1.5">{meta.tags.map((t) => <TagBadge key={t} text={t} />)}</div>
              </section>
            )}
            <section>
              <h2 className="text-xs uppercase tracking-widest mb-2 flex items-center justify-between" style={{ color: "var(--color-text-muted)" }}><span>{t('game.custom_tags')}</span></h2>
              <div className="flex flex-wrap gap-1.5 items-center">
                {customization.customTags?.map((t) => (
                  <span key={t} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded cursor-pointer group" style={{ background: "var(--color-border)", color: "var(--color-text)", border: "1px solid var(--color-border-strong)" }} onClick={() => { const tags = customization.customTags?.filter((x) => x !== t) || []; onSaveCustomization({ customTags: tags }); }}>
                    {t} <span className="text-[10px] opacity-0 group-hover:opacity-100 transition-opacity">✕</span>
                  </span>
                ))}
                <input
                  type="text"
                  placeholder={t('library.search')}
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
                <p className="text-sm mb-1" style={{ color: "var(--color-text-muted)" }}>{t('game.no_meta_linked')}</p>
                <p className="text-xs mb-4" style={{ color: "var(--color-text-dim)" }}>{t('game.no_meta_hint')}</p>
                <button onClick={onLinkPage} className="px-5 py-2 rounded text-sm font-semibold" style={{ background: "var(--color-accent-dark)", color: "var(--color-white)" }}>{t('game.link_page')}</button>
              </div>
            )}
            {meta?.relations && meta.relations.length > 0 && (
              <section>
                <h2 className="text-xs uppercase tracking-widest mb-2" style={{ color: "var(--color-text-muted)" }}>{t('game.relations')}</h2>
                <div className="space-y-2">
                  {meta.relations.map((rawRelation, i) => {
                    const relation = parseRelationItem(rawRelation);
                    return (
                      <div
                        key={`${rawRelation}-${i}`}
                        className="flex items-start gap-2.5 rounded-lg px-3 py-2"
                        style={{ background: "var(--color-bg-elev)", border: "1px solid var(--color-border-soft)" }}
                      >
                        <span
                          className="inline-flex flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                          style={{ background: "#1d3446", color: "#9ed2ff", border: "1px solid #31536d" }}
                          title={relation.relationKey}
                        >
                          {relation.relationLabel}
                        </span>
                        <div className="min-w-0 flex-1">
                          {relation.url ? (
                            <a
                              href={relation.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-sm underline-offset-2 hover:underline"
                              style={{ color: "var(--color-text)" }}
                              title={`Open ${relation.title} on VNDB`}
                            >
                              {relation.title}
                            </a>
                          ) : (
                            <p className="text-sm" style={{ color: "var(--color-text)" }}>{relation.title}</p>
                          )}
                          <div className="mt-1 flex items-center gap-2 flex-wrap">
                            {relation.linkText && relation.url && (
                              <a
                                href={relation.url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide"
                                style={{ background: "var(--color-panel-2)", color: "var(--color-accent)", border: "1px solid var(--color-border)" }}
                                title={`Open ${relation.title}`}
                              >
                                {relation.linkText}
                              </a>
                            )}
                            {!relation.url && relation.raw !== relation.title && (
                              <span className="text-[10px]" style={{ color: "var(--color-text-dim)" }}>{relation.raw}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
            <InGameGallery shots={screenshots} onTake={onTakeScreenshot} onAnnotate={onAnnotateScreenshot} onOpenFolder={onOpenScreenshotsFolder} onExportZip={onExportGalleryZip} onUpdateTags={onUpdateScreenshotTags} />
            <section>
              <h2 className="text-xs uppercase tracking-widest mb-2" style={{ color: "var(--color-text-muted)" }}>{t('game.history')}</h2>
              <SessionTimeline sessions={sessions} gamePath={game.path} onEditNote={onEditSessionNote} />
            </section>
            <section>
              <VersionTimeline history={history} onAddHistory={onAddHistory} />
            </section>
          </div>
          <div className="flex-shrink-0 w-60 space-y-4">
            <div className="rounded-lg p-4 space-y-3" style={{ background: "var(--color-bg-elev)", border: "1px solid var(--color-border-soft)" }}>
              <h2 className="text-xs uppercase tracking-widest" style={{ color: "var(--color-text-muted)" }}>{t('game.your_stats')}</h2>
              <div><p className="text-xs" style={{ color: "var(--color-text-muted)" }}>{t('game.total_playtime')}</p><p className="text-base font-semibold" style={{ color: "var(--color-text)" }}>{stat.totalTime > 0 ? formatTime(stat.totalTime, t) : "—"}</p></div>
              <div><p className="text-xs" style={{ color: "var(--color-text-muted)" }}>{t('game.last_played')}</p><p className="text-sm" style={{ color: "var(--color-text)" }}>{timeAgo(stat.lastPlayed, t)}</p></div>
              {stat.lastSession > 0 && <div><p className="text-xs" style={{ color: "var(--color-text-muted)" }}>{t('game.last_session')}</p><p className="text-sm" style={{ color: "var(--color-text)" }}>{formatTime(stat.lastSession, t)}</p></div>}
              {(stat.launchCount ?? 0) > 0 && <div><p className="text-xs" style={{ color: "var(--color-text-muted)" }}>{t('game.times_played_label')}</p><p className="text-sm font-semibold" style={{ color: "var(--color-accent)" }}>{t('game.times_played', { count: stat.launchCount })}</p></div>}
              {sessions.some((s) => s.path === game.path) && <div><p className="text-xs mb-2" style={{ color: "var(--color-text-muted)" }}>{t('game.this_week')}</p><PlayChart sessions={sessions} gamePath={game.path} /></div>}
            </div>
            <div className="rounded-lg p-4 space-y-4" style={{ background: "var(--color-bg-elev)", border: "1px solid var(--color-border-soft)" }}>
              <div>
                <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: "var(--color-text-muted)" }}>{t('library.filters.completion_status')}</label>
                <select value={customization.status || ""} onChange={(e) => onSaveCustomization({ status: ((e.target as HTMLSelectElement).value || undefined) as any })} className="w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1.5 text-xs outline-none text-[var(--color-text)] cursor-pointer" style={{ backgroundImage: "none" }}>
                  <option value="">{t('library.status_options.not_set')}</option>
                  <option value="Playing">{t('library.status_options.playing')}</option>
                  <option value="Completed">{t('library.status_options.completed')}</option>
                  <option value="On Hold">{t('library.status_options.on_hold')}</option>
                  <option value="Dropped">{t('library.status_options.dropped')}</option>
                  <option value="Plan to Play">{t('library.status_options.plan_to_play')}</option>
                </select>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs uppercase tracking-widest" style={{ color: "var(--color-text-muted)" }}>{t('game.overall_rating')}</label>
                  <span className="text-xs font-semibold" style={{ color: "var(--color-warning)" }}>
                    {typeof overall100 === "number" ? formatScoreForScale(overall100, ratingScale) : "—"}
                  </span>
                </div>
                <select
                  value={ratingMode}
                  onChange={(e) => {
                    onSaveCustomization({ ratingMode: (e.target as HTMLSelectElement).value as "manual" | "categories" });
                  }}
                  className="w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1.5 text-xs outline-none text-[var(--color-text)] cursor-pointer"
                  style={{ backgroundImage: "none" }}
                >
                  <option value="categories">{t('game.rating_mode_auto')}</option>
                  <option value="manual">{t('game.rating_mode_manual')}</option>
                </select>
                {ratingMode === "manual" && (
                  <div className="flex items-center gap-2 mt-2">
                    <input
                      type="number"
                      min={ratingCfg.min}
                      max={ratingCfg.max}
                      step={ratingCfg.step}
                      value={typeof manualOverall === "number" ? score100ToScaleValue(manualOverall, ratingScale) : ""}
                      onChange={(e) => {
                        const raw = e.currentTarget.value;
                        const parsed = parseFloat(raw);
                        onSaveCustomization({ overallScore100: Number.isFinite(parsed) ? scaleValueToScore100(parsed, ratingScale) : undefined });
                      }}
                      className="w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1.5 text-xs outline-none text-[var(--color-text)]"
                      placeholder={`0${ratingCfg.suffix}`}
                    />
                    <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>{ratingCfg.suffix}</span>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: "var(--color-text-muted)" }}>{t('game.category_ratings')}</label>
                <div className="space-y-1.5">
                  {RATING_CATEGORIES.map((cat) => (
                    <div key={cat.key} className="flex items-center gap-2">
                      <span className="text-[11px] w-20" style={{ color: "var(--color-text-muted)" }}>{t(cat.labelKey)}</span>
                      <input
                        type="number"
                        min={ratingCfg.min}
                        max={ratingCfg.max}
                        step={ratingCfg.step}
                        value={typeof customization.categoryRatings?.[cat.key] === "number" ? score100ToScaleValue(customization.categoryRatings?.[cat.key] as number, ratingScale) : ""}
                        onChange={(e) => {
                          const parsed = parseFloat(e.currentTarget.value);
                          const next = { ...(customization.categoryRatings || {}) };
                          if (Number.isFinite(parsed)) next[cat.key] = scaleValueToScore100(parsed, ratingScale);
                          else delete next[cat.key];
                          onSaveCustomization({ categoryRatings: next });
                        }}
                        className="flex-1 bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1 text-xs outline-none text-[var(--color-text)]"
                        placeholder={t('game.unrated')}
                      />
                    </div>
                  ))}
                </div>
                {ratingScale === "3_smiley" && (
                  <p className="text-[10px] mt-1" style={{ color: "var(--color-text-dim)" }}>1=😞 2=😐 3=😄</p>
                )}
              </div>
              <div>
                <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: "var(--color-text-muted)" }} title={t('game.time_budget_hint')}>{t('game.time_budget')}</label>
                <input type="number" min="0" placeholder={t('game.no_limit')} value={customization.timeLimitMins || ""} onChange={(e) => { const el = e.target as HTMLInputElement; onSaveCustomization({ timeLimitMins: el.value ? parseInt(el.value) : undefined }); }} className="w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1.5 text-xs outline-none text-[var(--color-text)]" />
              </div>
              <div>
                <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: "var(--color-text-muted)" }}>{t('game.short_review')}</label>
                <textarea
                  value={reviewDraft}
                  onInput={(e) => setReviewDraft((e.target as HTMLTextAreaElement).value)}
                  onBlur={() => onSaveCustomization({ personalReview: reviewDraft.trim() || undefined })}
                  rows={4}
                  maxLength={600}
                  className="w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1.5 text-xs outline-none text-[var(--color-text)] resize-y"
                  placeholder={t('game.review_placeholder')}
                />
              </div>
            </div>
            {stat.totalTime > 0 && <div className="rounded-lg p-4" style={{ background: "var(--color-bg-elev)", border: "1px solid var(--color-border-soft)" }}><Milestones totalSecs={stat.totalTime} /></div>}
            {meta && (
              <div className="rounded-lg p-4 space-y-2" style={{ background: "var(--color-bg-elev)", border: "1px solid var(--color-border-soft)" }}>
                <h2 className="text-xs uppercase tracking-widest mb-3" style={{ color: "var(--color-text-muted)" }}>{t('game.info')}</h2>
                <MetaRow label={t('game.meta.developer')} value={meta.developer} /><MetaRow label={t('game.meta.version')} value={meta.version} /><MetaRow label={t('game.meta.engine')} value={meta.engine} /><MetaRow label={t('game.meta.os')} value={meta.os} /><MetaRow label={t('game.meta.language')} value={meta.language} /><MetaRow label={t('game.meta.censored')} value={meta.censored} /><MetaRow label={t('game.meta.released')} value={meta.release_date} /><MetaRow label={t('game.meta.updated')} value={meta.last_updated} /><MetaRow label={t('game.meta.price')} value={meta.price} />
                <MetaRow label={t('game.meta.circle')} value={meta.circle} /><MetaRow label={t('game.meta.series')} value={meta.series} /><MetaRow label={t('game.meta.author')} value={meta.author} /><MetaRow label={t('game.meta.illustration')} value={meta.illustration} /><MetaRow label={t('game.meta.voice_actor')} value={meta.voice_actor} /><MetaRow label={t('game.meta.music')} value={meta.music} /><MetaRow label={t('game.meta.age_rating')} value={meta.age_rating} /><MetaRow label={t('game.meta.format')} value={meta.product_format} /><MetaRow label={t('game.meta.file_format')} value={meta.file_format} /><MetaRow label={t('game.meta.file_size')} value={meta.file_size} />
              </div>
            )}
            <div className="rounded-lg p-4 space-y-2" style={{ background: "var(--color-bg-elev)", border: "1px solid var(--color-border-soft)" }}>
              <h2 className="text-xs uppercase tracking-widest mb-3" style={{ color: "var(--color-text-muted)" }}>{t('game.files.title')}</h2>
              {customization.exeOverride ? (
                <>
                  <div>
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <p className="text-xs" style={{ color: "var(--color-warning)" }}>{t('game.files.launch_override')}</p>
                      <span className="text-[9px] px-1.5 py-px rounded font-semibold" style={{ background: "#3a2800", color: "var(--color-warning)", border: "1px solid var(--color-warning-border)" }}>{t('game.files.active')}</span>
                    </div>
                    <p className="text-xs font-mono break-all" style={{ color: "var(--color-warning)" }}>{customization.exeOverride}</p>
                  </div>
                  <div><p className="text-xs mb-0.5" style={{ color: "var(--color-text-muted)" }}>{t('game.files.scanned_exe')}</p><p className="text-xs font-mono break-all" style={{ color: "var(--color-text-dim)" }}>{game.path}</p></div>
                </>
              ) : (
                <div><p className="text-xs mb-0.5" style={{ color: "var(--color-text-muted)" }}>{t('game.files.executable')}</p><p className="text-xs font-mono break-all" style={{ color: "var(--color-accent)" }}>{game.path}</p></div>
              )}
              <div><p className="text-xs mb-0.5" style={{ color: "var(--color-text-muted)" }}>{t('game.files.folder')}</p><p className="text-xs font-mono break-all" style={{ color: "var(--color-text)" }}>{game.path.replace(/[\\/][^\\/]$/, "")}</p></div>
            </div>
          </div>
        </div>
      </div>

      {metaLightboxShot && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.92)" }}
          onClick={() => setMetaLightboxShot(null)}
        >
          <div onClick={(e) => e.stopPropagation()} className="relative flex flex-col items-center max-w-full max-h-full">
            <img
              src={metaLightboxShot}
              alt="metadata screenshot"
              style={{ maxWidth: "92vw", maxHeight: "84vh", objectFit: "contain", display: "block" }}
              className="rounded shadow-2xl"
            />
            <button
              onClick={() => setMetaLightboxShot(null)}
              className="mt-4 text-xs px-4 py-1.5 rounded font-semibold transition-colors"
              style={{ background: "var(--color-border)", color: "var(--color-white)" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-border-strong)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "var(--color-border)")}
            >
              {t('common.close').toUpperCase()}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

