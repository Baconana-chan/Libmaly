import { invoke } from "@tauri-apps/api/core";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ApiServerConfig {
  enabled: boolean;
  port: number;
  /** Comma-separated CORS origins, or "*" for all origins. */
  corsOrigins: string;
}

export interface ApiServerStatus {
  running: boolean;
  boundAddr: string | null;
  port: number;
}

// ── Invoke wrappers ───────────────────────────────────────────────────────────

export function invokeApiServerGetConfig(): Promise<ApiServerConfig> {
  return invoke<ApiServerConfig>("api_server_get_config");
}

export function invokeApiServerSaveConfig(config: ApiServerConfig): Promise<void> {
  return invoke<void>("api_server_save_config", { config });
}

export function invokeApiServerStatus(): Promise<ApiServerStatus> {
  return invoke<ApiServerStatus>("api_server_status");
}

export function invokeApiServerRegenerateToken(): Promise<string> {
  return invoke<string>("api_server_regenerate_token");
}

export function invokeApiServerGetToken(): Promise<string> {
  return invoke<string>("api_server_get_token");
}

/** Call after persisting state so WebSocket clients get a library-updated event. */
export function invokeApiServerNotifyLibraryUpdated(): Promise<void> {
  return invoke<void>("api_server_notify_library_updated");
}

/** Forward a game lifecycle event to WebSocket clients. */
export function invokeApiServerBroadcastGameEvent(
  eventType: string,
  payload: unknown,
): Promise<void> {
  return invoke<void>("api_server_broadcast_game_event", {
    eventType,
    payload,
  });
}
