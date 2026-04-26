import { useState } from "preact/hooks";
import type { LibraryFolder } from "../../types";

export function ZipInstallModal({
  zipPath,
  libraryFolders,
  defaultFolderPath,
  onInstall,
  onClose,
}: {
  zipPath: string;
  libraryFolders: LibraryFolder[];
  defaultFolderPath: string;
  onInstall: (libraryRoot: string) => Promise<void>;
  onClose: () => void;
}) {
  const [selectedRoot, setSelectedRoot] = useState(defaultFolderPath);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runInstall = async () => {
    if (!selectedRoot.trim()) {
      setError("Choose a library folder first.");
      return;
    }
    setWorking(true);
    setError(null);
    try {
      await onInstall(selectedRoot);
    } catch (e) {
      setError(String(e));
    } finally {
      setWorking(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.82)" }}
      onClick={(e) => { if (e.target === e.currentTarget && !working) onClose(); }}
    >
      <div className="rounded-xl shadow-2xl w-[560px] max-w-[92vw] flex flex-col"
        style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
        <div className="flex items-center gap-3 px-5 py-3 border-b" style={{ borderColor: "var(--color-border-card)" }}>
          <h2 className="font-bold text-sm" style={{ color: "var(--color-white)" }}>Install ZIP via Libmaly</h2>
          <div className="flex-1" />
          <button onClick={onClose} disabled={working} className="text-sm disabled:opacity-40" style={{ color: "var(--color-text-dim)" }}>✕</button>
        </div>
        <div className="px-5 py-4 space-y-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
          <p>Choose which library folder should receive this archive.</p>
          <div className="rounded-lg px-3 py-2 text-xs break-all" style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border-soft)" }}>
            ZIP: {zipPath}
          </div>
          <label className="text-sm block">
            Library folder
            <select
              value={selectedRoot}
              onChange={(e) => setSelectedRoot(e.currentTarget.value)}
              className="mt-2 w-full px-3 py-2 rounded text-sm outline-none"
              style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
            >
              {libraryFolders.map((folder) => (
                <option key={folder.path} value={folder.path}>{folder.path}</option>
              ))}
            </select>
          </label>
          <p className="text-xs" style={{ color: "var(--color-text-dim)" }}>
            Libmaly will extract the archive into a new folder inside the selected library and then scan it for launchable executables.
          </p>
          {error && <p className="text-xs" style={{ color: "var(--color-danger)" }}>{error}</p>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t" style={{ borderColor: "var(--color-border-card)" }}>
          <button onClick={onClose} disabled={working} className="px-3 py-1.5 rounded text-xs disabled:opacity-50"
            style={{ background: "transparent", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>
            Cancel
          </button>
          <button onClick={() => void runInstall()} disabled={working} className="px-4 py-1.5 rounded text-xs font-semibold disabled:opacity-50"
            style={{ background: "var(--color-accent-dark)", color: "var(--color-white)" }}>
            {working ? "Installing..." : "Install"}
          </button>
        </div>
      </div>
    </div>
  );
}
