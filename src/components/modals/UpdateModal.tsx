import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useState } from "preact/hooks";
import type { Game, UpdatePreview, UpdateResult } from "../../types";

export function UpdateModal({ game, onClose }: { game: Game; onClose: () => void }) {
  type Phase = "idle" | "previewing" | "ready" | "updating" | "done" | "error";
  const [phase, setPhase] = useState<Phase>("idle");
  const [sourcePath, setSourcePath] = useState("");
  const [preview, setPreview] = useState<UpdatePreview | null>(null);
  const [result, setResult] = useState<UpdateResult | null>(null);
  const [errMsg, setErrMsg] = useState("");

  const pickSource = async () => {
    const sel = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Game archive or folder", extensions: ["zip"] }],
    }).catch(() => null);
    if (sel && typeof sel === "string") {
      setSourcePath(sel);
      setPreview(null);
      setPhase("previewing");
      try {
        const p = await invoke<UpdatePreview>("preview_update", {
          gameExe: game.path,
          newSource: sel,
        });
        setPreview(p);
        setPhase("ready");
      } catch (e) {
        setErrMsg(String(e));
        setPhase("error");
      }
    }
  };

  const pickFolder = async () => {
    const sel = await open({ multiple: false, directory: true }).catch(() => null);
    if (sel && typeof sel === "string") {
      setSourcePath(sel);
      setPreview(null);
      setPhase("previewing");
      try {
        const p = await invoke<UpdatePreview>("preview_update", {
          gameExe: game.path,
          newSource: sel,
        });
        setPreview(p);
        setPhase("ready");
      } catch (e) {
        setErrMsg(String(e));
        setPhase("error");
      }
    }
  };

  const doUpdate = async () => {
    setPhase("updating");
    try {
      const r = await invoke<UpdateResult>("update_game", {
        gameExe: game.path,
        newSource: sourcePath,
      });
      setResult(r);
      setPhase("done");
    } catch (e) {
      setErrMsg(String(e));
      setPhase("error");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.85)" }}
      onClick={(e) => { if (e.target === e.currentTarget && phase !== "updating") onClose(); }}>
      <div className="rounded-lg shadow-2xl w-[520px] max-h-[90vh] overflow-y-auto"
        style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>

        <div className="flex items-center gap-3 px-6 pt-5 pb-4 border-b" style={{ borderColor: "var(--color-border-card)" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="16 16 12 12 8 16" /><line x1="12" y1="12" x2="12" y2="21" />
            <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
          </svg>
          <div>
            <h2 className="font-bold text-base" style={{ color: "var(--color-white)" }}>Update Game</h2>
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>{game.name}</p>
          </div>
        </div>

        <div className="px-6 py-5 space-y-4">
          {phase === "idle" && (
            <>
              <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                Point to the folder or <code>.zip</code> archive containing the new version.
                Save files and configs will be preserved automatically.
              </p>
              <div className="flex gap-3">
                <button onClick={pickFolder}
                  className="flex-1 py-2.5 rounded font-semibold text-sm"
                  style={{ background: "var(--color-border)", color: "var(--color-text)", border: "1px solid var(--color-accent-dark)" }}>
                  📁 Select Folder
                </button>
                <button onClick={pickSource}
                  className="flex-1 py-2.5 rounded font-semibold text-sm"
                  style={{ background: "var(--color-border)", color: "var(--color-text)", border: "1px solid var(--color-accent-dark)" }}>
                  🗜 Select ZIP
                </button>
              </div>
            </>
          )}

          {phase === "previewing" && (
            <div className="flex items-center gap-3 py-4">
              <span className="w-5 h-5 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
              <span className="text-sm" style={{ color: "var(--color-text-muted)" }}>Analysing…</span>
            </div>
          )}

          {phase === "ready" && preview && (
            <>
              <div className="rounded p-3 space-y-1 text-xs" style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-panel-3)" }}>
                <p className="text-xs font-mono break-all mb-2" style={{ color: "var(--color-accent)" }}>{sourcePath}</p>
                <div className="flex gap-4">
                  <span style={{ color: "var(--color-text-muted)" }}>Files to update</span>
                  <span className="font-semibold" style={{ color: "var(--color-text)" }}>
                    {preview.source_is_zip
                      ? `~${preview.zip_entry_count ?? "?"} (archive)`
                      : `${preview.files_to_update} existing + ${preview.new_files} new`}
                  </span>
                </div>
              </div>

              {preview.protected_dirs.length > 0 && (
                <div className="rounded p-3" style={{ background: "#1a2e1a", border: "1px solid #2a4a2a" }}>
                  <p className="text-xs font-semibold mb-2" style={{ color: "var(--color-success)" }}>🛡 Protected (will NOT be overwritten)</p>
                  <ul className="space-y-0.5">
                    {preview.protected_dirs.map((d) => (
                      <li key={d} className="text-xs font-mono" style={{ color: "#8bc48b" }}>↳ {d}</li>
                    ))}
                  </ul>
                  <p className="text-xs mt-2" style={{ color: "#5a8c5a" }}>
                    A backup of these directories will be saved to <code>.libmaly_backup</code> before updating.
                  </p>
                </div>
              )}

              {preview.protected_dirs.length === 0 && (
                <div className="rounded p-3" style={{ background: "var(--color-panel)", border: "1px solid #4a3a1a" }}>
                  <p className="text-xs" style={{ color: "var(--color-warning)" }}>
                    ⚠ No save directories detected. The update will overwrite all files.
                    Make sure you have a manual backup if needed.
                  </p>
                </div>
              )}

              <div className="flex gap-3 justify-end pt-1">
                <button onClick={() => { setPhase("idle"); setPreview(null); setSourcePath(""); }}
                  className="px-4 py-2 rounded text-sm"
                  style={{ background: "var(--color-panel-2)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>Back</button>
                <button onClick={doUpdate}
                  className="px-5 py-2 rounded text-sm font-bold"
                  style={{ background: "var(--color-play-bg)", color: "var(--color-play-text)" }}>Apply Update</button>
              </div>
            </>
          )}

          {phase === "updating" && (
            <div className="flex flex-col items-center gap-3 py-6">
              <span className="w-8 h-8 rounded-full border-4 border-blue-400 border-t-transparent animate-spin" />
              <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>Updating… please wait</p>
            </div>
          )}

          {phase === "done" && result && (
            <>
              <div className="rounded p-4" style={{ background: "#1a2e1a", border: "1px solid #2a4a2a" }}>
                <p className="font-semibold mb-3" style={{ color: "var(--color-success)" }}>✓ Update complete</p>
                <div className="space-y-1 text-xs">
                  <p style={{ color: "#8bc48b" }}>Files updated: <b>{result.files_updated}</b></p>
                  <p style={{ color: "#8bc48b" }}>Files skipped (protected): <b>{result.files_skipped}</b></p>
                  {result.protected_dirs.length > 0 && (
                    <p style={{ color: "#8bc48b" }}>
                      Saved backup → <code className="break-all">{result.backup_dir}</code>
                    </p>
                  )}
                </div>
              </div>
              {result.warnings.length > 0 && (
                <div className="rounded p-3" style={{ background: "var(--color-warning-bg-2)", border: "1px solid var(--color-warning-border)" }}>
                  <p className="text-xs font-semibold mb-1" style={{ color: "var(--color-warning)" }}>Warnings</p>
                  {result.warnings.map((w, i) => <p key={i} className="text-xs font-mono" style={{ color: "#a08030" }}>{w}</p>)}
                </div>
              )}
              <div className="flex justify-end">
                <button onClick={onClose}
                  className="px-5 py-2 rounded text-sm font-semibold"
                  style={{ background: "var(--color-border)", color: "var(--color-text)" }}>Close</button>
              </div>
            </>
          )}

          {phase === "error" && (
            <>
              <div className="rounded p-3" style={{ background: "var(--color-danger-bg)", border: "1px solid #8b2020" }}>
                <p className="text-xs font-semibold mb-1" style={{ color: "var(--color-danger)" }}>Error</p>
                <p className="text-xs font-mono break-all" style={{ color: "#c89090" }}>{errMsg}</p>
              </div>
              <div className="flex gap-3 justify-end">
                <button onClick={() => { setPhase("idle"); setErrMsg(""); setPreview(null); setSourcePath(""); }}
                  className="px-4 py-2 rounded text-sm"
                  style={{ background: "var(--color-panel-2)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>Back</button>
                <button onClick={onClose}
                  className="px-4 py-2 rounded text-sm"
                  style={{ background: "var(--color-panel-3)", color: "var(--color-text)" }}>Close</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
