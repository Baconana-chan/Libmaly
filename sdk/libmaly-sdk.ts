/**
 * Libmaly SDK
 *
 * TypeScript/JavaScript SDK for third-party tools, dashboards, and scripts
 * that communicate with a running Libmaly instance via its local REST/WebSocket API.
 *
 * Requirements:
 *   - Libmaly ≥ 1.9.0 running on the same machine
 *   - API server enabled in Settings → 🌐 API
 *   - Bearer token copied from Settings → 🌐 API → Bearer Token
 *
 * Node.js:  Node ≥ 22 (native WebSocket); or pass { WebSocketImpl: require("ws") }
 * Browser:  Any modern browser.
 *
 * @example
 * import { LibmalyClient } from "./libmaly-sdk";
 *
 * const client = new LibmalyClient({ token: "your-bearer-token" });
 * const status = await client.getStatus();
 * console.log("Active game:", status.activeGame?.exe ?? "none");
 */

// ── Types — REST responses ─────────────────────────────────────────────────

export interface SystemTelemetry {
  cpuUsage: number;
  ramUsedMb: number;
  ramTotalMb: number;
  gpuUsage: number | null;
  gpuName: string | null;
}

export interface ActiveGame {
  exe: string;
  pid: number;
  rootPid: number;
}

export interface StatusResponse {
  version: string;
  uptimeSecs: number;
  activeGame: ActiveGame | null;
  telemetry: SystemTelemetry;
}

export interface GameStats {
  totalSecs: number;
  sessionCount: number;
  lastPlayedMs: number | null;
  [key: string]: unknown;
}

export interface GameMeta {
  title?: string;
  developer?: string;
  version?: string;
  coverUrl?: string;
  tags?: string[];
  [key: string]: unknown;
}

export interface GameEntry {
  path: string;
  name: string | null;
  meta: GameMeta | null;
  stats: GameStats | null;
}

export interface LibraryResponse {
  games: GameEntry[];
}

export interface VolumeResponse {
  level: number | null;
  note?: string;
}

export interface NotesResponse {
  path: string;
  notes: string | null;
}

export interface NotifyOptions {
  title: string;
  body: string;
  icon?: string;
  /** Optional source identifier shown in the overlay */
  source?: string;
}

export type WidgetPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export interface WidgetOptions {
  position?: WidgetPosition;
  /** Width in pixels (default: 300) */
  width?: number;
  /** Height in pixels (default: auto) */
  height?: number;
}

// ── Types — WebSocket events ───────────────────────────────────────────────

export interface WsConnectedPayload {
  version: string;
}

export interface WsGameStartedPayload {
  path: string;
}

export interface WsGameFinishedPayload {
  path: string;
  durationSecs: number;
}

export interface WsTelemetryPayload {
  cpuUsage: number;
  ramUsedMb: number;
  ramTotalMb: number;
  gpuUsage: number | null;
  activeGame: { exe: string; pid: number } | null;
}

export interface WsNotificationPayload {
  title: string;
  body: string;
  icon?: string;
}

export interface WsOverlayWidgetPushPayload {
  id: string;
  html: string;
  position?: WidgetPosition;
  width?: number;
  height?: number;
}

export interface WsOverlayWidgetRemovePayload {
  id: string;
}

export interface WsVolumeRequestedPayload {
  level: number;
}

/** Map of WebSocket event names to their payload types */
export interface LibmalyEvents {
  connected: WsConnectedPayload;
  "game-started": WsGameStartedPayload;
  "game-finished": WsGameFinishedPayload;
  telemetry: WsTelemetryPayload;
  "library-updated": Record<string, never>;
  notification: WsNotificationPayload;
  "overlay-widget-push": WsOverlayWidgetPushPayload;
  "overlay-widget-remove": WsOverlayWidgetRemovePayload;
  "volume-requested": WsVolumeRequestedPayload;
  /** Wildcard — fired for every event with the raw message */
  "*": { type: string; payload: unknown };
}

type EventHandler<T> = (payload: T) => void;

// ── Client options ─────────────────────────────────────────────────────────

export interface LibmalyClientOptions {
  /** API host. Default: "127.0.0.1" */
  host?: string;
  /** API port configured in Libmaly. Default: 39510 */
  port?: number;
  /** Bearer token from Settings → 🌐 API → Bearer Token */
  token: string;
  /**
   * Custom WebSocket constructor.
   * Pass `require("ws")` for Node.js versions < 22.
   * @example
   * import WebSocket from "ws";
   * const client = new LibmalyClient({ token, WebSocketImpl: WebSocket });
   */
  WebSocketImpl?: new (url: string) => WebSocket;
  /** Automatically reconnect the WebSocket on disconnect. Default: true */
  autoReconnect?: boolean;
  /** Delay between reconnect attempts in milliseconds. Default: 3000 */
  reconnectDelayMs?: number;
}

// ── LibmalyApiError ────────────────────────────────────────────────────────

export class LibmalyApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    message: string,
  ) {
    super(message);
    this.name = "LibmalyApiError";
  }
}

// ── LibmalyClient ──────────────────────────────────────────────────────────

export class LibmalyClient {
  private readonly baseUrl: string;
  private readonly wsUrl: string;
  private readonly headers: Record<string, string>;
  private readonly WsImpl: new (url: string) => WebSocket;
  private readonly autoReconnect: boolean;
  private readonly reconnectDelayMs: number;

  private ws: WebSocket | null = null;
  private wsConnected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly listeners = new Map<string, Set<EventHandler<any>>>();

  constructor(options: LibmalyClientOptions) {
    const host = options.host ?? "127.0.0.1";
    const port = options.port ?? 39510;
    this.baseUrl = `http://${host}:${port}`;
    this.wsUrl = `ws://${host}:${port}/ws`;
    this.headers = {
      Authorization: `Bearer ${options.token}`,
      "Content-Type": "application/json",
    };
    this.WsImpl =
      options.WebSocketImpl ??
      (typeof WebSocket !== "undefined"
        ? WebSocket
        : (() => {
            throw new Error(
              "No WebSocket implementation found. Pass { WebSocketImpl: require('ws') } in options.",
            );
          })());
    this.autoReconnect = options.autoReconnect ?? true;
    this.reconnectDelayMs = options.reconnectDelayMs ?? 3000;
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      throw new LibmalyApiError(
        res.status,
        json,
        `Libmaly API error ${res.status}: ${JSON.stringify(json)}`,
      );
    }
    return json as T;
  }

  private get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  private post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("POST", path, body ?? {});
  }

  private del<T>(path: string): Promise<T> {
    return this.request<T>("DELETE", path);
  }

  // ── REST — Status & Library ──────────────────────────────────────────────

  /** Get app version, uptime, active game, and system telemetry */
  getStatus(): Promise<StatusResponse> {
    return this.get<StatusResponse>("/api/status");
  }

  /** Get the full game library with metadata and stats */
  getLibrary(): Promise<LibraryResponse> {
    return this.get<LibraryResponse>("/api/library");
  }

  /** Get a single game entry by its executable path */
  getGame(path: string): Promise<GameEntry> {
    return this.get<GameEntry>(`/api/library/game?path=${encodeURIComponent(path)}`);
  }

  // ── REST — Remote Control ────────────────────────────────────────────────

  /** Ask Libmaly to launch a game by its executable path */
  launch(path: string): Promise<{ ok: boolean }> {
    return this.post<{ ok: boolean }>("/api/launch", { path });
  }

  /** Kill the currently running game */
  kill(): Promise<{ ok: boolean }> {
    return this.post<{ ok: boolean }>("/api/kill");
  }

  /** Get current master volume level (0–100, or null if unavailable) */
  getVolume(): Promise<VolumeResponse> {
    return this.get<VolumeResponse>("/api/volume");
  }

  /** Request a master volume change (0–100) */
  setVolume(level: number): Promise<{ ok: boolean; level: number }> {
    return this.post<{ ok: boolean; level: number }>("/api/volume", { level });
  }

  // ── REST — State Access ──────────────────────────────────────────────────

  /** Get raw GameMetadata for a game */
  getMetadata(path: string): Promise<GameMeta | null> {
    return this.get<GameMeta | null>(`/api/metadata?path=${encodeURIComponent(path)}`);
  }

  /** Get GameStats for a game */
  getStats(path: string): Promise<GameStats | null> {
    return this.get<GameStats | null>(`/api/stats?path=${encodeURIComponent(path)}`);
  }

  /** Get notes text for a game */
  getNotes(path: string): Promise<NotesResponse> {
    return this.get<NotesResponse>(`/api/notes?path=${encodeURIComponent(path)}`);
  }

  // ── REST — Extension Hooks ───────────────────────────────────────────────

  /** Push a notification toast into the Libmaly overlay */
  notify(options: NotifyOptions): Promise<{ ok: boolean }> {
    return this.post<{ ok: boolean }>("/api/notify", options);
  }

  /**
   * Inject an HTML widget into the in-game overlay.
   *
   * The widget is rendered in a positioned `<div>` inside the overlay window.
   * Use the same `id` to update or remove the widget later.
   *
   * @example
   * await client.pushWidget("timer", "<b>Session: 01:23</b>", { position: "top-right" });
   */
  pushWidget(
    id: string,
    html: string,
    options?: WidgetOptions,
  ): Promise<{ ok: boolean }> {
    return this.post<{ ok: boolean }>("/api/overlay/widget", {
      id,
      html,
      ...options,
    });
  }

  /** Remove an overlay widget by its id */
  removeWidget(id: string): Promise<{ ok: boolean }> {
    return this.del<{ ok: boolean }>(`/api/overlay/widget/${encodeURIComponent(id)}`);
  }

  // ── WebSocket ────────────────────────────────────────────────────────────

  /**
   * Open the WebSocket connection to receive real-time events.
   *
   * Events are dispatched via `on()` handlers.
   * The connection is automatically restarted on disconnect unless
   * `disconnect()` is called explicitly or `autoReconnect` is `false`.
   */
  connect(): void {
    this.closed = false;
    this._openWs();
  }

  /** Close the WebSocket connection and stop auto-reconnect */
  disconnect(): void {
    this.closed = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.wsConnected = false;
  }

  /** Whether the WebSocket is currently connected */
  get isConnected(): boolean {
    return this.wsConnected;
  }

  /**
   * Register an event handler.
   *
   * @example
   * client.on("game-started", ({ path }) => console.log("Launched:", path));
   * client.on("telemetry", (t) => console.log("CPU:", t.cpuUsage));
   * client.on("*", ({ type, payload }) => console.log(type, payload));
   */
  on<K extends keyof LibmalyEvents>(
    event: K,
    handler: EventHandler<LibmalyEvents[K]>,
  ): this {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
    return this;
  }

  /** Remove a previously registered event handler */
  off<K extends keyof LibmalyEvents>(
    event: K,
    handler: EventHandler<LibmalyEvents[K]>,
  ): this {
    this.listeners.get(event)?.delete(handler);
    return this;
  }

  /** Remove all handlers for an event, or all handlers for all events */
  removeAllListeners(event?: keyof LibmalyEvents): this {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
    return this;
  }

  private _emit<K extends keyof LibmalyEvents>(
    event: K,
    payload: LibmalyEvents[K],
  ): void {
    this.listeners.get(event)?.forEach((h) => h(payload));
    if (event !== "*") {
      this.listeners.get("*")?.forEach((h) =>
        (h as EventHandler<LibmalyEvents["*"]>)({ type: event, payload }),
      );
    }
  }

  private _openWs(): void {
    if (this.closed) return;
    try {
      const ws = new this.WsImpl(
        `${this.wsUrl}?token=${encodeURIComponent(this.headers.Authorization.replace("Bearer ", ""))}`,
      );
      this.ws = ws as unknown as WebSocket;

      (ws as unknown as WebSocket).onopen = () => {
        this.wsConnected = true;
        // Auth header is sent via query param for WS since some clients can't set headers.
      };

      (ws as unknown as WebSocket).onmessage = (ev: MessageEvent) => {
        let msg: { type: string; payload: unknown };
        try {
          msg = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data));
        } catch {
          return;
        }
        const { type, payload } = msg;
        this._emit(type as keyof LibmalyEvents, payload as never);
      };

      (ws as unknown as WebSocket).onclose = () => {
        this.wsConnected = false;
        this.ws = null;
        if (!this.closed && this.autoReconnect) {
          this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this._openWs();
          }, this.reconnectDelayMs);
        }
      };

      (ws as unknown as WebSocket).onerror = () => {
        // onclose will fire next; no separate action needed.
      };
    } catch {
      if (!this.closed && this.autoReconnect) {
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          this._openWs();
        }, this.reconnectDelayMs);
      }
    }
  }

  // ── Utility ──────────────────────────────────────────────────────────────

  /**
   * Format seconds as a human-readable duration string.
   * @example LibmalyClient.formatDuration(3725) // → "1h 2m 5s"
   */
  static formatDuration(totalSecs: number): string {
    const h = Math.floor(totalSecs / 3600);
    const m = Math.floor((totalSecs % 3600) / 60);
    const s = Math.floor(totalSecs % 60);
    const parts: string[] = [];
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    if (s > 0 || parts.length === 0) parts.push(`${s}s`);
    return parts.join(" ");
  }

  /**
   * Wait until Libmaly API is reachable (polls every 1 s, up to `timeoutMs`).
   * Useful for scripts that start before Libmaly is fully running.
   */
  async waitForReady(timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastError: unknown;
    while (Date.now() < deadline) {
      try {
        await this.getStatus();
        return;
      } catch (e) {
        lastError = e;
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    throw new Error(`Libmaly not reachable after ${timeoutMs}ms: ${lastError}`);
  }
}

export default LibmalyClient;
