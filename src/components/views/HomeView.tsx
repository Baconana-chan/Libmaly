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
            <div className="w-full rounded-t" style={{ height: `${h}%`, background: "linear-gradient(180deg,var(--color-accent),var(--color-accent-dark))" }} title={`${labels[i]}: ${formatTime(v)}`} />
            <span className="text-[9px]" style={{ color: "var(--color-text-dim)" }}>{labels[i]}</span>
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
    <div className="flex-1 overflow-y-auto px-8 py-6" style={{ scrollbarWidth: "thin", scrollbarColor: "var(--color-border) transparent" }}>
      <div className="flex items-center gap-6 mb-8 pb-5 border-b" style={{ borderColor: "var(--color-border-card)" }}>
        <div>
          <p className="text-3xl font-bold" style={{ color: "var(--color-text)" }}>{games.length}</p>
          <p className="text-xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>Games in library</p>
        </div>
        <div style={{ width: "1px", height: "36px", background: "var(--color-panel-3)" }} />
        <div>
          <p className="text-3xl font-bold" style={{ color: "var(--color-text)" }}>{Object.keys(stats).filter((k) => stats[k].totalTime > 0).length}</p>
          <p className="text-xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>Played</p>
        </div>
        <div style={{ width: "1px", height: "36px", background: "var(--color-panel-3)" }} />
        <div>
          <p className="text-3xl font-bold" style={{ color: "var(--color-text)" }}>{formatTime(totalPlaytimeSecs)}</p>
          <p className="text-xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>Total playtime</p>
        </div>
        <div style={{ width: "1px", height: "36px", background: "var(--color-panel-3)" }} />
        <div>
          <p className="text-3xl font-bold" style={{ color: "var(--color-text)" }}>{Object.keys(favGames).length}</p>
          <p className="text-xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>Favourites</p>
        </div>
        <div style={{ width: "1px", height: "36px", background: "var(--color-panel-3)" }} />
        <div>
          <p className="text-3xl font-bold" style={{ color: "var(--color-text)" }}>{Object.keys(notes).filter((k) => notes[k].trim()).length}</p>
          <p className="text-xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>With notes</p>
        </div>
      </div>

      <section>
        <h2 className="text-xs uppercase tracking-widest mb-4" style={{ color: "var(--color-text-muted)" }}>
          Recent Games
          <span className="ml-2 font-normal normal-case" style={{ color: "var(--color-text-dim)" }}>
            — played in the last 60 days
          </span>
        </h2>

        {recent.length === 0 ? (
          <div className="rounded-lg px-6 py-12 text-center" style={{ background: "var(--color-bg-elev)", border: "2px dashed var(--color-panel-3)" }}>
            <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>No games played recently.</p>
            <p className="text-xs mt-1" style={{ color: "var(--color-text-dim)" }}>Launch a game to see it here.</p>
          </div>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
            {recent.map((game) => {
              const st = stats[game.path] ?? { totalTime: 0, lastPlayed: 0 };
              const cover = coverSrc(game);
              const name = displayName(game);
              const isFav = !!favGames[game.path];
              return (
                <div key={game.path} className="rounded-lg overflow-hidden flex flex-col" style={{ background: "var(--color-bg-elev)", border: "1px solid var(--color-border-soft)" }}>
                  <div className="relative flex-shrink-0 overflow-hidden cursor-pointer" style={{ height: "110px" }} onClick={() => onSelect(game)}>
                    {cover ? <img src={cover} alt="" className="w-full h-full object-cover" style={{ filter: "brightness(0.65)" }} /> : <div className="w-full h-full" style={{ background: heroGradient(game.name) }} />}
                    <div className="absolute inset-0" style={{ background: "linear-gradient(to top,rgba(22,32,45,0.9) 0%,transparent 60%)" }} />
                    <div className="absolute bottom-0 left-0 px-3 pb-2 pr-2 right-0 flex items-end justify-between">
                      <p className="font-semibold text-sm line-clamp-2 flex-1 mr-2" style={{ color: "var(--color-white)", textShadow: "0 1px 4px rgba(0,0,0,0.9)" }}>
                        {isFav && <span style={{ color: "var(--color-warning)", marginRight: "3px" }}>★</span>}
                        {name}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                        {timeAgo(st.lastPlayed)} · {st.totalTime > 0 ? formatTime(st.totalTime) : "—"}
                      </p>
                    </div>
                    <button
                      onClick={() => onSelect(game)}
                      className="px-2.5 py-1 rounded text-xs flex-shrink-0"
                      style={{ background: "var(--color-panel-3)", color: "var(--color-text-muted)", border: "1px solid var(--color-border-strong)" }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = "var(--color-accent-deep)";
                        e.currentTarget.style.color = "var(--color-accent)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "var(--color-panel-3)";
                        e.currentTarget.style.color = "var(--color-text-muted)";
                      }}
                    >
                      View
                    </button>
                    <button
                      onClick={() => (runningGamePath === game.path ? onStop() : onPlay(game.path))}
                      className="px-2.5 py-1 rounded text-xs flex-shrink-0 flex items-center gap-1"
                      style={{ background: runningGamePath === game.path ? "var(--color-stop-bg)" : "var(--color-play-bg)", color: runningGamePath === game.path ? "var(--color-danger-soft)" : "var(--color-play-text)" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = runningGamePath === game.path ? "var(--color-stop-hover)" : "var(--color-play-hover)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = runningGamePath === game.path ? "var(--color-stop-bg)" : "var(--color-play-bg)")}
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
          <h2 className="text-xs uppercase tracking-widest mb-4" style={{ color: "var(--color-text-muted)" }}>Most Played This Week</h2>
          <div className="rounded-xl p-4 space-y-3" style={{ background: "var(--color-bg-elev)", border: "1px solid var(--color-border-soft)" }}>
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
                      <p className="text-xs truncate font-medium" style={{ color: "var(--color-text)" }}>{name}</p>
                      <span className="text-[10px] ml-2 flex-shrink-0" style={{ color: "var(--color-accent)" }}>{formatTime(secs)}</span>
                    </div>
                    <div className="h-1 rounded-full" style={{ background: "var(--color-panel-low)" }}>
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${(secs / maxSecs) * 100}%`,
                          background: "linear-gradient(90deg, var(--color-accent-dark), var(--color-accent))",
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
          <h2 className="text-xs uppercase tracking-widest mb-4" style={{ color: "var(--color-text-muted)" }}>Library Activity — Last 7 Days</h2>
          <div className="rounded-xl p-4" style={{ background: "var(--color-bg-elev)", border: "1px solid var(--color-border-soft)" }}>
            <PlayChart sessions={sessions} gamePath={null} days={7} />
          </div>
        </section>
      )}
    </div>
  );
}

