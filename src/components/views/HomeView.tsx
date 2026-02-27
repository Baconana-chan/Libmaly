import { useMemo } from "preact/hooks";

interface GameLike {
  name: string;
  path: string;
}

interface GameStatsLike {
  totalTime: number;
  lastPlayed: number;
}

interface SessionEntryLike {
  path: string;
  startedAt: number;
  duration: number;
}

interface GameMetadataLike {
  title?: string;
  cover_url?: string;
}

interface GameCustomizationLike {
  displayName?: string;
  coverUrl?: string;
}

function formatTime(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
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

function PlayChart({ sessions, gamePath, days = 7 }: { sessions: SessionEntryLike[]; gamePath: string | null; days?: number }) {
  const labels = Array.from({ length: days }).map((_, i) => {
    const d = new Date(Date.now() - (days - 1 - i) * 86400000);
    return d.toLocaleDateString(undefined, { weekday: "short" });
  });
  const values = Array(days).fill(0);
  const now = Date.now();
  sessions.forEach((s) => {
    if (gamePath && s.path !== gamePath) return;
    const diff = Math.floor((now - s.startedAt) / 86400000);
    if (diff < 0 || diff >= days) return;
    const idx = days - 1 - diff;
    values[idx] += s.duration;
  });
  const max = Math.max(...values, 1);
  return (
    <div className="flex items-end gap-1.5 h-28 mt-1">
      {values.map((v, i) => {
        const h = Math.max(4, Math.round((v / max) * 100));
        return (
          <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1">
            <div className="w-full rounded-t" style={{ height: `${h}%`, background: "linear-gradient(180deg,#66c0f4,#2a6db5)" }} title={`${labels[i]}: ${formatTime(v)}`} />
            <span className="text-[9px]" style={{ color: "#4a5568" }}>{labels[i]}</span>
          </div>
        );
      })}
    </div>
  );
}

export function HomeView({
  games,
  stats,
  sessions,
  metadata,
  customizations,
  favGames,
  notes,
  runningGamePath,
  totalPlaytimeSecs,
  onSelect,
  onPlay,
  onStop,
}: {
  games: GameLike[];
  stats: Record<string, GameStatsLike>;
  sessions: SessionEntryLike[];
  metadata: Record<string, GameMetadataLike>;
  customizations: Record<string, GameCustomizationLike>;
  favGames: Record<string, boolean>;
  notes: Record<string, string>;
  runningGamePath: string | null;
  totalPlaytimeSecs: number;
  onSelect: (g: GameLike) => void;
  onPlay: (path: string) => void;
  onStop: () => void;
}) {
  const cutoff = Date.now() - 60 * 24 * 60 * 60 * 1000;

  const recent = useMemo(
    () =>
      games
        .filter((g) => (stats[g.path]?.lastPlayed ?? 0) > cutoff)
        .sort((a, b) => (stats[b.path]?.lastPlayed ?? 0) - (stats[a.path]?.lastPlayed ?? 0))
        .slice(0, 20),
    [games, stats, cutoff],
  );

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
      .map(([path, secs]) => ({ game: games.find((g) => g.path === path), secs, path }))
      .filter((e): e is { game: GameLike; secs: number; path: string } => !!e.game);
  }, [sessions, games, weekAgo]);

  const displayName = (g: GameLike) => customizations[g.path]?.displayName ?? metadata[g.path]?.title ?? g.name;
  const coverSrc = (g: GameLike) => customizations[g.path]?.coverUrl ?? metadata[g.path]?.cover_url;

  return (
    <div className="flex-1 overflow-y-auto px-8 py-6" style={{ scrollbarWidth: "thin", scrollbarColor: "#2a475e transparent" }}>
      <div className="flex items-center gap-6 mb-8 pb-5 border-b" style={{ borderColor: "#1b3a50" }}>
        <div>
          <p className="text-3xl font-bold" style={{ color: "#fff" }}>{games.length}</p>
          <p className="text-xs mt-0.5" style={{ color: "#8f98a0" }}>Games in library</p>
        </div>
        <div style={{ width: "1px", height: "36px", background: "#2a3f54" }} />
        <div>
          <p className="text-3xl font-bold" style={{ color: "#fff" }}>{Object.keys(stats).filter((k) => stats[k].totalTime > 0).length}</p>
          <p className="text-xs mt-0.5" style={{ color: "#8f98a0" }}>Played</p>
        </div>
        <div style={{ width: "1px", height: "36px", background: "#2a3f54" }} />
        <div>
          <p className="text-3xl font-bold" style={{ color: "#fff" }}>{formatTime(totalPlaytimeSecs)}</p>
          <p className="text-xs mt-0.5" style={{ color: "#8f98a0" }}>Total playtime</p>
        </div>
        <div style={{ width: "1px", height: "36px", background: "#2a3f54" }} />
        <div>
          <p className="text-3xl font-bold" style={{ color: "#fff" }}>{Object.keys(favGames).length}</p>
          <p className="text-xs mt-0.5" style={{ color: "#8f98a0" }}>Favourites</p>
        </div>
        <div style={{ width: "1px", height: "36px", background: "#2a3f54" }} />
        <div>
          <p className="text-3xl font-bold" style={{ color: "#fff" }}>{Object.keys(notes).filter((k) => notes[k].trim()).length}</p>
          <p className="text-xs mt-0.5" style={{ color: "#8f98a0" }}>With notes</p>
        </div>
      </div>

      <section>
        <h2 className="text-xs uppercase tracking-widest mb-4" style={{ color: "#8f98a0" }}>
          Recent Games
          <span className="ml-2 font-normal normal-case" style={{ color: "#4a5568" }}>
            — played in the last 60 days
          </span>
        </h2>

        {recent.length === 0 ? (
          <div className="rounded-lg px-6 py-12 text-center" style={{ background: "#16202d", border: "2px dashed #2a3f54" }}>
            <p className="text-sm" style={{ color: "#8f98a0" }}>No games played recently.</p>
            <p className="text-xs mt-1" style={{ color: "#4a5568" }}>Launch a game to see it here.</p>
          </div>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
            {recent.map((game) => {
              const st = stats[game.path] ?? { totalTime: 0, lastPlayed: 0 };
              const cover = coverSrc(game);
              const name = displayName(game);
              const isFav = !!favGames[game.path];
              return (
                <div key={game.path} className="rounded-lg overflow-hidden flex flex-col" style={{ background: "#16202d", border: "1px solid #1e3a50" }}>
                  <div className="relative flex-shrink-0 overflow-hidden cursor-pointer" style={{ height: "110px" }} onClick={() => onSelect(game)}>
                    {cover ? <img src={cover} alt="" className="w-full h-full object-cover" style={{ filter: "brightness(0.65)" }} /> : <div className="w-full h-full" style={{ background: heroGradient(game.name) }} />}
                    <div className="absolute inset-0" style={{ background: "linear-gradient(to top,rgba(22,32,45,0.9) 0%,transparent 60%)" }} />
                    <div className="absolute bottom-0 left-0 px-3 pb-2 pr-2 right-0 flex items-end justify-between">
                      <p className="font-semibold text-sm line-clamp-2 flex-1 mr-2" style={{ color: "#fff", textShadow: "0 1px 4px rgba(0,0,0,0.9)" }}>
                        {isFav && <span style={{ color: "#c8a951", marginRight: "3px" }}>★</span>}
                        {name}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px]" style={{ color: "#8f98a0" }}>
                        {timeAgo(st.lastPlayed)} · {st.totalTime > 0 ? formatTime(st.totalTime) : "—"}
                      </p>
                    </div>
                    <button
                      onClick={() => onSelect(game)}
                      className="px-2.5 py-1 rounded text-xs flex-shrink-0"
                      style={{ background: "#2a3f54", color: "#8f98a0", border: "1px solid #3d5a73" }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = "#1e4060";
                        e.currentTarget.style.color = "#66c0f4";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "#2a3f54";
                        e.currentTarget.style.color = "#8f98a0";
                      }}
                    >
                      View
                    </button>
                    <button
                      onClick={() => (runningGamePath === game.path ? onStop() : onPlay(game.path))}
                      className="px-2.5 py-1 rounded text-xs flex-shrink-0 flex items-center gap-1"
                      style={{ background: runningGamePath === game.path ? "#6b2222" : "#4c6b22", color: runningGamePath === game.path ? "#e88585" : "#d2e885" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = runningGamePath === game.path ? "#8a1e1e" : "#5c8a1e")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = runningGamePath === game.path ? "#6b2222" : "#4c6b22")}
                    >
                      {runningGamePath === game.path ? (
                        <>
                          <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" /></svg>
                          Stop
                        </>
                      ) : (
                        <>
                          <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                          Play
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {mostPlayedThisWeek.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xs uppercase tracking-widest mb-4" style={{ color: "#8f98a0" }}>Most Played This Week</h2>
          <div className="rounded-xl p-4 space-y-3" style={{ background: "#16202d", border: "1px solid #1e3a50" }}>
            {mostPlayedThisWeek.map(({ game, secs, path }) => {
              const maxSecs = mostPlayedThisWeek[0].secs;
              const cover = coverSrc(game);
              const name = displayName(game);
              return (
                <div key={path} className="flex items-center gap-3 cursor-pointer" onClick={() => onSelect(game)}>
                  <div className="w-8 h-8 rounded overflow-hidden flex-shrink-0" style={{ background: heroGradient(game.name) }}>
                    {cover && <img src={cover} alt="" className="w-full h-full object-cover" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <p className="text-xs truncate font-medium" style={{ color: "#c6d4df" }}>{name}</p>
                      <span className="text-[10px] ml-2 flex-shrink-0" style={{ color: "#66c0f4" }}>{formatTime(secs)}</span>
                    </div>
                    <div className="h-1 rounded-full" style={{ background: "#1a2d3d" }}>
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${(secs / maxSecs) * 100}%`,
                          background: "linear-gradient(90deg, #2a6db5, #66c0f4)",
                          transition: "width 0.4s",
                        }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {sessions.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xs uppercase tracking-widest mb-4" style={{ color: "#8f98a0" }}>Library Activity — Last 7 Days</h2>
          <div className="rounded-xl p-4" style={{ background: "#16202d", border: "1px solid #1e3a50" }}>
            <PlayChart sessions={sessions} gamePath={null} days={7} />
          </div>
        </section>
      )}
    </div>
  );
}
