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

export interface RecentFileOp {
  ts: number;
  operation: string;
  path: string;
  strategy: string;
  success: boolean;
  error?: string | null;
}

export interface ScraperHealthDiagnostic {
  source_id: string;
  source_label: string;
  overall_status: "healthy" | "degraded" | "parser_failed" | string;
  source_wide_parser_failure: boolean;
  total_attempts: number;
  total_successes: number;
  total_failures: number;
  parser_failure_count: number;
  consecutive_parser_failures: number;
  last_success_at?: number | null;
  last_failure_at?: number | null;
  last_failure_kind?: string | null;
  last_failure_reason?: string | null;
  last_failure_url?: string | null;
  recent_failure_reasons: string[];
}

export interface IntegrityIssue {
  severity: "error" | "warning" | string;
  code: string;
  message: string;
  path?: string | null;
  gamePath?: string | null;
}

export interface IntegrityCheckReport {
  scannedAt: number;
  totalGames: number;
  totalLibraryFolders: number;
  errorCount: number;
  warningCount: number;
  issues: IntegrityIssue[];
}

export interface SnapshotResult {
  id: string;
  path: string;
  createdAt: number;
  entryCount: number;
  label?: string | null;
  reason?: string | null;
}
export interface SnapshotPreviewItem {
  key: string;
  label: string;
  status: "changed" | "same" | "missing_in_snapshot" | "new_in_snapshot";
  currentCount: number;
  snapshotCount: number;
}
export interface SnapshotRestorePreview {
  snapshot: SnapshotResult & { entries: Record<string, string> };
  items: SnapshotPreviewItem[];
  changedCount: number;
  currentGames: number;
  snapshotGames: number;
  currentFolders: number;
  snapshotFolders: number;
}

export type LogLevelFilter = "all" | "error" | "warn" | "info";

export function LogViewerModal({
  logs,
  recentFileOps,
  crashReport,
  scraperHealth,
  levelFilter,
  onSetLevelFilter,
  onRefresh,
  onClear,
  onExport,
  onCopyJson,
  onClose,
}: {
  logs: RustLogEntry[];
  recentFileOps: RecentFileOp[];
  crashReport: CrashReport | null;
  scraperHealth: ScraperHealthDiagnostic[];
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
  const statusLabel = (status: ScraperHealthDiagnostic["overall_status"]) => {
    if (status === "parser_failed") return "Parser failure";
    if (status === "degraded") return "Degraded";
    return "Healthy";
  };
  const filtered = logs.filter((l) => levelFilter === "all" ? true : normLevel(l.level) === levelFilter);
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.82)" }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rounded-xl shadow-2xl w-[760px] max-h-[80vh] flex flex-col" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
        <div className="flex items-center px-5 py-3 border-b" style={{ borderColor: "var(--color-border-card)" }}>
          <h2 className="font-bold text-sm" style={{ color: "var(--color-white)" }}>Rust Log Viewer</h2>
          <div className="flex-1" />
          {(["all", "error", "warn", "info"] as LogLevelFilter[]).map((lv) => <button key={lv} className="ml-1 text-[10px] uppercase px-2 py-1 rounded" style={{ background: levelFilter === lv ? "var(--color-accent-dark)" : "var(--color-panel-3)", color: levelFilter === lv ? "var(--color-white)" : "var(--color-text-muted)" }} onClick={() => onSetLevelFilter(lv)}>{lv}</button>)}
          <button className="text-xs px-2 py-1 rounded" style={{ background: "var(--color-panel-3)", color: "var(--color-text-muted)" }} onClick={onRefresh}>Refresh</button>
          <button className="ml-2 text-xs px-2 py-1 rounded" style={{ background: "var(--color-panel-3)", color: "var(--color-accent-soft)" }} onClick={onCopyJson}>Copy JSON</button>
          <button className="ml-2 text-xs px-2 py-1 rounded" style={{ background: "#20323d", color: "var(--color-accent-soft)" }} onClick={onExport}>Export</button>
          <button className="ml-2 text-xs px-2 py-1 rounded" style={{ background: "#3a2020", color: "var(--color-danger-soft)" }} onClick={onClear}>Clear</button>
          <button className="ml-2 text-sm" style={{ color: "var(--color-text-dim)" }} onClick={onClose}>✕</button>
        </div>
        <div className="px-5 py-2 text-[11px]" style={{ color: "var(--color-text-muted)" }}>
          Found a bug? Please report it here:{" "}
          <a href="https://github.com/Baconana-chan/Libmaly/issues" target="_blank" rel="noreferrer" style={{ color: "var(--color-accent)" }}>
            github.com/Baconana-chan/Libmaly/issues
          </a>
        </div>
        <div className="overflow-y-auto p-3 font-mono text-[11px] border-t" style={{ borderColor: "var(--color-border-card)", scrollbarWidth: "thin", scrollbarColor: "var(--color-border) transparent" }}>
          {crashReport && (
            <div className="mb-3 p-2 rounded" style={{ background: "#2a1a1a", border: "1px solid #5a2a2a" }}>
              <div style={{ color: "var(--color-danger)" }}>[CRASH REPORT] {new Date(crashReport.ts).toLocaleString()}</div>
              <div style={{ color: "var(--color-text-soft)" }}>message: {crashReport.message}</div>
              <div style={{ color: "var(--color-text-muted)" }}>location: {crashReport.location}</div>
              <div style={{ color: "var(--color-text-muted)" }}>thread: {crashReport.thread}</div>
            </div>
          )}
          {scraperHealth.length > 0 && (
            <div className="mb-3 p-2 rounded" style={{ background: "var(--color-bg-deep)", border: "1px solid var(--color-border-card)" }}>
              <div className="mb-2" style={{ color: "var(--color-text-soft)" }}>[SCRAPER HEALTH]</div>
              {scraperHealth.map((entry) => (
                <div key={entry.source_id} className="mb-2 pb-2" style={{ borderBottom: "1px solid var(--color-border-card)" }}>
                  <div>
                    <span style={{ color: entry.source_wide_parser_failure ? "var(--color-danger)" : entry.overall_status === "degraded" ? "var(--color-warning)" : "var(--color-accent-soft)" }}>
                      {entry.source_label}
                    </span>
                    <span className="ml-2" style={{ color: "var(--color-text-muted)" }}>
                      {statusLabel(entry.overall_status)} | attempts {entry.total_attempts} | ok {entry.total_successes} | fail {entry.total_failures}
                    </span>
                  </div>
                  {(entry.last_failure_reason || entry.recent_failure_reasons.length > 0) && (
                    <div className="mt-1" style={{ color: "var(--color-text-muted)" }}>
                      reason: {entry.last_failure_reason ?? entry.recent_failure_reasons[entry.recent_failure_reasons.length - 1]}
                    </div>
                  )}
                  {entry.source_wide_parser_failure && (
                    <div className="mt-1" style={{ color: "var(--color-danger-soft)" }}>
                      consecutive parser failures: {entry.consecutive_parser_failures}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {recentFileOps.length > 0 && (
            <div className="mb-3 p-2 rounded" style={{ background: "var(--color-bg-deep)", border: "1px solid var(--color-border-card)" }}>
              <div className="mb-2" style={{ color: "var(--color-text-soft)" }}>[RECENT FILE OPS]</div>
              {recentFileOps.slice().reverse().slice(0, 8).map((entry, idx) => (
                <div key={`${entry.ts}-${idx}`} className="mb-1">
                  <span style={{ color: entry.success ? "var(--color-success)" : "var(--color-danger-soft)" }}>
                    {entry.success ? "ok" : "failed"}
                  </span>
                  <span className="ml-2" style={{ color: "var(--color-text-muted)" }}>
                    {entry.operation} via {entry.strategy}
                  </span>
                  <div className="font-mono break-all" style={{ color: "var(--color-text-dim)" }}>{entry.path}</div>
                  {entry.error && (
                    <div style={{ color: "var(--color-text-muted)" }}>{entry.error}</div>
                  )}
                </div>
              ))}
            </div>
          )}
          {filtered.length === 0 ? (
            <p style={{ color: "var(--color-text-muted)" }}>No logs yet.</p>
          ) : filtered.slice().reverse().map((l, i) => (
            <div key={i} className="mb-1.5">
              <span style={{ color: "var(--color-text-dim)" }}>{new Date(l.ts).toLocaleTimeString()}</span>
              <span className="ml-2 uppercase" style={{ color: normLevel(l.level) === "error" ? "var(--color-danger)" : normLevel(l.level) === "warn" ? "var(--color-warning)" : "var(--color-accent-soft)" }}>{l.level}</span>
              <span className="ml-2" style={{ color: "var(--color-text)" }}>{l.message}</span>
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
      <div className="rounded-xl shadow-2xl w-[760px] max-h-[84vh] flex flex-col" style={{ background: "var(--color-panel)", border: "1px solid #6b2a2a" }}>
        <div className="px-5 py-3 border-b flex items-center" style={{ borderColor: "#402020" }}>
          <h2 className="font-bold text-sm" style={{ color: "var(--color-danger-soft)" }}>Crash Reporter</h2>
          <div className="flex-1" />
          <button onClick={onCopy} className="text-xs px-2 py-1 rounded" style={{ background: "var(--color-panel-3)", color: "var(--color-accent-soft)" }}>Copy Report</button>
          <button onClick={onClose} className="ml-2 text-sm" style={{ color: "var(--color-text-dim)" }}>✕</button>
        </div>
        <div className="px-5 py-3 text-xs" style={{ color: "var(--color-text-soft)" }}>
          LIBMALY detected a previous Rust panic. Please copy and share this report for debugging.
          <div className="mt-2">
            Report here:{" "}
            <a href="https://github.com/Baconana-chan/Libmaly/issues" target="_blank" rel="noreferrer" style={{ color: "var(--color-accent)" }}>
              github.com/Baconana-chan/Libmaly/issues
            </a>
          </div>
        </div>
        <textarea readOnly value={text} className="mx-5 mb-5 p-3 rounded text-[11px] font-mono outline-none" style={{ minHeight: "300px", background: "var(--color-bg-deep)", color: "var(--color-text)", border: "1px solid var(--color-panel-3)" }} />
      </div>
    </div>
  );
}

export function IntegrityCheckModal({ report, onClose }: { report: IntegrityCheckReport; onClose: () => void }) {
  const issues = report.issues.slice().sort((a, b) => {
    if (a.severity === b.severity) return a.code.localeCompare(b.code);
    return a.severity === "error" ? -1 : 1;
  });
  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.84)" }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rounded-xl shadow-2xl w-[820px] max-h-[84vh] flex flex-col" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
        <div className="px-5 py-3 border-b flex items-center" style={{ borderColor: "var(--color-border-card)" }}>
          <div>
            <h2 className="font-bold text-sm" style={{ color: "var(--color-white)" }}>Library Integrity Check</h2>
            <div className="text-[11px]" style={{ color: "var(--color-text-dim)" }}>
              {new Date(report.scannedAt).toLocaleString()} | {report.totalGames} games | {report.totalLibraryFolders} folders
            </div>
          </div>
          <div className="flex-1" />
          <div className="text-[11px] mr-4" style={{ color: "var(--color-danger-soft)" }}>Errors: {report.errorCount}</div>
          <div className="text-[11px] mr-4" style={{ color: "var(--color-warning)" }}>Warnings: {report.warningCount}</div>
          <button onClick={onClose} className="text-sm" style={{ color: "var(--color-text-dim)" }}>✕</button>
        </div>
        <div className="overflow-y-auto p-4 space-y-3 text-[12px]" style={{ scrollbarWidth: "thin", scrollbarColor: "var(--color-border) transparent" }}>
          {issues.length === 0 ? (
            <div className="rounded-lg p-4" style={{ background: "var(--color-bg-deep)", border: "1px solid var(--color-border-card)", color: "var(--color-success)" }}>
              No integrity issues found.
            </div>
          ) : issues.map((issue, idx) => (
            <div key={`${issue.code}-${issue.path ?? idx}`} className="rounded-lg p-3" style={{ background: "var(--color-bg-deep)", border: `1px solid ${issue.severity === "error" ? "#6b2a2a" : "var(--color-border-card)"}` }}>
              <div className="flex items-center gap-2">
                <span className="uppercase text-[10px] font-bold" style={{ color: issue.severity === "error" ? "var(--color-danger-soft)" : "var(--color-warning)" }}>
                  {issue.severity}
                </span>
                <span className="text-[10px]" style={{ color: "var(--color-text-dim)" }}>{issue.code}</span>
              </div>
              <div className="mt-1" style={{ color: "var(--color-text)" }}>{issue.message}</div>
              {issue.path && (
                <div className="mt-1 break-all font-mono text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                  {issue.path}
                </div>
              )}
            </div>
          ))
          }
        </div>
      </div>
    </div>
  );
}

export function SnapshotRestoreModal({
  snapshots,
  selectedPath,
  preview,
  previewLoading,
  previewError,
  loading,
  restoring,
  onSelect,
  onRefresh,
  onRestore,
  onClose,
}: {
  snapshots: SnapshotResult[];
  selectedPath: string | null;
  preview: SnapshotRestorePreview | null;
  previewLoading: boolean;
  previewError: string | null;
  loading: boolean;
  restoring: boolean;
  onSelect: (path: string) => void;
  onRefresh: () => void;
  onRestore: () => void;
  onClose: () => void;
}) {
  const statusTone = (status: SnapshotPreviewItem["status"]) => {
    switch (status) {
      case "changed":
        return { border: "var(--color-warning-border)", fg: "var(--color-warning)" };
      case "missing_in_snapshot":
      case "new_in_snapshot":
        return { border: "#6b2a2a", fg: "var(--color-danger-soft)" };
      default:
        return { border: "var(--color-border-card)", fg: "var(--color-text-dim)" };
    }
  };
  const statusLabel = (status: SnapshotPreviewItem["status"]) => {
    if (status === "changed") return "Will Replace";
    if (status === "missing_in_snapshot") return "Will Remove";
    if (status === "new_in_snapshot") return "Will Add";
    return "Unchanged";
  };
  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.84)" }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rounded-xl shadow-2xl w-[980px] max-w-[94vw] max-h-[84vh] flex flex-col" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
        <div className="px-5 py-3 border-b flex items-center" style={{ borderColor: "var(--color-border-card)" }}>
          <h2 className="font-bold text-sm" style={{ color: "var(--color-white)" }}>Restore Wizard</h2>
          <div className="flex-1" />
          <button onClick={onRefresh} className="text-xs px-2 py-1 rounded" style={{ background: "var(--color-panel-3)", color: "var(--color-text)" }}>Refresh</button>
          <button onClick={onClose} className="ml-2 text-sm" style={{ color: "var(--color-text-dim)" }}>✕</button>
        </div>
        <div className="px-5 py-3 text-xs" style={{ color: "var(--color-text-muted)" }}>
          Choose a snapshot, review the overwrite preview, then restore. A fresh pre-restore snapshot will be created first.
        </div>
        <div className="flex-1 min-h-0 grid grid-cols-[minmax(300px,360px)_1fr]">
          <div className="overflow-y-auto px-5 pb-4 space-y-2 border-r" style={{ borderColor: "var(--color-border-card)", scrollbarWidth: "thin", scrollbarColor: "var(--color-border) transparent" }}>
            {loading ? (
              <p style={{ color: "var(--color-text-muted)" }}>Loading snapshots…</p>
            ) : snapshots.length === 0 ? (
              <p style={{ color: "var(--color-text-muted)" }}>No snapshots found yet.</p>
            ) : snapshots.map((snap) => (
              <button
                key={snap.path}
                onClick={() => onSelect(snap.path)}
                className="w-full text-left rounded-lg p-3"
                style={{
                  background: selectedPath === snap.path ? "var(--color-accent-deep)" : "var(--color-bg-deep)",
                  border: `1px solid ${selectedPath === snap.path ? "var(--color-accent-mid)" : "var(--color-border-card)"}`,
                }}
              >
                <div className="flex items-center gap-2">
                  <div className="font-semibold" style={{ color: "var(--color-text)" }}>{snap.label || snap.id}</div>
                  <div className="text-[10px]" style={{ color: "var(--color-text-dim)" }}>{new Date(snap.createdAt).toLocaleString()}</div>
                </div>
                {snap.reason && (
                  <div className="mt-1 text-[11px]" style={{ color: "var(--color-text-muted)" }}>{snap.reason}</div>
                )}
                <div className="mt-1 text-[10px] font-mono break-all" style={{ color: "var(--color-text-dim)" }}>
                  {snap.path}
                </div>
                <div className="mt-1 text-[10px]" style={{ color: "var(--color-text-dim)" }}>
                  entries: {snap.entryCount}
                </div>
              </button>
            ))}
          </div>
          <div className="overflow-y-auto px-5 pb-4" style={{ scrollbarWidth: "thin", scrollbarColor: "var(--color-border) transparent" }}>
            {!selectedPath ? (
              <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>Select a snapshot to preview the restore plan.</p>
            ) : previewLoading ? (
              <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>Preparing restore preview…</p>
            ) : previewError ? (
              <div className="rounded-lg p-3 text-xs" style={{ background: "var(--color-bg-deep)", border: "1px solid #6b2a2a", color: "var(--color-danger-soft)" }}>
                Could not load snapshot preview: {previewError}
              </div>
            ) : !preview ? (
              <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>No preview available.</p>
            ) : (
              <div className="space-y-4">
                <div className="rounded-lg p-3" style={{ background: "var(--color-bg-deep)", border: "1px solid var(--color-border-card)" }}>
                  <div className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>{preview.snapshot.label || preview.snapshot.id}</div>
                  <div className="mt-1 text-[11px]" style={{ color: "var(--color-text-dim)" }}>{new Date(preview.snapshot.createdAt).toLocaleString()}</div>
                  {preview.snapshot.reason && (
                    <div className="mt-2 text-xs" style={{ color: "var(--color-text-muted)" }}>{preview.snapshot.reason}</div>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-3 text-xs">
                  <div className="rounded-lg p-3" style={{ background: "var(--color-bg-deep)", border: "1px solid var(--color-border-card)" }}>
                    <div style={{ color: "var(--color-text-dim)" }}>Changed Sections</div>
                    <div className="mt-1 text-lg font-semibold" style={{ color: "var(--color-warning)" }}>{preview.changedCount}</div>
                  </div>
                  <div className="rounded-lg p-3" style={{ background: "var(--color-bg-deep)", border: "1px solid var(--color-border-card)" }}>
                    <div style={{ color: "var(--color-text-dim)" }}>Games</div>
                    <div className="mt-1 text-sm font-semibold" style={{ color: "var(--color-text)" }}>{preview.currentGames} → {preview.snapshotGames}</div>
                  </div>
                  <div className="rounded-lg p-3" style={{ background: "var(--color-bg-deep)", border: "1px solid var(--color-border-card)" }}>
                    <div style={{ color: "var(--color-text-dim)" }}>Folders</div>
                    <div className="mt-1 text-sm font-semibold" style={{ color: "var(--color-text)" }}>{preview.currentFolders} → {preview.snapshotFolders}</div>
                  </div>
                </div>
                <div className="rounded-lg p-3 text-xs" style={{ background: "#2f2417", border: "1px solid #6a5132", color: "#f4d7a8" }}>
                  Restoring will overwrite the current local library state with this snapshot.
                </div>
                <div className="space-y-2">
                  {preview.items.map((item) => {
                    const tone = statusTone(item.status);
                    return (
                      <div key={item.key} className="rounded-lg p-3" style={{ background: "var(--color-bg-deep)", border: `1px solid ${tone.border}` }}>
                        <div className="flex items-center gap-2">
                          <div className="font-semibold flex-1" style={{ color: "var(--color-text)" }}>{item.label}</div>
                          <div className="text-[10px] uppercase tracking-wide" style={{ color: tone.fg }}>{statusLabel(item.status)}</div>
                        </div>
                        <div className="mt-1 text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                          current: {item.currentCount} | snapshot: {item.snapshotCount}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-3 justify-end px-5 py-3 border-t" style={{ borderColor: "var(--color-border-card)" }}>
          <button onClick={onClose} className="px-3 py-1.5 rounded text-xs" style={{ background: "transparent", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>
            Cancel
          </button>
          <button onClick={onRestore} disabled={!selectedPath || restoring || previewLoading || !preview} className="px-4 py-1.5 rounded text-xs font-semibold disabled:opacity-50" style={{ background: "#2f5f46", color: "var(--color-white)" }}>
            {restoring ? "Restoring…" : "Restore Snapshot"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function RecoveryModeModal({
  report,
  onStaySafe,
  onResume,
}: {
  report: CrashReport;
  onStaySafe: () => void;
  onResume: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[10001] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.86)" }}>
      <div className="rounded-xl shadow-2xl w-[720px] max-h-[84vh] flex flex-col" style={{ background: "var(--color-panel)", border: "1px solid #6b2a2a" }}>
        <div className="px-5 py-3 border-b flex items-center" style={{ borderColor: "#402020" }}>
          <h2 className="font-bold text-sm" style={{ color: "var(--color-danger-soft)" }}>Recovery Mode</h2>
        </div>
        <div className="px-5 py-4 text-sm" style={{ color: "var(--color-text)" }}>
          LIBMALY detected a previous crash on startup and temporarily disabled background refresh and scraping for this session.
          <div className="mt-3 text-xs" style={{ color: "var(--color-text-muted)" }}>
            Crash: {report.message}
          </div>
          <div className="mt-1 text-xs" style={{ color: "var(--color-text-dim)" }}>
            {report.location}
          </div>
          <div className="mt-4 text-xs" style={{ color: "var(--color-text-muted)" }}>
            Stay in recovery mode to inspect the library safely, or resume normal startup to re-enable automatic sync and background metadata checks.
          </div>
        </div>
        <div className="flex gap-3 justify-end px-5 py-4 border-t" style={{ borderColor: "var(--color-border-card)" }}>
          <button onClick={onStaySafe} className="px-3 py-1.5 rounded text-xs" style={{ background: "var(--color-panel-3)", color: "var(--color-text)" }}>
            Stay In Recovery Mode
          </button>
          <button onClick={onResume} className="px-4 py-1.5 rounded text-xs font-semibold" style={{ background: "var(--color-accent-dark)", color: "var(--color-white)" }}>
            Resume Normal Startup
          </button>
        </div>
      </div>
    </div>
  );
}

