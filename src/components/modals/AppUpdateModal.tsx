import { invoke } from "@tauri-apps/api/core";
import { useState } from "preact/hooks";

export function AppUpdateModal({
  version,
  url,
  downloadUrl,
  onClose,
}: {
  version: string;
  url: string;
  downloadUrl: string;
  onClose: () => void;
}) {
  type Phase = "idle" | "downloading" | "done" | "error";
  const [phase, setPhase] = useState<Phase>("idle");
  const [errMsg, setErrMsg] = useState("");

  const handleInstall = async () => {
    if (!downloadUrl) return;
    setPhase("downloading");
    try {
      await invoke("apply_update", { downloadUrl });
      setPhase("done");
    } catch (e: any) {
      setErrMsg(String(e));
      setPhase("error");
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.82)" }} onClick={(e) => { if (e.target === e.currentTarget && phase !== "downloading") onClose(); }}>
      <div className="rounded-xl shadow-2xl w-[440px]" style={{ background: "#1e2d3d", border: "1px solid #2a475e" }}>
        <div className="flex items-center gap-3 px-6 pt-5 pb-4 border-b" style={{ borderColor: "#1b3a50" }}>
          <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "linear-gradient(135deg,#2a6db5,#1a4a80)" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#66c0f4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="16 16 12 12 8 16" /><line x1="12" y1="12" x2="12" y2="21" /><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
            </svg>
          </div>
          <div className="flex-1 min-w-0"><h2 className="font-bold text-base" style={{ color: "#fff" }}>Update Available</h2><p className="text-xs" style={{ color: "#8f98a0" }}>LIBMALY {version}</p></div>
          {phase !== "downloading" && <button onClick={onClose} className="text-xl leading-none" style={{ color: "#4a5568" }}>✕</button>}
        </div>
        <div className="px-6 py-5 space-y-4">
          {phase === "idle" && (
            <>
              <p className="text-sm leading-relaxed" style={{ color: "#b8c8d4" }}>
                A new version of LIBMALY is ready.{" "}
                {downloadUrl ? "Click Install Now to download and apply the update automatically." : "No automatic installer is available for this release yet."}
              </p>
              <div className="flex gap-3 justify-end pt-1">
                <a href={url} target="_blank" rel="noreferrer" className="px-4 py-2 rounded text-xs" style={{ background: "transparent", color: "#8f98a0", border: "1px solid #2a475e" }}>Changelog</a>
                {downloadUrl ? <button onClick={handleInstall} className="px-5 py-2 rounded text-sm font-semibold" style={{ background: "#2a6db5", color: "#fff" }}>Install Now</button> : <button onClick={onClose} className="px-4 py-2 rounded text-sm" style={{ background: "#2a3f54", color: "#c6d4df" }}>Close</button>}
              </div>
            </>
          )}
          {phase === "downloading" && <p className="text-sm" style={{ color: "#c6d4df" }}>Downloading and preparing update…</p>}
          {phase === "error" && <p className="text-xs" style={{ color: "#e57373" }}>{errMsg}</p>}
        </div>
      </div>
    </div>
  );
}
