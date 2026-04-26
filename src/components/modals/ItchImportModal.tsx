import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { normalizePathForMatch } from "../../lib/helpers";
import type {
  Game,
  GameCustomization,
  ItchButlerStatus,
  ItchGameUpdate,
  ItchInstallResult,
  ItchLibraryEntry,
  ItchOwnedLibrary,
  ItchUpdateCheckResult,
} from "../../types";

export function ItchImportModal({
  games,
  customizations,
  onImportInstalled,
  onClose,
}: {
  games: Game[];
  customizations: Record<string, GameCustomization>;
  onImportInstalled: (result: ItchInstallResult) => Promise<void>;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<ItchButlerStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [library, setLibrary] = useState<ItchOwnedLibrary | null>(null);
  const [updatesByCaveId, setUpdatesByCaveId] = useState<Record<string, ItchGameUpdate>>({});
  const [warnings, setWarnings] = useState<string[]>([]);
  const [installRoot, setInstallRoot] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  const importedCaveIds = useMemo(
    () => new Set(Object.values(customizations).map((custom) => custom.itchCaveId).filter((value): value is string => !!value)),
    [customizations],
  );

  const existingPaths = useMemo(
    () => new Set(games.map((game) => normalizePathForMatch(game.path))),
    [games],
  );

  const refreshLibrary = useCallback(async (forceFresh = false, nextApiKey?: string) => {
    const key = (nextApiKey ?? apiKey).trim();
    if (!key) {
      setError("Enter an itch.io API key first.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const nextLibrary = await invoke<ItchOwnedLibrary>("itch_butler_list_owned_games", {
        apiKey: key,
        search: null,
        fresh: forceFresh,
      });
      setLibrary(nextLibrary);
      if (!installRoot.trim() && nextLibrary.installLocations.length > 0) {
        setInstallRoot(nextLibrary.installLocations[0].path);
      }
      await invoke("set_api_key", { provider: "itch_io", key });
      if (nextLibrary.records.some((record) => record.caveIds.length > 0)) {
        const updateResult = await invoke<ItchUpdateCheckResult>("itch_butler_check_updates", {
          apiKey: key,
          caveIds: nextLibrary.records.flatMap((record) => record.caveIds),
        });
        setWarnings(updateResult.warnings);
        setUpdatesByCaveId(Object.fromEntries(updateResult.updates.map((update) => [update.caveId, update])));
      } else {
        setWarnings([]);
        setUpdatesByCaveId({});
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [apiKey, installRoot]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [butlerStatus, savedKey] = await Promise.all([
          invoke<ItchButlerStatus>("itch_butler_status"),
          invoke<string>("get_api_key", { provider: "itch_io" }).catch(() => ""),
        ]);
        if (cancelled) return;
        setStatus(butlerStatus);
        setApiKey(savedKey || "");
        if (butlerStatus.available && savedKey) {
          await refreshLibrary(false, savedKey);
        } else {
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(String(e));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshLibrary]);

  const filteredRecords = useMemo(() => {
    const lower = query.trim().toLowerCase();
    if (!library) return [];
    if (!lower) return library.records;
    return library.records.filter((record) => record.title.toLowerCase().includes(lower));
  }, [library, query]);

  const handlePickInstallRoot = async () => {
    const picked = await open({ directory: true, multiple: false }).catch(() => null);
    if (picked && typeof picked === "string") setInstallRoot(picked);
  };

  const handleInstall = async (entry: ItchLibraryEntry) => {
    const key = apiKey.trim();
    const target = installRoot.trim();
    if (!key) {
      setError("Enter an itch.io API key first.");
      return;
    }
    if (!target) {
      setError("Choose an install folder first.");
      return;
    }
    setBusyKey(`install:${entry.id}`);
    setError("");
    try {
      const result = await invoke<ItchInstallResult>("itch_butler_install_game", {
        apiKey: key,
        gameId: entry.id,
        installPath: target,
      });
      await onImportInstalled(result);
      await refreshLibrary(true, key);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyKey(null);
    }
  };

  const handleImportInstalled = async (entry: ItchLibraryEntry) => {
    if (!library || !entry.primaryCaveId || entry.installFolders.length === 0) {
      return;
    }
    const cave = library.caves.find((item) => item.id === entry.primaryCaveId);
    setBusyKey(`import:${entry.primaryCaveId}`);
    setError("");
    try {
      await onImportInstalled({
        gameId: entry.id,
        title: entry.title,
        caveId: entry.primaryCaveId,
        installFolder: entry.installFolders[0],
        uploadId: cave?.upload?.id ?? 0,
        buildId: cave?.build?.id ?? null,
      });
      await refreshLibrary(false, apiKey);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyKey(null);
    }
  };

  const handleUpdate = async (update: ItchGameUpdate) => {
    const choice = [...update.choices].sort((a, b) => b.confidence - a.confidence)[0];
    if (!choice) {
      setError(`No update choice is available for ${update.game.title}.`);
      return;
    }
    setBusyKey(`update:${update.caveId}`);
    setError("");
    try {
      const result = await invoke<ItchInstallResult>("itch_butler_apply_update", {
        apiKey,
        caveId: update.caveId,
        uploadId: choice.upload.id,
        buildId: choice.build?.id ?? choice.upload.build?.id ?? null,
      });
      await onImportInstalled(result);
      await refreshLibrary(true, apiKey);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.82)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="rounded-xl shadow-2xl w-[860px] max-h-[86vh] flex flex-col"
        style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
        <div className="flex items-center gap-3 px-6 pt-5 pb-4 border-b shrink-0" style={{ borderColor: "var(--color-border-card)" }}>
          <div className="w-9 h-9 rounded flex items-center justify-center" style={{ background: "#2b2316", color: "#ffcf8d" }}>
            io
          </div>
          <div>
            <h2 className="font-bold text-base" style={{ color: "var(--color-white)" }}>itch.io Butler</h2>
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              Browse owned purchases, install them with butler, and apply updates without leaving Libmaly.
            </p>
          </div>
          <button onClick={onClose} className="ml-auto text-xl" style={{ color: "var(--color-text-dim)" }}>✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4"
          style={{ scrollbarWidth: "thin", scrollbarColor: "var(--color-border) transparent" }}>
          <div className="rounded-lg p-4 space-y-3" style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border)" }}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>Butler status</div>
                <p className="mt-1 text-sm" style={{ color: status?.available ? "#9fe0a9" : "#ffb0a6" }}>
                  {status?.available ? `Detected ${status.version || "butler"}` : "butler was not found on this system"}
                </p>
                {status?.executablePath && (
                  <p className="text-[10px] break-all" style={{ color: "var(--color-text-dim)" }}>{status.executablePath}</p>
                )}
              </div>
              {!status?.available && (
                <button
                  onClick={() => { void openUrl(status?.installUrl || "https://itch.io/app"); }}
                  className="px-4 py-2 rounded text-sm font-medium"
                  style={{ background: "#3a2516", color: "#ffcf8d", border: "1px solid #7b5a25" }}
                >
                  Get itch app / butler
                </button>
              )}
            </div>

            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey((e.target as HTMLInputElement).value)}
              placeholder="itch.io API key"
              className="w-full px-3 py-2 rounded text-sm outline-none"
              style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
            />

            <div className="grid grid-cols-[1fr_auto_auto] gap-2">
              <input
                type="text"
                value={installRoot}
                onChange={(e) => setInstallRoot((e.target as HTMLInputElement).value)}
                placeholder="Default install folder for itch titles"
                className="w-full px-3 py-2 rounded text-sm outline-none"
                style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
              />
              <button
                onClick={() => { void handlePickInstallRoot(); }}
                className="px-4 py-2 rounded text-sm"
                style={{ background: "transparent", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}
              >
                Browse…
              </button>
              <button
                onClick={() => { void refreshLibrary(true); }}
                disabled={!status?.available || loading}
                className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
                style={{ background: "#2b2316", color: "#ffcf8d", border: "1px solid #7b5a25" }}
              >
                {loading ? "Loading..." : "Load Library"}
              </button>
            </div>

            {library && (
              <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                Signed in as {library.profile.user.displayName || library.profile.user.username}. Owned titles: {library.records.length}. Installed caves: {library.caves.length}.
              </p>
            )}
            {warnings.length > 0 && (
              <p className="text-xs" style={{ color: "#ffd89a" }}>{warnings[0]}</p>
            )}
            {error && <p className="text-sm" style={{ color: "var(--color-danger)" }}>{error}</p>}
          </div>

          {status?.available && library && (
            <>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery((e.target as HTMLInputElement).value)}
                placeholder="Filter owned itch titles"
                className="w-full px-3 py-2 rounded text-sm outline-none"
                style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
              />

              <div className="space-y-2">
                {filteredRecords.map((entry) => {
                  const update = entry.primaryCaveId ? updatesByCaveId[entry.primaryCaveId] : undefined;
                  const imported = !!entry.primaryCaveId && importedCaveIds.has(entry.primaryCaveId);
                  const importFolder = entry.installFolders[0] || null;
                  const alreadyExistsByPath = importFolder
                    ? Array.from(existingPaths).some((path) => path.startsWith(normalizePathForMatch(importFolder)))
                    : false;
                  return (
                    <div key={entry.id} className="rounded-lg p-3 flex gap-3 items-start"
                      style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border-soft)" }}>
                      {entry.cover ? (
                        <img src={entry.cover} alt={entry.title} className="w-12 h-12 rounded object-cover shrink-0" />
                      ) : (
                        <div className="w-12 h-12 rounded flex items-center justify-center shrink-0"
                          style={{ background: "var(--color-panel-3)", color: "var(--color-text-dim)" }}>
                          io
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium truncate" style={{ color: "var(--color-text)" }}>{entry.title}</p>
                          {entry.installed && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--color-success-bg)", color: "var(--color-success)" }}>
                              Installed
                            </span>
                          )}
                          {imported && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "#1b2f42", color: "#9ed2ff" }}>
                              Imported
                            </span>
                          )}
                          {update && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "#3f2f12", color: "#ffd483" }}>
                              Update available
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] mt-1" style={{ color: "var(--color-text-dim)" }}>
                          Game #{entry.id}{entry.installedAt ? ` · installed ${new Date(entry.installedAt).toLocaleString()}` : ""}
                        </p>
                        {importFolder && (
                          <p className="text-[10px] mt-1 break-all" style={{ color: "var(--color-text-muted)" }}>{importFolder}</p>
                        )}
                      </div>
                      <div className="flex flex-col gap-2 items-stretch min-w-[132px]">
                        <button
                          onClick={() => { void handleInstall(entry); }}
                          disabled={busyKey !== null || !status.available}
                          className="px-3 py-2 rounded text-xs font-semibold disabled:opacity-50"
                          style={{ background: "#2b2316", color: "#ffcf8d", border: "1px solid #7b5a25" }}
                        >
                          {busyKey === `install:${entry.id}` ? "Installing..." : entry.installed ? "Reinstall" : "Install"}
                        </button>
                        <button
                          onClick={() => { void handleImportInstalled(entry); }}
                          disabled={!entry.installed || !entry.primaryCaveId || busyKey !== null}
                          className="px-3 py-2 rounded text-xs disabled:opacity-50"
                          style={{ background: "transparent", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}
                        >
                          {busyKey === `import:${entry.primaryCaveId}` ? "Importing..." : imported ? "Re-import" : alreadyExistsByPath ? "Refresh Link" : "Import to Library"}
                        </button>
                        <button
                          onClick={() => { if (update) void handleUpdate(update); }}
                          disabled={!update || busyKey !== null}
                          className="px-3 py-2 rounded text-xs disabled:opacity-50"
                          style={{ background: "#203321", color: "#9fe0a9", border: "1px solid #38603a" }}
                        >
                          {busyKey === `update:${entry.primaryCaveId}` ? "Updating..." : "Apply Update"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {!loading && status?.available && library && filteredRecords.length === 0 && (
            <p className="text-sm text-center py-8" style={{ color: "var(--color-text-muted)" }}>
              No owned itch titles match your current filter.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
