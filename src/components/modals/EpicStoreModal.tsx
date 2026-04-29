// src/components/modals/EpicStoreModal.tsx
// Epic Games Store (EOS) integration modal – Settings, Status, Ownership check, Achievements.

import { useEffect, useState } from "preact/hooks";
import {
  eosGetConfig,
  eosSaveConfig,
  eosGetClientSecretSet,
  eosInitialize,
  eosShutdown,
  eosGetStatus,
  eosLogin,
  eosLogout,
  eosQueryOwnership,
  eosGetAchievements,
  type EosConfig,
  type EosStatusResult,
  type OwnershipResult,
  type EosAchievementDef,
} from "../../lib/eos";

// ── Style constants ────────────────────────────────────────────────────────────
const inputStyle: preact.JSX.CSSProperties = {
  background: "var(--color-panel-2)",
  color: "var(--color-text)",
  border: "1px solid var(--color-border)",
  borderRadius: 6,
  padding: "6px 10px",
  fontSize: 13,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};
const btnPrimary: preact.JSX.CSSProperties = {
  background: "var(--color-accent)",
  color: "var(--color-white)",
  border: "none",
  borderRadius: 6,
  padding: "7px 16px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};
const btnSecondary: preact.JSX.CSSProperties = {
  background: "var(--color-panel-2)",
  color: "var(--color-text-muted)",
  border: "1px solid var(--color-border)",
  borderRadius: 6,
  padding: "7px 16px",
  fontSize: 13,
  cursor: "pointer",
};
const btnDanger: preact.JSX.CSSProperties = {
  background: "var(--color-danger-strong)",
  color: "var(--color-white)",
  border: "none",
  borderRadius: 6,
  padding: "7px 16px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};
const labelStyle: preact.JSX.CSSProperties = {
  color: "var(--color-text-dim)",
  fontSize: 10,
  textTransform: "uppercase" as const,
  letterSpacing: "0.08em",
  display: "block",
  marginBottom: 4,
};
const sectionTitle: preact.JSX.CSSProperties = {
  color: "var(--color-text-muted)",
  fontSize: 11,
  textTransform: "uppercase" as const,
  letterSpacing: "0.08em",
  marginBottom: 8,
};

// ── Spinner ────────────────────────────────────────────────────────────────────
function Spinner() {
  return (
    <span
      style={{
        display: "inline-block",
        width: 12,
        height: 12,
        borderRadius: "50%",
        border: "2px solid currentColor",
        borderTopColor: "transparent",
        animation: "spin 0.7s linear infinite",
      }}
    />
  );
}

// ── Tab: Settings ──────────────────────────────────────────────────────────────
function SettingsTab({
  onChanged,
}: {
  onChanged: () => void;
}) {
  const [cfg, setCfg] = useState<EosConfig>({
    productId: "", sandboxId: "", deploymentId: "", clientId: "", enabled: false,
  });
  const [clientSecret, setClientSecret] = useState("");
  const [secretSet, setSecretSet] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    eosGetConfig().then(setCfg);
    eosGetClientSecretSet().then(setSecretSet);
  }, []);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      await eosSaveConfig(cfg, clientSecret || undefined);
      setMsg({ text: "Settings saved.", ok: true });
      if (clientSecret) {
        setSecretSet(true);
        setClientSecret("");
      }
      onChanged();
    } catch (e) {
      setMsg({ text: String(e), ok: false });
    } finally {
      setSaving(false);
    }
  };

  const field = (
    label: string,
    key: keyof EosConfig,
    placeholder: string,
    secret = false,
  ) => (
    <div style={{ marginBottom: 12 }}>
      <label style={labelStyle}>{label}</label>
      <input
        type={secret ? "password" : "text"}
        placeholder={placeholder}
        value={cfg[key] as string}
        onInput={(e) =>
          setCfg({ ...cfg, [key]: (e.target as HTMLInputElement).value })
        }
        style={inputStyle}
      />
    </div>
  );

  return (
    <div>
      <p style={{ color: "var(--color-text-muted)", fontSize: 12, marginBottom: 16 }}>
        Enter your Epic Developer Portal credentials. All values are stored locally;
        the Client Secret is stored in the OS keychain.
      </p>

      {/* Enable toggle */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 16,
          padding: "10px 14px",
          borderRadius: 8,
          background: "var(--color-panel-2)",
          border: "1px solid var(--color-border)",
        }}
      >
        <input
          type="checkbox"
          id="eos-enabled"
          checked={cfg.enabled}
          onChange={(e) =>
            setCfg({ ...cfg, enabled: (e.target as HTMLInputElement).checked })
          }
        />
        <label
          htmlFor="eos-enabled"
          style={{ color: "var(--color-text)", fontSize: 13, cursor: "pointer" }}
        >
          Enable Epic Games Store integration
        </label>
      </div>

      {field("Product ID", "productId", "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx")}
      {field("Sandbox ID", "sandboxId", "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx")}
      {field("Deployment ID", "deploymentId", "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx")}
      {field("Client ID", "clientId", "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")}

      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>
          Client Secret{" "}
          {secretSet && !clientSecret && (
            <span style={{ color: "var(--color-success)", marginLeft: 4 }}>
              ● stored in keychain
            </span>
          )}
        </label>
        <input
          type="password"
          placeholder={secretSet ? "Leave blank to keep current secret" : "Client secret"}
          value={clientSecret}
          onInput={(e) => setClientSecret((e.target as HTMLInputElement).value)}
          style={inputStyle}
        />
      </div>

      {msg && (
        <p
          style={{
            fontSize: 12,
            color: msg.ok ? "var(--color-success)" : "var(--color-danger)",
            marginBottom: 8,
          }}
        >
          {msg.text}
        </p>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button onClick={save} disabled={saving} style={btnPrimary}>
          {saving && <Spinner />} Save Settings
        </button>
      </div>
    </div>
  );
}

// ── Tab: Account ───────────────────────────────────────────────────────────────
function AccountTab({ onGoToSettings }: { onGoToSettings: () => void }) {
  const [status, setStatus] = useState<EosStatusResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sdkDisabled, setSdkDisabled] = useState(false);

  const refresh = async () => {
    try {
      setStatus(await eosGetStatus());
    } catch {
      /* not initialized */
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const init = async () => {
    setLoading(true);
    setError("");
    setSdkDisabled(false);
    try {
      await eosInitialize();
      await refresh();
    } catch (e) {
      const msg = String(e);
      if (msg.includes("disabled")) {
        setSdkDisabled(true);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const login = async (type: "persistent" | "account_portal") => {
    setLoading(true);
    setError("");
    try {
      await eosLogin(type);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    setLoading(true);
    setError("");
    try {
      await eosLogout();
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const shutdown = async () => {
    setLoading(true);
    try {
      await eosShutdown();
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const isInit = status?.isInitialized ?? false;
  const isLoggedIn = status?.isLoggedIn ?? false;

  return (
    <div>
      {/* SDK status row */}
      <div
        style={{
          padding: "10px 14px",
          borderRadius: 8,
          background: "var(--color-panel-2)",
          border: "1px solid var(--color-border)",
          marginBottom: 16,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div>
          <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
            SDK&nbsp;
            <span
              style={{
                color: isInit ? "var(--color-success)" : "var(--color-text-dim)",
                fontWeight: 600,
              }}
            >
              {isInit ? "Initialized" : "Not loaded"}
            </span>
            {status?.sdkVersion && (
              <span style={{ marginLeft: 8, color: "var(--color-text-dim)", fontSize: 11 }}>
                v{status.sdkVersion}
              </span>
            )}
          </div>
          {isLoggedIn && status?.accountId && (
            <div style={{ marginTop: 4, fontSize: 11, color: "var(--color-text-dim)" }}>
              Account ID: <code style={{ userSelect: "text" }}>{status.accountId}</code>
            </div>
          )}
        </div>
        {isInit && (
          <button onClick={shutdown} disabled={loading} style={btnSecondary}>
            Unload
          </button>
        )}
      </div>

      {/* Login status */}
      <div
        style={{
          padding: "10px 14px",
          borderRadius: 8,
          background: "var(--color-panel-2)",
          border: "1px solid var(--color-border)",
          marginBottom: 16,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span style={{ fontSize: 13, color: "var(--color-text)" }}>
          {isLoggedIn ? "✓ Logged in to Epic Account" : "Not logged in"}
        </span>
        {isLoggedIn && (
          <button onClick={logout} disabled={loading} style={btnDanger}>
            {loading && <Spinner />} Log Out
          </button>
        )}
      </div>

      {sdkDisabled && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            background: "rgba(255,160,0,.1)",
            border: "1px solid rgba(255,160,0,.35)",
            marginBottom: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <span style={{ fontSize: 12, color: "var(--color-text)" }}>
            EOS SDK is disabled. Enable it in the Settings tab first.
          </span>
          <button
            onClick={onGoToSettings}
            style={{ ...btnPrimary, flexShrink: 0, fontSize: 11, padding: "5px 12px" }}
          >
            Go to Settings
          </button>
        </div>
      )}

      {error && (
        <p style={{ fontSize: 12, color: "var(--color-danger)", marginBottom: 8 }}>{error}</p>
      )}

      {/* Action buttons */}
      <p style={sectionTitle}>Actions</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {!isInit && (
          <button onClick={init} disabled={loading} style={btnPrimary}>
            {loading && <Spinner />} Load EOS SDK
          </button>
        )}
        {isInit && !isLoggedIn && (
          <>
            <button
              onClick={() => login("persistent")}
              disabled={loading}
              style={btnPrimary}
              title="Silent re-login using stored token"
            >
              {loading && <Spinner />} Silent Login (Persistent)
            </button>
            <button
              onClick={() => login("account_portal")}
              disabled={loading}
              style={{ ...btnPrimary, background: "var(--color-accent-2, var(--color-accent))" }}
              title="Opens Epic Account login in browser"
            >
              {loading && <Spinner />} Login via Account Portal
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Tab: Ownership ─────────────────────────────────────────────────────────────
function OwnershipTab() {
  const [input, setInput] = useState("");
  const [results, setResults] = useState<OwnershipResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const query = async () => {
    const ids = input
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!ids.length) return;
    setLoading(true);
    setError("");
    try {
      setResults(await eosQueryOwnership(ids));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <p style={{ color: "var(--color-text-muted)", fontSize: 12, marginBottom: 12 }}>
        Enter one EGS Catalog Item ID per line (or comma-separated). Must be logged in.
      </p>
      <textarea
        rows={4}
        placeholder={"ItemId1\nItemId2\n..."}
        value={input}
        onInput={(e) => setInput((e.target as HTMLTextAreaElement).value)}
        style={{ ...inputStyle, resize: "vertical", fontFamily: "monospace" }}
      />
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8, marginBottom: 12 }}>
        <button onClick={query} disabled={loading} style={btnPrimary}>
          {loading && <Spinner />} Check Ownership
        </button>
      </div>
      {error && (
        <p style={{ fontSize: 12, color: "var(--color-danger)", marginBottom: 8 }}>{error}</p>
      )}
      {results.length > 0 && (
        <div
          style={{
            borderRadius: 6,
            border: "1px solid var(--color-border)",
            overflow: "hidden",
          }}
        >
          {results.map((r) => (
            <div
              key={r.catalogItemId}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "7px 12px",
                borderBottom: "1px solid var(--color-border)",
                background: "var(--color-panel-2)",
                fontSize: 13,
              }}
            >
              <span style={{ fontFamily: "monospace", color: "var(--color-text)" }}>
                {r.catalogItemId}
              </span>
              <span
                style={{
                  color: r.owned ? "var(--color-success)" : "var(--color-text-dim)",
                  fontWeight: 600,
                  fontSize: 11,
                  textTransform: "uppercase",
                }}
              >
                {r.owned ? "Owned" : "Not Owned"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Tab: Achievements ──────────────────────────────────────────────────────────
function AchievementsTab() {
  const [defs, setDefs] = useState<EosAchievementDef[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setDefs(await eosGetAchievements());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const filtered = filter
    ? defs.filter(
        (d) =>
          d.achievementId.toLowerCase().includes(filter.toLowerCase()) ||
          d.displayName.toLowerCase().includes(filter.toLowerCase()),
      )
    : defs;

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button onClick={load} disabled={loading} style={btnPrimary}>
          {loading && <Spinner />} Fetch Definitions
        </button>
        {defs.length > 0 && (
          <input
            placeholder="Filter…"
            value={filter}
            onInput={(e) => setFilter((e.target as HTMLInputElement).value)}
            style={{ ...inputStyle, maxWidth: 200 }}
          />
        )}
      </div>
      {error && (
        <p style={{ fontSize: 12, color: "var(--color-danger)", marginBottom: 8 }}>{error}</p>
      )}
      {defs.length > 0 && (
        <p style={{ fontSize: 11, color: "var(--color-text-dim)", marginBottom: 8 }}>
          {filtered.length} / {defs.length} achievements
        </p>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {filtered.map((d) => (
          <div
            key={d.achievementId}
            style={{
              padding: "8px 12px",
              borderRadius: 6,
              border: "1px solid var(--color-border)",
              background: "var(--color-panel-2)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {d.unlockedIconUrl && (
                <img
                  src={d.unlockedIconUrl}
                  alt=""
                  style={{ width: 28, height: 28, borderRadius: 4, objectFit: "cover" }}
                />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--color-text)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {d.displayName || d.achievementId}
                </div>
                {d.description && (
                  <div style={{ fontSize: 11, color: "var(--color-text-dim)" }}>
                    {d.description}
                  </div>
                )}
              </div>
              {d.isHidden && (
                <span
                  style={{
                    fontSize: 10,
                    padding: "2px 6px",
                    borderRadius: 4,
                    background: "var(--color-panel)",
                    color: "var(--color-text-dim)",
                    border: "1px solid var(--color-border)",
                    flexShrink: 0,
                  }}
                >
                  Hidden
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Root modal ─────────────────────────────────────────────────────────────────
const TABS = ["Account", "Ownership", "Achievements", "Settings"] as const;
type Tab = (typeof TABS)[number];

interface EpicStoreModalProps {
  onClose: () => void;
  initialTab?: Tab;
}

export function EpicStoreModal({ onClose, initialTab = "Account" }: EpicStoreModalProps) {
  const [tab, setTab] = useState<Tab>(initialTab);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.8)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: "var(--color-panel)",
          border: "1px solid var(--color-border)",
          borderRadius: 10,
          width: 580,
          maxWidth: "95vw",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 20px 12px",
            borderBottom: "1px solid var(--color-border)",
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexShrink: 0,
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 6,
              background: "#0078f2",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 800,
              fontSize: 13,
              color: "#fff",
              flexShrink: 0,
            }}
          >
            EGS
          </div>
          <div style={{ flex: 1 }}>
            <h2 style={{ color: "var(--color-white)", fontSize: 15, fontWeight: 700, margin: 0 }}>
              Epic Games Store
            </h2>
            <p style={{ fontSize: 11, color: "var(--color-text-dim)", margin: 0 }}>
              EOS SDK Integration
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "var(--color-text-dim)",
              fontSize: 18,
              cursor: "pointer",
              lineHeight: 1,
              padding: 0,
            }}
          >
            ×
          </button>
        </div>

        {/* Tab bar */}
        <div
          style={{
            display: "flex",
            borderBottom: "1px solid var(--color-border)",
            padding: "0 20px",
            flexShrink: 0,
          }}
        >
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                background: "none",
                border: "none",
                borderBottom: t === tab ? "2px solid var(--color-accent)" : "2px solid transparent",
                color: t === tab ? "var(--color-text)" : "var(--color-text-dim)",
                fontSize: 12,
                fontWeight: t === tab ? 700 : 400,
                padding: "8px 12px",
                cursor: "pointer",
                marginBottom: -1,
              }}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div style={{ padding: 20, overflowY: "auto", flex: 1 }}>
          {tab === "Account"      && <AccountTab onGoToSettings={() => setTab("Settings")} />}
          {tab === "Ownership"    && <OwnershipTab />}
          {tab === "Achievements" && <AchievementsTab />}
          {tab === "Settings"     && <SettingsTab onChanged={() => {}} />}
        </div>
      </div>
    </div>
  );
}
