import { useTranslation } from "react-i18next";

interface GameLike {
  name: string;
  path: string;
}

interface GameStatsLike {
  totalTime: number;
  launchCount: number;
}

interface SessionEntryLike {
  path: string;
  duration: number;
  startedAt: number;
}

interface GameCustomizationLike {
  displayName?: string;
}

interface GameMetadataLike {
  title?: string;
}

export function StatsView({
  games,
  stats,
  sessions,
  customizations,
  metadata,
  totalPlaytimeSecs,
}: {
  games: GameLike[];
  stats: Record<string, GameStatsLike>;
  sessions: SessionEntryLike[];
  customizations: Record<string, GameCustomizationLike>;
  metadata: Record<string, GameMetadataLike>;
  totalPlaytimeSecs: number;
}) {
  const { t } = useTranslation();
  const hours = Math.floor(totalPlaytimeSecs / 3600);
  const mins = Math.floor((totalPlaytimeSecs % 3600) / 60);

  const longestSession = sessions.length
    ? sessions.reduce((max, s) => (s.duration > max.duration ? s : max), sessions[0])
    : null;
  const lsGame = longestSession
    ? customizations[longestSession.path]?.displayName ||
      metadata[longestSession.path]?.title ||
      games.find((g) => g.path === longestSession.path)?.name ||
      t('stats_view.unknown')
    : "-";
  const lsHrs = longestSession ? Math.floor(longestSession.duration / 3600) : 0;
  const lsMins = longestSession ? Math.floor((longestSession.duration % 3600) / 60) : 0;

  let maxLaunches = 0;
  let mostLaunchedGame = "-";
  for (const path of Object.keys(stats)) {
    if ((stats[path].launchCount || 0) > maxLaunches) {
      maxLaunches = stats[path].launchCount;
      mostLaunchedGame =
        customizations[path]?.displayName ||
        metadata[path]?.title ||
        games.find((g) => g.path === path)?.name ||
        t('stats_view.unknown');
    }
  }

  const days = t('stats_view.days', { returnObjects: true }) as string[];
  const dayCounts = [0, 0, 0, 0, 0, 0, 0];
  sessions.forEach((s) => {
    dayCounts[new Date(s.startedAt).getDay()]++;
  });
  let maxDayIdx = 0;
  for (let i = 1; i < 7; i++) {
    if (dayCounts[i] > dayCounts[maxDayIdx]) maxDayIdx = i;
  }
  const busiestDay = dayCounts[maxDayIdx] > 0 ? days[maxDayIdx] : "-";

  return (
    <div className="flex-1 overflow-y-auto px-10 py-8" style={{ background: "linear-gradient(to bottom, var(--color-bg) 0%, var(--color-bg-elev) 100%)", color: "var(--color-text)" }}>
      <h2 className="text-2xl font-bold mb-8 tracking-wide" style={{ color: "var(--color-text)" }}>
        {t('stats_view.title')}
      </h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="p-6 rounded-lg shadow-sm" style={{ background: "var(--color-panel-3)", border: "1px solid var(--color-border-strong)" }}>
          <h3 className="text-xs uppercase tracking-widest mb-2" style={{ color: "var(--color-text-muted)" }}>
            {t('stats_view.total_time')}
          </h3>
          <p className="text-3xl font-bold" style={{ color: "var(--color-accent)" }}>
            {hours}h {mins}m
          </p>
        </div>
        <div className="p-6 rounded-lg shadow-sm" style={{ background: "var(--color-panel-3)", border: "1px solid var(--color-border-strong)" }}>
          <h3 className="text-xs uppercase tracking-widest mb-2" style={{ color: "var(--color-text-muted)" }}>
            {t('stats_view.longest_session')}
          </h3>
          <p className="text-xl font-bold mb-1" style={{ color: "var(--color-warning)" }}>
            {lsHrs}h {lsMins}m
          </p>
          <p className="text-xs truncate text-ellipsis overflow-hidden" style={{ color: "var(--color-text-muted)" }}>
            {lsGame}
          </p>
        </div>
        <div className="p-6 rounded-lg shadow-sm" style={{ background: "var(--color-panel-3)", border: "1px solid var(--color-border-strong)" }}>
          <h3 className="text-xs uppercase tracking-widest mb-2" style={{ color: "var(--color-text-muted)" }}>
            {t('stats_view.most_played')}
          </h3>
          <p className="text-xl font-bold mb-1" style={{ color: "var(--color-danger)" }}>
            {t('stats_view.launches', { count: maxLaunches })}
          </p>
          <p className="text-xs truncate text-ellipsis overflow-hidden" style={{ color: "var(--color-text-muted)" }}>
            {mostLaunchedGame}
          </p>
        </div>
        <div className="p-6 rounded-lg shadow-sm" style={{ background: "var(--color-panel-3)", border: "1px solid var(--color-border-strong)" }}>
          <h3 className="text-xs uppercase tracking-widest mb-2" style={{ color: "var(--color-text-muted)" }}>
            {t('stats_view.busiest_day')}
          </h3>
          <p className="text-2xl font-bold" style={{ color: "var(--color-success)" }}>
            {busiestDay}
          </p>
        </div>
      </div>
    </div>
  );
}
