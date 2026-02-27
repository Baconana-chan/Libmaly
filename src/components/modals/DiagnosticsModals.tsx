export interface RustLogEntry {
  ts: number;
  level: string;
  message: string;
}

export interface CrashReport {
  ts: number;
  thread: string;
  message: string;
  location: string;
  backtrace: string;
}

export type LogLevelFilter = "all" | "error" | "warn" | "info";

export function LogViewerModal({
  logs,
  crashReport,
  levelFilter,
  onSetLevelFilter,
  onRefresh,
  onClear,
  onExport,
  onCopyJson,
  onClose,
}: {
  logs: RustLogEntry[];
  crashReport: CrashReport | null;
  levelFilter: LogLevelFilter;
  onSetLevelFilter: (v: LogLevelFilter) => void;
  onRefresh: () => void;
  onClear: () => void;
  onExport: () => void;
  onCopyJson: () => void;
  onClose: () => void;
}) {
  const normLevel = (l: string): "error" | "warn" | "info" => {
    const x = l.toLowerCase();
    if (x.startsWith("err")) return "error";
    if (x.startsWith("warn")) return "warn";
    return "info";
  };
  const filtered = logs.filter((l) => levelFilter === "all" ? true : normLevel(l.level) === levelFilter);
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.82)" }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rounded-xl shadow-2xl w-[760px] max-h-[80vh] flex flex-col" style={{ background: "#1e2d3d", border: "1px solid #2a475e" }}>
        <div className="flex items-center px-5 py-3 border-b" style={{ borderColor: "#1b3a50" }}>
          <h2 className="font-bold text-sm" style={{ color: "#fff" }}>Rust Log Viewer</h2>
          <div className="flex-1" />
          {(["all", "error", "warn", "info"] as LogLevelFilter[]).map((lv) => <button key={lv} className="ml-1 text-[10px] uppercase px-2 py-1 rounded" style={{ background: levelFilter === lv ? "#2a6db5" : "#2a3f54", color: levelFilter === lv ? "#fff" : "#8f98a0" }} onClick={() => onSetLevelFilter(lv)}>{lv}</button>)}
          <button className="text-xs px-2 py-1 rounded" style={{ background: "#2a3f54", color: "#8f98a0" }} onClick={onRefresh}>Refresh</button>
          <button className="ml-2 text-xs px-2 py-1 rounded" style={{ background: "#2a3f54", color: "#8cb4d5" }} onClick={onCopyJson}>Copy JSON</button>
          <button className="ml-2 text-xs px-2 py-1 rounded" style={{ background: "#20323d", color: "#8cb4d5" }} onClick={onExport}>Export</button>
          <button className="ml-2 text-xs px-2 py-1 rounded" style={{ background: "#3a2020", color: "#e88585" }} onClick={onClear}>Clear</button>
          <button className="ml-2 text-sm" style={{ color: "#4a5568" }} onClick={onClose}>✕</button>
        </div>
        <div className="px-5 py-2 text-[11px]" style={{ color: "#8f98a0" }}>
          Found a bug? Please report it here:{" "}
          <a href="https://github.com/Baconana-chan/Libmaly/issues" target="_blank" rel="noreferrer" style={{ color: "#66c0f4" }}>
            github.com/Baconana-chan/Libmaly/issues
          </a>
        </div>
        <div className="overflow-y-auto p-3 font-mono text-[11px] border-t" style={{ borderColor: "#1b3a50", scrollbarWidth: "thin", scrollbarColor: "#2a475e transparent" }}>
          {crashReport && (
            <div className="mb-3 p-2 rounded" style={{ background: "#2a1a1a", border: "1px solid #5a2a2a" }}>
              <div style={{ color: "#e57373" }}>[CRASH REPORT] {new Date(crashReport.ts).toLocaleString()}</div>
              <div style={{ color: "#b8c8d4" }}>message: {crashReport.message}</div>
              <div style={{ color: "#8f98a0" }}>location: {crashReport.location}</div>
              <div style={{ color: "#8f98a0" }}>thread: {crashReport.thread}</div>
            </div>
          )}
          {filtered.length === 0 ? (
            <p style={{ color: "#8f98a0" }}>No logs yet.</p>
          ) : filtered.slice().reverse().map((l, i) => (
            <div key={i} className="mb-1.5">
              <span style={{ color: "#4a5568" }}>{new Date(l.ts).toLocaleTimeString()}</span>
              <span className="ml-2 uppercase" style={{ color: normLevel(l.level) === "error" ? "#e57373" : normLevel(l.level) === "warn" ? "#c8a951" : "#8cb4d5" }}>{l.level}</span>
              <span className="ml-2" style={{ color: "#c6d4df" }}>{l.message}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function CrashReportModal({ report, onClose }: { report: CrashReport; onClose: () => void }) {
  const text = JSON.stringify(report, null, 2);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      alert("Crash report copied.");
    } catch {
      alert("Could not copy report automatically.");
    }
  };
  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.88)" }}>
      <div className="rounded-xl shadow-2xl w-[760px] max-h-[84vh] flex flex-col" style={{ background: "#1e2d3d", border: "1px solid #6b2a2a" }}>
        <div className="px-5 py-3 border-b flex items-center" style={{ borderColor: "#402020" }}>
          <h2 className="font-bold text-sm" style={{ color: "#e88585" }}>Crash Reporter</h2>
          <div className="flex-1" />
          <button onClick={onCopy} className="text-xs px-2 py-1 rounded" style={{ background: "#2a3f54", color: "#8cb4d5" }}>Copy Report</button>
          <button onClick={onClose} className="ml-2 text-sm" style={{ color: "#4a5568" }}>✕</button>
        </div>
        <div className="px-5 py-3 text-xs" style={{ color: "#b8c8d4" }}>
          LIBMALY detected a previous Rust panic. Please copy and share this report for debugging.
          <div className="mt-2">
            Report here:{" "}
            <a href="https://github.com/Baconana-chan/Libmaly/issues" target="_blank" rel="noreferrer" style={{ color: "#66c0f4" }}>
              github.com/Baconana-chan/Libmaly/issues
            </a>
          </div>
        </div>
        <textarea readOnly value={text} className="mx-5 mb-5 p-3 rounded text-[11px] font-mono outline-none" style={{ minHeight: "300px", background: "#0d1117", color: "#c6d4df", border: "1px solid #2a3f54" }} />
      </div>
    </div>
  );
}
