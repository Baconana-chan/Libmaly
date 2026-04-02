import { useState, useEffect } from "preact/hooks";
import { useTranslation } from "react-i18next";
import { marked } from "marked";

export function WhatsNewModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [changelog, setChangelog] = useState<string>("");

  useEffect(() => {
    fetch("/CHANGELOG.md")
      .then((r) => r.text())
      .then((text) => setChangelog(text))
      .catch(() => setChangelog(""));
  }, []);

  const html = marked.parse(changelog, { breaks: true }) as string;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.82)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="rounded-xl shadow-2xl w-[680px] max-h-[82vh] flex flex-col"
        style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}
      >
        <div className="flex items-center gap-3 px-6 pt-5 pb-4 border-b flex-shrink-0" style={{ borderColor: "var(--color-border-card)" }}>
          <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "linear-gradient(135deg,var(--color-accent-dark),#1a4a80)" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-base" style={{ color: "var(--color-white)" }}>{t("whats_new.title")}</h2>
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>{t("whats_new.subtitle")}</p>
          </div>
          <button onClick={onClose} className="text-xl leading-none" style={{ color: "var(--color-text-dim)" }}>✕</button>
        </div>

        <div
          className="flex-1 overflow-y-auto px-6 py-5 markdown-body changelog-content"
          style={{ color: "var(--color-text-soft)" }}
          dangerouslySetInnerHTML={{ __html: html }}
        />

        <div className="flex gap-3 justify-end px-6 py-4 border-t flex-shrink-0" style={{ borderColor: "var(--color-border-card)" }}>
          <button
            onClick={onClose}
            className="px-5 py-2 rounded text-sm font-semibold"
            style={{ background: "var(--color-accent)", color: "var(--color-black-strong)" }}
          >
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
