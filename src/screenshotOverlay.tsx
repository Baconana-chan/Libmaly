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
const OVERLAY_MARGIN = 24;
const OVERLAY_TOAST_TTL_MS = 3600;

function ScreenshotOverlayApp() {
  const [toasts, setToasts] = useState<OverlayToast[]>([]);
  const timeoutIdsRef = useRef<Record<string, number>>({});

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
    const height = OVERLAY_HEIGHT;
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
    await positionOverlay();
    await win.show().catch(() => {});
  };

  useEffect(() => {
    let unlistenPromise: Promise<() => void> | null = null;
    unlistenPromise = listen<OverlayScreenshotPayload>("libmaly://screenshot-overlay-show", (event) => {
      void showToast(event.payload);
    });
    return () => {
      void unlistenPromise?.then((unlisten) => unlisten());
    };
  }, []);

  return (
    <div
      className="w-screen h-screen p-4 flex items-end justify-end"
      style={{ background: "transparent", pointerEvents: "none" }}
    >
      <div className="flex flex-col gap-2 items-end">
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
    </div>
  );
}

render(<ScreenshotOverlayApp />, document.getElementById("root")!);
