import { useEffect, useRef, useState } from "preact/hooks";
import { open } from "@tauri-apps/plugin-dialog";
import {
  type PluginSummary,
  type PluginManifestInput,
  invokePluginList,
  invokePluginInstallFromZip,
  invokePluginInstallInline,
  invokePluginSetEnabled,
  invokePluginDelete,
  invokePluginGetScript,
} from "../../lib/plugins";

// ── PluginsTab ────────────────────────────────────────────────────────────────

export function PluginsTab() {
  const [plugins, setPlugins] = useState<PluginSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInstall, setShowInstall] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const reload = () => {
    setLoading(true);
    invokePluginList()
      .then(setPlugins)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(reload, []);

  const handleToggle = (id: string, enabled: boolean) => {
    invokePluginSetEnabled(id, enabled)
      .then(reload)
      .catch((e) => setError(String(e)));
  };

  const handleDelete = (id: string, name: string) => {
    if (!confirm(`Delete plugin "${name}"? This cannot be undone.`)) return;
    invokePluginDelete(id)
      .then(reload)
      .catch((e) => setError(String(e)));
  };

  const handleInstallZip = async () => {
    const path = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Plugin zip", extensions: ["zip"] }],
    }).catch(() => null);
    if (!path || typeof path !== "string") return;
    setError(null);
    invokePluginInstallFromZip(path)
      .then(() => { setShowInstall(false); reload(); })
      .catch((e) => setError(String(e)));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>🧩 Plugins</div>
          <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 2 }}>
            JS metadata-source and UI-panel plugins extend Libmaly's capabilities.
          </div>
        </div>
        <button
          style={{
            padding: "6px 14px",
            borderRadius: 6,
            border: "1px solid var(--color-accent)",
            background: "transparent",
            color: "var(--color-accent)",
            fontSize: 12,
            cursor: "pointer",
          }}
          onClick={() => setShowInstall((v) => !v)}
        >
          {showInstall ? "Cancel" : "+ Install Plugin"}
        </button>
      </div>

      {/* Install panel */}
      {showInstall && (
        <InstallPanel
          onInstalled={() => { setShowInstall(false); reload(); }}
          onError={setError}
          onInstallZip={handleInstallZip}
        />
      )}

      {/* Error */}
      {error && (
        <div
          style={{
            padding: "8px 12px",
            borderRadius: 6,
            background: "var(--color-danger-bg)",
            color: "var(--color-danger-strong)",
            fontSize: 12,
          }}
        >
          {error}
          <button
            style={{ marginLeft: 8, cursor: "pointer", background: "none", border: "none", color: "inherit" }}
            onClick={() => setError(null)}
          >
            ✕
          </button>
        </div>
      )}

      {/* Plugin list */}
      {loading ? (
        <div style={{ color: "var(--color-text-muted)", fontSize: 12 }}>Loading plugins…</div>
      ) : plugins.length === 0 ? (
        <EmptyState />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {plugins.map((plugin) => (
            <PluginCard
              key={plugin.id}
              plugin={plugin}
              editing={editingId === plugin.id}
              onToggleEdit={() =>
                setEditingId((cur) => (cur === plugin.id ? null : plugin.id))
              }
              onToggleEnabled={(e) => handleToggle(plugin.id, e)}
              onDelete={() => handleDelete(plugin.id, plugin.name)}
              onSaved={() => { setEditingId(null); reload(); }}
              onError={setError}
            />
          ))}
        </div>
      )}

      {/* Legend */}
      <div style={{ fontSize: 11, color: "var(--color-text-dim)", borderTop: "1px solid var(--color-border)", paddingTop: 8 }}>
        <strong>metadata-source</strong> plugins run sandboxed JS to fetch game metadata from custom URLs.&nbsp;
        <strong>ui-panel</strong> plugins render HTML inside an iframe in this tab.&nbsp;
        Plugin JS is executed via an embedded interpreter (boa_engine); network access is pre-fetched by Libmaly.
      </div>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div
      style={{
        textAlign: "center",
        padding: "36px 16px",
        color: "var(--color-text-muted)",
        borderRadius: 8,
        border: "1px dashed var(--color-border)",
      }}
    >
      <div style={{ fontSize: 32, marginBottom: 8 }}>🧩</div>
      <div style={{ fontSize: 13, marginBottom: 4 }}>No plugins installed</div>
      <div style={{ fontSize: 11 }}>
        Click <strong>+ Install Plugin</strong> to add a metadata source or UI panel.
      </div>
    </div>
  );
}

// ── Plugin card ───────────────────────────────────────────────────────────────

function PluginCard({
  plugin,
  editing,
  onToggleEdit,
  onToggleEnabled,
  onDelete,
  onSaved,
  onError,
}: {
  plugin: PluginSummary;
  editing: boolean;
  onToggleEdit: () => void;
  onToggleEnabled: (enabled: boolean) => void;
  onDelete: () => void;
  onSaved: () => void;
  onError: (e: string) => void;
}) {
  const kindColor =
    plugin.kind === "metadata-source" ? "var(--color-accent)" : "var(--color-warning)";
  const kindLabel = plugin.kind === "metadata-source" ? "METADATA" : "UI PANEL";

  return (
    <div
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: 8,
        overflow: "hidden",
        opacity: plugin.enabled ? 1 : 0.6,
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 12px",
          background: "var(--color-panel-2)",
        }}
      >
        {/* Kind badge */}
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            padding: "2px 6px",
            borderRadius: 4,
            border: `1px solid ${kindColor}`,
            color: kindColor,
            letterSpacing: "0.04em",
            flexShrink: 0,
          }}
        >
          {kindLabel}
        </span>

        {/* Name + version */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {plugin.name}
            {plugin.version && (
              <span style={{ marginLeft: 6, fontSize: 11, color: "var(--color-text-muted)", fontWeight: 400 }}>
                v{plugin.version}
              </span>
            )}
          </div>
          {plugin.author && (
            <div style={{ fontSize: 11, color: "var(--color-text-dim)" }}>by {plugin.author}</div>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          {/* Toggle */}
          <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer", fontSize: 11 }}>
            <input
              type="checkbox"
              checked={plugin.enabled}
              onChange={(e) => onToggleEnabled((e.target as HTMLInputElement).checked)}
            />
            {plugin.enabled ? "On" : "Off"}
          </label>

          {/* Edit script (metadata-source only) */}
          {plugin.kind === "metadata-source" && (
            <button
              style={smallBtn}
              onClick={onToggleEdit}
            >
              {editing ? "Close" : "Edit"}
            </button>
          )}

          {/* Delete */}
          <button
            style={{ ...smallBtn, color: "var(--color-danger-strong)" }}
            onClick={onDelete}
          >
            Delete
          </button>
        </div>
      </div>

      {/* Description */}
      {plugin.description && (
        <div
          style={{
            padding: "6px 12px",
            fontSize: 11,
            color: "var(--color-text-muted)",
            background: "var(--color-panel-1)",
            borderTop: "1px solid var(--color-border)",
          }}
        >
          {plugin.description}
        </div>
      )}

      {/* URL patterns (metadata-source) */}
      {plugin.kind === "metadata-source" && plugin.urlPatterns.length > 0 && (
        <div
          style={{
            padding: "6px 12px",
            fontSize: 11,
            color: "var(--color-text-dim)",
            background: "var(--color-panel-1)",
            borderTop: "1px solid var(--color-border)",
            fontFamily: "monospace",
          }}
        >
          Matches: {plugin.urlPatterns.join(" | ")}
        </div>
      )}

      {/* Script editor (expanded) */}
      {editing && plugin.kind === "metadata-source" && (
        <ScriptEditor
          pluginId={plugin.id}
          pluginName={plugin.name}
          onSaved={onSaved}
          onError={onError}
        />
      )}

      {/* UI panel preview */}
      {plugin.kind === "ui-panel" && plugin.enabled && (
        <UiPanelPreview pluginId={plugin.id} />
      )}
    </div>
  );
}

// ── Script editor ─────────────────────────────────────────────────────────────

function ScriptEditor({
  pluginId,
  pluginName,
  onSaved,
  onError,
}: {
  pluginId: string;
  pluginName: string;
  onSaved: () => void;
  onError: (e: string) => void;
}) {
  const [script, setScript] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    invokePluginGetScript(pluginId)
      .then(setScript)
      .catch((e) => onError(String(e)))
      .finally(() => setLoading(false));
  }, [pluginId]);

  const save = () => {
    setSaving(true);
    // Re-install inline to overwrite the script; keep existing manifest data.
    const manifest: PluginManifestInput = { id: pluginId, name: pluginName, urlPatterns: [] };
    invokePluginInstallInline(manifest, script)
      .then(onSaved)
      .catch((e) => onError(String(e)))
      .finally(() => setSaving(false));
  };

  if (loading) {
    return (
      <div style={{ padding: "8px 12px", fontSize: 12, color: "var(--color-text-muted)" }}>
        Loading script…
      </div>
    );
  }

  return (
    <div style={{ borderTop: "1px solid var(--color-border)", background: "var(--color-panel-1)" }}>
      <textarea
        value={script}
        onInput={(e) => setScript((e.target as HTMLTextAreaElement).value)}
        spellcheck={false}
        style={{
          display: "block",
          width: "100%",
          minHeight: 200,
          background: "var(--color-panel-3)",
          color: "var(--color-text)",
          border: "none",
          borderBottom: "1px solid var(--color-border)",
          padding: "10px 12px",
          fontFamily: "monospace",
          fontSize: 12,
          resize: "vertical",
          boxSizing: "border-box",
          outline: "none",
        }}
      />
      <div style={{ display: "flex", justifyContent: "flex-end", padding: "6px 10px" }}>
        <button
          disabled={saving}
          style={{ ...smallBtn, background: "var(--color-accent)", color: "#fff", opacity: saving ? 0.6 : 1 }}
          onClick={save}
        >
          {saving ? "Saving…" : "Save Script"}
        </button>
      </div>
    </div>
  );
}

// ── UI Panel preview ──────────────────────────────────────────────────────────

function UiPanelPreview({ pluginId }: { pluginId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [path, setPath] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const toggle = async () => {
    if (!expanded && !path) {
      try {
        const p = await import("../../lib/plugins").then((m) =>
          m.invokePluginGetPanelPath(pluginId),
        );
        // Convert to a file:// URL for iframe src.
        setPath("file:///" + p.replace(/\\/g, "/"));
      } catch (e) {
        setErr(String(e));
        return;
      }
    }
    setExpanded((v) => !v);
  };

  return (
    <div style={{ borderTop: "1px solid var(--color-border)" }}>
      <button
        style={{
          ...smallBtn,
          display: "block",
          width: "100%",
          textAlign: "left",
          padding: "7px 12px",
          borderRadius: 0,
          background: "var(--color-panel-2)",
        }}
        onClick={toggle}
      >
        {expanded ? "▲ Hide Panel" : "▼ Show Panel"}
      </button>
      {err && (
        <div style={{ padding: "6px 12px", fontSize: 11, color: "var(--color-danger-strong)" }}>{err}</div>
      )}
      {expanded && path && (
        <iframe
          ref={iframeRef}
          src={path}
          sandbox="allow-scripts allow-same-origin"
          style={{
            width: "100%",
            height: 320,
            border: "none",
            background: "#fff",
            display: "block",
          }}
        />
      )}
    </div>
  );
}

// ── Install panel ─────────────────────────────────────────────────────────────

function InstallPanel({
  onInstalled,
  onError,
  onInstallZip,
}: {
  onInstalled: () => void;
  onError: (e: string) => void;
  onInstallZip: () => void;
}) {
  const [mode, setMode] = useState<"pick" | "inline">("pick");

  // Inline install form state
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [version, setVersion] = useState("");
  const [author, setAuthor] = useState("");
  const [description, setDescription] = useState("");
  const [urlPatterns, setUrlPatterns] = useState("");
  const [script, setScript] = useState(INLINE_TEMPLATE);
  const [saving, setSaving] = useState(false);

  const installInline = () => {
    const patterns = urlPatterns
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    if (!id.trim()) { onError("Plugin id is required"); return; }
    if (!name.trim()) { onError("Plugin name is required"); return; }
    if (patterns.length === 0) { onError("At least one URL pattern is required"); return; }
    if (!script.trim()) { onError("Plugin script is required"); return; }

    const manifest: PluginManifestInput = {
      id: id.trim(),
      name: name.trim(),
      version: version.trim() || "1.0.0",
      author: author.trim() || undefined,
      description: description.trim() || undefined,
      urlPatterns: patterns,
      entrypoint: "plugin.js",
    };

    setSaving(true);
    invokePluginInstallInline(manifest, script)
      .then(onInstalled)
      .catch((e) => onError(String(e)))
      .finally(() => setSaving(false));
  };

  return (
    <div
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      {/* Mode tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid var(--color-border)", background: "var(--color-panel-2)" }}>
        {(["pick", "inline"] as const).map((m) => (
          <button
            key={m}
            style={{
              flex: 1,
              padding: "8px 0",
              border: "none",
              background: mode === m ? "var(--color-panel-3)" : "transparent",
              color: mode === m ? "var(--color-accent)" : "var(--color-text-muted)",
              fontSize: 12,
              cursor: "pointer",
              fontWeight: mode === m ? 600 : 400,
            }}
            onClick={() => setMode(m)}
          >
            {m === "pick" ? "📦 From Zip" : "✏️ Write Inline"}
          </button>
        ))}
      </div>

      {/* Zip install */}
      {mode === "pick" && (
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
            Select a <code>.zip</code> file containing <code>manifest.json</code> and the plugin's
            entrypoint (<code>plugin.js</code> or <code>index.html</code>).
          </div>
          <button style={{ ...smallBtn, alignSelf: "flex-start", padding: "8px 16px" }} onClick={onInstallZip}>
            Browse for zip…
          </button>
        </div>
      )}

      {/* Inline install */}
      {mode === "inline" && (
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {[
              { label: "ID *", value: id, setter: setId, placeholder: "my-plugin" },
              { label: "Name *", value: name, setter: setName, placeholder: "My Plugin" },
              { label: "Version", value: version, setter: setVersion, placeholder: "1.0.0" },
              { label: "Author", value: author, setter: setAuthor, placeholder: "Your Name" },
            ].map(({ label, value, setter, placeholder }) => (
              <label key={label} style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11 }}>
                <span style={{ color: "var(--color-text-muted)" }}>{label}</span>
                <input
                  value={value}
                  onInput={(e) => setter((e.target as HTMLInputElement).value)}
                  placeholder={placeholder}
                  style={inputStyle}
                />
              </label>
            ))}
          </div>

          <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11 }}>
            <span style={{ color: "var(--color-text-muted)" }}>Description</span>
            <input
              value={description}
              onInput={(e) => setDescription((e.target as HTMLInputElement).value)}
              placeholder="What does this plugin do?"
              style={inputStyle}
            />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11 }}>
            <span style={{ color: "var(--color-text-muted)" }}>URL Patterns * (one regex per line)</span>
            <textarea
              value={urlPatterns}
              onInput={(e) => setUrlPatterns((e.target as HTMLTextAreaElement).value)}
              placeholder={"https://example\\.com/game/.*\nhttps://store\\.example\\.com/.*"}
              rows={3}
              style={{ ...inputStyle, fontFamily: "monospace", resize: "vertical" }}
            />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11 }}>
            <span style={{ color: "var(--color-text-muted)" }}>Plugin Script (fetchMetadata function)</span>
            <textarea
              value={script}
              onInput={(e) => setScript((e.target as HTMLTextAreaElement).value)}
              rows={12}
              spellcheck={false}
              style={{ ...inputStyle, fontFamily: "monospace", resize: "vertical", fontSize: 11 }}
            />
          </label>

          <button
            disabled={saving}
            style={{ ...smallBtn, background: "var(--color-accent)", color: "#fff", alignSelf: "flex-start", padding: "8px 18px", opacity: saving ? 0.6 : 1 }}
            onClick={installInline}
          >
            {saving ? "Installing…" : "Install Plugin"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const smallBtn: preact.JSX.CSSProperties = {
  padding: "4px 10px",
  borderRadius: 5,
  border: "1px solid var(--color-border)",
  background: "var(--color-panel-3)",
  color: "var(--color-text)",
  fontSize: 11,
  cursor: "pointer",
};

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

// ── Inline template ───────────────────────────────────────────────────────────

const INLINE_TEMPLATE = `/**
 * fetchMetadata(url, html)
 *
 * @param {string} url  - The URL being fetched.
 * @param {string} html - The pre-fetched HTML body of the page.
 * @returns {object|null} A partial GameMetadata object, or null if not applicable.
 *
 * Available GameMetadata fields:
 *   title, version, developer, publisher, overview, overview_html,
 *   cover_url, screenshots (array), tags (array), genres (array),
 *   engine, os, language, censored, release_date, last_updated,
 *   rating, price, source_url, source_label
 */
function fetchMetadata(url, html) {
  // Example: extract the page title
  var titleMatch = html.match(/<title[^>]*>([^<]+)<\\/title>/i);
  var title = titleMatch ? titleMatch[1].trim() : null;

  return {
    title: title,
    tags: [],
    screenshots: [],
  };
}
`;
