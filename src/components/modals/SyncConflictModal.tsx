import { useMemo, useState } from "preact/hooks";
import { useTranslation } from "react-i18next";
import {
  syncResolveConflicts,
  type SyncConflictPreviewReport,
  type SyncConflictResolutionChoice,
  type SyncResult,
} from "../../lib/sync";
 
interface SyncConflictModalProps {
  report: SyncConflictPreviewReport;
  onResolve: (result: SyncResult) => void;
  onCancel: () => void;
}
 
export default function SyncConflictModal({ report, onResolve, onCancel }: SyncConflictModalProps) {
  const { t } = useTranslation();
  const conflicts = useMemo(
    () => report.items.filter((item) => item.requiresManual),
    [report.items],
  );
  const [resolution, setResolution] = useState<Record<string, SyncConflictResolutionChoice>>({});
  const [loading, setLoading] = useState(false);
 
  const handleResolve = async () => {
    setLoading(true);
    try {
      const result = await syncResolveConflicts(resolution);
      onResolve(result);
    } catch (error) {
      console.error("Failed to resolve conflicts:", error);
    } finally {
      setLoading(false);
    }
  };
 
  const handleSelectAll = (choice: SyncConflictResolutionChoice) => {
    const newResolution: Record<string, SyncConflictResolutionChoice> = {};
    conflicts.forEach((conflict) => {
      newResolution[conflict.key] = choice;
    });
    setResolution(newResolution);
  };

  const formatValue = (value: string | null) => {
    if (value === null) return "<deleted>";
    return value;
  };
 
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-lg p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-white">
            {t("syncConflict.title", "Sync Conflicts")}
          </h2>
          <button onClick={onCancel} className="text-gray-400 hover:text-white">
            ✕
          </button>
        </div>
 
        <p className="text-gray-300 mb-4">
          {t("syncConflict.description", "The following entries changed on both sides. Compare local, remote, and base values before picking the final version.")}
        </p>

        <div className="mb-4 rounded border border-gray-700 bg-gray-800/60 p-3 text-xs text-gray-300">
          <div>{`Manual conflicts: ${report.conflictCount}`}</div>
          <div>{`Changed entries in this sync: ${report.changedKeys.length}`}</div>
          <div>{`Auto-resolved entries: ${Math.max(0, report.items.length - report.conflictCount)}`}</div>
        </div>
 
        {/* Batch Actions */}
        <div className="flex gap-3 mb-4">
          <button
            onClick={() => handleSelectAll("local")}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-1 px-3 rounded"
          >
            {t("syncConflict.selectAllLocal", "Select All Local")}
          </button>
          <button
            onClick={() => handleSelectAll("remote")}
            className="bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium py-1 px-3 rounded"
          >
            {t("syncConflict.selectAllRemote", "Select All Remote")}
          </button>
          <button
            onClick={() => handleSelectAll("base")}
            className="bg-gray-600 hover:bg-gray-500 text-white text-sm font-medium py-1 px-3 rounded"
          >
            {t("syncConflict.selectAllBase", "Select All Base")}
          </button>
        </div>
 
        {/* Conflict List */}
        <div className="space-y-4 mb-6">
          {conflicts.map((conflict) => (
            <div key={conflict.key} className="bg-gray-800 rounded p-4">
              <div className="flex justify-between items-start gap-3 mb-3">
                <div>
                  <h3 className="font-medium text-white">{conflict.label || conflict.key}</h3>
                  <p className="mt-1 text-xs text-gray-400 break-all">{conflict.key}</p>
                  <p className="mt-1 text-xs text-amber-300">{conflict.reason}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setResolution({ ...resolution, [conflict.key]: "local" })}
                    className={`text-sm font-medium py-1 px-3 rounded ${
                      resolution[conflict.key] === "local"
                        ? "bg-blue-600 text-white"
                        : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                    }`}
                  >
                    {t("syncConflict.local", "Local")}
                  </button>
                  <button
                    onClick={() => setResolution({ ...resolution, [conflict.key]: "remote" })}
                    className={`text-sm font-medium py-1 px-3 rounded ${
                      resolution[conflict.key] === "remote"
                        ? "bg-purple-600 text-white"
                        : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                    }`}
                  >
                    {t("syncConflict.remote", "Remote")}
                  </button>
                  <button
                    onClick={() => setResolution({ ...resolution, [conflict.key]: "base" })}
                    className={`text-sm font-medium py-1 px-3 rounded ${
                      resolution[conflict.key] === "base"
                        ? "bg-gray-500 text-white"
                        : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                    }`}
                  >
                    {t("syncConflict.base", "Base")}
                  </button>
                </div>
              </div>
 
              <div className="mb-3 grid grid-cols-3 gap-2 text-[11px] text-gray-400">
                <div>{`Local items: ${conflict.localCount}`}</div>
                <div>{`Remote items: ${conflict.remoteCount}`}</div>
                <div>{`Base items: ${conflict.baseCount}`}</div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <p className="text-xs text-gray-400 mb-1">{t("syncConflict.localValue", "Local Value")}</p>
                  <pre className="bg-gray-900 p-2 rounded text-xs text-gray-300 overflow-x-auto">
                    {formatValue(conflict.localValue)}
                  </pre>
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-1">{t("syncConflict.remoteValue", "Remote Value")}</p>
                  <pre className="bg-gray-900 p-2 rounded text-xs text-gray-300 overflow-x-auto">
                    {formatValue(conflict.remoteValue)}
                  </pre>
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-1">{t("syncConflict.baseValue", "Base Value")}</p>
                  <pre className="bg-gray-900 p-2 rounded text-xs text-gray-300 overflow-x-auto">
                    {formatValue(conflict.baseValue)}
                  </pre>
                </div>
              </div>
            </div>
          ))}
        </div>
 
        {/* Action Buttons */}
        <div className="flex gap-3">
          <button
            onClick={handleResolve}
            disabled={loading || conflicts.some((conflict) => !resolution[conflict.key])}
            className="flex-1 bg-green-600 hover:bg-green-700 text-white font-medium py-2 px-4 rounded disabled:opacity-50"
          >
            {loading ? t("syncConflict.resolving", "Resolving...") : t("syncConflict.resolve", "Resolve Conflicts")}
          </button>
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-medium py-2 px-4 rounded disabled:opacity-50"
          >
            {t("syncConflict.cancel", "Cancel")}
          </button>
        </div>
 
        {conflicts.some((conflict) => !resolution[conflict.key]) && (
          <p className="text-yellow-400 text-sm mt-2 text-center">
            {t("syncConflict.selectOne", "Please select Local, Remote, or Base for every conflict before continuing")}
          </p>
        )}
      </div>
    </div>
  );
}