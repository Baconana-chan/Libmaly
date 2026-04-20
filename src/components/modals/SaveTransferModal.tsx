import { invoke } from "@tauri-apps/api/core";
import { useState } from "preact/hooks";
import { useTranslation } from "react-i18next";

interface SavePathInfo {
  path: string;
  engine: string;
  description: string;
}

interface SaveTransferModalProps {
  gameName: string;
  gamePath: string;
  engine?: string;
  companyName?: string;
  onClose: () => void;
}

export function SaveTransferModal({ gameName, gamePath, engine, companyName, onClose }: SaveTransferModalProps) {
  const { t } = useTranslation();
  const [sourcePath, setSourcePath] = useState("");
  const [targetPath, setTargetPath] = useState("");
  const [customSourcePath, setCustomSourcePath] = useState("");
  const [customTargetPath, setCustomTargetPath] = useState("");
  const [detectedPaths, setDetectedPaths] = useState<SavePathInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [createBackup, setCreateBackup] = useState(true);

  const detectPaths = async () => {
    setLoading(true);
    setError("");
    try {
      const paths = await invoke<SavePathInfo[]>("detect_save_paths", {
        gamePath,
        engine,
        companyName,
        gameName,
      });
      setDetectedPaths(paths);
      if (paths.length > 0) {
        setSourcePath(paths[0].path);
        setTargetPath(paths[0].path);
      }
    } catch (e: any) {
      setError(e?.toString?.() || "Failed to detect save paths");
    } finally {
      setLoading(false);
    }
  };

  const handleTransfer = async () => {
    const finalSource = customSourcePath || sourcePath;
    const finalTarget = customTargetPath || targetPath;

    if (!finalSource || !finalTarget) {
      setError("Please select both source and target paths");
      return;
    }

    if (finalSource === finalTarget) {
      setError("Source and target paths cannot be the same");
      return;
    }

    setTransferring(true);
    setError("");
    setSuccess("");
    try {
      const result = await invoke<{ success: boolean; message: string; files_transferred: number }>("transfer_saves", {
        sourcePath: finalSource,
        targetPath: finalTarget,
        createBackup,
      });
      if (result.success) {
        setSuccess(result.message);
      } else {
        setError(result.message);
      }
    } catch (e: any) {
      setError(e?.toString?.() || "Failed to transfer saves");
    } finally {
      setTransferring(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.82)" }} onClick={() => onClose()}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg p-6"
        style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)", scrollbarWidth: "thin", scrollbarColor: "var(--color-border) transparent" }}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold" style={{ color: "var(--color-white)" }}>
            Transfer Saves
          </h2>
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded text-xs"
            style={{ background: "var(--color-border)", color: "var(--color-text)" }}
          >
            {t('common.close')}
          </button>
        </div>

        <div className="mb-4">
          <p className="text-sm mb-2" style={{ color: "var(--color-text-muted)" }}>
            Game: <span style={{ color: "var(--color-text)" }}>{gameName}</span>
          </p>
          <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
            Path: <span style={{ color: "var(--color-text)" }}>{gamePath}</span>
          </p>
        </div>

        <button
          onClick={detectPaths}
          disabled={loading}
          className="w-full px-4 py-2 rounded text-sm mb-4 transition-colors"
          style={{ background: "var(--color-accent)", color: "var(--color-white)" }}
        >
          {loading ? "Detecting..." : "Auto-Detect Save Paths"}
        </button>

        {detectedPaths.length > 0 && (
          <div className="mb-4">
            <p className="text-xs mb-2" style={{ color: "var(--color-text-muted)" }}>
              Detected save paths:
            </p>
            <div className="space-y-2">
              {detectedPaths.map((info, idx) => (
                <div
                  key={idx}
                  className="p-2 rounded text-xs cursor-pointer transition-colors"
                  style={{
                    background: "var(--color-panel-2)",
                    border: "1px solid var(--color-border)",
                  }}
                  onClick={() => {
                    setSourcePath(info.path);
                    setTargetPath(info.path);
                  }}
                >
                  <div className="font-bold" style={{ color: "var(--color-accent)" }}>
                    {info.engine}
                  </div>
                  <div style={{ color: "var(--color-text-muted)" }}>{info.description}</div>
                  <div className="truncate" style={{ color: "var(--color-text)" }}>{info.path}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-4 mb-4">
          <div>
            <label className="text-xs mb-1 block" style={{ color: "var(--color-text-muted)" }}>
              Source Path (where to copy FROM):
            </label>
            <select
              value={sourcePath}
              onChange={(e) => setSourcePath((e.target as HTMLSelectElement).value)}
              disabled={customSourcePath.length > 0}
              className="w-full px-3 py-2 rounded text-sm outline-none mb-2"
              style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
            >
              {detectedPaths.length === 0 && <option value="">-- Select detected path --</option>}
              {detectedPaths.map((info, idx) => (
                <option key={idx} value={info.path}>
                  {info.engine} - {info.description}
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Or enter custom path..."
              value={customSourcePath}
              onChange={(e) => setCustomSourcePath((e.target as HTMLInputElement).value)}
              className="w-full px-3 py-2 rounded text-sm outline-none"
              style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
            />
          </div>

          <div>
            <label className="text-xs mb-1 block" style={{ color: "var(--color-text-muted)" }}>
              Target Path (where to copy TO):
            </label>
            <select
              value={targetPath}
              onChange={(e) => setTargetPath((e.target as HTMLSelectElement).value)}
              disabled={customTargetPath.length > 0}
              className="w-full px-3 py-2 rounded text-sm outline-none mb-2"
              style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
            >
              {detectedPaths.length === 0 && <option value="">-- Select detected path --</option>}
              {detectedPaths.map((info, idx) => (
                <option key={idx} value={info.path}>
                  {info.engine} - {info.description}
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Or enter custom path..."
              value={customTargetPath}
              onChange={(e) => setCustomTargetPath((e.target as HTMLInputElement).value)}
              className="w-full px-3 py-2 rounded text-sm outline-none"
              style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="createBackup"
              checked={createBackup}
              onChange={(e) => setCreateBackup((e.target as HTMLInputElement).checked)}
              className="w-4 h-4"
            />
            <label htmlFor="createBackup" className="text-sm" style={{ color: "var(--color-text)" }}>
              Create backup of target before transfer
            </label>
          </div>
        </div>

        {error && (
          <div className="p-3 rounded text-sm mb-4" style={{ background: "rgba(255,0,0,0.1)", color: "#ff6b6b", border: "1px solid rgba(255,0,0,0.3)" }}>
            {error}
          </div>
        )}

        {success && (
          <div className="p-3 rounded text-sm mb-4" style={{ background: "rgba(0,255,0,0.1)", color: "#51cf66", border: "1px solid rgba(0,255,0,0.3)" }}>
            {success}
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={handleTransfer}
            disabled={transferring}
            className="flex-1 px-4 py-2 rounded text-sm transition-colors"
            style={{ background: "var(--color-accent)", color: "var(--color-white)" }}
          >
            {transferring ? "Transferring..." : "Transfer Saves"}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded text-sm"
            style={{ background: "var(--color-border)", color: "var(--color-text)" }}
          >
            Cancel
          </button>
        </div>

        <div className="mt-4 p-3 rounded text-xs" style={{ background: "var(--color-panel-2)", color: "var(--color-text-muted)" }}>
          <p className="font-bold mb-1">Tips:</p>
          <ul className="list-disc list-inside space-y-1">
            <li>Click "Auto-Detect" to find common save locations</li>
            <li>You can manually enter paths if auto-detection fails</li>
            <li>Backup is recommended to prevent data loss</li>
            <li>Supported engines: Unity, Unreal, Ren'Py, RPG Maker</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
