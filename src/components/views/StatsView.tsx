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
  const hours = Math.floor(totalPlaytimeSecs / 3600);
  const mins = Math.floor((totalPlaytimeSecs % 3600) / 60);

  const longestSession = sessions.length
    ? sessions.reduce((max, s) => (s.duration > max.duration ? s : max), sessions[0])
    : null;
  const lsGame = longestSession
    ? customizations[longestSession.path]?.displayName ||
      metadata[longestSession.path]?.title ||
      games.find((g) => g.path === longestSession.path)?.name ||
      "Unknown"
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
        "Unknown";
    }
  }

  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
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
    <div className="flex-1 overflow-y-auto px-10 py-8" style={{ background: "linear-gradient(to bottom, #1b2838 0%, #17212e 100%)", color: "#c6d4df" }}>
      <h2 className="text-2xl font-bold mb-8 tracking-wide" style={{ color: "#fff" }}>
        LIBRALY STATS
      </h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="p-6 rounded-lg shadow-sm" style={{ background: "#2a3f54", border: "1px solid #3d5a73" }}>
          <h3 className="text-xs uppercase tracking-widest mb-2" style={{ color: "#8f98a0" }}>
            Total Library Time
          </h3>
          <p className="text-3xl font-bold" style={{ color: "#66c0f4" }}>
            {hours}h {mins}m
          </p>
        </div>
        <div className="p-6 rounded-lg shadow-sm" style={{ background: "#2a3f54", border: "1px solid #3d5a73" }}>
          <h3 className="text-xs uppercase tracking-widest mb-2" style={{ color: "#8f98a0" }}>
            Longest Session
          </h3>
          <p className="text-xl font-bold mb-1" style={{ color: "#c8a951" }}>
            {lsHrs}h {lsMins}m
          </p>
          <p className="text-xs truncate text-ellipsis overflow-hidden" style={{ color: "#8f98a0" }}>
            {lsGame}
          </p>
        </div>
        <div className="p-6 rounded-lg shadow-sm" style={{ background: "#2a3f54", border: "1px solid #3d5a73" }}>
          <h3 className="text-xs uppercase tracking-widest mb-2" style={{ color: "#8f98a0" }}>
            Most Played Game
          </h3>
          <p className="text-xl font-bold mb-1" style={{ color: "#e57373" }}>
            {maxLaunches} launches
          </p>
          <p className="text-xs truncate text-ellipsis overflow-hidden" style={{ color: "#8f98a0" }}>
            {mostLaunchedGame}
          </p>
        </div>
        <div className="p-6 rounded-lg shadow-sm" style={{ background: "#2a3f54", border: "1px solid #3d5a73" }}>
          <h3 className="text-xs uppercase tracking-widest mb-2" style={{ color: "#8f98a0" }}>
            Busiest Day
          </h3>
          <p className="text-2xl font-bold" style={{ color: "#6dbf6d" }}>
            {busiestDay}
          </p>
        </div>
      </div>
    </div>
  );
}
