import { useState } from "preact/hooks";
import { useTranslation } from "react-i18next";
import { syncResolveConflicts, type SyncConflict } from "../../lib/sync";
 
interface SyncConflictModalProps {
  conflicts: SyncConflict[];
  onResolve: () => void;
  onCancel: () => void;
}
 
export default function SyncConflictModal({ conflicts, onResolve, onCancel }: SyncConflictModalProps) {
  const { t } = useTranslation();
  const [resolution, setResolution] = useState<Record<string, "local" | "remote">>({});
  const [loading, setLoading] = useState(false);
 
  const handleResolve = async () => {
    setLoading(true);
    try {
      await syncResolveConflicts(resolution);
      onResolve();
    } catch (error) {
      console.error("Failed to resolve conflicts:", error);
    } finally {
      setLoading(false);
    }
  };
 
  const handleSelectAll = (choice: "local" | "remote") => {
    const newResolution: Record<string, "local" | "remote"> = {};
    conflicts.forEach((conflict) => {
      newResolution[conflict.key] = choice;
    });
    setResolution(newResolution);
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
          {t("syncConflict.description", "The following entries have conflicts. Choose which version to keep.")}
        </p>
 
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
        </div>
 
        {/* Conflict List */}
        <div className="space-y-4 mb-6">
          {conflicts.map((conflict) => (
            <div key={conflict.key} className="bg-gray-800 rounded p-4">
              <div className="flex justify-between items-center mb-3">
                <h3 className="font-medium text-white">{conflict.key}</h3>
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
                </div>
              </div>
 
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-gray-400 mb-1">{t("syncConflict.localValue", "Local Value")}</p>
                  <pre className="bg-gray-900 p-2 rounded text-xs text-gray-300 overflow-x-auto">
                    {conflict.localValue}
                  </pre>
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-1">{t("syncConflict.remoteValue", "Remote Value")}</p>
                  <pre className="bg-gray-900 p-2 rounded text-xs text-gray-300 overflow-x-auto">
                    {conflict.remoteValue}
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
            disabled={loading || Object.keys(resolution).length === 0}
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
 
        {Object.keys(resolution).length === 0 && (
          <p className="text-yellow-400 text-sm mt-2 text-center">
            {t("syncConflict.selectOne", "Please select at least one conflict to resolve")}
          </p>
        )}
      </div>
    </div>
  );
}