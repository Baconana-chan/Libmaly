import { useMemo } from "preact/hooks";
import { useTranslation } from "react-i18next";
import { formatTime } from "../../lib/helpers";
import { RATING_CATEGORIES } from "../../lib/constants";

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
}

interface GameMetadataLike {
  source?: string;
  title?: string;
  developer?: string;
  circle?: string;
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
  const label = t(`stats_view.${statusKey}`) || status;
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
    <div className="flex flex-col items-center gap-0.5">
      <div className="w-4 h-16 rounded-full overflow-hidden flex items-end" style={{ background: "var(--color-bg-deep)" }}>
        <div className="w-full rounded-full transition-all" style={{ height: `${pct}%`, background: pct > 60 ? "var(--color-warning)" : pct > 30 ? "var(--color-accent)" : "var(--color-accent-deep)" }} />
      </div>
      {showLabel && <span className="text-[8px]" style={{ color: "var(--color-text-dim)" }}>{label}</span>}
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
function HeatmapCell({ value, max }: { value: number; max: number }) {
  const intensity = max > 0 ? value / max : 0;
  const bg = intensity === 0 ? "var(--color-bg-deep)" :
    intensity < 0.25 ? "var(--color-accent-deep)" :
      intensity < 0.5 ? "var(--color-accent-muted)" :
        intensity < 0.75 ? "var(--color-accent-soft)" : "var(--color-accent)";
  return <div className="w-3.5 h-3.5 rounded-sm" style={{ background: bg }} />;
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

  // Activity heatmap (last 90 days)
  const heatmapData = useMemo(() => {
    const days: Record<string, number> = {};
    for (const s of sessions) {
      const d = new Date(s.startedAt);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      days[key] = (days[key] || 0) + s.duration;
    }
    const result: number[][] = [];
    const now = new Date();
    for (let week = 51; week >= 0; week--) {
      const weekData: number[] = [];
      for (let day = 0; day < 7; day++) {
        const d = new Date(now);
        d.setDate(d.getDate() - (week * 7 + (6 - day)));
        const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
        weekData.push(days[key] || 0);
      }
      result.push(weekData);
    }
    return result;
  }, [sessions]);
  const maxHeatValue = Math.max(1, ...heatmapData.flat());

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

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex-1 overflow-y-auto px-6 py-6" style={{ scrollbarWidth: "thin", scrollbarColor: "var(--color-border) transparent" }}>
      <div className="max-w-5xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20V10" /><path d="M18 20V4" /><path d="M6 20v-4" />
          </svg>
          <h2 className="text-lg font-bold" style={{ color: "var(--color-white)" }}>{t('stats_view.title')}</h2>
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
        {heatmapData.some(w => w.some(d => d > 0)) && (
          <div className="rounded-xl p-5" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border-soft)" }}>
            <SectionHeader icon="🗓️" title={t('stats_view.activity_heatmap')} />
            <div className="flex gap-0.5 overflow-x-auto pb-2">
              {heatmapData.map((week, wi) => (
                <div key={wi} className="flex flex-col gap-0.5">
                  {week.map((day, di) => (
                    <HeatmapCell key={di} value={day} max={maxHeatValue} />
                  ))}
                </div>
              ))}
            </div>
            <div className="flex items-center gap-1 mt-2 justify-end">
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
          <div className="rounded-xl p-5" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border-soft)" }}>
            <SectionHeader icon="🔥" title={t('stats_view.current_streak')} />
            <div className="flex items-end gap-3">
              <span className="text-4xl font-black" style={{ color: streak > 0 ? "var(--color-warning)" : "var(--color-text-dim)" }}>
                {streak}
              </span>
              <span className="text-sm mb-1" style={{ color: "var(--color-text-muted)" }}>
                {streak === 1 ? t('stats_view.day') : t('stats_view.days_unit')} {t('stats_view.in_a_row')}
              </span>
            </div>
            {streak === 0 && sessions.length > 0 && (
              <p className="text-[11px] mt-2" style={{ color: "var(--color-text-dim)" }}>{t('stats_view.play_today_streak')}</p>
            )}
          </div>

          {/* Favorite Time of Day */}
          <div className="rounded-xl p-5" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border-soft)" }}>
            <SectionHeader icon="🌙" title={t('stats_view.favorite_gaming_time')} />
            <div className="flex items-end gap-3">
              <span className="text-2xl font-bold" style={{ color: "var(--color-accent)" }}>
                {favoriteTimeLabel}
              </span>
              <span className="text-sm mb-1" style={{ color: "var(--color-text-muted)" }}>
                ({favoriteHour.toString().padStart(2, "0")}:00 {t('stats_view.peak')})
              </span>
            </div>
            <div className="flex gap-1 mt-3">
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
    </div>
  );
}
