import { useMemo } from "preact/hooks";
import { formatTime } from "../../lib/helpers";

interface GameLike {
  name: string;
  path: string;
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
  developer?: string;
  circle?: string;
  title?: string;
}

interface YearInReviewModalProps {
  year: number;
  sessions: SessionEntryLike[];
  games: GameLike[];
  metadata: Record<string, GameMetadataLike>;
  customizations: Record<string, GameCustomizationLike>;
  onClose: () => void;
}

// Sparkline component similar to StatsView
function MiniSparkline({ data, width = 280, height = 50, color = "var(--color-warning)" }: { data: number[], width?: number, height?: number, color?: string }) {
  if (data.length < 2) return null;
  const max = Math.max(1, ...data);
  const stepX = width / (data.length - 1);
  const points = data.map((v, i) => `${i * stepX},${height - (v / max) * (height - 8) - 4}`).join(" ");
  const areaPoints = `0,${height} ${points} ${(data.length - 1) * stepX},${height}`;
  
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="yearSparkGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.4" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={areaPoints} fill="url(#yearSparkGrad)" />
      <polyline points={points} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {data.map((v, i) => v > 0 && (
        <circle key={i} cx={i * stepX} cy={height - (v / max) * (height - 8) - 4} r="4" fill={color} stroke="var(--color-panel)" strokeWidth="1.5" />
      ))}
    </svg>
  );
}

export function YearInReviewModal({ year, sessions, games, metadata, customizations, onClose }: YearInReviewModalProps) {
  const { totalTime, topGame, topDev, longestSession, monthlyData, totalSessions } = useMemo(() => {
    let tTime = 0;
    const gameTimes: Record<string, number> = {};
    const devTimes: Record<string, number> = {};
    let lSession: SessionEntryLike | null = null;
    const mData = new Array(12).fill(0);
    let tSessions = 0;

    for (const s of sessions) {
      const d = new Date(s.startedAt);
      if (d.getFullYear() === year) {
        tTime += s.duration;
        gameTimes[s.path] = (gameTimes[s.path] || 0) + s.duration;
        
        const dev = metadata[s.path]?.circle || metadata[s.path]?.developer || "Unknown Developer";
        devTimes[dev] = (devTimes[dev] || 0) + s.duration;

        if (!lSession || s.duration > lSession.duration) {
          lSession = s;
        }

        mData[d.getMonth()] += s.duration;
        tSessions++;
      }
    }

    let tGamePath = "";
    let maxGameTime = 0;
    for (const [p, time] of Object.entries(gameTimes)) {
      if (time > maxGameTime) {
        maxGameTime = time;
        tGamePath = p;
      }
    }
    
    let tDevName = "—";
    let maxDevTime = 0;
    for (const [dev, time] of Object.entries(devTimes)) {
      if (dev !== "Unknown Developer" && time > maxDevTime) {
        maxDevTime = time;
        tDevName = dev;
      }
    }

    const tGameObj = games.find(g => g.path === tGamePath);
    const tGameName = tGameObj ? (customizations[tGamePath]?.displayName || metadata[tGamePath]?.title || tGameObj.name) : "—";
    
    const lGameObj = lSession ? games.find(g => g.path === lSession!.path) : null;
    const lGameName = lGameObj ? (customizations[lSession!.path]?.displayName || metadata[lSession!.path]?.title || lGameObj.name) : "—";

    return {
      totalTime: tTime,
      topGame: { name: tGameName, time: maxGameTime },
      topDev: { name: tDevName, time: maxDevTime },
      longestSession: { game: lGameName, duration: lSession?.duration || 0 },
      monthlyData: mData,
      totalSessions: tSessions,
    };
  }, [year, sessions, games, metadata, customizations]);

  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(4px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="rounded-2xl shadow-2xl w-[600px] flex flex-col overflow-hidden relative"
        style={{
          background: "var(--color-panel)",
          border: "1px solid var(--color-warning-muted)",
        }}
      >
        {/* Header Graphic */}
        <div className="relative pt-10 pb-8 px-8 flex flex-col items-center justify-center" style={{ background: "linear-gradient(135deg, var(--color-bg-deep) 0%, var(--color-panel) 100%)" }}>
          <div className="absolute top-0 left-0 w-full h-1" style={{ background: "linear-gradient(90deg, var(--color-warning), var(--color-accent), var(--color-success))" }} />
          <div className="absolute top-4 right-4">
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-black/20 text-xl leading-none" style={{ color: "var(--color-text-dim)" }}>✕</button>
          </div>
          
          <div className="w-20 h-20 rounded-full flex items-center justify-center mb-4 shadow-lg" style={{ background: "var(--color-warning-bg)", border: "2px solid var(--color-warning)" }}>
            <span className="text-4xl">🎉</span>
          </div>
          <h2 className="text-3xl font-black tracking-tight" style={{ color: "var(--color-white)" }}>
            {year} Year in Review
          </h2>
          <p className="mt-2 text-sm text-center max-w-sm" style={{ color: "var(--color-text-muted)" }}>
            A look back at your gaming adventures, milestones, and favorite moments from the past year.
          </p>
        </div>

        {/* Content */}
        <div className="p-8 flex flex-col gap-6" style={{ background: "var(--color-bg)" }}>
          
          {/* Big Stat */}
          <div className="flex flex-col items-center p-6 rounded-xl" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border-soft)" }}>
            <span className="text-xs uppercase tracking-widest font-bold mb-1" style={{ color: "var(--color-warning)" }}>Total Playtime</span>
            <span className="text-4xl font-black mb-1" style={{ color: "var(--color-white)" }}>
              {Math.floor(totalTime / 3600)}h {Math.floor((totalTime % 3600) / 60)}m
            </span>
            <span className="text-xs" style={{ color: "var(--color-text-dim)" }}>Across {totalSessions} gaming sessions</span>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Top Game */}
            <div className="p-5 rounded-xl flex flex-col gap-1" style={{ background: "var(--color-panel)", borderLeft: "3px solid var(--color-accent)" }}>
              <span className="text-[10px] uppercase tracking-wider font-bold" style={{ color: "var(--color-accent)" }}>Top Game of {year}</span>
              <span className="text-lg font-bold truncate" title={topGame.name} style={{ color: "var(--color-text)" }}>{topGame.name}</span>
              <span className="text-xs font-mono" style={{ color: "var(--color-text-dim)" }}>{formatTime(topGame.time)} played</span>
            </div>

            {/* Top Developer */}
            <div className="p-5 rounded-xl flex flex-col gap-1" style={{ background: "var(--color-panel)", borderLeft: "3px solid var(--color-success)" }}>
              <span className="text-[10px] uppercase tracking-wider font-bold" style={{ color: "var(--color-success)" }}>Top Developer</span>
              <span className="text-lg font-bold truncate" title={topDev.name} style={{ color: "var(--color-text)" }}>{topDev.name}</span>
              <span className="text-xs font-mono" style={{ color: "var(--color-text-dim)" }}>{formatTime(topDev.time)} played</span>
            </div>
            
            {/* Longest Session */}
            <div className="col-span-2 p-5 rounded-xl flex items-center justify-between" style={{ background: "var(--color-panel)", borderLeft: "3px solid var(--color-accent-soft)" }}>
              <div className="flex flex-col gap-1 overflow-hidden pr-4">
                <span className="text-[10px] uppercase tracking-wider font-bold" style={{ color: "var(--color-accent-soft)" }}>Longest Marathon</span>
                <span className="text-base font-bold truncate" style={{ color: "var(--color-text)" }}>{longestSession.game}</span>
              </div>
              <div className="text-right flex-shrink-0">
                <span className="text-xl font-black block" style={{ color: "var(--color-white)" }}>{Math.floor(longestSession.duration / 3600)}h {Math.floor((longestSession.duration % 3600) / 60)}m</span>
              </div>
            </div>
          </div>

          {/* Monthly Graph */}
          {totalTime > 0 && (
            <div className="mt-2">
              <span className="text-[10px] uppercase tracking-wider font-bold block mb-3 text-center" style={{ color: "var(--color-text-muted)" }}>Activity Throughout {year}</span>
              <div className="px-2">
                <MiniSparkline data={monthlyData} height={60} color="var(--color-warning)" />
                <div className="flex justify-between mt-2 px-1">
                  {monthNames.map((m, i) => (
                    <span key={i} className="text-[9px]" style={{ color: i % 2 === 0 ? "var(--color-text-dim)" : "transparent" }}>{m}</span>
                  ))}
                </div>
              </div>
            </div>
          )}
          
        </div>

        {/* Footer */}
        <div className="p-4 flex justify-center border-t" style={{ background: "var(--color-panel)", borderColor: "var(--color-border-soft)" }}>
           <button
            onClick={onClose}
            className="px-8 py-2.5 rounded-full text-sm font-bold transition-transform hover:scale-105"
            style={{ background: "var(--color-warning)", color: "#000" }}
          >
            Awesome!
          </button>
        </div>
      </div>
    </div>
  );
}
