import { useState, useEffect, useRef } from "preact/hooks";
import { useTranslation } from "react-i18next";
import type { GameAchievementItem } from "../../lib/gameAchievements";
import { newAchievementItem } from "../../lib/gameAchievements";

export function AchievementTrackerModal({
  displayTitle,
  initialItems,
  onSave,
  onClose,
}: {
  displayTitle: string;
  initialItems: GameAchievementItem[];
  onSave: (items: GameAchievementItem[]) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [items, setItems] = useState<GameAchievementItem[]>(() => [...initialItems]);
  const saveRef = useRef(onSave);
  saveRef.current = onSave;

  useEffect(() => {
    setItems([...initialItems]);
  }, [initialItems]);

  useEffect(() => {
    const tmr = setTimeout(() => saveRef.current(items), 450);
    return () => clearTimeout(tmr);
  }, [items]);

  const flushAndClose = () => {
    onSave(items);
    onClose();
  };

  const doneCount = items.filter((i) => i.done).length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.85)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) flushAndClose();
      }}
    >
      <div
        className="rounded-lg shadow-2xl flex flex-col"
        style={{
          background: "var(--color-panel)",
          border: "1px solid var(--color-border)",
          width: "560px",
          maxHeight: "78vh",
        }}
      >
        <div
          className="flex items-center gap-3 px-5 pt-4 pb-3 flex-shrink-0 border-b"
          style={{ borderColor: "var(--color-border-card)" }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
            <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
            <path d="M4 22h16" />
            <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
            <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
            <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
          </svg>
          <span className="font-bold flex-1" style={{ color: "var(--color-white)" }}>
            {t("game.achievements_modal_title", { title: displayTitle })}
          </span>
          <button
            type="button"
            onClick={flushAndClose}
            className="ml-1 text-xs px-3 py-1.5 rounded"
            style={{
              background: "var(--color-panel-3)",
              color: "var(--color-text)",
              border: "1px solid var(--color-border-strong)",
            }}
          >
            {t("common.close")}
          </button>
        </div>

        <div
          className="flex-1 overflow-y-auto px-5 py-4 space-y-2"
          style={{ scrollbarWidth: "thin", scrollbarColor: "var(--color-border) transparent" }}
        >
          {items.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
              {t("game.achievements_empty_hint")}
            </p>
          ) : (
            items.map((row) => (
              <div key={row.id} className="flex items-start gap-2 group">
                <label className="flex items-center pt-1.5 cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={row.done}
                    className="rounded"
                    style={{ accentColor: "var(--color-accent)" }}
                    onChange={() => {
                      setItems((prev) =>
                        prev.map((r) => (r.id === row.id ? { ...r, done: !r.done } : r))
                      );
                    }}
                  />
                </label>
                <input
                  type="text"
                  className="flex-1 min-w-0 text-sm px-2 py-1.5 rounded outline-none"
                  style={{
                    background: "var(--color-panel-deep)",
                    color: "var(--color-text)",
                    border: "1px solid var(--color-border)",
                  }}
                  placeholder={t("game.achievements_item_placeholder")}
                  value={row.label}
                  onInput={(e) => {
                    const v = (e.target as HTMLInputElement).value;
                    setItems((prev) => prev.map((r) => (r.id === row.id ? { ...r, label: v } : r)));
                  }}
                />
                <button
                  type="button"
                  title={t("common.remove")}
                  className="opacity-60 group-hover:opacity-100 text-xs px-2 py-1.5 rounded shrink-0"
                  style={{ color: "var(--color-text-dim)" }}
                  onClick={() => setItems((prev) => prev.filter((r) => r.id !== row.id))}
                >
                  ✕
                </button>
              </div>
            ))
          )}
        </div>

        <div
          className="flex items-center justify-between gap-3 px-5 py-3 flex-shrink-0 border-t"
          style={{ borderColor: "var(--color-border-card)" }}
        >
          <span className="text-[10px]" style={{ color: "var(--color-text-dim)" }}>
            {items.length > 0
              ? t("game.achievements_progress_label", { done: doneCount, total: items.length })
              : t("game.achievements_footer")}
          </span>
          <button
            type="button"
            onClick={() => setItems((prev) => [...prev, newAchievementItem()])}
            className="text-xs px-3 py-1.5 rounded font-medium"
            style={{
              background: "var(--color-accent-dark)",
              color: "var(--color-white)",
              border: "1px solid var(--color-border-strong)",
            }}
          >
            {t("game.achievements_add")}
          </button>
        </div>
      </div>
    </div>
  );
}
