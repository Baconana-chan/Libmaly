import { render } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  cursorPosition,
  getCurrentWindow,
  LogicalPosition,
  LogicalSize,
  monitorFromPoint,
  primaryMonitor,
} from "@tauri-apps/api/window";
import "./App.css";

interface Screenshot {
  path: string;
  filename: string;
  timestamp: number;
  tags: string[];
}

interface OverlayScreenshotPayload {
  gamePath: string;
  gameTitle: string;
  screenshot: Screenshot;
  label?: string;
}

interface OverlayToast {
  id: string;
  gameTitle: string;
  screenshot: Screenshot;
  label: string;
}

const OVERLAY_WIDTH = 380;
const OVERLAY_HEIGHT = 220;
const OVERLAY_HEIGHT_WITH_HISTORY = 310;
const OVERLAY_MARGIN = 24;
const OVERLAY_TOAST_TTL_MS = 3600;
const MAX_HISTORY_ITEMS = 8;

function ScreenshotOverlayApp() {
  const [toasts, setToasts] = useState<OverlayToast[]>([]);
  const [history, setHistory] = useState<OverlayScreenshotPayload[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const timeoutIdsRef = useRef<Record<string, number>>({});

  // API server overlay widgets
  const [apiWidgets, setApiWidgets] = useState<
    { id: string; html: string; position?: string; width?: number; height?: number }[]
  >([]);

  const win = useMemo(() => getCurrentWindow(), []);

  useEffect(() => {
    document.documentElement.dataset.theme = "dark";
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    void win.setAlwaysOnTop(true).catch(() => {});
    void win.setSkipTaskbar(true).catch(() => {});
    void win.setIgnoreCursorEvents(true).catch(() => {});
    void win.hide().catch(() => {});
  }, [win]);

  useEffect(() => () => {
    for (const timeoutId of Object.values(timeoutIdsRef.current)) {
      window.clearTimeout(timeoutId);
    }
    timeoutIdsRef.current = {};
  }, []);

  const hideOverlaySoonIfEmpty = () => {
    window.setTimeout(() => {
      setToasts((current) => {
        if (current.length === 0) {
          void win.hide().catch(() => {});
        }
        return current;
      });
    }, 60);
  };

  const dismissToast = (id: string) => {
    const timeoutId = timeoutIdsRef.current[id];
    if (timeoutId) {
      window.clearTimeout(timeoutId);
      delete timeoutIdsRef.current[id];
    }
    setToasts((prev) => {
      const next = prev.filter((toast) => toast.id !== id);
      if (next.length === 0) hideOverlaySoonIfEmpty();
      return next;
    });
  };

  const positionOverlay = async () => {
    const pointer = await cursorPosition().catch(() => null);
    const targetMonitor = pointer
      ? await monitorFromPoint(pointer.x, pointer.y).catch(() => null)
      : null;
    const monitor = targetMonitor ?? await primaryMonitor().catch(() => null);
    if (!monitor) return;
    const scaleFactor = monitor.scaleFactor || 1;
    const width = OVERLAY_WIDTH;
    const height = showHistory ? OVERLAY_HEIGHT_WITH_HISTORY : OVERLAY_HEIGHT;
    const x = monitor.position.x / scaleFactor + monitor.size.width / scaleFactor - width - OVERLAY_MARGIN;
    const y = monitor.position.y / scaleFactor + monitor.size.height / scaleFactor - height - OVERLAY_MARGIN;
    await win.setSize(new LogicalSize(width, height)).catch(() => {});
    await win.setPosition(new LogicalPosition(x, y)).catch(() => {});
  };

  const showToast = async (payload: OverlayScreenshotPayload) => {
    const id = `${payload.screenshot.path}:${Date.now()}`;
    setToasts((prev) => [
      {
        id,
        gameTitle: payload.gameTitle,
        screenshot: payload.screenshot,
        label: payload.label || "Screenshot saved",
      },
      ...prev.filter((toast) => toast.screenshot.path !== payload.screenshot.path),
    ].slice(0, 3));
    const timeoutId = window.setTimeout(() => dismissToast(id), OVERLAY_TOAST_TTL_MS);
    timeoutIdsRef.current[id] = timeoutId;

    // Add to history strip
    setHistory((prev) => {
      const next = [payload, ...prev.filter((h) => h.screenshot.path !== payload.screenshot.path)].slice(0, MAX_HISTORY_ITEMS);
      return next;
    });
    setShowHistory(true);

    await positionOverlay();
    await win.show().catch(() => {});
  };

  useEffect(() => {
    let unlistenPromise: Promise<() => void> | null = null;
    unlistenPromise = listen<OverlayScreenshotPayload>("libmaly://screenshot-overlay-show", (event) => {
      void showToast(event.payload);
    });
    const unlistenWidgetPush = listen<{ id: string; html: string; position?: string; width?: number; height?: number }>(
      "api-overlay-widget-push",
      (ev) => {
        setApiWidgets((prev) => {
          const filtered = prev.filter((w) => w.id !== ev.payload.id);
          return [...filtered, ev.payload];
        });
      }
    );
    const unlistenWidgetRemove = listen<string>("api-overlay-widget-remove", (ev) => {
      setApiWidgets((prev) => prev.filter((w) => w.id !== ev.payload));
    });
    return () => {
      void unlistenPromise?.then((unlisten) => unlisten());
      void unlistenWidgetPush.then((f) => f());
      void unlistenWidgetRemove.then((f) => f());
    };
  }, []);

  return (
    <div
      className="w-screen h-screen p-4 flex items-end justify-end"
      style={{ background: "transparent", pointerEvents: "none" }}
    >
      <div className="flex flex-col gap-2 items-end">
        {/* History strip */}
        {showHistory && history.length > 0 && (
          <div
            className="rounded-2xl px-3 py-2.5"
            style={{
              width: 340,
              background: "linear-gradient(135deg, rgba(8,10,14,0.95), rgba(18,24,34,0.92))",
              border: "1px solid rgba(125, 170, 214, 0.22)",
              boxShadow: "0 18px 40px rgba(0,0,0,0.36)",
              backdropFilter: "blur(14px)",
              pointerEvents: "auto",
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-black uppercase tracking-[0.22em]" style={{ color: "#7cc5ff" }}>
                Recent Captures
              </span>
              <button
                onClick={() => { setShowHistory(false); setHistory([]); }}
                className="text-[10px] px-1.5 py-0.5 rounded"
                style={{ color: "rgba(196,210,227,0.5)" }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "rgba(255,255,255,0.8)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(196,210,227,0.5)"; }}
              >
                ✕
              </button>
            </div>
            <div className="flex gap-1.5 overflow-x-auto" style={{ scrollbarWidth: "thin" }}>
              {history.map((item, i) => (
                <button
                  key={item.screenshot.path + i}
                  className="flex-shrink-0 rounded-lg overflow-hidden transition-transform hover:scale-105"
                  style={{ width: 64, height: 42, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(125,170,214,0.15)" }}
                  onClick={async () => {
                    // Re-show this screenshot as a toast
                    await showToast(item);
                  }}
                  title={item.screenshot.filename}
                >
                  <img
                    src={convertFileSrc(item.screenshot.path)}
                    alt={item.screenshot.filename}
                    className="w-full h-full object-cover"
                  />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Toast notifications */}
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="flex items-center gap-3 rounded-2xl px-3 py-2.5"
            style={{
              width: 340,
              background: "linear-gradient(135deg, rgba(8,10,14,0.95), rgba(18,24,34,0.92))",
              border: "1px solid rgba(125, 170, 214, 0.22)",
              boxShadow: "0 18px 40px rgba(0,0,0,0.36)",
              backdropFilter: "blur(14px)",
            }}
          >
            <img
              src={convertFileSrc(toast.screenshot.path)}
              alt={toast.screenshot.filename}
              className="rounded-lg object-cover flex-shrink-0"
              style={{ width: 72, height: 48, background: "rgba(255,255,255,0.05)" }}
            />
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-black uppercase tracking-[0.22em]" style={{ color: "#7cc5ff" }}>
                {toast.label}
              </div>
              <div className="text-[13px] font-semibold truncate" style={{ color: "rgba(255,255,255,0.96)" }}>
                {toast.gameTitle}
              </div>
              <div className="text-[11px] truncate" style={{ color: "rgba(196,210,227,0.72)" }}>
                {toast.screenshot.filename}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* API overlay widgets */}
      {apiWidgets.map((widget) => {
        const pos = widget.position ?? "bottom-right";
        const posStyle: preact.JSX.CSSProperties = {};
        if (pos.includes("top")) posStyle.top = 16; else posStyle.bottom = 16;
        if (pos.includes("left")) posStyle.left = 16; else posStyle.right = 16;
        return (
          <div
            key={widget.id}
            style={{
              position: "fixed",
              ...posStyle,
              width: widget.width ?? 300,
              height: widget.height ?? "auto",
              background: "rgba(8,10,14,0.9)",
              border: "1px solid rgba(125,170,214,0.22)",
              borderRadius: 12,
              padding: 10,
              pointerEvents: "auto",
              color: "#fff",
              fontSize: 12,
              backdropFilter: "blur(10px)",
              zIndex: 9999,
            }}
            // Using dangerouslySetInnerHTML is intentional: API users supply HTML snippets
            // for their widgets. This is an advanced feature; only local API clients
            // (secured by bearer token) can inject widgets.
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: widget.html }}
          />
        );
      })}
    </div>
  );
}

render(<ScreenshotOverlayApp />, document.getElementById("root")!);
