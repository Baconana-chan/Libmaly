import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import {
  type UnifiedPeer,
  type SocialProviderConfig,
  type SocialProviderStatus,
  type SocialIdentityLink,
  type IdentityLinkSuggestion,
  type FeedItem,
  SOCIAL_PROVIDER_PULSE,
  SOCIAL_PROVIDER_DISCORD,
  SOCIAL_PROVIDER_STEAM,
  PROVIDER_META,
  invokeGetUnifiedPeers,
  invokeGetProviderConfigs,
  invokeSaveProviderConfig,
  invokeGetProviderStatuses,
  invokeLinkIdentities,
  invokeUnlinkIdentities,
  invokeGetIdentityLinks,
  invokeGetLinkSuggestions,
  invokeSteamStart,
  invokeSteamStop,
  invokeGetActivityFeed,
  onSocialPeersUpdated,
  providerLabel,
  providerIcon,
  statusColor,
  statusDot,
} from "../../lib/socialProviders";
import { formatPulseElapsed } from "../../lib/pulse";
import {
  type SocialIdentityProfile,
  invokeGetIdentityProfile,
  invokeGetIdentityFingerprint,
  invokeSaveIdentityProfile,
  invokeGenerateIdentityKeys,
  invokeIdentityHasKeys,
  exportIdentityToFile,
  importIdentityFromFile,
  invokeDeleteIdentity,
  formatCreatedAt,
} from "../../lib/socialIdentity";
import {
  type FriendEntry,
  type FriendActivityEntry,
  invokeFriendsList,
  invokeFriendsAdd,
  invokeFriendsRemove,
  invokeFriendsGetActivity,
  onPeersUpdated,
  formatSessionDuration,
  shortPeerId,
} from "../../lib/friendActivity";

// ── Shared styles ──────────────────────────────────────────────────────────────

const card: preact.JSX.CSSProperties = {
  background: "var(--color-panel-2)",
  border: "1px solid var(--color-border)",
  borderRadius: 10,
  padding: "12px 14px",
};

const btnBase: preact.JSX.CSSProperties = {
  padding: "5px 12px",
  borderRadius: 6,
  fontSize: 12,
  cursor: "pointer",
  border: "1px solid rgba(255,255,255,.15)",
  background: "rgba(255,255,255,.06)",
  color: "inherit",
};

const sectionTitle: preact.JSX.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "var(--color-text-muted)",
  marginBottom: 8,
};

const inputStyle: preact.JSX.CSSProperties = {
  background: "var(--color-panel-3)",
  border: "1px solid var(--color-border)",
  borderRadius: 6,
  color: "var(--color-text)",
  padding: "5px 9px",
  fontSize: 12,
  fontFamily: "monospace",
  width: "100%",
  boxSizing: "border-box",
};

// ── Provider source chip ───────────────────────────────────────────────────────

function ProviderChip({ providerId }: { providerId: string }) {
  const meta = PROVIDER_META[providerId];
  return (
    <span
      style={{
        fontSize: 9,
        padding: "1px 6px",
        borderRadius: 99,
        background: "var(--color-panel-3)",
        color: "var(--color-text-muted)",
        border: "1px solid var(--color-border)",
        flexShrink: 0,
      }}
    >
      {meta?.icon ?? "🔌"} {meta?.label ?? providerId}
    </span>
  );
}

// ── Unified peer card ──────────────────────────────────────────────────────────

function UnifiedPeerCard({
  peer,
  tick,
  onLink,
}: {
  peer: UnifiedPeer;
  tick: number;
  onLink: (peer: UnifiedPeer) => void;
}) {
  void tick;
  const elapsed = peer.activity?.sessionStart
    ? formatPulseElapsed(peer.activity.sessionStart)
    : null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "9px 12px",
        background: "var(--color-panel-2)",
        border: "1px solid var(--color-border)",
        borderRadius: 8,
      }}
    >
      {/* Avatar */}
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: "50%",
          background: "var(--color-panel-3)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 16,
          flexShrink: 0,
          overflow: "hidden",
        }}
      >
        {peer.avatarUrl ? (
          <img src={peer.avatarUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : "🎮"}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {peer.displayName}
        </div>
        {peer.activity ? (
          <div style={{ fontSize: 11, color: "var(--color-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {peer.activity.title}
            {elapsed && <span style={{ marginLeft: 5, opacity: 0.6 }}>· {elapsed}</span>}
          </div>
        ) : (
          <div style={{ fontSize: 11, color: "var(--color-text-muted)", opacity: 0.6 }}>Online</div>
        )}
        {/* Source chips */}
        <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap" }}>
          {peer.sources.map((s) => (
            <ProviderChip key={`${s.providerId}:${s.providerPeerId}`} providerId={s.providerId} />
          ))}
        </div>
      </div>

      {/* Link button — only shown when peer has a single source (suggest linking to others) */}
      {peer.sources.length === 1 && (
        <button
          title="Link to the same person on another provider"
          onClick={() => onLink(peer)}
          style={{
            padding: "3px 8px",
            fontSize: 10,
            borderRadius: 5,
            border: "1px solid var(--color-border)",
            background: "var(--color-panel-3)",
            color: "var(--color-text-muted)",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          🔗
        </button>
      )}
    </div>
  );
}

// ── Provider card ──────────────────────────────────────────────────────────────

function ProviderCard({
  config,
  status,
  onSave,
  onStartSteam,
  onStopSteam,
}: {
  config: SocialProviderConfig;
  status: SocialProviderStatus | undefined;
  onSave: (c: SocialProviderConfig) => void;
  onStartSteam: (apiKey: string, steamId: string) => void;
  onStopSteam: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<SocialProviderConfig>({ ...config });

  const isSteam = config.providerId === SOCIAL_PROVIDER_STEAM;
  const isDiscord = config.providerId === SOCIAL_PROVIDER_DISCORD;
  const isPulse = config.providerId === SOCIAL_PROVIDER_PULSE;

  const meta = PROVIDER_META[config.providerId];
  const st = status?.status ?? "disconnected";
  const peerCount = status?.peerCount ?? 0;

  const handleSave = () => {
    onSave(draft);
    setExpanded(false);
  };

  return (
    <div style={card}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 20 }}>{meta?.icon ?? "🔌"}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)" }}>
              {config.label}
            </span>
            <span style={{ fontSize: 10, color: statusColor(st) }}>
              {statusDot(st)} {st}
            </span>
            {peerCount > 0 && (
              <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>
                · {peerCount} peer{peerCount !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          {meta && (
            <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 1 }}>
              {meta.description}
            </div>
          )}
        </div>
        <button
          style={{
            padding: "3px 10px",
            fontSize: 11,
            borderRadius: 5,
            border: "1px solid var(--color-border)",
            background: "var(--color-panel-3)",
            cursor: "pointer",
            color: "var(--color-text)",
            flexShrink: 0,
          }}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "▲ Close" : "▼ Configure"}
        </button>
      </div>

      {/* Expanded config panel */}
      {expanded && (
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Common: label */}
          <div>
            <label style={{ fontSize: 11, color: "var(--color-text-muted)" }}>Display label</label>
            <input
              style={{ ...inputStyle, marginTop: 4 }}
              value={draft.label}
              onInput={(e) => setDraft((d) => ({ ...d, label: (e.target as HTMLInputElement).value }))}
            />
          </div>

          {/* Steam-specific fields */}
          {isSteam && (
            <>
              <div>
                <label style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                  Steam Web API Key
                  {" · "}
                  <a
                    href="https://steamcommunity.com/dev/apikey"
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "var(--color-accent)" }}
                  >
                    Get one ↗
                  </a>
                </label>
                <input
                  style={{ ...inputStyle, marginTop: 4 }}
                  type="password"
                  placeholder="XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
                  value={draft.credentials.apiKey ?? ""}
                  onInput={(e) =>
                    setDraft((d) => ({
                      ...d,
                      credentials: {
                        ...d.credentials,
                        apiKey: (e.target as HTMLInputElement).value,
                      },
                    }))
                  }
                />
              </div>
              <div>
                <label style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                  Your Steam64 ID
                  {" · "}
                  <a
                    href="https://steamid.io/"
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "var(--color-accent)" }}
                  >
                    Look up ↗
                  </a>
                </label>
                <input
                  style={{ ...inputStyle, marginTop: 4 }}
                  placeholder="76561198xxxxxxxxx"
                  value={draft.credentials.steamId ?? ""}
                  onInput={(e) =>
                    setDraft((d) => ({
                      ...d,
                      credentials: {
                        ...d.credentials,
                        steamId: (e.target as HTMLInputElement).value,
                      },
                    }))
                  }
                />
              </div>
              <div style={{ fontSize: 11, color: "var(--color-text-muted)", lineHeight: 1.5 }}>
                Libmaly polls <code>GetFriendList</code> + <code>GetPlayerSummaries</code> every 60 s.
                Only online friends are shown; your own credentials are stored locally and never sent anywhere except the Steam API.
              </div>
            </>
          )}

          {/* Discord info */}
          {isDiscord && (
            <div
              style={{
                padding: "10px 12px",
                background: "rgba(88,101,242,.1)",
                border: "1px solid rgba(88,101,242,.3)",
                borderRadius: 7,
                fontSize: 11,
                color: "var(--color-text-muted)",
                lineHeight: 1.5,
              }}
            >
              Discord presence is read automatically from the Discord SDK when Discord is running.
              Individual friend enumeration from Discord requires Discord to be connected.
              The provider status above reflects the SDK connection state.
            </div>
          )}

          {/* Pulse info */}
          {isPulse && (
            <div style={{ fontSize: 11, color: "var(--color-text-muted)", lineHeight: 1.5 }}>
              Pulse is configured separately in the <strong>Pulse</strong> tab.
              Enabling it there feeds peer data here automatically.
            </div>
          )}

          {/* Save / action buttons */}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
            {isSteam && (
              <>
                <button
                  style={{
                    padding: "5px 12px",
                    fontSize: 11,
                    borderRadius: 5,
                    border: "1px solid var(--color-border)",
                    background: "var(--color-panel-3)",
                    cursor: "pointer",
                    color: "var(--color-danger)",
                  }}
                  onClick={() => { handleSave(); onStopSteam(); }}
                >
                  Stop
                </button>
                <button
                  style={{
                    padding: "5px 12px",
                    fontSize: 11,
                    borderRadius: 5,
                    border: "none",
                    background: "var(--color-accent)",
                    color: "#fff",
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                  onClick={() => {
                    handleSave();
                    onStartSteam(draft.credentials.apiKey ?? "", draft.credentials.steamId ?? "");
                  }}
                >
                  Save & Start
                </button>
              </>
            )}
            {!isSteam && (
              <button
                style={{
                  padding: "5px 14px",
                  fontSize: 11,
                  borderRadius: 5,
                  border: "none",
                  background: "var(--color-accent)",
                  color: "#fff",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
                onClick={handleSave}
              >
                Save
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Identity link suggestion banner ───────────────────────────────────────────

function LinkSuggestionBanner({
  suggestion,
  onAccept,
  onDismiss,
}: {
  suggestion: IdentityLinkSuggestion;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 12px",
        background: "rgba(55,165,216,.08)",
        border: "1px solid rgba(55,165,216,.25)",
        borderRadius: 8,
        fontSize: 11,
      }}
    >
      <span style={{ fontSize: 14 }}>🔗</span>
      <div style={{ flex: 1 }}>
        <strong style={{ color: "var(--color-text)" }}>{suggestion.displayNameA}</strong>
        {" on "}
        <span style={{ color: "var(--color-text-muted)" }}>
          {providerIcon(suggestion.providerA)} {providerLabel(suggestion.providerA)}
        </span>
        {" looks like the same person as on "}
        <span style={{ color: "var(--color-text-muted)" }}>
          {providerIcon(suggestion.providerB)} {providerLabel(suggestion.providerB)}
        </span>
        {". Link them?"}
      </div>
      <button
        onClick={onAccept}
        style={{
          padding: "3px 9px",
          fontSize: 10,
          borderRadius: 4,
          border: "none",
          background: "var(--color-accent)",
          color: "#fff",
          cursor: "pointer",
          fontWeight: 600,
          flexShrink: 0,
        }}
      >
        Link
      </button>
      <button
        onClick={onDismiss}
        style={{
          padding: "3px 7px",
          fontSize: 10,
          borderRadius: 4,
          border: "1px solid var(--color-border)",
          background: "var(--color-panel-3)",
          color: "var(--color-text-muted)",
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        ✕
      </button>
    </div>
  );
}

// ── Identity links list ────────────────────────────────────────────────────────

function IdentityLinksPanel({
  links,
  onUnlink,
}: {
  links: SocialIdentityLink[];
  onUnlink: (link: SocialIdentityLink) => void;
}) {
  if (links.length === 0) return null;
  return (
    <div>
      <div style={sectionTitle}>Active Identity Links</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {links.map((link) => (
          <div
            key={`${link.providerA}:${link.peerIdA}:${link.providerB}:${link.peerIdB}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "7px 10px",
              background: "var(--color-panel-2)",
              border: "1px solid var(--color-border)",
              borderRadius: 7,
              fontSize: 11,
            }}
          >
            <span style={{ color: "var(--color-text-muted)" }}>
              {providerIcon(link.providerA)} {providerLabel(link.providerA)}
              {" "}
              <code style={{ fontSize: 10 }}>{link.peerIdA}</code>
            </span>
            <span style={{ color: "var(--color-text-dim)", flexShrink: 0 }}>↔</span>
            <span style={{ flex: 1, color: "var(--color-text-muted)" }}>
              {providerIcon(link.providerB)} {providerLabel(link.providerB)}
              {" "}
              <code style={{ fontSize: 10 }}>{link.peerIdB}</code>
            </span>
            <button
              onClick={() => onUnlink(link)}
              style={{
                padding: "2px 7px",
                fontSize: 10,
                borderRadius: 4,
                border: "1px solid rgba(192,57,43,.4)",
                background: "rgba(192,57,43,.12)",
                color: "var(--color-danger)",
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              Unlink
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Portable Identity Panel ───────────────────────────────────────────────────

function PortableIdentityPanel() {
  const [profile, setProfile] = useState<SocialIdentityProfile | null>(null);
  const [hasKeys, setHasKeys] = useState(false);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editAvatar, setEditAvatar] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const [p, hk, fp] = await Promise.all([
      invokeGetIdentityProfile(),
      invokeIdentityHasKeys(),
      invokeGetIdentityFingerprint(),
    ]);
    setProfile(p);
    setHasKeys(hk);
    setFingerprint(fp);
  }, []);

  useEffect(() => { load(); }, [load]);

  const flash = (ok: boolean, text: string) => {
    setStatusMsg({ ok, text });
    setTimeout(() => setStatusMsg(null), 3500);
  };

  const handleGenerate = async () => {
    try {
      const p = await invokeGenerateIdentityKeys();
      setProfile(p);
      setHasKeys(true);
      const fp = await invokeGetIdentityFingerprint();
      setFingerprint(fp);
      flash(true, "New keypair generated.");
    } catch (e) {
      flash(false, String(e));
    } finally {
      setConfirmRegen(false);
    }
  };

  const handleSaveProfile = async () => {
    setSaving(true);
    try {
      await invokeSaveIdentityProfile(editName, editAvatar ?? null);
      await load();
      setEditing(false);
      flash(true, "Profile saved.");
    } catch (e) {
      flash(false, String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleExport = async () => {
    try {
      await exportIdentityToFile();
      flash(true, "Identity bundle exported.");
    } catch (e) {
      flash(false, String(e));
    }
  };

  const handleImport = async () => {
    try {
      const p = await importIdentityFromFile();
      if (!p) return;
      setProfile(p);
      setHasKeys(true);
      const fp = await invokeGetIdentityFingerprint();
      setFingerprint(fp);
      flash(true, "Identity imported successfully.");
    } catch (e) {
      flash(false, String(e));
    }
  };

  const handleDelete = async () => {
    try {
      await invokeDeleteIdentity();
      await load();
      flash(true, "Identity deleted.");
    } catch (e) {
      flash(false, String(e));
    } finally {
      setConfirmDelete(false);
    }
  };

  const handleAvatarFile = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = ev.target?.result;
      if (typeof result === "string") setEditAvatar(result);
    };
    reader.readAsDataURL(file);
  };

  const cardStyle: Record<string, string> = {
    marginBottom: "16px",
    padding: "14px 16px",
    background: "rgba(55,165,216,.05)",
    border: "1px solid rgba(55,165,216,.2)",
    borderRadius: "10px",
  };

  return (
    <div style={cardStyle}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 18 }}>🔑</span>
        <span style={{ fontWeight: 700, fontSize: 14 }}>Portable Identity</span>
      </div>

      <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 12, lineHeight: 1.5 }}>
        Your identity is an ED25519 keypair stored in the system keychain. Export it to take
        your Display Name, Avatar, and cryptographic identity to any relay or reinstallation.
      </div>

      {/* No keypair yet */}
      {!hasKeys && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
            No identity keypair found. Generate one or import an existing bundle.
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={handleGenerate} style={{ ...btnBase, background: "var(--color-accent, #37a5d8)", color: "#fff", border: "none" }}>
              Generate Keypair
            </button>
            <button onClick={handleImport} style={btnBase}>Import Bundle…</button>
          </div>
        </div>
      )}

      {/* Identity card */}
      {hasKeys && profile && !editing && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
            {profile.avatarBase64 ? (
              <img
                src={profile.avatarBase64}
                alt="avatar"
                style={{ width: 52, height: 52, borderRadius: "50%", objectFit: "cover", border: "2px solid rgba(55,165,216,.4)" }}
              />
            ) : (
              <div style={{
                width: 52, height: 52, borderRadius: "50%",
                background: "rgba(55,165,216,.18)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 24,
              }}>👤</div>
            )}
            <div>
              <div style={{ fontWeight: 600, fontSize: 15 }}>
                {profile.displayName || <span style={{ color: "var(--color-text-muted)" }}>No display name set</span>}
              </div>
              {fingerprint && (
                <div style={{ fontFamily: "monospace", fontSize: 11, color: "var(--color-text-muted)", marginTop: 2 }}
                  title={`Full public key: ${profile.publicKeyB64}`}>
                  🆔 {fingerprint}
                </div>
              )}
              {profile.createdAt > 0 && (
                <div style={{ fontSize: 11, color: "var(--color-text-dim)", marginTop: 1 }}>
                  Generated {formatCreatedAt(profile.createdAt)}
                </div>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button style={btnBase} onClick={() => {
              setEditName(profile.displayName);
              setEditAvatar(profile.avatarBase64 ?? null);
              setEditing(true);
            }}>✏️ Edit Profile</button>
            <button style={btnBase} onClick={handleExport}>📤 Export Bundle</button>
            <button style={btnBase} onClick={handleImport}>📥 Import Bundle…</button>
            <button style={btnBase} onClick={() => setConfirmRegen(true)}>🔄 New Keypair…</button>
            <button
              style={{ ...btnBase, color: "var(--color-danger, #e55)", borderColor: "rgba(220,80,80,.3)" }}
              onClick={() => setConfirmDelete(true)}
            >🗑 Delete Identity…</button>
          </div>
        </>
      )}

      {/* Edit form */}
      {editing && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>Edit Profile</div>
          {/* Avatar preview + picker */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
            {editAvatar ? (
              <img src={editAvatar} alt="preview" style={{ width: 44, height: 44, borderRadius: "50%", objectFit: "cover" }} />
            ) : (
              <div style={{ width: 44, height: 44, borderRadius: "50%", background: "rgba(55,165,216,.18)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>👤</div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <button style={{ ...btnBase, fontSize: 11 }} onClick={() => avatarInputRef.current?.click()}>Choose Image…</button>
              {editAvatar && <button style={{ ...btnBase, fontSize: 11 }} onClick={() => setEditAvatar(null)}>Remove Avatar</button>}
              <input ref={avatarInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleAvatarFile} />
            </div>
          </div>
          <label style={{ fontSize: 12 }}>Display Name</label>
          <input
            type="text"
            maxLength={64}
            value={editName}
            onInput={(e) => setEditName((e.target as HTMLInputElement).value)}
            style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,.15)", background: "rgba(0,0,0,.2)", color: "inherit", fontSize: 13 }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button
              onClick={handleSaveProfile}
              disabled={saving}
              style={{ ...btnBase, background: "var(--color-accent, #37a5d8)", color: "#fff", border: "none", opacity: saving ? 0.6 : 1 }}
            >{saving ? "Saving…" : "Save"}</button>
            <button style={btnBase} onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Confirm: regen keypair */}
      {confirmRegen && (
        <div style={{ marginTop: 10, padding: "10px 12px", background: "rgba(220,120,0,.1)", border: "1px solid rgba(220,120,0,.4)", borderRadius: 6, fontSize: 13 }}>
          <strong>⚠️ Replace keypair?</strong> Any relay that knows your current public key will treat the new key as a completely different identity.
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button onClick={handleGenerate} style={{ ...btnBase, background: "rgba(220,120,0,.7)", color: "#fff", border: "none" }}>Yes, Generate New Keypair</button>
            <button style={btnBase} onClick={() => setConfirmRegen(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Confirm: delete */}
      {confirmDelete && (
        <div style={{ marginTop: 10, padding: "10px 12px", background: "rgba(192,57,43,.1)", border: "1px solid rgba(192,57,43,.4)", borderRadius: 6, fontSize: 13 }}>
          <strong>⚠️ Delete identity?</strong> This removes the private key from the system keychain. Export a bundle first if you want to restore it later.
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button onClick={handleDelete} style={{ ...btnBase, background: "rgba(192,57,43,.8)", color: "#fff", border: "none" }}>Yes, Delete Permanently</button>
            <button style={btnBase} onClick={() => setConfirmDelete(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Status flash */}
      {statusMsg && (
        <div style={{ marginTop: 8, fontSize: 12, color: statusMsg.ok ? "#4caf50" : "#f44336" }}>
          {statusMsg.text}
        </div>
      )}
    </div>
  );
}

// ── Friend Activity Panel ─────────────────────────────────────────────────────

function FriendActivityPanel() {
  const [activity, setActivity] = useState<FriendActivityEntry[]>([]);
  const [friends, setFriends]   = useState<FriendEntry[]>([]);
  const [loading, setLoading]   = useState(false);
  const [addPeerId, setAddPeerId]     = useState("");
  const [addNickname, setAddNickname] = useState("");
  const [addNote, setAddNote]         = useState("");
  const [addError, setAddError]       = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [flash, setFlash]             = useState<{ ok: boolean; msg: string } | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = (ok: boolean, msg: string) => {
    setFlash({ ok, msg });
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 3000);
  };

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [a, f] = await Promise.all([invokeFriendsGetActivity(), invokeFriendsList()]);
      setActivity(a);
      setFriends(f);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    const unsub = onPeersUpdated(reload);
    return () => { unsub.then((f) => f()); };
  }, [reload]);

  const handleAdd = async () => {
    const id = addPeerId.trim();
    if (!id) { setAddError("Peer ID is required."); return; }
    setAddError(null);
    try {
      await invokeFriendsAdd(id, addNickname.trim() || undefined, addNote.trim() || undefined);
      setAddPeerId(""); setAddNickname(""); setAddNote("");
      setShowAddForm(false);
      await reload();
      notify(true, "Friend added.");
    } catch (e) {
      setAddError(String(e));
    }
  };

  const handleRemove = async (peerId: string) => {
    try {
      await invokeFriendsRemove(peerId);
      await reload();
      notify(true, "Friend removed.");
    } catch (e) {
      notify(false, String(e));
    }
  };

  const onlineCount = activity.filter((e) => e.isOnline).length;

  const dotStyle = (online: boolean): preact.JSX.CSSProperties => ({
    width: 8, height: 8, borderRadius: "50%",
    background: online ? "var(--color-success)" : "var(--color-text-dim)",
    flexShrink: 0,
  });

  return (
    <div style={{ ...card, padding: "16px 18px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--color-text-muted)" }}>
          Friends · {friends.length} saved{onlineCount > 0 ? `, ${onlineCount} online` : ""}
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={reload} title="Refresh" style={{ ...btnBase, padding: "3px 8px", fontSize: 11 }} disabled={loading}>
            {loading ? "…" : "↻"}
          </button>
          <button onClick={() => setShowAddForm((v) => !v)} style={{ ...btnBase, padding: "3px 10px", fontSize: 11 }}>
            {showAddForm ? "Cancel" : "+ Add Friend"}
          </button>
        </div>
      </div>

      {/* Add form */}
      {showAddForm && (
        <div style={{ background: "var(--color-panel-3)", borderRadius: 8, padding: "12px 14px", marginBottom: 12 }}>
          <p style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 8 }}>
            Ask your friend to share their Pulse Peer ID (visible in the Pulse tab).
          </p>
          <input
            placeholder="Peer ID (required)"
            value={addPeerId}
            onInput={(e) => setAddPeerId((e.target as HTMLInputElement).value)}
            style={{ ...inputStyle, marginBottom: 6 }}
          />
          <input
            placeholder="Nickname (optional)"
            value={addNickname}
            onInput={(e) => setAddNickname((e.target as HTMLInputElement).value)}
            style={{ ...inputStyle, marginBottom: 6 }}
          />
          <input
            placeholder="Note (optional)"
            value={addNote}
            onInput={(e) => setAddNote((e.target as HTMLInputElement).value)}
            style={{ ...inputStyle, marginBottom: 8 }}
          />
          {addError && <p style={{ fontSize: 11, color: "var(--color-danger)", marginBottom: 6 }}>{addError}</p>}
          <button onClick={handleAdd} style={{ ...btnBase, padding: "5px 14px", fontSize: 12 }}>Add</button>
        </div>
      )}

      {/* Flash */}
      {flash && (
        <div style={{ fontSize: 11, padding: "5px 10px", borderRadius: 6, marginBottom: 8,
          background: flash.ok ? "rgba(91,168,91,.13)" : "rgba(192,57,43,.13)",
          color: flash.ok ? "var(--color-success)" : "var(--color-danger)" }}>
          {flash.msg}
        </div>
      )}

      {/* Friend list */}
      {activity.length === 0 && !showAddForm ? (
        <p style={{ fontSize: 12, color: "var(--color-text-dim)", textAlign: "center", padding: "16px 0" }}>
          No friends added yet. Add a friend by their Pulse Peer ID.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {activity.map((f) => (
            <div key={f.peerId} style={{
              display: "flex", alignItems: "center", gap: 10,
              background: "var(--color-panel-3)", borderRadius: 8, padding: "9px 12px",
              border: "1px solid var(--color-border-soft)",
            }}>
              {/* Avatar / placeholder */}
              <div style={{
                width: 36, height: 36, borderRadius: "50%", flexShrink: 0, overflow: "hidden",
                background: "var(--color-panel-low)", display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 14, color: "var(--color-text-muted)",
              }}>
                {f.avatarUrl
                  ? <img src={f.avatarUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  : f.displayName.slice(0, 1).toUpperCase()}
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                  <span style={{ fontWeight: 600, fontSize: 13, color: "var(--color-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {f.displayName}
                  </span>
                  <div style={dotStyle(f.isOnline)} title={f.isOnline ? "Online" : "Offline"} />
                </div>
                <div style={{ fontSize: 10, color: "var(--color-text-dim)", fontFamily: "monospace" }}>
                  {shortPeerId(f.peerId)}
                </div>
                {f.isOnline && f.gameTitle ? (
                  <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 2 }}>
                    🎮 {f.gameTitle}
                    {f.sessionStart != null && (
                      <span style={{ marginLeft: 6, color: "var(--color-text-dim)" }}>
                        · {formatSessionDuration(f.sessionStart)}
                      </span>
                    )}
                  </div>
                ) : !f.isOnline && f.lastSeen != null ? (
                  <div style={{ fontSize: 10, color: "var(--color-text-dim)", marginTop: 2 }}>
                    Last seen {formatPulseElapsed(f.lastSeen)}
                  </div>
                ) : null}
                {f.note && (
                  <div style={{ fontSize: 10, color: "var(--color-text-dim)", marginTop: 1, fontStyle: "italic" }}>
                    {f.note}
                  </div>
                )}
              </div>

              {/* Remove */}
              <button
                onClick={() => handleRemove(f.peerId)}
                title="Remove friend"
                style={{ ...btnBase, padding: "3px 8px", fontSize: 11, color: "var(--color-danger)", flexShrink: 0 }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Unified Feed Panel ────────────────────────────────────────────────────────
//
// A chronological activity feed combining Pulse, Discord, and Steam into
// one unified scrollable view.  Provider badges let users see the source.

function UnifiedFeedPanel() {
  const [feed, setFeed]           = useState<FeedItem[]>([]);
  const [statuses, setStatuses]   = useState<SocialProviderStatus[]>([]);
  const [loading, setLoading]     = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [f, s] = await Promise.all([invokeGetActivityFeed(), invokeGetProviderStatuses()]);
      setFeed(f);
      setStatuses(s);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    const unsub = onSocialPeersUpdated(() => reload());
    const interval = setInterval(reload, 15_000);
    return () => {
      unsub.then((fn) => fn());
      clearInterval(interval);
    };
  }, [reload]);

  const activeProviders = statuses.filter((s) => s.status === "active" || s.status === "connecting");
  const totalOnline = feed.length;

  const badgeStyle = (providerId: string): preact.JSX.CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    padding: "2px 6px",
    borderRadius: 4,
    background: providerId === SOCIAL_PROVIDER_DISCORD
      ? "rgba(88,101,242,.2)"
      : providerId === SOCIAL_PROVIDER_STEAM
      ? "rgba(100,197,255,.15)"
      : "rgba(var(--color-accent-rgb),.15)",
    color: providerId === SOCIAL_PROVIDER_DISCORD
      ? "#7289da"
      : providerId === SOCIAL_PROVIDER_STEAM
      ? "rgb(100,197,255)"
      : "var(--color-accent)",
    border: `1px solid ${
      providerId === SOCIAL_PROVIDER_DISCORD
        ? "rgba(88,101,242,.3)"
        : providerId === SOCIAL_PROVIDER_STEAM
        ? "rgba(100,197,255,.25)"
        : "rgba(var(--color-accent-rgb),.3)"
    }`,
  });

  return (
    <div style={{ ...card, padding: "16px 18px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--color-text-muted)" }}>
            Unified Activity Feed
          </span>
          <span style={{ marginLeft: 8, fontSize: 11, color: "var(--color-text-dim)" }}>
            {totalOnline > 0 ? `${totalOnline} online` : "no one online"}
          </span>
        </div>
        <button
          onClick={reload}
          disabled={loading}
          style={{ ...btnBase, padding: "3px 8px", fontSize: 11 }}
        >
          {loading ? "…" : "↻"}
        </button>
      </div>

      {/* Provider status pills */}
      {activeProviders.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 12 }}>
          {activeProviders.map((s) => (
            <span key={s.providerId} style={badgeStyle(s.providerId)}>
              {providerIcon(s.providerId)} {providerLabel(s.providerId)}
              {s.peerCount > 0 && <span style={{ marginLeft: 2 }}>· {s.peerCount}</span>}
            </span>
          ))}
        </div>
      )}

      {/* Feed items */}
      {feed.length === 0 ? (
        <p style={{ fontSize: 12, color: "var(--color-text-dim)", textAlign: "center", padding: "16px 0" }}>
          {activeProviders.length === 0
            ? "No social providers are connected. Enable Pulse, Discord, or Steam in the settings below."
            : "No friends are currently online."}
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {feed.map((item, idx) => (
            <div
              key={`${item.providerId}-${item.displayName}-${idx}`}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                background: "var(--color-panel-3)", borderRadius: 8, padding: "9px 12px",
                border: "1px solid var(--color-border-soft)",
              }}
            >
              {/* Avatar */}
              <div style={{
                width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
                overflow: "hidden", background: "var(--color-panel-low)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 14, color: "var(--color-text-muted)",
              }}>
                {item.avatarUrl
                  ? <img src={item.avatarUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  : item.displayName.slice(0, 1).toUpperCase()}
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                  <span style={{ fontWeight: 600, fontSize: 13, color: "var(--color-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.displayName}
                  </span>
                  <span style={badgeStyle(item.providerId)}>
                    {providerIcon(item.providerId)} {providerLabel(item.providerId)}
                  </span>
                </div>
                {item.gameTitle ? (
                  <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                    🎮 {item.gameTitle}
                    {item.sessionStart != null && (
                      <span style={{ marginLeft: 6, color: "var(--color-text-dim)" }}>
                        · {formatSessionDuration(item.sessionStart)}
                      </span>
                    )}
                  </div>
                ) : (
                  <div style={{ fontSize: 10, color: "var(--color-text-dim)" }}>
                    {item.statusText ?? "Online"}
                  </div>
                )}
              </div>

              {/* Last-seen */}
              <div style={{ fontSize: 10, color: "var(--color-text-dim)", flexShrink: 0 }}>
                {formatPulseElapsed(item.lastSeen)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Social Providers tab ──────────────────────────────────────────────────

export function SocialProvidersTab() {
  const [peers, setPeers]           = useState<UnifiedPeer[]>([]);
  const [configs, setConfigs]       = useState<SocialProviderConfig[]>([]);
  const [statuses, setStatuses]     = useState<SocialProviderStatus[]>([]);
  const [links, setLinks]           = useState<SocialIdentityLink[]>([]);
  const [suggestions, setSuggestions] = useState<IdentityLinkSuggestion[]>([]);
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<string>>(new Set());
  const [tick, setTick]             = useState(0);
  const [notification, setNotification] = useState<{ ok: boolean; msg: string } | null>(null);
  const notifTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = (ok: boolean, msg: string) => {
    setNotification({ ok, msg });
    if (notifTimer.current) clearTimeout(notifTimer.current);
    notifTimer.current = setTimeout(() => setNotification(null), 3500);
  };

  const reload = useCallback(async () => {
    const [p, c, s, l, sg] = await Promise.all([
      invokeGetUnifiedPeers(),
      invokeGetProviderConfigs(),
      invokeGetProviderStatuses(),
      invokeGetIdentityLinks(),
      invokeGetLinkSuggestions(),
    ]);
    setPeers(p);
    setConfigs(c);
    setStatuses(s);
    setLinks(l);
    setSuggestions(sg);
  }, []);

  useEffect(() => {
    reload();
    const unsub = onSocialPeersUpdated((p) => setPeers(p));
    const interval = setInterval(() => {
      setTick((t) => t + 1);
      invokeGetProviderStatuses().then(setStatuses);
    }, 5000);
    return () => {
      unsub.then((f) => f());
      clearInterval(interval);
    };
  }, [reload]);

  const handleSaveConfig = async (config: SocialProviderConfig) => {
    try {
      await invokeSaveProviderConfig(config);
      setConfigs((prev) =>
        prev.map((c) => (c.providerId === config.providerId ? config : c))
      );
      notify(true, `${config.label} configuration saved.`);
    } catch (e) {
      notify(false, String(e));
    }
  };

  const handleStartSteam = async (apiKey: string, steamId: string) => {
    try {
      await invokeSteamStart(apiKey, steamId);
      notify(true, "Steam provider started.");
      setTimeout(() => invokeGetProviderStatuses().then(setStatuses), 2000);
    } catch (e) {
      notify(false, String(e));
    }
  };

  const handleStopSteam = async () => {
    await invokeSteamStop();
    notify(true, "Steam provider stopped.");
    setTimeout(() => invokeGetProviderStatuses().then(setStatuses), 500);
  };

  const handleLink = async (s: IdentityLinkSuggestion) => {
    try {
      await invokeLinkIdentities(s.providerA, s.peerIdA, s.providerB, s.peerIdB);
      reload();
      notify(true, "Identities linked.");
    } catch (e) {
      notify(false, String(e));
    }
  };

  const handleUnlink = async (link: SocialIdentityLink) => {
    try {
      await invokeUnlinkIdentities(link.providerA, link.peerIdA);
      reload();
      notify(true, "Identity link removed.");
    } catch (e) {
      notify(false, String(e));
    }
  };

  const handleDismissSuggestion = (s: IdentityLinkSuggestion) => {
    const key = `${s.providerA}:${s.peerIdA}:${s.providerB}:${s.peerIdB}`;
    setDismissedSuggestions((prev) => new Set([...prev, key]));
  };

  const visibleSuggestions = suggestions.filter((s) => {
    const key = `${s.providerA}:${s.peerIdA}:${s.providerB}:${s.peerIdB}`;
    return !dismissedSuggestions.has(key);
  });

  const statusFor = (id: string) => statuses.find((s) => s.providerId === id);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, padding: "0 4px" }}>

      {/* ── Portable Identity ── */}
      <PortableIdentityPanel />

      {/* ── Encrypted P2P Chat ── */}
      <div style={{ ...card, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13 }}>🔒 Encrypted P2P Chat</div>
          <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 2 }}>
            End-to-end encrypted messaging with friends — X25519 + ChaCha20-Poly1305
          </div>
        </div>
        <button
          onClick={() => window.dispatchEvent(new CustomEvent("libmaly:open-p2p-chat"))}
          style={{ padding: "6px 14px", fontSize: 12, borderRadius: 7, border: "none", background: "var(--color-accent)", color: "#fff", cursor: "pointer", fontWeight: 600, flexShrink: 0 }}
        >
          Open Chat
        </button>
      </div>

      {/* ── Decentralized Share (Nostr / Mastodon) ── */}
      <div style={{ ...card, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13 }}>📡 Share to Nostr / Mastodon</div>
          <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 2 }}>
            Publish reviews, ratings, and screenshots to decentralized social feeds
          </div>
        </div>
        <button
          onClick={() => window.dispatchEvent(new CustomEvent("libmaly:open-dshare"))}
          style={{ padding: "6px 14px", fontSize: 12, borderRadius: 7, border: "none", background: "var(--color-accent)", color: "#fff", cursor: "pointer", fontWeight: 600, flexShrink: 0 }}
        >
          Open
        </button>
      </div>

      {/* ── Epic Games Store ── */}
      <div style={{ ...card, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13 }}>🎮 Epic Games Store (EOS SDK)</div>
          <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 2 }}>
            Login with Epic Account, check game ownership, and view achievement definitions
          </div>
        </div>
        <button
          onClick={() => window.dispatchEvent(new CustomEvent("libmaly:open-epic-store"))}
          style={{ padding: "6px 14px", fontSize: 12, borderRadius: 7, border: "none", background: "#0078f2", color: "#fff", cursor: "pointer", fontWeight: 600, flexShrink: 0 }}
        >
          Open
        </button>
      </div>

      {/* ── Unified Activity Feed (Discord + Steam + Pulse) ── */}
      <UnifiedFeedPanel />

      {/* ── Friend Activity ── */}
      <FriendActivityPanel />

      {/* ── Notification banner ── */}
      {notification && (
        <div
          style={{
            padding: "8px 14px",
            borderRadius: 7,
            fontSize: 12,
            background: notification.ok ? "rgba(91,168,91,.15)" : "rgba(192,57,43,.15)",
            color: notification.ok ? "var(--color-success)" : "var(--color-danger)",
            border: `1px solid ${notification.ok ? "rgba(91,168,91,.3)" : "rgba(192,57,43,.35)"}`,
          }}
        >
          {notification.msg}
        </div>
      )}

      {/* ── Providers ── */}
      <div>
        <div style={sectionTitle}>Social Providers</div>
        <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 10, lineHeight: 1.5 }}>
          Each provider contributes peers independently. Enabling or disabling one never affects the others.
          Peers seen on multiple providers appear with all their source badges until you explicitly link them.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {configs.map((cfg) => (
            <ProviderCard
              key={cfg.providerId}
              config={cfg}
              status={statusFor(cfg.providerId)}
              onSave={handleSaveConfig}
              onStartSteam={handleStartSteam}
              onStopSteam={handleStopSteam}
            />
          ))}
        </div>
      </div>

      {/* ── Link suggestions ── */}
      {visibleSuggestions.length > 0 && (
        <div>
          <div style={sectionTitle}>Identity Link Suggestions</div>
          <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 8 }}>
            These people appear on multiple providers with the same display name. Link them to merge into one entry.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {visibleSuggestions.map((s) => (
              <LinkSuggestionBanner
                key={`${s.providerA}:${s.peerIdA}:${s.providerB}:${s.peerIdB}`}
                suggestion={s}
                onAccept={() => handleLink(s)}
                onDismiss={() => handleDismissSuggestion(s)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Identity links ── */}
      <IdentityLinksPanel links={links} onUnlink={handleUnlink} />

      {/* ── Unified peer list ── */}
      <div>
        <div style={sectionTitle}>
          Friends Online
          {peers.length > 0 && (
            <span style={{ fontWeight: 400, textTransform: "none", marginLeft: 6 }}>
              — {peers.length} peer{peers.length !== 1 ? "s" : ""} across all providers
            </span>
          )}
        </div>
        {peers.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--color-text-dim)", padding: "6px 0" }}>
            No friends online. Make sure at least one provider is connected.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {peers.map((peer) => (
              <UnifiedPeerCard
                key={peer.unifiedId}
                peer={peer}
                tick={tick}
                onLink={() => {/* manual linking via link button handled here */}}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
