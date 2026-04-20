import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { useTranslation } from "react-i18next";

interface ScreenshotItem {
  path: string;
  filename: string;
  timestamp: number;
  tags: string[];
}

function formatScreenshotMoment(timestamp: number, locale: string) {
  if (!timestamp) return "—";
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(timestamp * 1000));
  } catch {
    return new Date(timestamp * 1000).toLocaleString();
  }
}

function formatRelativeGap(deltaSeconds: number) {
  const abs = Math.abs(deltaSeconds);
  if (abs < 60) return `${abs}s`;
  if (abs < 3600) return `${Math.round(abs / 60)}m`;
  if (abs < 86400) return `${Math.round(abs / 3600)}h`;
  return `${Math.round(abs / 86400)}d`;
}

function ScreenshotMetaCard({
  label,
  shot,
  locale,
}: {
  label: string;
  shot: ScreenshotItem | null;
  locale: string;
}) {
  return (
    <div className="rounded-lg px-3 py-2" style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border-soft)" }}>
      <div className="text-[10px] uppercase tracking-[0.2em] font-bold" style={{ color: "var(--color-text-dim)" }}>
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold truncate" style={{ color: "var(--color-text)" }}>
        {shot?.filename || "—"}
      </div>
      <div className="mt-1 text-[11px]" style={{ color: "var(--color-text-muted)" }}>
        {shot ? formatScreenshotMoment(shot.timestamp, locale) : "—"}
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {(shot?.tags || []).length > 0 ? (
          shot?.tags.map((tag) => (
            <span
              key={`${label}-${tag}`}
              className="inline-flex rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide"
              style={{ background: "var(--color-border)", color: "var(--color-accent-soft)", border: "1px solid var(--color-border-strong)" }}
            >
              {tag}
            </span>
          ))
        ) : (
          <span className="text-[10px]" style={{ color: "var(--color-text-dim)" }}>—</span>
        )}
      </div>
    </div>
  );
}

export function ScreenshotComparisonModal({
  shots,
  initialLeftFilename,
  initialRightFilename,
  onClose,
}: {
  shots: ScreenshotItem[];
  initialLeftFilename?: string;
  initialRightFilename?: string;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const availableShots = useMemo(
    () => shots.slice().sort((left, right) => right.timestamp - left.timestamp),
    [shots],
  );
  const fallbackLeft = initialLeftFilename && availableShots.some((shot) => shot.filename === initialLeftFilename)
    ? initialLeftFilename
    : availableShots[0]?.filename ?? "";
  const fallbackRight = initialRightFilename && availableShots.some((shot) => shot.filename === initialRightFilename)
    ? initialRightFilename
    : availableShots.find((shot) => shot.filename !== fallbackLeft)?.filename ?? fallbackLeft;

  const [leftFilename, setLeftFilename] = useState(fallbackLeft);
  const [rightFilename, setRightFilename] = useState(fallbackRight);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [syncScroll, setSyncScroll] = useState(true);
  const [showDifferenceOverlay, setShowDifferenceOverlay] = useState(false);
  const leftPaneRef = useRef<HTMLDivElement>(null);
  const rightPaneRef = useRef<HTMLDivElement>(null);
  const scrollLockRef = useRef<"left" | "right" | null>(null);

  const leftShot = availableShots.find((shot) => shot.filename === leftFilename) ?? null;
  const rightShot = availableShots.find((shot) => shot.filename === rightFilename) ?? null;

  const comparisonSummary = useMemo(() => {
    if (!leftShot || !rightShot) return null;
    const leftTags = new Set(leftShot.tags || []);
    const rightTags = new Set(rightShot.tags || []);
    const sharedTags = [...leftTags].filter((tag) => rightTags.has(tag));
    const leftOnlyTags = [...leftTags].filter((tag) => !rightTags.has(tag));
    const rightOnlyTags = [...rightTags].filter((tag) => !leftTags.has(tag));
    return {
      timeGapSeconds: leftShot.timestamp - rightShot.timestamp,
      sharedTags,
      leftOnlyTags,
      rightOnlyTags,
    };
  }, [leftShot, rightShot]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    const leftPane = leftPaneRef.current;
    const rightPane = rightPaneRef.current;
    if (!leftPane || !rightPane) return;

    const sync = (source: HTMLDivElement, target: HTMLDivElement, sourceKey: "left" | "right") => {
      if (!syncScroll) return;
      if (scrollLockRef.current && scrollLockRef.current !== sourceKey) return;
      scrollLockRef.current = sourceKey;
      target.scrollLeft = source.scrollLeft;
      target.scrollTop = source.scrollTop;
      window.requestAnimationFrame(() => {
        if (scrollLockRef.current === sourceKey) {
          scrollLockRef.current = null;
        }
      });
    };

    const onLeftScroll = () => sync(leftPane, rightPane, "left");
    const onRightScroll = () => sync(rightPane, leftPane, "right");
    leftPane.addEventListener("scroll", onLeftScroll);
    rightPane.addEventListener("scroll", onRightScroll);
    return () => {
      leftPane.removeEventListener("scroll", onLeftScroll);
      rightPane.removeEventListener("scroll", onRightScroll);
    };
  }, [syncScroll]);

  if (availableShots.length < 2) {
    return null;
  }

  const renderPane = (label: string, primary: ScreenshotItem | null, secondary: ScreenshotItem | null, paneRef: typeof leftPaneRef) => (
    <div className="flex flex-col min-h-0">
      <ScreenshotMetaCard label={label} shot={primary} locale={i18n.language || "en"} />
      <div
        ref={paneRef}
        className="mt-3 flex-1 overflow-auto rounded-xl"
        style={{
          background: "linear-gradient(180deg, rgba(8,11,16,0.96), rgba(18,24,34,0.94))",
          border: "1px solid var(--color-border)",
          minHeight: 320,
          scrollbarWidth: "thin",
          scrollbarColor: "var(--color-border) transparent",
        }}
      >
        <div className="flex items-center justify-center min-h-full p-4">
          {primary ? (
            <div
              className="relative rounded-lg overflow-hidden shadow-2xl"
              style={{
                width: `${zoomPercent}%`,
                minWidth: zoomPercent > 100 ? `${zoomPercent}%` : "min(100%, 720px)",
                background: "#05070b",
                border: "1px solid rgba(124, 197, 255, 0.14)",
              }}
            >
              <img
                src={convertFileSrc(primary.path)}
                alt={primary.filename}
                className="block w-full h-auto"
                style={{ objectFit: "contain" }}
                draggable={false}
              />
              {showDifferenceOverlay && secondary && secondary.filename !== primary.filename && (
                <img
                  src={convertFileSrc(secondary.path)}
                  alt={secondary.filename}
                  className="absolute inset-0 w-full h-full pointer-events-none"
                  style={{ objectFit: "contain", mixBlendMode: "difference", opacity: 0.85 }}
                  draggable={false}
                />
              )}
            </div>
          ) : (
            <div className="text-sm" style={{ color: "var(--color-text-dim)" }}>
              {t("game.gallery.compare_empty")}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-10000 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.9)" }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="rounded-2xl flex flex-col overflow-hidden"
        style={{
          width: "min(1480px, 96vw)",
          maxHeight: "94vh",
          background: "var(--color-bg)",
          border: "1px solid var(--color-border-strong)",
          boxShadow: "0 28px 80px rgba(0,0,0,0.5)",
        }}
      >
        <div className="flex items-start gap-3 px-5 py-4 border-b" style={{ borderColor: "var(--color-border-soft)" }}>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-[0.22em] font-black" style={{ color: "var(--color-accent-soft)" }}>
              {t("game.gallery.compare_label")}
            </div>
            <h2 className="mt-1 text-lg font-bold" style={{ color: "var(--color-white)" }}>
              {t("game.gallery.compare_title")}
            </h2>
            <p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
              {t("game.gallery.compare_hint")}
            </p>
          </div>
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded text-xs font-semibold"
            style={{ background: "var(--color-panel-3)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}
          >
            {t("common.close")}
          </button>
        </div>

        <div className="px-5 py-4 border-b space-y-4" style={{ borderColor: "var(--color-border-soft)", background: "var(--color-bg-elev)" }}>
          <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr] items-end">
            <label className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              {t("game.gallery.compare_left")}
              <select
                value={leftFilename}
                onChange={(event) => setLeftFilename(event.currentTarget.value)}
                className="mt-1 w-full px-3 py-2 rounded text-sm outline-none"
                style={{ background: "var(--color-panel)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
              >
                {availableShots.map((shot) => (
                  <option key={`left-${shot.filename}`} value={shot.filename}>
                    {shot.filename}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={() => {
                setLeftFilename(rightFilename);
                setRightFilename(leftFilename);
              }}
              className="px-3 py-2 rounded text-xs font-semibold"
              style={{ background: "var(--color-panel-3)", color: "var(--color-accent)", border: "1px solid var(--color-border)" }}
            >
              {t("game.gallery.compare_swap")}
            </button>
            <label className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              {t("game.gallery.compare_right")}
              <select
                value={rightFilename}
                onChange={(event) => setRightFilename(event.currentTarget.value)}
                className="mt-1 w-full px-3 py-2 rounded text-sm outline-none"
                style={{ background: "var(--color-panel)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
              >
                {availableShots.map((shot) => (
                  <option key={`right-${shot.filename}`} value={shot.filename}>
                    {shot.filename}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="text-xs flex items-center gap-2" style={{ color: "var(--color-text-muted)" }}>
              {t("game.gallery.compare_zoom")}
              <input
                type="range"
                min="60"
                max="220"
                step="10"
                value={zoomPercent}
                onInput={(event) => setZoomPercent(parseInt(event.currentTarget.value, 10) || 100)}
              />
              <span className="text-[11px] font-semibold" style={{ color: "var(--color-text)" }}>{zoomPercent}%</span>
            </label>
            <button
              onClick={() => setZoomPercent(100)}
              className="px-2.5 py-1.5 rounded text-[11px] font-semibold"
              style={{ background: "var(--color-panel)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
            >
              {t("game.gallery.compare_reset_zoom")}
            </button>
            <label className="text-xs flex items-center gap-2" style={{ color: "var(--color-text-muted)" }}>
              <input type="checkbox" checked={syncScroll} onChange={(event) => setSyncScroll(event.currentTarget.checked)} />
              {t("game.gallery.compare_sync")}
            </label>
            <label className="text-xs flex items-center gap-2" style={{ color: "var(--color-text-muted)" }}>
              <input
                type="checkbox"
                checked={showDifferenceOverlay}
                onChange={(event) => setShowDifferenceOverlay(event.currentTarget.checked)}
              />
              {t("game.gallery.compare_difference")}
            </label>
          </div>

          {comparisonSummary && (
            <div className="grid gap-3 lg:grid-cols-[auto_1fr_1fr]">
              <div className="rounded-lg px-3 py-2" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border-soft)" }}>
                <div className="text-[10px] uppercase tracking-[0.18em] font-bold" style={{ color: "var(--color-text-dim)" }}>
                  {t("game.gallery.compare_gap")}
                </div>
                <div className="mt-1 text-sm font-semibold" style={{ color: "var(--color-text)" }}>
                  {formatRelativeGap(comparisonSummary.timeGapSeconds)}
                </div>
              </div>
              <div className="rounded-lg px-3 py-2" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border-soft)" }}>
                <div className="text-[10px] uppercase tracking-[0.18em] font-bold" style={{ color: "var(--color-text-dim)" }}>
                  {t("game.gallery.compare_shared_tags")}
                </div>
                <div className="mt-1 text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                  {comparisonSummary.sharedTags.length > 0 ? comparisonSummary.sharedTags.join(", ") : "—"}
                </div>
              </div>
              <div className="rounded-lg px-3 py-2" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border-soft)" }}>
                <div className="text-[10px] uppercase tracking-[0.18em] font-bold" style={{ color: "var(--color-text-dim)" }}>
                  {t("game.gallery.compare_tag_delta")}
                </div>
                <div className="mt-1 text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                  {[...comparisonSummary.leftOnlyTags, ...comparisonSummary.rightOnlyTags].length > 0
                    ? [...comparisonSummary.leftOnlyTags.map((tag) => `L:${tag}`), ...comparisonSummary.rightOnlyTags.map((tag) => `R:${tag}`)].join(", ")
                    : "—"}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2 px-5 py-5 overflow-auto" style={{ scrollbarWidth: "thin", scrollbarColor: "var(--color-border) transparent" }}>
          {renderPane(t("game.gallery.compare_left"), leftShot, rightShot, leftPaneRef)}
          {renderPane(t("game.gallery.compare_right"), rightShot, leftShot, rightPaneRef)}
        </div>
      </div>
    </div>
  );
}