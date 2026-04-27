import { render, type VNode } from "preact";
import type { ComponentChildren } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import {
  cursorPosition,
  getCurrentWindow,
  LogicalPosition,
  LogicalSize,
  monitorFromPoint,
  primaryMonitor,
} from "@tauri-apps/api/window";
import "./App.css";

// ── Types ─────────────────────────────────────────────────────────────────

interface Screenshot {
  path: string;
  filename: string;
  timestamp: number;
  tags: string[];
}

interface ScreenshotPayload {
  gamePath: string;
  gameTitle: string;
  screenshot: Screenshot;
  label?: string;
}

interface ScreenshotToast {
  id: string;
  gameTitle: string;
  screenshot: Screenshot;
  label: string;
}

interface AchievementItem {
  id: string;
  text: string;
  done: boolean;
}

interface SessionData {
  gamePath: string;
  gameTitle: string;
  coverUrl: string | null;
  notes: string | null;
  achievementItems: AchievementItem[];
  startTime: number;
  version: string | null;
  hasUpdate: boolean;
  newVersion: string | null;
}

interface OverlayNotification {
  id: string;
  type: "info" | "success" | "warning";
  title: string;
  message: string;
  timestamp: number;
}

type OverlayMode = "passive" | "active";
type ActiveTab = "notes" | "achievements" | "screenshots" | "notifications" | "browser";

interface SystemTelemetry {
  cpu_usage: number;
  ram_used_mb: number;
  ram_total_mb: number;
  gpu_usage: number | null;
  gpu_name: string | null;
}

// ── Constants ─────────────────────────────────────────────────────────────

const TOAST_TTL_MS = 3800;
const MAX_HISTORY = 8;

// ── Helpers ───────────────────────────────────────────────────────────────

function fmtDuration(startTime: number): string {
  const s = Math.floor((Date.now() - startTime) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`
    : `${m}:${String(ss).padStart(2, "0")}`;
}

// ── Browser quick-links ─────────────────────────────────────────────────────

const BROWSER_QUICK_LINKS: Array<{ label: string; url: string; icon: string }> = [
  { label: "F95zone",   url: "https://f95zone.to/latest/",  icon: "🎮" },
  { label: "DLsite",    url: "https://www.dlsite.com",       icon: "🏪" },
  { label: "VNDB",      url: "https://vndb.org",             icon: "📚" },
  { label: "Google",    url: "https://www.google.com",       icon: "🔍" },
  { label: "Wikipedia", url: "https://en.wikipedia.org",     icon: "📖" },
  { label: "YouTube",   url: "https://www.youtube.com",      icon: "▶️" },
];

// ── Sub-components ────────────────────────────────────────────────────────

function ToastCard({ toast, onDismiss }: { toast: ScreenshotToast; onDismiss: () => void }) {
  return (
    <div
      className="rounded-2xl overflow-hidden flex items-stretch"
      style={{
        width: 340,
        background: "linear-gradient(135deg, rgba(8,10,14,0.96), rgba(18,24,34,0.93))",
        border: "1px solid rgba(125,170,214,0.22)",
        boxShadow: "0 12px 32px rgba(0,0,0,0.5)",
        backdropFilter: "blur(14px)",
      }}
    >
      <div className="shrink-0" style={{ width: 72, height: 54 }}>
        <img
          src={convertFileSrc(toast.screenshot.path)}
          alt={toast.screenshot.filename}
          className="w-full h-full object-cover"
        />
      </div>
      <div className="flex-1 px-3 py-2 flex flex-col justify-center min-w-0">
        <p className="text-[11px] font-semibold truncate" style={{ color: "#7cc5ff" }}>
          {toast.label}
        </p>
        <p className="text-[10px] truncate mt-0.5" style={{ color: "rgba(200,215,230,0.55)" }}>
          {toast.screenshot.filename}
        </p>
      </div>
      <button
        className="flex items-center justify-center px-3 text-[11px] transition-colors"
        style={{ color: "rgba(200,215,230,0.35)" }}
        onMouseEnter={(e) => { e.currentTarget.style.color = "rgba(200,215,230,0.8)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(200,215,230,0.35)"; }}
        onClick={onDismiss}
      >
        ✕
      </button>
    </div>
  );
}

// ── Main overlay app ──────────────────────────────────────────────────────

function GameOverlayApp() {
  const win = useMemo(() => getCurrentWindow(), []);

  // Overlay state
  const [mode, setMode] = useState<OverlayMode>("passive");
  const [activeTab, setActiveTab] = useState<ActiveTab>("notes");

  // Session
  const [session, setSession] = useState<SessionData | null>(null);

  // In-game notifications
  const [notifications, setNotifications] = useState<OverlayNotification[]>([]);

  // Screenshot toasts & history
  const [toasts, setToasts] = useState<ScreenshotToast[]>([]);
  const [history, setHistory] = useState<ScreenshotPayload[]>([]);
  const toastTimers = useRef<Record<string, number>>({});

  // Session tick (re-render once per second to update timer)
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  void tick; // suppress unused-var warning

  // Note editor state — draft lives in the overlay, persisted via overlay-note-save
  const [liveNotes, setLiveNotes] = useState<string>("");
  // Keep liveNotes in sync when a new session arrives
  useEffect(() => { setLiveNotes(session?.notes ?? ""); }, [session]);

  // Browser state
  const [browserUrl, setBrowserUrl] = useState("");
  const openBrowser = useCallback(async (raw: string) => {
    let url = raw.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(url) && !url.includes(" ")) {
        url = "https://" + url;
      } else {
        url = "https://www.google.com/search?q=" + encodeURIComponent(url);
      }
    }
    await invoke("open_overlay_browser", { url }).catch(console.error);
  }, []);
  const closeBrowser = useCallback(() => {
    invoke("close_overlay_browser").catch(console.error);
  }, []);

  // System telemetry — polled every 1.5 s while a session is active
  const [telemetry, setTelemetry] = useState<SystemTelemetry | null>(null);
  useEffect(() => {
    if (!session) { setTelemetry(null); return; }
    const poll = async () => {
      try {
        const t = await invoke<SystemTelemetry>("get_system_telemetry");
        setTelemetry(t);
      } catch { /* ignore */ }
    };
    void poll();
    const id = setInterval(() => void poll(), 1500);
    return () => clearInterval(id);
  }, [session]);

  // ── Window initialisation ─────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.dataset.theme = "dark";
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";

    const init = async () => {
      await win.setAlwaysOnTop(true).catch(() => {});
      await win.setSkipTaskbar(true).catch(() => {});
      await win.setIgnoreCursorEvents(true).catch(() => {});

      // Size to the full monitor
      const ptr = await cursorPosition().catch(() => null);
      const monitor = ptr
        ? await monitorFromPoint(ptr.x, ptr.y).catch(() => null) ?? await primaryMonitor().catch(() => null)
        : await primaryMonitor().catch(() => null);
      if (monitor) {
        const sf = monitor.scaleFactor || 1;
        await win.setSize(new LogicalSize(
          monitor.size.width / sf,
          monitor.size.height / sf,
        )).catch(() => {});
        await win.setPosition(new LogicalPosition(
          monitor.position.x / sf,
          monitor.position.y / sf,
        )).catch(() => {});
      }
      await win.show().catch(() => {});
    };

    void init();

    return () => {
      for (const id of Object.values(toastTimers.current)) {
        window.clearTimeout(id);
      }
    };
  }, [win]);

  // ── Mode transitions ─────────────────────────────────────────────────

  const closeOverlay = useCallback(async () => {
    setMode("passive");
    await win.setIgnoreCursorEvents(true).catch(() => {});
  }, [win]);

  // ── Toast management ─────────────────────────────────────────────────

  const dismissToast = useCallback((id: string) => {
    const tid = toastTimers.current[id];
    if (tid) { window.clearTimeout(tid); delete toastTimers.current[id]; }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showScreenshotToast = useCallback((payload: ScreenshotPayload) => {
    const id = `${payload.screenshot.path}:${Date.now()}`;
    setToasts((prev) =>
      [
        { id, gameTitle: payload.gameTitle, screenshot: payload.screenshot, label: payload.label ?? "Screenshot saved" },
        ...prev.filter((t) => t.screenshot.path !== payload.screenshot.path),
      ].slice(0, 3)
    );
    const tid = window.setTimeout(() => dismissToast(id), TOAST_TTL_MS);
    toastTimers.current[id] = tid;

    setHistory((prev) =>
      [payload, ...prev.filter((h) => h.screenshot.path !== payload.screenshot.path)].slice(0, MAX_HISTORY)
    );
  }, [dismissToast]);

  // ── Event listeners ──────────────────────────────────────────────────

  useEffect(() => {
    const cleanups: Array<Promise<() => void>> = [];

    // Shift+Tab toggle from Rust keyboard hook
    cleanups.push(
      listen("libmaly://overlay-toggle", () => {
        setMode((prev) => {
          const next: OverlayMode = prev === "passive" ? "active" : "passive";
          if (next === "active") {
            void win.setIgnoreCursorEvents(false).catch(() => {});
          } else {
            void win.setIgnoreCursorEvents(true).catch(() => {});
          }
          return next;
        });
      })
    );

    // Game session start — receive data from App.tsx
    cleanups.push(
      listen<SessionData>("libmaly://overlay-session-start", (ev) => {
        setSession(ev.payload);
        setNotifications([]);
        setActiveTab("notes");
      })
    );

    // Game session end
    cleanups.push(
      listen("libmaly://overlay-session-end", () => {
        setSession(null);
        setMode("passive");
        void win.setIgnoreCursorEvents(true).catch(() => {});
      })
    );

    // In-game notifications
    cleanups.push(
      listen<OverlayNotification>("libmaly://overlay-notification", (ev) => {
        setNotifications((prev) => [ev.payload, ...prev].slice(0, 30));
        // Switch to notifications tab only if overlay is open
        setActiveTab((prev) => (prev === "notifications" ? prev : "notifications"));
      })
    );

    // Screenshot taken
    cleanups.push(
      listen<ScreenshotPayload>("libmaly://screenshot-overlay-show", (ev) => {
        showScreenshotToast(ev.payload);
      })
    );

    return () => {
      void Promise.all(cleanups.map((p) => p.then((u) => u())));
    };
  }, [win, showScreenshotToast]);

  // ── Render helpers ───────────────────────────────────────────────────

  const sessionTime = session ? fmtDuration(session.startTime) : "";

  const doneCount = session
    ? session.achievementItems.filter((a) => a.done).length
    : 0;
  const totalCount = session?.achievementItems.length ?? 0;

  const PANEL_BG = "linear-gradient(160deg, rgba(10,14,22,0.97) 0%, rgba(6,10,18,0.99) 100%)";
  const BORDER = "rgba(125,170,214,0.18)";
  const TEXT_DIM = "rgba(255,255,255,0.28)";
  const TEXT_MUTED = "rgba(255,255,255,0.55)";
  const TEXT_MAIN = "rgba(255,255,255,0.88)";
  const ACCENT = "#7cc5ff";

  const tabLabel: Record<ActiveTab, string> = {
    notes: "Notes",
    achievements: `Goals ${totalCount > 0 ? `${doneCount}/${totalCount}` : ""}`,
    screenshots: `Captures ${history.length > 0 ? `(${history.length})` : ""}`,
    notifications: `Alerts ${notifications.length > 0 ? `(${notifications.length})` : ""}`,
    browser: "Browser",
  };

  // ── JSX ──────────────────────────────────────────────────────────────

  return (
    <div className="w-screen h-screen overflow-hidden" style={{ background: "transparent", userSelect: "none" }}>

      {/* ── ACTIVE MODE ── */}
      {mode === "active" && (
        <div
          className="absolute inset-0 flex"
          style={{ background: "rgba(0,0,0,0.42)", backdropFilter: "blur(3px)", pointerEvents: "all" }}
          onClick={() => void closeOverlay()}
        >
          {/* Right panel — stop propagation so clicks inside don't close */}
          <div
            className="absolute right-0 top-0 h-full flex flex-col"
            style={{
              width: 460,
              background: PANEL_BG,
              borderLeft: `1px solid ${BORDER}`,
              boxShadow: "-20px 0 60px rgba(0,0,0,0.55)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* ── Header ── */}
            <div
              className="flex items-center gap-3 px-5 py-4 shrink-0 border-b"
              style={{ borderColor: BORDER }}
            >
              {/* Cover art */}
              {session?.coverUrl ? (
                <img
                  src={convertFileSrc(session.coverUrl)}
                  alt=""
                  className="shrink-0 rounded-sm object-cover"
                  style={{ width: 40, height: 56, border: "1px solid rgba(255,255,255,0.1)" }}
                />
              ) : (
                <div
                  className="shrink-0 rounded-sm flex items-center justify-center"
                  style={{ width: 40, height: 56, background: "rgba(255,255,255,0.05)", border: `1px solid ${BORDER}` }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={TEXT_DIM} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                </div>
              )}

              {/* Title + timer */}
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm truncate" style={{ color: TEXT_MAIN }}>
                  {session?.gameTitle ?? "No game running"}
                </p>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  {session ? (
                    <p className="text-xs tabular-nums" style={{ color: ACCENT }}>
                      {sessionTime}
                    </p>
                  ) : (
                    <p className="text-xs" style={{ color: TEXT_DIM }}>
                      Start a game to see session info
                    </p>
                  )}
                  {/* Version badge */}
                  {session?.version && (
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded font-mono"
                      style={{
                        background: session.hasUpdate ? "rgba(240,176,64,0.12)" : "rgba(125,170,214,0.1)",
                        color: session.hasUpdate ? "#f0b040" : "rgba(125,170,214,0.65)",
                        border: `1px solid ${session.hasUpdate ? "rgba(240,176,64,0.25)" : "rgba(125,170,214,0.18)"}`,
                      }}
                    >
                      v{session.version}
                    </span>
                  )}
                  {/* Update available badge */}
                  {session?.hasUpdate && session.newVersion && (
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
                      style={{
                        background: "rgba(240,176,64,0.14)",
                        color: "#f0b040",
                        border: "1px solid rgba(240,176,64,0.28)",
                      }}
                    >
                      ↑ {session.newVersion} available
                    </span>
                  )}
                </div>
              </div>

              {/* Libmaly logo badge */}
              <div
                className="shrink-0 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest"
                style={{ background: "rgba(125,170,214,0.1)", color: ACCENT, border: `1px solid rgba(125,170,214,0.2)` }}
              >
                LIBMALY
              </div>

              {/* Close */}
              <button
                className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-colors"
                style={{ background: "rgba(255,255,255,0.05)", color: TEXT_DIM }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.12)"; e.currentTarget.style.color = TEXT_MAIN; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; e.currentTarget.style.color = TEXT_DIM; }}
                onClick={() => void closeOverlay()}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* ── Tab bar ── */}
            <div className="flex shrink-0 border-b" style={{ borderColor: BORDER }}>
              {(["notes", "achievements", "screenshots", "notifications", "browser"] as ActiveTab[]).map((tab) => {
                const active = activeTab === tab;
                const hasBadge =
                  (tab === "notifications" && notifications.length > 0) ||
                  (tab === "achievements" && totalCount > 0 && doneCount < totalCount);
                return (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className="flex-1 py-2.5 text-[11px] font-medium relative transition-colors truncate px-1"
                    style={{ color: active ? ACCENT : TEXT_DIM, background: "transparent" }}
                    onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = TEXT_MUTED; }}
                    onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = TEXT_DIM; }}
                  >
                    {tabLabel[tab]}
                    {hasBadge && (
                      <span
                        className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full"
                        style={{ background: ACCENT }}
                      />
                    )}
                    {active && (
                      <span
                        className="absolute bottom-0 left-1/4 right-1/4 h-0.5 rounded-full"
                        style={{ background: "rgba(125,170,214,0.6)" }}
                      />
                    )}
                  </button>
                );
              })}
            </div>

            {/* ── Tab content ── */}
            <div
              className="flex-1 overflow-y-auto p-4"
              style={{ scrollbarWidth: "thin", scrollbarColor: `rgba(125,170,214,0.18) transparent` }}
            >
              {/* Notes — editable markdown editor */}
              {activeTab === "notes" && session && (
                <NoteEditor
                  gamePath={session.gamePath}
                  initialText={liveNotes}
                  onSaved={(text) => setLiveNotes(text)}
                  TEXT_DIM={TEXT_DIM}
                  TEXT_MUTED={TEXT_MUTED}
                  TEXT_MAIN={TEXT_MAIN}
                  ACCENT={ACCENT}
                  BORDER={BORDER}
                />
              )}
              {activeTab === "notes" && !session && (
                <EmptyState
                  icon={<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>}
                  text="No game running."
                  hint="Start a game to take notes."
                />
              )}

              {/* Achievements */}
              {activeTab === "achievements" && (
                session && session.achievementItems.length > 0 ? (
                  <div className="space-y-1.5">
                    {session.achievementItems.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-start gap-2.5 px-3 py-2 rounded-lg"
                        style={{
                          background: item.done ? "rgba(70,180,90,0.07)" : "rgba(255,255,255,0.03)",
                          border: `1px solid ${item.done ? "rgba(70,180,90,0.18)" : "rgba(255,255,255,0.05)"}`,
                        }}
                      >
                        <div
                          className="shrink-0 w-4 h-4 mt-0.5 rounded-full border flex items-center justify-center"
                          style={{
                            borderColor: item.done ? "rgba(70,180,90,0.6)" : "rgba(255,255,255,0.2)",
                            background: item.done ? "rgba(70,180,90,0.18)" : "transparent",
                          }}
                        >
                          {item.done && (
                            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#46b45a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </div>
                        <p
                          className="text-xs leading-relaxed flex-1"
                          style={{
                            color: item.done ? "rgba(255,255,255,0.38)" : TEXT_MUTED,
                            textDecoration: item.done ? "line-through" : "none",
                          }}
                        >
                          {item.text}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    icon={<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /><path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" /><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" /><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" /></svg>}
                    text="No achievement checklist for this game."
                    hint="Open Libmaly to add tracking goals."
                  />
                )
              )}

              {/* Screenshots */}
              {activeTab === "screenshots" && (
                history.length > 0 ? (
                  <div className="grid grid-cols-2 gap-2">
                    {history.map((item, i) => (
                      <div
                        key={item.screenshot.path + i}
                        className="rounded-lg overflow-hidden"
                        style={{
                          aspectRatio: "16/9",
                          background: "rgba(255,255,255,0.04)",
                          border: `1px solid ${BORDER}`,
                        }}
                      >
                        <img
                          src={convertFileSrc(item.screenshot.path)}
                          alt={item.screenshot.filename}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    icon={<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>}
                    text="No screenshots this session."
                    hint="Press F12 to capture."
                  />
                )
              )}

              {/* Notifications */}
              {activeTab === "notifications" && (
                notifications.length > 0 ? (
                  <div className="space-y-2">
                    {notifications.map((n) => (
                      <div
                        key={n.id}
                        className="p-3 rounded-lg"
                        style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${BORDER}` }}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className="text-[11px] font-semibold"
                            style={{ color: n.type === "warning" ? "#f0b040" : n.type === "success" ? "#46b45a" : ACCENT }}
                          >
                            {n.title}
                          </span>
                          <span className="text-[10px] ml-auto tabular-nums" style={{ color: TEXT_DIM }}>
                            {new Date(n.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        <p className="text-xs" style={{ color: TEXT_MUTED }}>{n.message}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    icon={<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>}
                    text="No alerts this session."
                  />
                )
              )}

              {/* Browser launcher */}
              {activeTab === "browser" && (
                <div className="flex flex-col gap-5">
                  {/* Quick links grid */}
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: TEXT_DIM }}>Quick Links</p>
                    <div className="grid grid-cols-2 gap-2">
                      {BROWSER_QUICK_LINKS.map((link) => (
                        <button
                          key={link.url}
                          onClick={() => void openBrowser(link.url)}
                          className="flex items-center gap-2 px-3 py-2 rounded-lg text-left text-[11px] transition-colors"
                          style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${BORDER}`, color: TEXT_MUTED }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(125,170,214,0.08)"; e.currentTarget.style.borderColor = "rgba(125,170,214,0.25)"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; e.currentTarget.style.borderColor = BORDER; }}
                        >
                          <span style={{ fontSize: 15 }}>{link.icon}</span>
                          <span>{link.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Custom URL / search */}
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: TEXT_DIM }}>Open URL or Search</p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={browserUrl}
                        onInput={(e) => setBrowserUrl((e.target as HTMLInputElement).value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void openBrowser(browserUrl); } }}
                        placeholder="https://… or search Google"
                        className="flex-1 rounded-lg px-3 text-xs h-8"
                        style={{ background: "rgba(255,255,255,0.05)", border: `1px solid ${BORDER}`, color: TEXT_MAIN, outline: "none", fontFamily: "inherit" }}
                        onFocus={(e) => { (e.target as HTMLInputElement).style.borderColor = "rgba(125,170,214,0.45)"; }}
                        onBlur={(e) => { (e.target as HTMLInputElement).style.borderColor = BORDER; }}
                      />
                      <button
                        onClick={() => void openBrowser(browserUrl)}
                        disabled={!browserUrl.trim()}
                        className="px-3 h-8 rounded-lg text-[11px] font-semibold shrink-0 transition-colors"
                        style={{
                          background: browserUrl.trim() ? "rgba(125,170,214,0.14)" : "rgba(255,255,255,0.04)",
                          color: browserUrl.trim() ? ACCENT : TEXT_DIM,
                          border: `1px solid ${browserUrl.trim() ? "rgba(125,170,214,0.28)" : BORDER}`,
                        }}
                      >
                        Open
                      </button>
                    </div>
                    <p className="text-[9px] mt-1.5" style={{ color: TEXT_DIM }}>Opens in a floating overlay browser · use its toolbar to navigate</p>
                  </div>

                  {/* Game-specific search shortcuts */}
                  {session && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: TEXT_DIM }}>Search for "{session.gameTitle}"</p>
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { label: "F95zone",  url: `https://f95zone.to/search/?q=${encodeURIComponent(session.gameTitle)}&t=post`, icon: "🎮" },
                          { label: "VNDB",     url: `https://vndb.org/v?q=${encodeURIComponent(session.gameTitle)}`, icon: "📚" },
                          { label: "DLsite",   url: `https://www.dlsite.com/home/fsr/=/keyword/${encodeURIComponent(session.gameTitle)}`, icon: "🏪" },
                          { label: "Google",   url: `https://www.google.com/search?q=${encodeURIComponent(session.gameTitle + " game")}`, icon: "🔍" },
                        ].map((link) => (
                          <button
                            key={link.label}
                            onClick={() => void openBrowser(link.url)}
                            className="flex items-center gap-2 px-3 py-2 rounded-lg text-left text-[11px] transition-colors"
                            style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${BORDER}`, color: TEXT_MUTED }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(125,170,214,0.08)"; e.currentTarget.style.borderColor = "rgba(125,170,214,0.25)"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; e.currentTarget.style.borderColor = BORDER; }}
                          >
                            <span style={{ fontSize: 15 }}>{link.icon}</span>
                            <span>{link.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Close browser */}
                  <button
                    onClick={closeBrowser}
                    className="flex items-center justify-center gap-2 w-full py-2 rounded-lg text-[11px] transition-colors"
                    style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${BORDER}`, color: TEXT_DIM }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,60,60,0.08)"; e.currentTarget.style.borderColor = "rgba(255,60,60,0.25)"; e.currentTarget.style.color = "rgba(255,100,100,0.7)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; e.currentTarget.style.borderColor = BORDER; e.currentTarget.style.color = TEXT_DIM; }}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                    Close Browser Window
                  </button>
                </div>
              )}
            </div>

            {/* ── Footer ── */}
            <div
              className="shrink-0 px-5 py-2.5 border-t"
              style={{ borderColor: BORDER }}
            >
              {/* Telemetry row */}
              {telemetry && (
                <div className="flex items-center gap-3 mb-2">
                  <TelemetryBadge label="CPU" value={`${telemetry.cpu_usage.toFixed(0)}%`} pct={telemetry.cpu_usage} />
                  <TelemetryBadge
                    label="RAM"
                    value={
                      telemetry.ram_total_mb >= 1024
                        ? `${(telemetry.ram_used_mb / 1024).toFixed(1)}G`
                        : `${telemetry.ram_used_mb}M`
                    }
                    pct={telemetry.ram_total_mb > 0 ? (telemetry.ram_used_mb / telemetry.ram_total_mb) * 100 : 0}
                  />
                  {telemetry.gpu_usage !== null && (
                    <TelemetryBadge label="GPU" value={`${telemetry.gpu_usage.toFixed(0)}%`} pct={telemetry.gpu_usage} />
                  )}
                  {telemetry.gpu_name && (
                    <span className="text-[9px] truncate ml-auto" style={{ color: TEXT_DIM, maxWidth: 140 }}>
                      {telemetry.gpu_name.split(" ").slice(0, 4).join(" ")}
                    </span>
                  )}
                </div>
              )}
              <p className="text-[10px] text-center" style={{ color: TEXT_DIM }}>
                <span style={{ color: "rgba(125,170,214,0.5)" }}>Shift+Tab</span>
                {" "}to close overlay &nbsp;·&nbsp;{" "}
                <span style={{ color: "rgba(125,170,214,0.5)" }}>F12</span>
                {" "}to screenshot
              </p>
            </div>
          </div>

          {/* Screenshot toasts — left of panel while overlay is open */}
          <div className="absolute bottom-4 flex flex-col gap-2 items-end" style={{ right: 460 + 16 }}>
            {toasts.map((t) => (
              <ToastCard key={t.id} toast={t} onDismiss={() => dismissToast(t.id)} />
            ))}
          </div>
        </div>
      )}

      {/* ── PASSIVE MODE ── screenshot toasts + stats widget ── */}
      {mode === "passive" && (
        <>
          {/* Screenshot toasts — bottom-right */}
          {toasts.length > 0 && (
            <div
              className="absolute bottom-4 right-4 flex flex-col gap-2 items-end"
              style={{ pointerEvents: "auto" }}
            >
              {toasts.map((t) => (
                <ToastCard key={t.id} toast={t} onDismiss={() => dismissToast(t.id)} />
              ))}
            </div>
          )}

          {/* System monitor widget — bottom-left, visible when a session is active */}
          {session && telemetry && (
            <StatsWidget telemetry={telemetry} />
          )}
        </>
      )}
    </div>
  );
}

// ── Stats widget (passive mode corner widget) ─────────────────────────────

function TelemetryBadge({ label, value, pct }: { label: string; value: string; pct: number }) {
  const color = pct > 80 ? "#f07050" : pct > 60 ? "#f0b040" : "#7cc5ff";
  return (
    <div className="flex items-center gap-1">
      <span className="text-[9px] font-bold uppercase" style={{ color: "rgba(255,255,255,0.3)" }}>{label}</span>
      <div
        className="rounded-full overflow-hidden"
        style={{ width: 36, height: 3, background: "rgba(255,255,255,0.1)" }}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.min(100, pct)}%`, background: color, transition: "width 0.6s ease" }}
        />
      </div>
      <span className="text-[9px] tabular-nums" style={{ color: "rgba(255,255,255,0.5)" }}>{value}</span>
    </div>
  );
}

function StatRow({
  label,
  value,
  pct,
  accent,
}: {
  label: string;
  value: string;
  pct: number; // 0–100
  accent?: string;
}) {
  const BAR_W = 72;
  const filled = Math.min(100, Math.max(0, pct));
  const color = accent ?? (filled > 80 ? "#f07050" : filled > 60 ? "#f0b040" : "#7cc5ff");
  return (
    <div className="flex items-center gap-2">
      <span className="w-6 text-right text-[9px] font-bold uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.35)" }}>
        {label}
      </span>
      {/* mini bar */}
      <div
        className="rounded-full overflow-hidden"
        style={{ width: BAR_W, height: 3, background: "rgba(255,255,255,0.1)" }}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${filled}%`, background: color, transition: "width 0.6s ease" }}
        />
      </div>
      <span className="text-[9px] tabular-nums" style={{ color: "rgba(255,255,255,0.55)", minWidth: 36 }}>
        {value}
      </span>
    </div>
  );
}

function StatsWidget({ telemetry }: { telemetry: SystemTelemetry }) {
  const ramPct = telemetry.ram_total_mb > 0
    ? (telemetry.ram_used_mb / telemetry.ram_total_mb) * 100
    : 0;
  const ramLabel = telemetry.ram_total_mb >= 1024
    ? `${(telemetry.ram_used_mb / 1024).toFixed(1)}/${(telemetry.ram_total_mb / 1024).toFixed(0)}G`
    : `${telemetry.ram_used_mb}/${telemetry.ram_total_mb}M`;

  return (
    <div
      className="absolute left-4 bottom-4 flex flex-col gap-1.5 pointer-events-none"
      style={{
        background: "linear-gradient(135deg, rgba(8,10,14,0.82), rgba(12,18,28,0.78))",
        border: "1px solid rgba(125,170,214,0.13)",
        borderRadius: 8,
        padding: "7px 10px",
        backdropFilter: "blur(8px)",
        boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
      }}
    >
      <StatRow label="CPU" value={`${telemetry.cpu_usage.toFixed(0)}%`} pct={telemetry.cpu_usage} />
      <StatRow label="RAM" value={ramLabel} pct={ramPct} />
      {telemetry.gpu_usage !== null && (
        <StatRow label="GPU" value={`${telemetry.gpu_usage.toFixed(0)}%`} pct={telemetry.gpu_usage} />
      )}
    </div>
  );
}

// ── Minimal Markdown renderer (bold, italic, code, headings, lists) ─────────

function SimpleMarkdown({ src, color }: { src: string; color: string }) {
  const lines = src.split("\n");
  const nodes: VNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Heading
    const hMatch = line.match(/^(#{1,3})\s+(.*)/s);
    if (hMatch) {
      const level = hMatch[1].length;
      const size = level === 1 ? "13px" : level === 2 ? "11.5px" : "11px";
      nodes.push(
        <p key={i} style={{ color, fontSize: size, fontWeight: 700, marginTop: 8, marginBottom: 2 }}>
          {inlineMarkdown(hMatch[2])}
        </p>
      );
      i++; continue;
    }
    // Unordered list item
    const ulMatch = line.match(/^[-*+]\s+(.*)/s);
    if (ulMatch) {
      nodes.push(
        <div key={i} style={{ display: "flex", gap: 6, marginTop: 2 }}>
          <span style={{ color: "rgba(125,170,214,0.55)", flexShrink: 0 }}>·</span>
          <span style={{ color, fontSize: "11px", lineHeight: 1.55 }}>{inlineMarkdown(ulMatch[1])}</span>
        </div>
      );
      i++; continue;
    }
    // Ordered list item
    const olMatch = line.match(/^(\d+)\.\s+(.*)/s);
    if (olMatch) {
      nodes.push(
        <div key={i} style={{ display: "flex", gap: 6, marginTop: 2 }}>
          <span style={{ color: "rgba(125,170,214,0.55)", flexShrink: 0, fontSize: "11px" }}>{olMatch[1]}.</span>
          <span style={{ color, fontSize: "11px", lineHeight: 1.55 }}>{inlineMarkdown(olMatch[2])}</span>
        </div>
      );
      i++; continue;
    }
    // Blank line
    if (line.trim() === "") {
      nodes.push(<div key={i} style={{ height: 6 }} />);
      i++; continue;
    }
    // Normal paragraph line
    nodes.push(
      <p key={i} style={{ color, fontSize: "11px", lineHeight: 1.6, marginBottom: 1 }}>
        {inlineMarkdown(line)}
      </p>
    );
    i++;
  }
  return <div style={{ fontFamily: "inherit" }}>{nodes}</div>;
}

type InlineNode = string | VNode;
function inlineMarkdown(text: string): InlineNode[] {
  // Process bold+italic, bold, italic, inline code in one pass
  const result: InlineNode[] = [];
  let rest = text;
  let key = 0;
  while (rest.length > 0) {
    // Bold-italic ***text***
    let m = rest.match(/^(.*)\*{3}(.+?)\*{3}(.*)/s);
    if (m) { if (m[1]) result.push(m[1]); result.push(<strong key={key++}><em>{m[2]}</em></strong>); rest = m[3]; continue; }
    // Bold **text**
    m = rest.match(/^(.*)\*{2}(.+?)\*{2}(.*)/s);
    if (m) { if (m[1]) result.push(m[1]); result.push(<strong key={key++}>{m[2]}</strong>); rest = m[3]; continue; }
    // Italic *text*
    m = rest.match(/^(.*)\*(.+?)\*(.*)/s);
    if (m) { if (m[1]) result.push(m[1]); result.push(<em key={key++}>{m[2]}</em>); rest = m[3]; continue; }
    // Inline code `text`
    m = rest.match(/^(.*)`(.+?)`(.*)/s);
    if (m) {
      if (m[1]) result.push(m[1]);
      result.push(
        <code key={key++} style={{ background: "rgba(125,170,214,0.12)", borderRadius: 3, padding: "0 3px", fontSize: "10.5px" }}>
          {m[2]}
        </code>
      );
      rest = m[3]; continue;
    }
    result.push(rest);
    break;
  }
  return result;
}

// ── Note editor sub-component ─────────────────────────────────────────────

interface NoteEditorProps {
  gamePath: string;
  initialText: string;
  onSaved: (newText: string) => void;
  TEXT_DIM: string;
  TEXT_MUTED: string;
  TEXT_MAIN: string;
  ACCENT: string;
  BORDER: string;
}

function NoteEditor({ gamePath, initialText, onSaved, TEXT_DIM, TEXT_MUTED, TEXT_MAIN, ACCENT, BORDER }: NoteEditorProps) {
  const [draft, setDraft] = useState(initialText);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) {
      taRef.current?.focus();
    }
  }, [editing]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await emit("libmaly://overlay-note-save", { gamePath, notes: draft });
      onSaved(draft);
    } catch { /* ignore */ } finally {
      setSaving(false);
    }
    setEditing(false);
  }, [draft, gamePath, onSaved]);

  const handleDiscard = useCallback(() => {
    setDraft(initialText);
    setEditing(false);
  }, [initialText]);

  // Ctrl+S / Cmd+S shortcut
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      void handleSave();
    } else if (e.key === "Escape") {
      handleDiscard();
    }
  }, [handleSave, handleDiscard]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-2 shrink-0" style={{ borderBottom: `1px solid ${BORDER}`, paddingBottom: 8 }}>
        <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: TEXT_DIM }}>Notes</span>
        {editing ? (
          <div className="flex items-center gap-2">
            <span className="text-[9px]" style={{ color: TEXT_DIM }}>Ctrl+S to save · Esc to discard</span>
            <button
              onClick={handleDiscard}
              className="text-[10px] px-2 py-0.5 rounded transition-colors"
              style={{ color: TEXT_DIM, background: "rgba(255,255,255,0.04)", border: `1px solid ${BORDER}` }}
              onMouseEnter={(e) => { e.currentTarget.style.color = TEXT_MUTED; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = TEXT_DIM; }}
            >
              Discard
            </button>
            <button
              onClick={() => void handleSave()}
              disabled={saving}
              className="text-[10px] px-2 py-0.5 rounded font-semibold transition-colors"
              style={{ color: ACCENT, background: "rgba(125,170,214,0.1)", border: `1px solid rgba(125,170,214,0.3)` }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(125,170,214,0.18)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(125,170,214,0.1)"; }}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded transition-colors"
            style={{ color: TEXT_DIM, background: "rgba(255,255,255,0.04)", border: `1px solid ${BORDER}` }}
            onMouseEnter={(e) => { e.currentTarget.style.color = TEXT_MAIN; e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = TEXT_DIM; e.currentTarget.style.borderColor = BORDER; }}
          >
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
            Edit
          </button>
        )}
      </div>

      {/* Content */}
      {editing ? (
        <textarea
          ref={taRef}
          value={draft}
          onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
          onKeyDown={handleKeyDown}
          placeholder="Write notes in plain Markdown…"
          className="flex-1 resize-none rounded-lg p-3 text-xs leading-relaxed"
          style={{
            background: "rgba(255,255,255,0.04)",
            border: `1px solid rgba(125,170,214,0.25)`,
            color: TEXT_MAIN,
            outline: "none",
            fontFamily: "inherit",
            minHeight: 0,
            scrollbarWidth: "thin",
            scrollbarColor: "rgba(125,170,214,0.18) transparent",
          }}
        />
      ) : (
        draft.trim() ? (
          <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(125,170,214,0.18) transparent" }}>
            <SimpleMarkdown src={draft} color={TEXT_MUTED} />
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center py-6 gap-3">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
            <p className="text-[11px] text-center" style={{ color: "rgba(255,255,255,0.22)" }}>
              No notes yet.<br />
              <span style={{ color: "rgba(255,255,255,0.14)" }}>Press Edit to write something.</span>
            </p>
          </div>
        )
      )}
    </div>
  );
}

// ── Empty state helper ────────────────────────────────────────────────────

function EmptyState({ icon, text, hint }: { icon: ComponentChildren; text: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3">
      <div style={{ color: "rgba(255,255,255,0.15)" }}>{icon}</div>
      <p className="text-xs text-center leading-relaxed" style={{ color: "rgba(255,255,255,0.3)" }}>
        {text}
        {hint && <><br /><span style={{ color: "rgba(255,255,255,0.18)" }}>{hint}</span></>}
      </p>
    </div>
  );
}

// ── Bootstrap ─────────────────────────────────────────────────────────────

render(<GameOverlayApp />, document.getElementById("root")!);
