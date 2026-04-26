import { useState } from "preact/hooks";
import { useTranslation } from "react-i18next";
import type { GameMetadata } from "../../types";

export function MetadataDiffModal({ oldMeta, newMeta, onConfirm, onClose }: {
  oldMeta: GameMetadata;
  newMeta: GameMetadata;
  onConfirm: (logNote: string | null) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const versionChanged = oldMeta.version !== newMeta.version;
  const oldV = oldMeta.version || "Unknown";
  const newV = newMeta.version || "Unknown";
  const [note, setNote] = useState("");
  const [wantsToLog, setWantsToLog] = useState(versionChanged);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.8)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rounded-lg p-6 w-[480px] shadow-2xl" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
        <h2 className="text-lg font-bold mb-4" style={{ color: "var(--color-white)" }}>{t('game.update.title')}</h2>

        <div className="space-y-3 mb-6">
          {versionChanged ? (
            <div className="p-3 rounded" style={{ background: "var(--color-panel-3)" }}>
              <p className="text-sm" style={{ color: "var(--color-text)" }}>
                {t('game.update.version_changed', { old: oldV, new: newV })}
              </p>
            </div>
          ) : (
            <div className="p-3 rounded" style={{ background: "var(--color-panel-2)" }}>
              <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                {t('game.update.no_version_change', { version: newV })}
              </p>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-text)" }}>
            <input type="checkbox" checked={wantsToLog} onChange={(e) => setWantsToLog(e.currentTarget.checked)} />
            {t('game.update.log_history')}
          </label>

          {wantsToLog && (
            <textarea
              className="w-full h-20 p-2 rounded text-sm outline-none resize-none"
              style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
              placeholder={t('game.update.placeholder', { version: newV })}
              value={note}
              onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)}
            />
          )}
        </div>

        <div className="flex gap-3 justify-end">
          <button onClick={onClose}
            className="px-4 py-2 rounded text-sm hover:opacity-80 transition-opacity"
            style={{ background: "var(--color-panel-2)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>{t('common.migration.cancel')}</button>
          <button onClick={() => onConfirm(wantsToLog ? note : null)}
            className="px-5 py-2 rounded text-sm font-semibold hover:opacity-80 transition-opacity"
            style={{ background: "var(--color-accent)", color: "var(--color-black-strong)" }}>
            {t('game.update.apply')}
          </button>
        </div>
      </div>
    </div>
  );
}
