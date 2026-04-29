import { useEffect, useState } from "preact/hooks";
import {
  type ApiServerConfig,
  type ApiServerStatus,
  invokeApiServerGetConfig,
  invokeApiServerSaveConfig,
  invokeApiServerStatus,
  invokeApiServerGetToken,
  invokeApiServerRegenerateToken,
} from "../../lib/apiServer";

const DEFAULT_CONFIG: ApiServerConfig = {
  enabled: false,
  port: 39510,
  corsOrigins: "http://localhost:*",
};

// ── ApiServerTab ──────────────────────────────────────────────────────────────

export function ApiServerTab() {
  const [config, setConfig] = useState<ApiServerConfig>(DEFAULT_CONFIG);
  const [status, setStatus] = useState<ApiServerStatus | null>(null);
  const [token, setToken] = useState<string>("");
  const [tokenVisible, setTokenVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const loadAll = async () => {
    try {
      const [cfg, st, tok] = await Promise.all([
        invokeApiServerGetConfig(),
        invokeApiServerStatus(),
        invokeApiServerGetToken(),
      ]);
      setConfig(cfg);
      setStatus(st);
      setToken(tok);
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => { loadAll(); }, []);

  const save = async () => {
    setError(null);
    setSuccessMsg(null);
    setSaving(true);
    try {
      await invokeApiServerSaveConfig(config);
      const st = await invokeApiServerStatus();
      setStatus(st);
      setSuccessMsg(config.enabled ? `Server started on port ${config.port}` : "Server stopped.");
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const regenerateToken = async () => {
    if (!confirm("Generate a new API token? All existing clients will need to update their token.")) return;
    setError(null);
    try {
      const tok = await invokeApiServerRegenerateToken();
      setToken(tok);
      setSuccessMsg("New token generated.");
    } catch (e) {
      setError(String(e));
    }
  };

  const copyToken = () => {
    if (token) navigator.clipboard.writeText(token).catch(() => {});
  };

  const baseUrl = status?.boundAddr
    ? `http://${status.boundAddr}`
    : `http://127.0.0.1:${config.port}`;
  const wsUrl = baseUrl.replace("http://", "ws://") + "/ws";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header */}
      <div>
        <div style={{ fontWeight: 600, fontSize: 15 }}>🔌 REST / WebSocket API</div>
        <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 2 }}>
          Expose a local HTTP + WebSocket API on localhost so third-party tools, dashboards, and scripts can
          interact with Libmaly.
        </div>
      </div>

      {/* Status badge */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          style={{
            display: "inline-block",
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: status?.running ? "var(--color-success, #5ba85b)" : "var(--color-text-dim)",
          }}
        />
        <span style={{ fontSize: 12, color: status?.running ? "var(--color-success, #5ba85b)" : "var(--color-text-muted)" }}>
          {status?.running ? `Running — ${baseUrl}` : "Stopped"}
        </span>
      </div>

      {/* Enable toggle + port */}
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 16, alignItems: "center" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) =>
              setConfig((c) => ({ ...c, enabled: (e.target as HTMLInputElement).checked }))
            }
          />
          Enable API server
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--color-text-muted)" }}>
          Port:
          <input
            type="number"
            min={1024}
            max={65535}
            value={config.port}
            onInput={(e) =>
              setConfig((c) => ({
                ...c,
                port: parseInt((e.target as HTMLInputElement).value) || 39510,
              }))
            }
            style={{ ...inputStyle, width: 80 }}
          />
        </label>
      </div>

      {/* CORS */}
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
        <span style={{ color: "var(--color-text-muted)" }}>
          Allowed Origins (CORS) — comma-separated, or <code>*</code> for all
        </span>
        <input
          value={config.corsOrigins}
          onInput={(e) =>
            setConfig((c) => ({ ...c, corsOrigins: (e.target as HTMLInputElement).value }))
          }
          placeholder="http://localhost:*"
          style={inputStyle}
        />
      </label>

      {/* Save button */}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          disabled={saving}
          style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }}
          onClick={save}
        >
          {saving ? "Applying…" : "Apply & Restart"}
        </button>
      </div>

      {/* Feedback */}
      {error && (
        <div style={{ padding: "7px 12px", borderRadius: 6, background: "var(--color-danger-bg)", color: "var(--color-danger-strong)", fontSize: 12 }}>
          {error}
          <button style={{ marginLeft: 8, cursor: "pointer", background: "none", border: "none", color: "inherit" }} onClick={() => setError(null)}>✕</button>
        </div>
      )}
      {successMsg && (
        <div style={{ padding: "7px 12px", borderRadius: 6, background: "var(--color-panel-3)", color: "var(--color-text-muted)", fontSize: 12 }}>
          {successMsg}
          <button style={{ marginLeft: 8, cursor: "pointer", background: "none", border: "none", color: "inherit" }} onClick={() => setSuccessMsg(null)}>✕</button>
        </div>
      )}

      {/* Bearer token */}
      <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: 16 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Bearer Token</div>
        <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 8 }}>
          All requests must include <code>Authorization: Bearer &lt;token&gt;</code>.
          Keep this secret — anyone with the token can control Libmaly.
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type={tokenVisible ? "text" : "password"}
            readOnly
            value={token}
            style={{ ...inputStyle, flex: 1, fontFamily: "monospace", fontSize: 11 }}
          />
          <button style={btnSecondary} onClick={() => setTokenVisible((v) => !v)}>
            {tokenVisible ? "Hide" : "Show"}
          </button>
          <button style={btnSecondary} onClick={copyToken}>Copy</button>
          <button style={{ ...btnSecondary, color: "var(--color-warning)" }} onClick={regenerateToken}>
            Regenerate
          </button>
        </div>
      </div>

      {/* Endpoint reference */}
      {status?.running && (
        <EndpointReference baseUrl={baseUrl} wsUrl={wsUrl} />
      )}

      {/* SDK hint */}
      <div style={{ fontSize: 11, color: "var(--color-text-dim)", borderTop: "1px solid var(--color-border)", paddingTop: 10 }}>
        <strong>Security note:</strong> The server only binds to <code>127.0.0.1</code> (localhost) and is never exposed to the network.
        Use a reverse proxy if you need LAN access.
      </div>
    </div>
  );
}

// ── Endpoint reference ────────────────────────────────────────────────────────

function EndpointReference({ baseUrl, wsUrl }: { baseUrl: string; wsUrl: string }) {
  const rows: { method: string; path: string; desc: string }[] = [
    { method: "GET",    path: "/api/status",              desc: "App version, active game, CPU/RAM telemetry" },
    { method: "GET",    path: "/api/library",             desc: "Full game list with metadata + stats" },
    { method: "GET",    path: "/api/library/game?path=…", desc: "Single game entry" },
    { method: "POST",   path: "/api/launch",              desc: '{ "path": "…" }  — launch a game' },
    { method: "POST",   path: "/api/kill",                desc: "Kill the running game" },
    { method: "GET",    path: "/api/volume",              desc: "Current volume (informational)" },
    { method: "POST",   path: "/api/volume",              desc: '{ "level": 0–100 }  — request volume change' },
    { method: "GET",    path: "/api/metadata?path=…",     desc: "Raw GameMetadata for a game" },
    { method: "GET",    path: "/api/stats?path=…",        desc: "GameStats (playtime, sessions) for a game" },
    { method: "GET",    path: "/api/notes?path=…",        desc: "Notes text for a game" },
    { method: "POST",   path: "/api/notify",              desc: '{ "title", "body", "icon?" }  — push notification' },
    { method: "POST",   path: "/api/overlay/widget",      desc: '{ "id", "html", "position?" }  — inject overlay widget' },
    { method: "DELETE", path: "/api/overlay/widget/:id",  desc: "Remove an overlay widget" },
    { method: "WS",     path: "/ws",                      desc: "WebSocket — real-time events" },
  ];

  const methodColor = (m: string) => {
    switch (m) {
      case "GET":    return "#4a8ee8";
      case "POST":   return "var(--color-accent)";
      case "DELETE": return "var(--color-danger-strong)";
      case "WS":     return "#a170c8";
      default:       return "var(--color-text-muted)";
    }
  };

  return (
    <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: 14 }}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>
        Endpoints — <span style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 400 }}>{baseUrl}</span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead>
            <tr style={{ color: "var(--color-text-dim)", textAlign: "left" }}>
              <th style={{ padding: "3px 8px 3px 0", fontWeight: 600 }}>Method</th>
              <th style={{ padding: "3px 8px" }}>Path</th>
              <th style={{ padding: "3px 0 3px 8px" }}>Description</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.path} style={{ borderTop: "1px solid var(--color-border)" }}>
                <td style={{ padding: "4px 8px 4px 0", color: methodColor(r.method), fontWeight: 600, fontFamily: "monospace", whiteSpace: "nowrap" }}>
                  {r.method}
                </td>
                <td style={{ padding: "4px 8px", fontFamily: "monospace", whiteSpace: "nowrap" }}>
                  {r.method === "WS"
                    ? <span style={{ color: "var(--color-text-muted)" }}>{wsUrl}</span>
                    : r.path}
                </td>
                <td style={{ padding: "4px 0 4px 8px", color: "var(--color-text-muted)" }}>{r.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* WS event docs */}
      <div style={{ marginTop: 12 }}>
        <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 4, color: "var(--color-text-muted)" }}>
          WebSocket events (pushed to subscribers)
        </div>
        {[
          { type: "connected",            desc: "Sent on WS connect — includes server version" },
          { type: "game-started",         desc: "{ path }  — a game was launched" },
          { type: "game-finished",        desc: "{ path, durationSecs }  — game exited" },
          { type: "telemetry",            desc: "{ cpuUsage, ramUsedMb, … }  — pushed every 5 s" },
          { type: "library-updated",      desc: "Library state was persisted" },
          { type: "notification",         desc: "{ title, body }  — forwarded from POST /api/notify" },
          { type: "overlay-widget-push",  desc: "{ id, html, … }  — forwarded from POST /api/overlay/widget" },
          { type: "overlay-widget-remove",desc: "{ id }  — forwarded from DELETE /api/overlay/widget/:id" },
          { type: "volume-requested",     desc: "{ level }  — forwarded from POST /api/volume" },
        ].map((ev) => (
          <div key={ev.type} style={{ display: "flex", gap: 8, padding: "2px 0", fontSize: 11 }}>
            <code style={{ color: "#a170c8", whiteSpace: "nowrap", minWidth: 180 }}>{ev.type}</code>
            <span style={{ color: "var(--color-text-dim)" }}>{ev.desc}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const inputStyle: preact.JSX.CSSProperties = {
  background: "var(--color-panel-3)",
  border: "1px solid var(--color-border)",
  borderRadius: 5,
  color: "var(--color-text)",
  padding: "5px 8px",
  fontSize: 12,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

const btnPrimary: preact.JSX.CSSProperties = {
  padding: "7px 18px",
  borderRadius: 6,
  border: "1px solid var(--color-accent)",
  background: "var(--color-accent)",
  color: "#fff",
  fontSize: 12,
  cursor: "pointer",
  fontWeight: 600,
};

const btnSecondary: preact.JSX.CSSProperties = {
  padding: "5px 12px",
  borderRadius: 5,
  border: "1px solid var(--color-border)",
  background: "var(--color-panel-3)",
  color: "var(--color-text)",
  fontSize: 11,
  cursor: "pointer",
};
