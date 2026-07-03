import { useState, useMemo, useCallback } from "preact/hooks";
import { useTranslation } from "react-i18next";
import { formatTime } from "../../lib/helpers";
import { RATING_CATEGORIES, SK_PLAY_GOALS } from "../../lib/constants";
import { loadCache, saveCache } from "../../lib/appStorage";
import { YearInReviewModal } from "../modals/YearInReviewModal";
import type { PlayGoal } from "../../types";

interface GameLike {
  name: string;
  path: string;
  uninstalled?: boolean;
}

interface GameStatsLike {
  totalTime: number;
  lastPlayed: number;
  lastSession: number;
  launchCount: number;
}

interface SessionEntryLike {
  path: string;
  duration: number;
  startedAt: number;
  mood?: string;
}

interface GameCustomizationLike {
  displayName?: string;
  status?: string;
  personalRating?: number;
  overallScore100?: number;
  ratingMode?: string;
  categoryRatings?: Record<string, number>;
  customTags?: string[];
  manualDeveloper?: string;
  manualGenres?: string;
  mugenForceSingleCore?: boolean;
  mugenDgVoodooFolder?: string;
}

interface GameMetadataLike {
  source?: string;
  title?: string;
  developer?: string;
  circle?: string;
  tags?: string[];
  genres?: string[];
  engine?: string;
}

interface StatsViewProps {
  games: GameLike[];
  stats: Record<string, GameStatsLike>;
  sessions: SessionEntryLike[];
  customizations: Record<string, GameCustomizationLike>;
  metadata: Record<string, GameMetadataLike>;
  notes: Record<string, string>;
  collections: { id: string; name: string; color: string; gamePaths: string[] }[];
  wishlist: { id: string; title: string; source: string; releaseStatus: string }[];
  totalPlaytimeSecs: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDayMs(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfWeekMs(ts: number): number {
  const d = new Date(ts);
  const mondayOffset = (d.getDay() + 6) % 7;
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - mondayOffset);
  return d.getTime();
}

function parseCsvList(value?: string): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function uniqueNormalizedLabels(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const cleaned = raw.replace(/\s+/g, " ").trim();
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}

// ─── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({ icon, label, value, sub, accent }: {
  icon: string;
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-1"
      style={{
        background: "var(--color-panel)",
        border: `1px solid ${accent || "var(--color-border-soft)"}`,
        borderLeft: `3px solid ${accent || "var(--color-accent)"}`,
      }}
    >
      <div className="flex items-center gap-2">
        <span className="text-lg">{icon}</span>
        <span className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: "var(--color-text-muted)" }}>{label}</span>
      </div>
      <span className="text-xl font-bold" style={{ color: "var(--color-text)" }}>{value}</span>
      {sub && <span className="text-[11px]" style={{ color: "var(--color-text-dim)" }}>{sub}</span>}
    </div>
  );
}

// ─── Section Header ───────────────────────────────────────────────────────────
function SectionHeader({ icon, title }: { icon: string; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="text-base">{icon}</span>
      <h3 className="text-sm font-bold uppercase tracking-wider" style={{ color: "var(--color-text)" }}>{title}</h3>
      <div className="flex-1 h-px" style={{ background: "var(--color-border-soft)" }} />
    </div>
  );
}

// ─── Mini Bar ─────────────────────────────────────────────────────────────────
function MiniBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] w-28 truncate" style={{ color: "var(--color-text-muted)" }}>{label}</span>
      <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "var(--color-bg-deep)" }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-[10px] w-12 text-right font-mono" style={{ color: "var(--color-text-dim)" }}>{pct}%</span>
    </div>
  );
}

// ─── Status Badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status, count, t }: { status: string; count: number; t: (key: string) => string }) {
  const statusKey = status.toLowerCase().replace(/\s+/g, '_');
  const label = t(`library.status_options.${statusKey}`) || status;
  const colors: Record<string, { bg: string; text: string }> = {
    "Playing": { bg: "var(--color-accent-deep)", text: "var(--color-accent)" },
    "Completed": { bg: "var(--color-success-bg)", text: "var(--color-success)" },
    "On Hold": { bg: "var(--color-warning-bg)", text: "var(--color-warning)" },
    "Dropped": { bg: "var(--color-danger-bg)", text: "var(--color-danger)" },
    "Plan to Play": { bg: "var(--color-panel-3)", text: "var(--color-text-muted)" },
  };
  const c = colors[status] || { bg: "var(--color-panel-3)", text: "var(--color-text-muted)" };
  return (
    <span className="px-2 py-1 rounded text-[11px] font-semibold" style={{ background: c.bg, color: c.text }}>
      {label} ({count})
    </span>
  );
}

// ─── Hour Bar ─────────────────────────────────────────────────────────────────
function HourBar({ hour, value, max, showLabel }: { hour: number; value: number; max: number; showLabel?: boolean }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  const label = `${hour.toString().padStart(2, "0")}:00`;
  return (
    <div className="flex flex-col items-center gap-0.5 flex-1 relative h-[70px]">
      <div className="w-full max-w-[14px] h-14 rounded-full overflow-hidden flex items-end absolute top-0" style={{ background: "var(--color-bg-deep)" }}>
        <div className="w-full rounded-full transition-all" style={{ height: `${pct}%`, background: pct > 60 ? "var(--color-warning)" : pct > 30 ? "var(--color-accent)" : "var(--color-accent-deep)" }} />
      </div>
      {showLabel && <span className="text-[8px] whitespace-nowrap absolute bottom-0" style={{ color: "var(--color-text-dim)" }}>{label}</span>}
    </div>
  );
}

// ─── Sparkline ────────────────────────────────────────────────────────────────
function Sparkline({ data, width = 300, height = 60, color = "var(--color-accent)" }: {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  if (data.length < 2) return null;
  const max = Math.max(1, ...data);
  const stepX = width / (data.length - 1);
  const points = data.map((v, i) => `${i * stepX},${height - (v / max) * (height - 8) - 4}`).join(" ");
  const areaPoints = `0,${height} ${points} ${(data.length - 1) * stepX},${height}`;
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="sparklineGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={areaPoints} fill="url(#sparklineGrad)" />
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {data.map((v, i) => v > 0 && (
        <circle key={i} cx={i * stepX} cy={height - (v / max) * (height - 8) - 4} r="3" fill={color} />
      ))}
    </svg>
  );
}

// ─── Heatmap Cell ─────────────────────────────────────────────────────────────
function HeatmapCell({ value, max, title }: { value: number; max: number; title?: string }) {
  const intensity = max > 0 ? value / max : 0;
  const bg = intensity === 0 ? "var(--color-bg-deep)" :
    intensity < 0.25 ? "var(--color-accent-deep)" :
      intensity < 0.5 ? "var(--color-accent-muted)" :
        intensity < 0.75 ? "var(--color-accent-soft)" : "var(--color-accent)";
  return (
    <div className="w-3.5 h-3.5 rounded-sm relative group" style={{ background: bg }}>
      {title && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover:block z-[100] pointer-events-none">
          <div className="bg-[#1b1f24] text-[#e6edf3] text-xs px-3 py-2 rounded shadow-xl whitespace-nowrap border border-white/10 font-medium">
            {title}
          </div>
          <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px border-4 border-transparent border-t-[#1b1f24]" />
        </div>
      )}
    </div>
  );
}

// ─── Radar Chart ──────────────────────────────────────────────────────────────
function RadarChart({ data, size = 180 }: {
  data: { label: string; value: number }[];
  size?: number;
}) {
  const cx = size / 2;
  const cy = size / 2;
  const maxR = size / 2 - 28;
  const levels = 4;
  const n = data.length;
  const angleStep = (2 * Math.PI) / n;

  const gridLevels = Array.from({ length: levels }, (_, i) => {
    const r = ((i + 1) / levels) * maxR;
    const points = data.map((_, j) => {
      const angle = j * angleStep - Math.PI / 2;
      return `${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`;
    }).join(" ");
    return <polygon key={`grid-${i}`} points={points} fill="none" stroke="var(--color-border-soft)" strokeWidth="0.5" />;
  });

  const axes = data.map((_, i) => {
    const angle = i * angleStep - Math.PI / 2;
    return (
      <line key={`axis-${i}`}
        x1={cx} y1={cy}
        x2={cx + maxR * Math.cos(angle)} y2={cy + maxR * Math.sin(angle)}
        stroke="var(--color-border-soft)" strokeWidth="0.5" />
    );
  });

  const dataPoints = data.map((d, i) => {
    const angle = i * angleStep - Math.PI / 2;
    const r = (d.value / 100) * maxR;
    return `${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`;
  }).join(" ");

  const labels = data.map((d, i) => {
    const angle = i * angleStep - Math.PI / 2;
    const labelR = maxR + 16;
    const x = cx + labelR * Math.cos(angle);
    const y = cy + labelR * Math.sin(angle);
    const anchor = Math.abs(Math.cos(angle)) < 0.1 ? "middle" : Math.cos(angle) > 0 ? "start" : "end";
    return (
      <text key={`label-${i}`} x={x} y={y} textAnchor={anchor} dominantBaseline="middle"
        fontSize="9" fill="var(--color-text-muted)">
        {d.label}
      </text>
    );
  });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {gridLevels}
      {axes}
      <polygon points={dataPoints} fill="var(--color-accent)" opacity="0.15" stroke="var(--color-accent)" strokeWidth="1.5" />
      {data.map((d, i) => {
        const angle = i * angleStep - Math.PI / 2;
        const r = (d.value / 100) * maxR;
        return (
          <circle key={`dot-${i}`}
            cx={cx + r * Math.cos(angle)} cy={cy + r * Math.sin(angle)}
            r="3" fill="var(--color-accent)" />
        );
      })}
      {labels}
    </svg>
  );
}

// ─── Donut Chart ──────────────────────────────────────────────────────────────
function DonutChart({ data, size = 160, t }: {
  data: { label: string; value: number; color: string }[];
  size?: number;
  t: (key: string) => string;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return null;
  const cx = size / 2;
  const cy = size / 2;
  const outerR = size / 2 - 10;
  const innerR = outerR * 0.6;

  let cumulative = 0;
  const slices = data.map((d, i) => {
    const startAngle = (cumulative / total) * 2 * Math.PI - Math.PI / 2;
    cumulative += d.value;
    const endAngle = (cumulative / total) * 2 * Math.PI - Math.PI / 2;

    const x1 = cx + outerR * Math.cos(startAngle);
    const y1 = cy + outerR * Math.sin(startAngle);
    const x2 = cx + outerR * Math.cos(endAngle);
    const y2 = cy + outerR * Math.sin(endAngle);
    const x3 = cx + innerR * Math.cos(endAngle);
    const y3 = cy + innerR * Math.sin(endAngle);
    const x4 = cx + innerR * Math.cos(startAngle);
    const y4 = cy + innerR * Math.sin(startAngle);

    const largeArc = (d.value / total) > 0.5 ? 1 : 0;
    const path = `M ${x1} ${y1} A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2} ${y2} L ${x3} ${y3} A ${innerR} ${innerR} 0 ${largeArc} 0 ${x4} ${y4} Z`;

    return <path key={i} d={path} fill={d.color} stroke="var(--color-bg)" strokeWidth="1" />;
  });

  const legend = data.map((d, i) => (
    <div key={i} className="flex items-center gap-2">
      <div className="w-2.5 h-2.5 rounded-sm" style={{ background: d.color }} />
      <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
        {d.label} ({Math.round((d.value / total) * 100)}%)
      </span>
    </div>
  ));

  return (
    <div className="flex items-center gap-6">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {slices}
        <text x={cx} y={cy - 6} textAnchor="middle" fontSize="14" fontWeight="bold" fill="var(--color-text)">
          {formatTime(total)}
        </text>
        <text x={cx} y={cy + 10} textAnchor="middle" fontSize="9" fill="var(--color-text-dim)">
          {t('stats_view.total')}
        </text>
      </svg>
      <div className="flex flex-col gap-1.5">{legend}</div>
    </div>
  );
}

// ─── StatsView ────────────────────────────────────────────────────────────────
export function StatsView({
  games,
  stats,
  sessions,
  customizations,
  metadata,
  notes,
  collections,
  wishlist,
  totalPlaytimeSecs,
}: StatsViewProps) {
  const { t } = useTranslation();
  const [showYearInReview, setShowYearInReview] = useState(false);
  const [timelineMode, setTimelineMode] = useState<"day" | "week">("day");
  const [timelineZoomDays, setTimelineZoomDays] = useState(56);
  const [selectedTimelineBucketStart, setSelectedTimelineBucketStart] = useState<number | null>(null);
  const [breakdownWindowWeeks, setBreakdownWindowWeeks] = useState(12);

  // ── Goal-based play tracking ──────────────────────────────────────────────
  const [goals, setGoals] = useState<PlayGoal[]>(() => loadCache<PlayGoal[]>(SK_PLAY_GOALS, []));
  const [goalEditorOpen, setGoalEditorOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<PlayGoal | null>(null);
  const [showGoalDeleteConfirm, setShowGoalDeleteConfirm] = useState<string | null>(null);

  const persistGoals = useCallback((next: PlayGoal[]) => {
    setGoals(next);
    saveCache(SK_PLAY_GOALS, next);
  }, []);

  const startOfMonth = (ts: number): number => {
    const d = new Date(ts);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };

  const periodStart = (goal: PlayGoal): number =>
    goal.period === 'weekly' ? startOfWeekMs(Date.now()) : startOfMonth(Date.now());

  const periodEnd = (goal: PlayGoal): number => {
    const start = periodStart(goal);
    if (goal.period === 'weekly') {
      return start + 7 * DAY_MS;
    }
    const d = new Date(start);
    d.setMonth(d.getMonth() + 1);
    return d.getTime();
  };

  const computePlaytimeForGame = (path: string, start: number, end: number): number => {
    let total = 0;
    for (const s of sessions) {
      if (s.path === path && s.startedAt >= start && s.startedAt < end) {
        total += s.duration;
      }
    }
    return total;
  };

  const computeCompletionForGame = (path: string): boolean => {
    return customizations[path]?.status === 'Completed';
  };

  // Resolve game paths for a given scope
  const resolveScopePaths = (goal: PlayGoal): string[] => {
    const { type, value } = goal.scope;
    switch (type) {
      case 'all':
        return games.map(g => g.path);
      case 'game':
        return value ? [value] : [];
      case 'collection': {
        const col = collections.find(c => c.id === value);
        return col ? col.gamePaths : [];
      }
      case 'tag':
        if (!value) return [];
        return games.filter(g => {
          const tags = [
            ...(metadata[g.path]?.tags || []),
            ...(customizations[g.path]?.customTags || []),
          ];
          return tags.some(t => t.trim().toLowerCase() === value.toLowerCase());
        }).map(g => g.path);
      case 'developer':
        if (!value) return [];
        return games.filter(g => {
          const m = metadata[g.path];
          const c = customizations[g.path];
          const dev = (c?.manualDeveloper || m?.circle || m?.developer || '').trim().toLowerCase();
          return dev === value.toLowerCase();
        }).map(g => g.path);
      case 'source':
        if (!value) return [];
        return games.filter(g => (metadata[g.path]?.source || '').toLowerCase() === value.toLowerCase()).map(g => g.path);
      default:
        return [];
    }
  };

  const computeGoalProgress = (goal: PlayGoal): { current: number; target: number; percent: number } => {
    const pStart = periodStart(goal);
    const pEnd = periodEnd(goal);

    if (goal.metric === 'playtime') {
      const paths = resolveScopePaths(goal);
      let totalPlaytime = 0;
      for (const path of paths) {
        totalPlaytime += computePlaytimeForGame(path, pStart, pEnd);
      }
      const current = totalPlaytime;
      const target = goal.target;
      const percent = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
      return { current, target, percent };
    }

    // Completion metric
    if (goal.metric === 'completion') {
      const paths = resolveScopePaths(goal);
      let completedCount = 0;
      for (const path of paths) {
        if (computeCompletionForGame(path)) completedCount++;
      }
      const current = completedCount;
      const target = goal.target;
      const percent = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
      return { current, target, percent };
    }

    return { current: 0, target: goal.target, percent: 0 };
  };

  // Get unique scope options for the create/edit form
  const scopeOptions = useMemo(() => {
    const gameOpts = games.map(g => ({
      type: 'game' as const,
      value: g.path,
      label: customizations[g.path]?.displayName || metadata[g.path]?.title || g.name,
    }));
    const collectionOpts = collections.map(c => ({
      type: 'collection' as const,
      value: c.id,
      label: c.name,
    }));
    const tagOptsMap = new Map<string, string>();
    for (const m of Object.values(metadata)) {
      for (const tag of (m?.tags || [])) {
        const t = tag.trim();
        if (t) tagOptsMap.set(t.toLowerCase(), t);
      }
    }
    for (const c of Object.values(customizations)) {
      for (const tag of (c?.customTags || [])) {
        const t = tag.trim();
        if (t) tagOptsMap.set(t.toLowerCase(), t);
      }
    }
    const tagOpts = Array.from(tagOptsMap.values()).map(t => ({
      type: 'tag' as const,
      value: t,
      label: t,
    })).sort((a, b) => a.label.localeCompare(b.label));

    const devOptsSet = new Set<string>();
    for (const [path] of Object.entries(stats)) {
      const m = metadata[path];
      const c = customizations[path];
      const dev = (c?.manualDeveloper || m?.circle || m?.developer || '').trim();
      if (dev) devOptsSet.add(dev);
    }
    const devOpts = Array.from(devOptsSet).map(d => ({
      type: 'developer' as const,
      value: d,
      label: d,
    })).sort((a, b) => a.label.localeCompare(b.label));

    const sourceOptsSet = new Set<string>();
    for (const m of Object.values(metadata)) {
      if (m?.source) sourceOptsSet.add(m.source);
    }
    const sourceOpts = Array.from(sourceOptsSet).map(s => ({
      type: 'source' as const,
      value: s,
      label: s.charAt(0).toUpperCase() + s.slice(1),
    })).sort((a, b) => a.label.localeCompare(b.label));

    return {
      games: gameOpts,
      collections: collectionOpts,
      tags: tagOpts,
      developers: devOpts,
      sources: sourceOpts,
    };
  }, [games, collections, metadata, customizations, stats]);

  const goalProgresses = useMemo(() => {
    return goals.map(g => ({ goal: g, progress: computeGoalProgress(g) }));
  }, [goals, sessions, stats, metadata, customizations, collections, games]);

  // Inline goal editor state
  const emptyGoalForm = (): Omit<PlayGoal, 'id' | 'createdAt'> => ({
    name: '',
    period: 'weekly',
    metric: 'playtime',
    target: 3600,
    scope: { type: 'all' },
  });
  const [goalForm, setGoalForm] = useState<Omit<PlayGoal, 'id' | 'createdAt'>>(emptyGoalForm());

  const resolveGameName = (path: string): string => {
    return customizations[path]?.displayName
      || metadata[path]?.title
      || games.find((g) => g.path === path)?.name
      || path;
  };

  // ── Core metrics ──────────────────────────────────────────────────────────
  const hours = Math.floor(totalPlaytimeSecs / 3600);
  const mins = Math.floor((totalPlaytimeSecs % 3600) / 60);

  const gamesPlayed = Object.values(stats).filter(s => s.totalTime > 0).length;
  const avgSessionDuration = sessions.length > 0
    ? sessions.reduce((sum, s) => sum + s.duration, 0) / sessions.length
    : 0;

  const longestSession = sessions.length
    ? sessions.reduce((a, b) => (a.duration > b.duration ? a : b))
    : null;
  const lsGame = longestSession
    ? customizations[longestSession.path]?.displayName ||
      metadata[longestSession.path]?.title ||
      games.find((g) => g.path === longestSession.path)?.name ||
      t('stats_view.unknown')
    : "—";
  const lsHrs = longestSession ? Math.floor(longestSession.duration / 3600) : 0;
  const lsMins = longestSession ? Math.floor((longestSession.duration % 3600) / 60) : 0;

  // Most played game
  let mostPlayedPath = "";
  let mostPlayedTime = 0;
  for (const path of Object.keys(stats)) {
    if (stats[path].totalTime > mostPlayedTime) {
      mostPlayedTime = stats[path].totalTime;
      mostPlayedPath = path;
    }
  }
  const mpGame = games.find(g => g.path === mostPlayedPath);
  const mpGameName = mpGame
    ? (customizations[mpGame.path]?.displayName ?? metadata[mpGame.path]?.title ?? mpGame.name)
    : "—";

  // Busiest day of week
  const days = t('stats_view.days', { returnObjects: true }) as string[];
  const dayCounts = [0, 0, 0, 0, 0, 0, 0];
  for (const s of sessions) {
    const d = new Date(s.startedAt).getDay();
    dayCounts[d] += s.duration;
  }
  let maxDayIdx = 0;
  for (let i = 1; i < 7; i++) {
    if (dayCounts[i] > dayCounts[maxDayIdx]) maxDayIdx = i;
  }
  const busiestDay = dayCounts[maxDayIdx] > 0 ? days[maxDayIdx] : "—";

  // ── Extended metrics ──────────────────────────────────────────────────────
  const totalLaunches = Object.values(stats).reduce((sum, s) => sum + (s.launchCount || 0), 0);
  const gamesWithNotes = Object.keys(notes).filter(k => notes[k]?.trim()).length;
  const gamesWithRatings = Object.values(customizations).filter(
    c => typeof c.personalRating === "number" || typeof c.overallScore100 === "number"
  ).length;
  const totalTags = Object.values(customizations).reduce(
    (sum, c) => sum + (c.customTags?.length || 0), 0
  );
  const uninstalledGames = games.filter(g => g.uninstalled).length;

  // Status distribution
  const statusCounts: Record<string, number> = {};
  for (const c of Object.values(customizations)) {
    if (c.status) {
      statusCounts[c.status] = (statusCounts[c.status] || 0) + 1;
    }
  }

  // Source distribution
  const sourceCounts: Record<string, number> = {};
  for (const m of Object.values(metadata)) {
    if (m.source) {
      sourceCounts[m.source] = (sourceCounts[m.source] || 0) + 1;
    }
  }
  const maxSourceCount = Math.max(1, ...Object.values(sourceCounts));

  // Top 5 by playtime
  const top5ByTime = useMemo(() => {
    return Object.entries(stats)
      .sort(([, a], [, b]) => b.totalTime - a.totalTime)
      .slice(0, 5)
      .map(([path, s]) => {
        const g = games.find(g => g.path === path);
        const name = g ? (customizations[path]?.displayName ?? metadata[path]?.title ?? g.name) : path;
        return { name, time: s.totalTime };
      });
  }, [games, stats, customizations, metadata]);
  const maxTime = top5ByTime.length > 0 ? top5ByTime[0].time : 1;

  // Top 5 by launches
  const top5ByLaunches = useMemo(() => {
    return Object.entries(stats)
      .sort(([, a], [, b]) => (b.launchCount || 0) - (a.launchCount || 0))
      .slice(0, 5)
      .map(([path, s]) => {
        const g = games.find(g => g.path === path);
        const name = g ? (customizations[path]?.displayName ?? metadata[path]?.title ?? g.name) : path;
        return { name, launches: s.launchCount || 0 };
      });
  }, [games, stats, customizations, metadata]);
  const maxLaunches = top5ByLaunches.length > 0 ? top5ByLaunches[0].launches : 1;

  // Playtime by source
  const sourcePlaytime: Record<string, number> = {};
  for (const [path, s] of Object.entries(stats)) {
    const src = metadata[path]?.source || "unknown";
    sourcePlaytime[src] = (sourcePlaytime[src] || 0) + s.totalTime;
  }
  const maxSourceTime = Math.max(1, ...Object.values(sourcePlaytime));

  // ── Medium complexity metrics ─────────────────────────────────────────────

  // Streak (consecutive days with at least one session)
  const streak = useMemo(() => {
    if (sessions.length === 0) return 0;
    const daySet = new Set<string>();
    for (const s of sessions) {
      const d = new Date(s.startedAt);
      daySet.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
    }
    let count = 0;
    const today = new Date();
    for (let i = 0; i < 365; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (daySet.has(key)) count++;
      else if (i > 0) break; // allow today to be empty
    }
    return count;
  }, [sessions]);

  // Favorite time of day
  const hourCounts = useMemo(() => {
    const hours = new Array(24).fill(0);
    for (const s of sessions) {
      hours[new Date(s.startedAt).getHours()]++;
    }
    return hours;
  }, [sessions]);
  const maxHourCount = Math.max(1, ...hourCounts);
  const favoriteHour = hourCounts.indexOf(maxHourCount);
  const timeLabels = [t('stats_view.night'), t('stats_view.morning'), t('stats_view.afternoon'), t('stats_view.evening')];
  const favoriteTimeLabel = favoriteHour >= 6 && favoriteHour < 12 ? timeLabels[1] :
    favoriteHour >= 12 && favoriteHour < 18 ? timeLabels[2] :
      favoriteHour >= 18 && favoriteHour < 24 ? timeLabels[3] : timeLabels[0];

  // Top developers
  const devPlaytime = useMemo(() => {
    const devs: Record<string, number> = {};
    for (const [path, s] of Object.entries(stats)) {
      const m = metadata[path];
      const dev = (m?.circle || m?.developer || "").trim() || t('stats_view.unknown_dev');
      devs[dev] = (devs[dev] || 0) + s.totalTime;
    }
    return Object.entries(devs)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5);
  }, [stats, metadata, t]);
  const maxDevTime = devPlaytime.length > 0 ? devPlaytime[0][1] : 1;

  // Rating distribution
  const ratingBuckets = useMemo(() => {
    const buckets = [0, 0, 0, 0, 0]; // 0-20, 21-40, 41-60, 61-80, 81-100
    for (const c of Object.values(customizations)) {
      const score = typeof c.overallScore100 === "number" ? c.overallScore100 :
        typeof c.personalRating === "number" ? c.personalRating * 10 : null;
      if (score !== null) {
        const idx = Math.min(4, Math.floor(score / 20));
        buckets[idx]++;
      }
    }
    return buckets;
  }, [customizations]);
  const maxRatingBucket = Math.max(1, ...ratingBuckets);
  const ratingLabels = t('stats_view.rating_buckets', { returnObjects: true }) as string[];
  const ratingColors = ["var(--color-danger)", "var(--color-warning)", "var(--color-text-muted)", "var(--color-accent-soft)", "var(--color-success)"];

  // Monthly trend (last 6 months)
  const monthlyTrend = useMemo(() => {
    const months = new Array(6).fill(0);
    const now = new Date();
    for (const s of sessions) {
      const d = new Date(s.startedAt);
      const diff = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
      if (diff >= 0 && diff < 6) {
        months[5 - diff] += s.duration;
      }
    }
    return months;
  }, [sessions]);
  const monthNames = t('stats_view.months', { returnObjects: true }) as string[];
  const monthLabels = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
      return monthNames[d.getMonth()];
    });
  }, [monthNames]);

  // ── Complex metrics ───────────────────────────────────────────────────────

  // Activity Heatmap (365 days)
  const { heatmapData, maxHeatValue, monthLabels: heatmapMonthLabels } = useMemo(() => {
    const daysMap: Record<string, { duration: number, count: number }> = {};
    for (const s of sessions) {
      const d = new Date(s.startedAt);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (!daysMap[key]) daysMap[key] = { duration: 0, count: 0 };
      daysMap[key].duration += s.duration;
      daysMap[key].count += 1;
    }
    
    const result: { duration: number; count: number; date: Date }[][] = [];
    const mLabels: { label: string; index: number }[] = [];
    const now = new Date();
    let currentMonth = -1;
    
    for (let week = 52; week >= 0; week--) {
      const weekData: { duration: number; count: number; date: Date }[] = [];
      let weekStartMonth = -1;
      
      for (let day = 0; day < 7; day++) {
        const d = new Date(now);
        d.setDate(d.getDate() - (week * 7 + (6 - day)));
        if (day === 0) weekStartMonth = d.getMonth();
        const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
        weekData.push({ 
          duration: daysMap[key]?.duration || 0, 
          count: daysMap[key]?.count || 0,
          date: d 
        });
      }
      
      if (weekStartMonth !== currentMonth && weekStartMonth !== -1) {
        mLabels.push({ label: monthNames[weekStartMonth], index: 52 - week });
        currentMonth = weekStartMonth;
      }
      
      result.push(weekData);
    }
    return { 
      heatmapData: result, 
      maxHeatValue: Math.max(1, ...result.flat().map(d => d.duration)),
      monthLabels: mLabels 
    };
  }, [sessions, monthNames]);

  // Productivity Correlation
  const productivity = useMemo(() => {
    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    const recentSessions = sessions.filter(s => s.startedAt > thirtyDaysAgo);
    
    let bingeTime = 0;
    let wellSpentTime = 0;
    const dailyTimes: Record<string, number> = {};
    
    for (const s of recentSessions) {
      const d = new Date(s.startedAt);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      dailyTimes[key] = (dailyTimes[key] || 0) + s.duration;
      
      if (s.duration > 4 * 3600) {
        bingeTime += s.duration;
      } else if (s.duration >= 1800 && s.duration <= 2.5 * 3600) {
        wellSpentTime += s.duration;
      }
    }
    
    for (const time of Object.values(dailyTimes)) {
      if (time > 6 * 3600) {
         bingeTime += time * 0.3; // Weight daily binges
      }
    }
    
    const totalAnalyzed = bingeTime + wellSpentTime || 1;
    const wellSpentPct = Math.round((wellSpentTime / totalAnalyzed) * 100);
    
    let label = "Balanced Play";
    let color = "var(--color-accent)";
    if (wellSpentPct > 70) {
      label = "Time Well Spent";
      color = "var(--color-success)";
    } else if (wellSpentPct < 30 && bingeTime > wellSpentTime) {
      label = "Binge-Heavy";
      color = "var(--color-danger)";
    }
    
    return { wellSpentPct, label, color, totalRecent: recentSessions.length, hasData: recentSessions.length > 0 };
  }, [sessions]);

  // Average category ratings
  const avgCategoryRatings = useMemo(() => {
    const sums: Record<string, number> = {};
    const counts: Record<string, number> = {};
    for (const c of Object.values(customizations)) {
      if (c.categoryRatings) {
        for (const [key, val] of Object.entries(c.categoryRatings)) {
          if (typeof val === "number") {
            sums[key] = (sums[key] || 0) + val;
            counts[key] = (counts[key] || 0) + 1;
          }
        }
      }
    }
    return RATING_CATEGORIES.map(cat => ({
      label: cat.label,
      value: counts[cat.key] ? Math.round(sums[cat.key]! / counts[cat.key]!) : 0,
    }));
  }, [customizations]);

  // Session mood distribution
  const moodCounts = useMemo(() => {
    const moods: Record<string, number> = { hype: 0, chill: 0, chaos: 0 };
    for (const s of sessions) {
      if (s.mood && s.mood in moods) {
        moods[s.mood]++;
      }
    }
    return moods;
  }, [sessions]);
  const totalMoods = Object.values(moodCounts).reduce((a, b) => a + b, 0);

  // Playtime by source (for donut)
  const sourcePlaytimeDonut = useMemo(() => {
    const srcTime: Record<string, number> = {};
    for (const [path, s] of Object.entries(stats)) {
      const src = metadata[path]?.source || "unknown";
      srcTime[src] = (srcTime[src] || 0) + s.totalTime;
    }
    const colors: Record<string, string> = {
      f95: "var(--color-accent)",
      dlsite: "var(--color-warning)",
      vndb: "var(--color-success)",
      mangagamer: "var(--color-danger)",
      johren: "var(--color-accent-soft)",
      fakku: "var(--color-accent-muted)",
      unknown: "var(--color-text-dim)",
    };
    return Object.entries(srcTime)
      .sort(([, a], [, b]) => b - a)
      .map(([src, time]) => ({
        label: src.charAt(0).toUpperCase() + src.slice(1),
        value: time,
        color: colors[src] || "var(--color-text-dim)",
      }));
  }, [stats, metadata]);

  // ── Session Timeline Explorer ───────────────────────────────────────────
  const timelineBuckets = useMemo(() => {
    const periodStart = timelineMode === "day" ? startOfDayMs : startOfWeekMs;
    const periodStep = timelineMode === "day" ? DAY_MS : DAY_MS * 7;
    const now = Date.now();
    const from = now - timelineZoomDays * DAY_MS;
    const firstStart = periodStart(from);

    const grouped = new Map<number, { start: number; end: number; duration: number; count: number; sessions: SessionEntryLike[] }>();
    for (const s of sessions) {
      if (s.startedAt < firstStart) continue;
      const start = periodStart(s.startedAt);
      const existing = grouped.get(start);
      if (existing) {
        existing.duration += s.duration;
        existing.count += 1;
        existing.sessions.push(s);
      } else {
        grouped.set(start, {
          start,
          end: start + periodStep,
          duration: s.duration,
          count: 1,
          sessions: [s],
        });
      }
    }

    for (let cur = firstStart; cur <= now; cur += periodStep) {
      if (!grouped.has(cur)) {
        grouped.set(cur, {
          start: cur,
          end: cur + periodStep,
          duration: 0,
          count: 0,
          sessions: [],
        });
      }
    }

    return Array.from(grouped.values())
      .sort((a, b) => a.start - b.start)
      .map((bucket) => ({
        ...bucket,
        sessions: [...bucket.sessions].sort((a, b) => b.startedAt - a.startedAt),
      }));
  }, [sessions, timelineMode, timelineZoomDays]);

  const maxTimelineDuration = Math.max(1, ...timelineBuckets.map((b) => b.duration));
  const activeTimelineBucket = useMemo(() => {
    if (timelineBuckets.length === 0) return null;
    if (selectedTimelineBucketStart !== null) {
      const selected = timelineBuckets.find((b) => b.start === selectedTimelineBucketStart);
      if (selected) return selected;
    }
    return timelineBuckets[timelineBuckets.length - 1];
  }, [timelineBuckets, selectedTimelineBucketStart]);

  // ── Breakdown charts over time ──────────────────────────────────────────
  const collectionLabelsByPath = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const col of collections) {
      for (const path of col.gamePaths) {
        if (!map[path]) map[path] = [];
        map[path].push(col.name);
      }
    }
    return map;
  }, [collections]);

  const breakdowns = useMemo(() => {
    const nowWeek = startOfWeekMs(Date.now());
    const weekStarts = Array.from({ length: breakdownWindowWeeks }, (_, idx) =>
      nowWeek - (breakdownWindowWeeks - 1 - idx) * DAY_MS * 7
    );
    const weekIndexMap = new Map<number, number>(weekStarts.map((w, i) => [w, i]));
    const minWeek = weekStarts[0] ?? nowWeek;

    type Entry = { label: string; total: number; series: number[] };
    const build = (resolver: (path: string) => string[]) => {
      const totals: Record<string, number> = {};
      const seriesMap: Record<string, number[]> = {};

      for (const s of sessions) {
        const ws = startOfWeekMs(s.startedAt);
        if (ws < minWeek) continue;
        const weekIdx = weekIndexMap.get(ws);
        if (weekIdx === undefined) continue;

        const labels = uniqueNormalizedLabels(resolver(s.path));
        const resolvedLabels = labels.length > 0 ? labels : ["Unknown"];
        const share = s.duration / resolvedLabels.length;

        for (const label of resolvedLabels) {
          totals[label] = (totals[label] || 0) + share;
          if (!seriesMap[label]) {
            seriesMap[label] = new Array(breakdownWindowWeeks).fill(0);
          }
          seriesMap[label][weekIdx] += share;
        }
      }

      const entries: Entry[] = Object.entries(totals)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([label, total]) => ({ label, total, series: seriesMap[label] || new Array(breakdownWindowWeeks).fill(0) }));

      return {
        entries,
        maxTotal: Math.max(1, ...entries.map((x) => x.total), 1),
      };
    };

    const developers = build((path) => {
      const m = metadata[path];
      const c = customizations[path];
      return [
        c?.manualDeveloper || "",
        m?.circle || "",
        m?.developer || "",
      ];
    });

    const genres = build((path) => {
      const m = metadata[path];
      const c = customizations[path];
      return [
        ...(Array.isArray(m?.genres) ? m!.genres! : []),
        ...parseCsvList(c?.manualGenres),
      ];
    });

    const tags = build((path) => {
      const m = metadata[path];
      const c = customizations[path];
      return [
        ...(Array.isArray(c?.customTags) ? c!.customTags! : []),
        ...(Array.isArray(m?.tags) ? m!.tags! : []),
      ];
    });

    const engines = build((path) => {
      const m = metadata[path];
      const c = customizations[path];
      const list: string[] = [];
      if (m?.engine) list.push(m.engine);
      if (c?.mugenForceSingleCore || c?.mugenDgVoodooFolder) list.push("MUGEN");
      return list;
    });

    const collectionBreakdown = build((path) => collectionLabelsByPath[path] || []);

    return {
      weekStarts,
      developers,
      genres,
      tags,
      engines,
      collections: collectionBreakdown,
    };
  }, [sessions, breakdownWindowWeeks, metadata, customizations, collectionLabelsByPath]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex-1 overflow-y-auto px-6 py-6" style={{ scrollbarWidth: "thin", scrollbarColor: "var(--color-border) transparent" }}>
      <div className="max-w-5xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20V10" /><path d="M18 20V4" /><path d="M6 20v-4" />
            </svg>
            <h2 className="text-lg font-bold" style={{ color: "var(--color-white)" }}>{t('stats_view.title')}</h2>
          </div>
          
          <button
            onClick={() => setShowYearInReview(true)}
            className="flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold transition-transform hover:scale-105"
            style={{ background: "var(--color-warning-bg)", color: "var(--color-warning)", border: "1px solid var(--color-warning)" }}
          >
            <span>🎉</span>
            {new Date().getFullYear()} Year in Review
          </button>
        </div>

        {/* ── Core Stats Grid ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            icon="🕐"
            label={t('stats_view.total_time')}
            value={`${hours}h ${mins}m`}
            sub={gamesPlayed > 0 ? `${gamesPlayed} games played` : "No games played yet"}
            accent="var(--color-accent)"
          />
          <StatCard
            icon="🏆"
            label={t('stats_view.most_played')}
            value={mpGameName}
            sub={mostPlayedTime > 0 ? formatTime(mostPlayedTime) : "—"}
            accent="var(--color-warning)"
          />
          <StatCard
            icon="⏱️"
            label={t('stats_view.longest_session')}
            value={longestSession ? `${lsHrs}h ${lsMins}m` : "—"}
            sub={longestSession ? lsGame : "—"}
            accent="var(--color-success)"
          />
          <StatCard
            icon="📅"
            label={t('stats_view.busiest_day')}
            value={busiestDay}
            sub={dayCounts[maxDayIdx] > 0 ? formatTime(dayCounts[maxDayIdx]) : "—"}
            accent="var(--color-accent-soft)"
          />
        </div>

        {/* ── Extended Stats Grid ─────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            icon="🎮"
            label={t('stats_view.total_launches')}
            value={totalLaunches.toLocaleString()}
            sub={games.length > 0 ? `${games.length} games in library` : t('stats_view.empty_library')}
          />
          <StatCard
            icon="📊"
            label={t('stats_view.avg_session')}
            value={avgSessionDuration > 0 ? formatTime(Math.round(avgSessionDuration)) : "—"}
            sub={sessions.length > 0 ? `${sessions.length} sessions logged` : t('stats_view.no_sessions_yet')}
          />
          <StatCard
            icon="📝"
            label={t('stats_view.games_with_notes')}
            value={gamesWithNotes.toString()}
            sub={gamesWithNotes > 0 ? `${Math.round((gamesWithNotes / Math.max(1, games.length)) * 100)}% of library` : "—"}
          />
          <StatCard
            icon="⭐"
            label={t('stats_view.games_rated')}
            value={gamesWithRatings.toString()}
            sub={gamesWithRatings > 0 ? `${Math.round((gamesWithRatings / Math.max(1, games.length)) * 100)}% of library` : "—"}
          />
        </div>

        {/* ── Library Overview ────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            icon="📁"
            label={t('stats_view.total_games')}
            value={games.length.toString()}
            sub={uninstalledGames > 0 ? `${uninstalledGames} ${t('stats_view.uninstalled')}` : t('stats_view.all_installed')}
          />
          <StatCard
            icon="🏷️"
            label={t('stats_view.custom_tags')}
            value={totalTags.toString()}
            sub={t('stats_view.across_all_games')}
          />
          <StatCard
            icon="📂"
            label={t('stats_view.collections')}
            value={collections.length.toString()}
            sub={collections.length > 0 ? `${collections.reduce((s, c) => s + c.gamePaths.length, 0)} ${t('stats_view.games_grouped')}` : "—"}
          />
          <StatCard
            icon="💜"
            label={t('stats_view.wishlist')}
            value={wishlist.length.toString()}
            sub={wishlist.length > 0 ? `${wishlist.filter(w => w.releaseStatus === "Released").length} ${t('stats_view.released')}` : "—"}
          />
        </div>

        {/* ── Top 5 by Playtime ───────────────────────────────────────────── */}
        {top5ByTime.length > 0 && (
          <div className="rounded-xl p-5" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border-soft)" }}>
            <SectionHeader icon="🏆" title={t('stats_view.top_5_playtime')} />
            <div className="space-y-2">
              {top5ByTime.map((item, i) => (
                <MiniBar
                  key={item.name}
                  label={`#${i + 1} ${item.name}`}
                  value={item.time}
                  max={maxTime}
                  color={i === 0 ? "var(--color-warning)" : i === 1 ? "var(--color-text-muted)" : i === 2 ? "var(--color-accent-soft)" : "var(--color-accent-deep)"}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── Top 5 by Launches ───────────────────────────────────────────── */}
        {top5ByLaunches.length > 0 && (
          <div className="rounded-xl p-5" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border-soft)" }}>
            <SectionHeader icon="🚀" title={t('stats_view.top_5_launches')} />
            <div className="space-y-2">
              {top5ByLaunches.map((item, i) => (
                <MiniBar
                  key={item.name}
                  label={`#${i + 1} ${item.name}`}
                  value={item.launches}
                  max={maxLaunches}
                  color={i === 0 ? "var(--color-warning)" : i === 1 ? "var(--color-text-muted)" : i === 2 ? "var(--color-accent-soft)" : "var(--color-accent-deep)"}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── Status Distribution ─────────────────────────────────────────── */}
        {Object.keys(statusCounts).length > 0 && (
          <div className="rounded-xl p-5" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border-soft)" }}>
            <SectionHeader icon="📋" title={t('stats_view.completion_status')} />
            <div className="flex flex-wrap gap-2">
              {Object.entries(statusCounts)
                .sort(([, a], [, b]) => b - a)
                .map(([status, count]) => (
                  <StatusBadge key={status} status={status} count={count} t={t} />
                ))}
            </div>
          </div>
        )}

        {/* ── Playtime by Source ──────────────────────────────────────────── */}
        {Object.keys(sourcePlaytime).length > 0 && (
          <div className="rounded-xl p-5" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border-soft)" }}>
            <SectionHeader icon="🌐" title={t('stats_view.playtime_by_source')} />
            <div className="space-y-2">
              {Object.entries(sourcePlaytime)
                .sort(([, a], [, b]) => b - a)
                .map(([src, time]) => (
                  <MiniBar
                    key={src}
                    label={src.charAt(0).toUpperCase() + src.slice(1)}
                    value={time}
                    max={maxSourceTime}
                    color="var(--color-accent)"
                  />
                ))}
            </div>
          </div>
        )}

        {/* ── Games by Source ─────────────────────────────────────────────── */}
        {Object.keys(sourceCounts).length > 0 && (
          <div className="rounded-xl p-5" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border-soft)" }}>
            <SectionHeader icon="📚" title={t('stats_view.games_by_source')} />
            <div className="space-y-2">
              {Object.entries(sourceCounts)
                .sort(([, a], [, b]) => b - a)
                .map(([src, count]) => (
                  <MiniBar
                    key={src}
                    label={src.charAt(0).toUpperCase() + src.slice(1)}
                    value={count}
                    max={maxSourceCount}
                    color="var(--color-accent-soft)"
                  />
                ))}
            </div>
          </div>
        )}

        {/* ── Complex Visualizations ──────────────────────────────────────── */}

        {/* Activity Heatmap */}
        {heatmapData.some(w => w.some(d => d.duration > 0)) && (
          <div className="rounded-xl p-5" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border-soft)" }}>
            <SectionHeader icon="🗓️" title={t('stats_view.activity_heatmap')} />
            <div className="flex flex-col overflow-x-auto pb-2 relative">
              <div className="flex ml-6 mb-1" style={{ height: "12px" }}>
                {heatmapMonthLabels.map(m => (
                  <span key={m.index} className="absolute text-[10px]" style={{ left: `${24 + m.index * 16}px`, color: "var(--color-text-muted)" }}>
                    {m.label}
                  </span>
                ))}
              </div>
              <div className="flex">
                <div className="flex flex-col gap-[3px] mr-2 justify-between py-1 text-[9px]" style={{ color: "var(--color-text-dim)", width: "16px" }}>
                  <span></span>
                  <span>Mon</span>
                  <span></span>
                  <span>Wed</span>
                  <span></span>
                  <span>Fri</span>
                  <span></span>
                </div>
                <div className="flex gap-[2px]">
                  {heatmapData.map((week, wi) => (
                    <div key={wi} className="flex flex-col gap-[2px]">
                      {week.map((day, di) => {
                        const title = day.count > 0
                          ? `${day.count} session${day.count === 1 ? '' : 's'} on ${monthNames[day.date.getMonth()]} ${day.date.getDate()}, ${day.date.getFullYear()}`
                          : `No activity on ${monthNames[day.date.getMonth()]} ${day.date.getDate()}, ${day.date.getFullYear()}`;
                        return (                          <HeatmapCell key={di} value={day.duration} max={maxHeatValue} title={title} />
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1 mt-3 justify-end">
              <span className="text-[9px]" style={{ color: "var(--color-text-dim)" }}>{t('stats_view.less')}</span>
              <div className="w-3 h-3 rounded-sm" style={{ background: "var(--color-bg-deep)" }} />
              <div className="w-3 h-3 rounded-sm" style={{ background: "var(--color-accent-deep)" }} />
              <div className="w-3 h-3 rounded-sm" style={{ background: "var(--color-accent-muted)" }} />
              <div className="w-3 h-3 rounded-sm" style={{ background: "var(--color-accent-soft)" }} />
              <div className="w-3 h-3 rounded-sm" style={{ background: "var(--color-accent)" }} />
              <span className="text-[9px]" style={{ color: "var(--color-text-dim)" }}>{t('stats_view.more')}</span>
            </div>
          </div>
        )}

        {/* Productivity Correlation */}
        {productivity.hasData && (
          <div className="rounded-xl p-5" style={{ background: "var(--color-panel)", border: `1px solid ${productivity.color}40` }}>
            <SectionHeader icon="⚖️" title="Session Habits (Last 30 Days)" />
            <div className="flex items-center gap-6">
              <div className="flex-1">
                <div className="flex justify-between items-end mb-2">
                  <span className="text-xl font-bold" style={{ color: productivity.color }}>{productivity.label}</span>
                  <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>{productivity.wellSpentPct}% balanced play</span>
                </div>
                <div className="w-full h-3 rounded-full overflow-hidden flex" style={{ background: "var(--color-bg-deep)" }}>
                  <div className="h-full transition-all" style={{ width: `${productivity.wellSpentPct}%`, background: "var(--color-success)" }} />
                  <div className="h-full transition-all" style={{ width: `${100 - productivity.wellSpentPct}%`, background: "var(--color-danger)" }} />
                </div>
                <div className="flex justify-between mt-2 text-[10px]" style={{ color: "var(--color-text-dim)" }}>
                  <span>Time Well Spent (30m-2.5h)</span>
                  <span>Binge Sessions ({'>'}4h)</span>
                </div>
              </div>
              <div className="flex-shrink-0 text-center w-24">
                <span className="text-3xl font-black block" style={{ color: "var(--color-text)" }}>{productivity.totalRecent}</span>
                <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--color-text-muted)" }}>Recent<br/>Sessions</span>
              </div>
            </div>
          </div>
        )}

        {/* Category Ratings Radar + Mood Distribution */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Radar Chart */}
          {avgCategoryRatings.some(r => r.value > 0) && (
            <div className="rounded-xl p-5" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border-soft)" }}>
              <SectionHeader icon="🎯" title={t('stats_view.rating_distribution')} />
              <div className="flex justify-center">
                <RadarChart data={avgCategoryRatings} size={200} />
              </div>
            </div>
          )}

          {/* Mood Distribution */}
          {totalMoods > 0 && (
            <div className="rounded-xl p-5" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border-soft)" }}>
              <SectionHeader icon="😊" title={t('stats_view.session_moods')} />
              <div className="space-y-3">
                {Object.entries(moodCounts).map(([mood, count]) => {
                  const pct = totalMoods > 0 ? Math.round((count / totalMoods) * 100) : 0;
                  const icons: Record<string, string> = { hype: "🔥", chill: "😌", chaos: "🌪️" };
                  const colors: Record<string, string> = {
                    hype: "var(--color-warning)",
                    chill: "var(--color-success)",
                    chaos: "var(--color-danger)",
                  };
                  const moodKey = mood.toLowerCase();
                  return (
                    <div key={mood} className="flex items-center gap-3">
                      <span className="text-lg">{icons[mood] || "❓"}</span>
                      <span className="text-[11px] w-12 capitalize" style={{ color: "var(--color-text-muted)" }}>{t(`stats_view.${moodKey}`)}</span>
                      <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ background: "var(--color-bg-deep)" }}>
                        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: colors[mood] || "var(--color-accent)" }} />
                      </div>
                      <span className="text-[10px] w-16 text-right font-mono" style={{ color: "var(--color-text-dim)" }}>
                        {count} ({pct}%)
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Playtime by Source Donut */}
        {sourcePlaytimeDonut.length > 0 && (
          <div className="rounded-xl p-5" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border-soft)" }}>
            <SectionHeader icon="🍩" title={t('stats_view.playtime_distribution')} />
            <div className="flex justify-center">
              <DonutChart data={sourcePlaytimeDonut} size={200} t={t} />
            </div>
          </div>
        )}

        {/* ── Streak & Activity ───────────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Streak */}
          <div className="rounded-xl p-5 flex flex-col justify-between" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border-soft)" }}>
            <SectionHeader icon="🔥" title={t('stats_view.current_streak')} />
            <div className="flex items-end gap-3">
              <span className="text-4xl font-black" style={{ color: streak > 0 ? "var(--color-warning)" : "var(--color-text-dim)" }}>
                {streak}
              </span>
              <span className="text-sm mb-1" style={{ color: "var(--color-text-muted)" }}>
                {streak === 1 ? t('stats_view.day') : t('stats_view.days_unit')} {t('stats_view.in_a_row')}
              </span>
            </div>
            {streak === 0 && sessions.length > 0 ? (
              <p className="text-[11px] mt-2" style={{ color: "var(--color-text-dim)" }}>{t('stats_view.play_today_streak')}</p>
            ) : <div className="mt-2" />}
          </div>

          {/* Favorite Time of Day */}
          <div className="rounded-xl p-5 flex flex-col" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border-soft)" }}>
            <SectionHeader icon="🌙" title={t('stats_view.favorite_gaming_time')} />
            <div className="flex items-end gap-3 mb-2">
              <span className="text-2xl font-bold" style={{ color: "var(--color-accent)" }}>
                {favoriteTimeLabel}
              </span>
              <span className="text-sm mb-1" style={{ color: "var(--color-text-muted)" }}>
                ({favoriteHour.toString().padStart(2, "0")}:00 {t('stats_view.peak')})
              </span>
            </div>
            <div className="flex flex-1 justify-between items-end gap-[1px]">
              {hourCounts.map((count, i) => (
                <HourBar key={i} hour={i} value={count} max={maxHourCount} showLabel={i % 3 === 0} />
              ))}
            </div>
          </div>
        </div>

        {/* ── Top Developers ──────────────────────────────────────────────── */}
        {devPlaytime.length > 0 && (
          <div className="rounded-xl p-5" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border-soft)" }}>
            <SectionHeader icon="�" title={t('stats_view.top_developers')} />
            <div className="space-y-2">
              {devPlaytime.map(([dev, time], i) => (
                <MiniBar
                  key={dev}
                  label={`#${i + 1} ${dev}`}
                  value={time}
                  max={maxDevTime}
                  color={i === 0 ? "var(--color-warning)" : i === 1 ? "var(--color-text-muted)" : "var(--color-accent-deep)"}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── Rating Distribution ─────────────────────────────────────────── */}
        {ratingBuckets.some(b => b > 0) && (
          <div className="rounded-xl p-5" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border-soft)" }}>
            <SectionHeader icon="⭐" title={t('stats_view.rating_distribution')} />
            <div className="space-y-2">
              {ratingBuckets.map((count, i) => (
                <MiniBar
                  key={i}
                  label={`${ratingLabels[i]} (${count})`}
                  value={count}
                  max={maxRatingBucket}
                  color={ratingColors[i]}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── Monthly Trend ───────────────────────────────────────────────── */}
        {monthlyTrend.some(v => v > 0) && (
          <div className="rounded-xl p-5" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border-soft)" }}>
            <SectionHeader icon="📈" title={t('stats_view.monthly_trend')} />
            <div className="flex items-end gap-4">
              <div className="flex-1">
                <Sparkline data={monthlyTrend} height={60} color="var(--color-accent)" />
              </div>
              <div className="flex gap-3">
                {monthlyTrend.map((time, i) => (
                  <div key={i} className="flex flex-col items-center gap-1">
                    <span className="text-[9px] font-mono" style={{ color: "var(--color-text-dim)" }}>
                      {time > 0 ? formatTime(time) : "—"}
                    </span>
                    <span className="text-[9px]" style={{ color: "var(--color-text-muted)" }}>{monthLabels[i]}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Session Timeline Explorer ───────────────────────────────────── */}
        <div className="rounded-xl p-5" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border-soft)" }}>
          <div className="flex items-center justify-between gap-3 mb-3">
            <SectionHeader icon="🧭" title="Session Timeline Explorer" />
          </div>

          <div className="flex flex-wrap items-center gap-2 mb-3">
            <div className="flex items-center gap-1 rounded px-1 py-1" style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border-soft)" }}>
              <button
                onClick={() => setTimelineMode("day")}
                className="px-2.5 py-1 rounded text-xs"
                style={{
                  background: timelineMode === "day" ? "var(--color-accent-deep)" : "transparent",
                  color: timelineMode === "day" ? "var(--color-accent)" : "var(--color-text-muted)",
                }}
              >
                Per day
              </button>
              <button
                onClick={() => setTimelineMode("week")}
                className="px-2.5 py-1 rounded text-xs"
                style={{
                  background: timelineMode === "week" ? "var(--color-accent-deep)" : "transparent",
                  color: timelineMode === "week" ? "var(--color-accent)" : "var(--color-text-muted)",
                }}
              >
                Per week
              </button>
            </div>
            <label className="flex items-center gap-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
              Zoom: {timelineZoomDays}d
              <input
                type="range"
                min={14}
                max={180}
                step={7}
                value={timelineZoomDays}
                onInput={(e) => setTimelineZoomDays(Number((e.target as HTMLInputElement).value))}
              />
            </label>
          </div>

          {timelineBuckets.length === 0 || timelineBuckets.every((b) => b.count === 0) ? (
            <p className="text-xs" style={{ color: "var(--color-text-dim)" }}>No sessions in selected range.</p>
          ) : (
            <>
              <div className="overflow-x-auto pb-2">
                <div className="flex items-end gap-1.5 min-h-[120px]">
                  {timelineBuckets.map((bucket) => {
                    const pct = Math.max(4, Math.round((bucket.duration / maxTimelineDuration) * 100));
                    const isActive = activeTimelineBucket?.start === bucket.start;
                    const startLabel = new Date(bucket.start).toLocaleDateString();
                    const endLabel = new Date(bucket.end - 1).toLocaleDateString();
                    return (
                      <button
                        key={bucket.start}
                        onClick={() => setSelectedTimelineBucketStart(bucket.start)}
                        className="w-4 rounded-t-sm relative"
                        style={{
                          height: `${pct}%`,
                          minHeight: "6px",
                          background: isActive ? "var(--color-warning)" : "var(--color-accent)",
                          opacity: bucket.count === 0 ? 0.25 : 0.95,
                          border: isActive ? "1px solid var(--color-warning)" : "1px solid transparent",
                        }}
                        title={`${timelineMode === "day" ? startLabel : `${startLabel} - ${endLabel}`}\n${bucket.count} sessions\n${formatTime(Math.round(bucket.duration))}`}
                      />
                    );
                  })}
                </div>
              </div>

              {activeTimelineBucket && (
                <div className="mt-3 rounded p-3" style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border-soft)" }}>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold" style={{ color: "var(--color-text)" }}>
                      {timelineMode === "day"
                        ? new Date(activeTimelineBucket.start).toLocaleDateString()
                        : `${new Date(activeTimelineBucket.start).toLocaleDateString()} - ${new Date(activeTimelineBucket.end - 1).toLocaleDateString()}`}
                    </p>
                    <p className="text-[11px]" style={{ color: "var(--color-text-dim)" }}>
                      {activeTimelineBucket.count} sessions · {formatTime(Math.round(activeTimelineBucket.duration))}
                    </p>
                  </div>

                  {activeTimelineBucket.sessions.length === 0 ? (
                    <p className="text-[11px]" style={{ color: "var(--color-text-dim)" }}>No sessions in this bucket.</p>
                  ) : (
                    <div className="space-y-1.5 max-h-44 overflow-y-auto">
                      {activeTimelineBucket.sessions.map((s) => (
                        <div key={`${s.path}-${s.startedAt}`} className="flex items-center justify-between gap-2 text-[11px]">
                          <span className="truncate" style={{ color: "var(--color-text-muted)" }}>
                            {new Date(s.startedAt).toLocaleString()} · {resolveGameName(s.path)}
                          </span>
                          <span className="font-mono" style={{ color: "var(--color-text-dim)" }}>
                            {formatTime(s.duration)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Tag / Developer Breakdowns Over Time ───────────────────────── */}
        <div className="rounded-xl p-5" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border-soft)" }}>
          <div className="flex items-center justify-between gap-3 mb-3">
            <SectionHeader icon="📊" title="Breakdowns Over Time" />
            <div className="flex items-center gap-1 rounded px-1 py-1" style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border-soft)" }}>
              {[8, 12, 24].map((w) => (
                <button
                  key={w}
                  onClick={() => setBreakdownWindowWeeks(w)}
                  className="px-2.5 py-1 rounded text-xs"
                  style={{
                    background: breakdownWindowWeeks === w ? "var(--color-accent-deep)" : "transparent",
                    color: breakdownWindowWeeks === w ? "var(--color-accent)" : "var(--color-text-muted)",
                  }}
                >
                  {w}w
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              { key: "genres", title: "Genres", icon: "🧩", data: breakdowns.genres },
              { key: "tags", title: "Tags", icon: "🏷️", data: breakdowns.tags },
              { key: "engines", title: "Engines", icon: "⚙️", data: breakdowns.engines },
              { key: "developers", title: "Developers", icon: "🛠️", data: breakdowns.developers },
              { key: "collections", title: "Collections", icon: "📚", data: breakdowns.collections },
            ].map((block) => (
              <div key={block.key} className="rounded-lg p-3" style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border-soft)" }}>
                <p className="text-xs font-semibold mb-2" style={{ color: "var(--color-text)" }}>
                  {block.icon} {block.title}
                </p>
                {block.data.entries.length === 0 ? (
                  <p className="text-[11px]" style={{ color: "var(--color-text-dim)" }}>No data in selected range.</p>
                ) : (
                  <div className="space-y-2">
                    {block.data.entries.map((entry) => (
                      <div key={entry.label} className="rounded px-2 py-2" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border-soft)" }}>
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-[11px] truncate" style={{ color: "var(--color-text-muted)" }} title={entry.label}>{entry.label}</span>
                          <span className="text-[10px] font-mono" style={{ color: "var(--color-text-dim)" }}>{formatTime(Math.round(entry.total))}</span>
                        </div>
                        <div className="h-1.5 rounded-full overflow-hidden mb-1" style={{ background: "var(--color-bg-deep)" }}>
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.max(4, Math.round((entry.total / block.data.maxTotal) * 100))}%`,
                              background: "var(--color-accent)",
                            }}
                          />
                        </div>
                        <Sparkline data={entry.series.map((x) => Math.round(x))} height={26} color="var(--color-accent-soft)" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ── Goals ──────────────────────────────────────────────────────── */}
        <div className="rounded-xl p-5" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border-soft)" }}>
          <div className="flex items-center justify-between gap-3 mb-3">
            <SectionHeader icon="🎯" title={t('stats_view.goals')} />
            <button
              onClick={() => {
                setEditingGoal(null);
                setGoalForm({ name: '', period: 'weekly', metric: 'playtime', target: 3600, scope: { type: 'all' } });
                setGoalEditorOpen(true);
              }}
              className="px-3 py-1 rounded text-xs font-semibold transition-all hover:scale-105"
              style={{ background: "var(--color-accent-deep)", color: "var(--color-accent)", border: "1px solid var(--color-accent)" }}
            >
              + {t('stats_view.goal_add')}
            </button>
          </div>

          {goalEditorOpen && (
            <div className="mb-4 rounded-lg p-4 space-y-3" style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border)" }}>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: "var(--color-text-muted)" }}>{t('stats_view.goal_name')}</label>
                  <input
                    type="text"
                    className="raw-input"
                    value={goalForm.name}
                    onInput={(e) => setGoalForm(f => ({ ...f, name: (e.target as HTMLInputElement).value }))}
                    placeholder="e.g. Weekly RPG grind"
                    style={{ background: "var(--color-bg-deep)", border: "1px solid var(--color-border)", borderRadius: "6px", padding: "6px 10px", color: "var(--color-text)", fontSize: "13px" }}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: "var(--color-text-muted)" }}>{t('stats_view.goal_period')}</label>
                  <select
                    value={goalForm.period}
                    onChange={(e) => setGoalForm(f => ({ ...f, period: (e.target as HTMLSelectElement).value as 'weekly' | 'monthly' }))}
                  >
                    <option value="weekly">{t('stats_view.goal_weekly')}</option>
                    <option value="monthly">{t('stats_view.goal_monthly')}</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: "var(--color-text-muted)" }}>{t('stats_view.goal_metric')}</label>
                  <select
                    value={goalForm.metric}
                    onChange={(e) => setGoalForm(f => ({ ...f, metric: (e.target as HTMLSelectElement).value as 'playtime' | 'completion' }))}
                  >
                    <option value="playtime">{t('stats_view.goal_playtime')}</option>
                    <option value="completion">{t('stats_view.goal_completion')}</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: "var(--color-text-muted)" }}>{t('stats_view.goal_scope')}</label>
                  <select
                    value={goalForm.scope.type}
                    onChange={(e) => {
                      const type = (e.target as HTMLSelectElement).value as PlayGoal['scope']['type'];
                      setGoalForm(f => ({ ...f, scope: { type, value: type === 'all' ? undefined : '' } }));
                    }}
                  >
                    <option value="all">{t('stats_view.goal_scope_all')}</option>
                    <option value="game">{t('stats_view.goal_scope_game')}</option>
                    <option value="collection">{t('stats_view.goal_scope_collection')}</option>
                    <option value="tag">{t('stats_view.goal_scope_tag')}</option>
                    <option value="developer">{t('stats_view.goal_scope_developer')}</option>
                    <option value="source">{t('stats_view.goal_scope_source')}</option>
                  </select>
                </div>
              </div>

              {/* Scope value selector */}
              {goalForm.scope.type !== 'all' && (
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: "var(--color-text-muted)" }}>
                    {goalForm.scope.type === 'game' ? t('stats_view.goal_scope_game') :
                     goalForm.scope.type === 'collection' ? t('stats_view.goal_scope_collection') :
                     goalForm.scope.type === 'tag' ? t('stats_view.goal_scope_tag') :
                     goalForm.scope.type === 'developer' ? t('stats_view.goal_scope_developer') :
                     t('stats_view.goal_scope_source')}
                  </label>
                  <select
                    value={goalForm.scope.value || ''}
                    onChange={(e) => setGoalForm(f => ({ ...f, scope: { ...f.scope, value: (e.target as HTMLSelectElement).value } }))}
                  >
                    <option value="" disabled>Select...</option>
                    {goalForm.scope.type === 'game' && scopeOptions.games.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                    {goalForm.scope.type === 'collection' && scopeOptions.collections.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                    {goalForm.scope.type === 'tag' && scopeOptions.tags.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                    {goalForm.scope.type === 'developer' && scopeOptions.developers.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                    {goalForm.scope.type === 'source' && scopeOptions.sources.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: "var(--color-text-muted)" }}>
                  {goalForm.metric === 'playtime' ? t('stats_view.goal_target_seconds') : t('stats_view.goal_target')} ({goalForm.metric === 'playtime' ? formatTime(goalForm.target) : `${goalForm.target}`})
                </label>
                <input
                  type="range"
                  min={goalForm.metric === 'playtime' ? 600 : 1}
                  max={goalForm.metric === 'playtime' ? 86400 * 7 : 100}
                  step={goalForm.metric === 'playtime' ? 600 : 1}
                  value={goalForm.target}
                  onInput={(e) => setGoalForm(f => ({ ...f, target: Number((e.target as HTMLInputElement).value) }))}
                  style={{ width: '100%' }}
                />
                <div className="flex justify-between text-[10px]" style={{ color: "var(--color-text-dim)" }}>
                  <span>{goalForm.metric === 'playtime' ? '10 min' : '1'}</span>
                  <span>
                    {goalForm.metric === 'playtime'
                      ? `${Math.floor(goalForm.target / 3600)}h ${Math.floor((goalForm.target % 3600) / 60)}m`
                      : `${goalForm.target} games`}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  onClick={() => { setGoalEditorOpen(false); setEditingGoal(null); }}
                  className="px-3 py-1.5 rounded text-xs"
                  style={{ background: "var(--color-panel-3)", color: "var(--color-text-muted)" }}
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={() => {
                    if (!goalForm.name.trim()) return;
                    if (goalForm.scope.type !== 'all' && !goalForm.scope.value) return;
                    if (editingGoal) {
                      persistGoals(goals.map(g => g.id === editingGoal.id ? { ...g, ...goalForm, id: g.id, createdAt: g.createdAt } : g));
                    } else {
                      const newGoal: PlayGoal = {
                        ...goalForm,
                        id: `goal-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                        createdAt: Date.now(),
                      };
                      persistGoals([...goals, newGoal]);
                    }
                    setGoalEditorOpen(false);
                    setEditingGoal(null);
                  }}
                  className="px-3 py-1.5 rounded text-xs font-semibold"
                  style={{ background: "var(--color-accent-deep)", color: "var(--color-accent)", border: "1px solid var(--color-accent)" }}
                >
                  {editingGoal ? t('stats_view.goal_edit_title') : t('stats_view.goal_save')}
                </button>
              </div>
            </div>
          )}

          {goalProgresses.length === 0 ? (
            <div className="flex flex-col items-center py-10 gap-2" style={{ color: "var(--color-text-muted)" }}>
              <span className="text-2xl">🎯</span>
              <p className="text-sm">{t('stats_view.goal_no_goals')}</p>
              <p className="text-[11px]" style={{ color: "var(--color-text-dim)" }}>{t('stats_view.goal_no_goals_hint')}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {goalProgresses.map(({ goal, progress }) => {
                const isCompleted = progress.percent >= 100;
                const scopeLabel = goal.scope.type === 'all' ? t('stats_view.goal_scope_all') :
                  goal.scope.type === 'game' ? (() => {
                    const g = games.find(gg => gg.path === goal.scope.value);
                    return g ? (customizations[g.path]?.displayName || metadata[g.path]?.title || g.name) : goal.scope.value || '';
                  })() :
                  goal.scope.type === 'collection' ? (collections.find(c => c.id === goal.scope.value)?.name || goal.scope.value || '') :
                  goal.scope.type === 'source' ? (goal.scope.value ? goal.scope.value.charAt(0).toUpperCase() + goal.scope.value.slice(1) : '') :
                  goal.scope.value || '';

                const metricIcon = goal.metric === 'playtime' ? '🕐' : '✓';
                const periodLabel = goal.period === 'weekly' ? t('stats_view.goal_weekly') : t('stats_view.goal_monthly');

                return (
                  <div
                    key={goal.id}
                    className="rounded-lg p-3 relative group"
                    style={{
                      background: isCompleted ? 'var(--color-success-bg)' : 'var(--color-panel-2)',
                      border: `1px solid ${isCompleted ? 'var(--color-success-border)' : 'var(--color-border-soft)'}`,
                    }}
                  >
                    {/* Edit/Delete buttons */}
                    <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => {
                          setEditingGoal(goal);
                          setGoalForm({
                            name: goal.name,
                            period: goal.period,
                            metric: goal.metric,
                            target: goal.target,
                            scope: { ...goal.scope },
                          });
                          setGoalEditorOpen(true);
                        }}
                        className="w-6 h-6 flex items-center justify-center rounded text-[10px]"
                        style={{ background: "var(--color-panel-3)", color: "var(--color-text-muted)" }}
                        title={t('stats_view.goal_edit')}
                      >
                        ✏️
                      </button>
                      <button
                        onClick={() => setShowGoalDeleteConfirm(goal.id)}
                        className="w-6 h-6 flex items-center justify-center rounded text-[10px]"
                        style={{ background: "var(--color-danger-bg)", color: "var(--color-danger)" }}
                        title={t('stats_view.goal_delete')}
                      >
                        🗑️
                      </button>
                    </div>

                    {showGoalDeleteConfirm === goal.id && (
                      <div className="absolute top-2 right-12 flex items-center gap-1.5 z-10">
                        <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>{t('stats_view.goal_delete_confirm')}</span>
                        <button
                          onClick={() => {
                            persistGoals(goals.filter(g => g.id !== goal.id));
                            setShowGoalDeleteConfirm(null);
                          }}
                          className="px-2 py-0.5 rounded text-[10px] font-semibold"
                          style={{ background: "var(--color-danger-bg)", color: "var(--color-danger)", border: "1px solid var(--color-danger)" }}
                        >
                          {t('common.yes')}
                        </button>
                        <button
                          onClick={() => setShowGoalDeleteConfirm(null)}
                          className="px-2 py-0.5 rounded text-[10px]"
                          style={{ background: "var(--color-panel-3)", color: "var(--color-text-muted)" }}
                        >
                          {t('common.no')}
                        </button>
                      </div>
                    )}

                    {/* Goal info */}
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-base">{metricIcon}</span>
                      <div className="flex flex-col gap-0">
                        <span className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>{goal.name}</span>
                        <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                          {periodLabel} {t('stats_view.goal_within')} {scopeLabel}
                        </span>
                      </div>
                    </div>

                    {/* Progress bar */}
                    <div className="flex items-center gap-3">
                      <div className="flex-1">
                        <div className="h-2.5 rounded-full overflow-hidden" style={{ background: "var(--color-bg-deep)" }}>
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{
                              width: `${Math.max(2, progress.percent)}%`,
                              background: isCompleted
                                ? 'linear-gradient(90deg, var(--color-success), var(--color-accent))'
                                : progress.percent > 60
                                  ? 'linear-gradient(90deg, var(--color-accent-dark), var(--color-accent))'
                                  : 'var(--color-accent-muted)',
                            }}
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {isCompleted && <span className="text-xs">🎉</span>}
                        <span
                          className="text-xs font-bold font-mono"
                          style={{
                            color: isCompleted ? 'var(--color-success)' :
                              progress.percent > 60 ? 'var(--color-accent)' : 'var(--color-text-muted)',
                          }}
                        >
                          {progress.percent}%
                        </span>
                        <span className="text-[10px]" style={{ color: "var(--color-text-dim)" }}>
                          {goal.metric === 'playtime'
                            ? `${formatTime(progress.current)} / ${formatTime(progress.target)}`
                            : `${progress.current} / ${progress.target} ${t('stats_view.goal_games')}`}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Empty State ─────────────────────────────────────────────────── */}
        {games.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 gap-4" style={{ color: "var(--color-text-muted)" }}>
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.3 }}>
              <path d="M12 20V10" /><path d="M18 20V4" /><path d="M6 20v-4" />
            </svg>
            <p className="text-base">{t('stats_view.no_stats_yet')}</p>
          </div>
        )}
      </div>

      {showYearInReview && (
        <YearInReviewModal
          year={new Date().getFullYear()}
          sessions={sessions}
          games={games}
          metadata={metadata}
          customizations={customizations}
          onClose={() => setShowYearInReview(false)}
        />
      )}
    </div>
  );
}
