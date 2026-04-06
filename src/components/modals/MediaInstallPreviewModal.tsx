import { useEffect, useState } from "preact/hooks";
import { invoke } from "@tauri-apps/api/core";
import { findMatchingWinePrefixEntry } from "../../lib/mediaPlaybackKnowledge";
import {
  diffPrefixMediaDiagnostics,
  formatWinetricksErrorWithHints,
  type MediaDiagFlags,
} from "../../lib/winetricksSupport";

interface PrefixMediaSlice extends MediaDiagFlags {
  summary: string;
}

function snapshotMedia(m: PrefixMediaSlice): MediaDiagFlags {
  return {
    has_media_foundation: m.has_media_foundation,
    has_quartz: m.has_quartz,
    has_wmp: m.has_wmp,
    has_lavfilters: m.has_lavfilters,
    has_wmv_decoder: m.has_wmv_decoder,
    likely_video_playback_issue: m.likely_video_playback_issue,
  };
}

export function MediaInstallPreviewModal({
  isOpen,
  onClose,
  prefixName,
  prefixPath,
  verbs,
  sourceLabel,
  beforeMedia,
  onFinished,
}: {
  isOpen: boolean;
  onClose: () => void;
  prefixName: string;
  prefixPath: string;
  verbs: string[];
  sourceLabel: string;
  beforeMedia: PrefixMediaSlice;
  onFinished?: () => void | Promise<void>;
}) {
  const [phase, setPhase] = useState<"preview" | "working" | "result">("preview");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [deltaLines, setDeltaLines] = useState<string[]>([]);

  useEffect(() => {
    if (isOpen) {
      setPhase("preview");
      setErrorText(null);
      setDeltaLines([]);
    }
  }, [isOpen, prefixPath, verbs.join("|")]);

  if (!isOpen) return null;

  const beforeFlags = snapshotMedia(beforeMedia);

  const runInstall = async () => {
    setPhase("working");
    setErrorText(null);
    setDeltaLines([]);
    try {
      await invoke("install_prefix_media_fixes", {
        prefix: prefixPath,
        verbs,
      });
      await onFinished?.();
      const list = await invoke<{ path: string; media: PrefixMediaSlice }[]>("list_wine_prefixes").catch(() => []);
      const row = findMatchingWinePrefixEntry(list, prefixPath);
      const afterFlags = row ? snapshotMedia(row.media) : beforeFlags;
      setDeltaLines(diffPrefixMediaDiagnostics(beforeFlags, afterFlags));
      setPhase("result");
    } catch (e) {
      setErrorText(formatWinetricksErrorWithHints(String(e)));
      setPhase("result");
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.82)" }}
      onClick={(ev) => {
        if (phase === "working") return;
        if (ev.target === ev.currentTarget) onClose();
      }}
    >
      <div
        className="rounded-xl shadow-2xl w-[min(480px,92vw)] max-h-[85vh] flex flex-col overflow-hidden"
        style={{ background: "var(--color-panel)", border: "1px solid var(--color-border-strong)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b flex items-center gap-2" style={{ borderColor: "var(--color-bg-deep)" }}>
          <span className="font-bold" style={{ color: "var(--color-white)" }}>
            {phase === "preview" ? "Install media components" : phase === "working" ? "Running winetricks…" : errorText ? "Install failed" : "Install finished"}
          </span>
        </div>

        <div className="px-5 py-4 overflow-y-auto text-sm space-y-3" style={{ color: "var(--color-text-soft)" }}>
          <p>
            <span className="opacity-70">Prefix </span>
            <span className="font-semibold" style={{ color: "var(--color-text)" }}>{prefixName}</span>
          </p>
          <p className="text-xs font-mono break-all opacity-80">{prefixPath}</p>
          <p className="text-xs">
            <span className="opacity-70">Source </span>
            <span style={{ color: "var(--color-accent-soft)" }}>{sourceLabel}</span>
          </p>

          {phase === "preview" && (
            <>
              <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                Winetricks will run (non-interactive):
              </p>
              <code className="block text-[11px] p-2 rounded font-mono whitespace-pre-wrap break-all" style={{ background: "var(--color-bg-code)", border: "1px solid var(--color-border)" }}>
                winetricks -q {verbs.join(" ")}
              </code>
              <p className="text-[11px]" style={{ color: "var(--color-text-dim)" }}>
                This may take several minutes and can download large Windows components.
              </p>
            </>
          )}

          {phase === "working" && (
            <p className="text-xs animate-pulse" style={{ color: "var(--color-text-muted)" }}>
              Please wait — do not close the app…
            </p>
          )}

          {phase === "result" && errorText && (
            <pre
              className="text-[11px] p-3 rounded whitespace-pre-wrap font-mono max-h-48 overflow-y-auto"
              style={{ background: "var(--color-danger-bg)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
            >
              {errorText}
            </pre>
          )}

          {phase === "result" && !errorText && (
            <div>
              <p className="text-xs font-semibold mb-2" style={{ color: "var(--color-success)" }}>
                Prefix re-scanned — component changes
              </p>
              <ul className="text-[11px] space-y-1 list-disc pl-4">
                {deltaLines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t" style={{ borderColor: "var(--color-bg-deep)" }}>
          {phase === "preview" && (
            <>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded text-sm"
                style={{ background: "var(--color-panel-2)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void runInstall()}
                disabled={verbs.length === 0}
                className="px-4 py-2 rounded text-sm font-semibold disabled:opacity-40"
                style={{ background: "var(--color-accent-dark)", color: "var(--color-white)" }}
              >
                Install
              </button>
            </>
          )}
          {(phase === "result" || phase === "working") && phase !== "working" && (
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded text-sm font-semibold"
              style={{ background: "var(--color-panel-3)", color: "var(--color-text)" }}
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
