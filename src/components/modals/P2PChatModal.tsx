/**
 * P2PChatModal — Encrypted peer-to-peer chat window.
 *
 * Left pane  : Conversation list + contact management
 * Right pane : Active message thread + input bar
 * Top bar    : My Chat Key (shareable X25519 public key) + settings button
 */
import { useState, useEffect, useCallback, useRef } from "preact/hooks";
import type { JSX } from "preact";
import {
  type ChatConfig,
  type ChatMessage,
  type ConversationSummary,
  chatGetConfig,
  chatSaveConfig,
  chatGetMyX25519Pub,
  chatSaveContact,
  chatGetConversations,
  chatGetMessages,
  chatSendMessage,
  chatFetchRemote,
  chatMarkRead,
  chatDeleteConversation,
} from "../../lib/p2pChat";

// ── Style constants ───────────────────────────────────────────────────────────

const overlay: JSX.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 9100,
  background: "rgba(0,0,0,.65)", backdropFilter: "blur(6px)",
  display: "flex", alignItems: "center", justifyContent: "center",
};

const dialog: JSX.CSSProperties = {
  background: "var(--color-panel)", border: "1px solid var(--color-border)",
  borderRadius: 14, width: "min(860px,95vw)", height: "min(640px,90vh)",
  display: "flex", flexDirection: "column", overflow: "hidden",
  boxShadow: "0 24px 80px rgba(0,0,0,.5)",
};

const topBar: JSX.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between",
  padding: "12px 16px", borderBottom: "1px solid var(--color-border)",
  gap: 10, flexShrink: 0,
};

const body: JSX.CSSProperties = {
  display: "flex", flex: 1, minHeight: 0,
};

const leftPane: JSX.CSSProperties = {
  width: 220, borderRight: "1px solid var(--color-border)",
  display: "flex", flexDirection: "column", overflow: "hidden", flexShrink: 0,
};

const rightPane: JSX.CSSProperties = {
  flex: 1, display: "flex", flexDirection: "column", overflow: "hidden",
};

const btnSmall: JSX.CSSProperties = {
  padding: "4px 10px", fontSize: 11, borderRadius: 6,
  border: "1px solid var(--color-border)", background: "var(--color-panel-2)",
  color: "var(--color-text)", cursor: "pointer",
};

const btnAccent: JSX.CSSProperties = {
  padding: "6px 14px", fontSize: 12, borderRadius: 7,
  border: "none", background: "var(--color-accent)",
  color: "#fff", cursor: "pointer", fontWeight: 600,
};

const inputStyle: JSX.CSSProperties = {
  flex: 1, padding: "7px 10px", fontSize: 13,
  background: "var(--color-panel-2)", border: "1px solid var(--color-border)",
  borderRadius: 7, color: "var(--color-text)", outline: "none",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(secs: number): string {
  const d = new Date(secs * 1000);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) +
    " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

// ── Sub-components ────────────────────────────────────────────────────────────

/** Copyable label for our X25519 public key. */
function MyChatKey({ pubKey }: { pubKey: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(pubKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ fontSize: 10, color: "var(--color-text-dim)", letterSpacing: "0.05em", textTransform: "uppercase" }}>
        My Chat Key:
      </span>
      <code style={{ fontSize: 10, background: "var(--color-panel-2)", padding: "2px 6px", borderRadius: 4, color: "var(--color-text-muted)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {pubKey ? truncate(pubKey, 28) : "generating…"}
      </code>
      <button onClick={copy} style={btnSmall}>
        {copied ? "✓" : "Copy"}
      </button>
    </div>
  );
}

/** Side-pane conversation entry. */
function ConvRow({
  conv, active, onClick,
}: { conv: ConversationSummary; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", flexDirection: "column", alignItems: "flex-start",
        gap: 2, padding: "9px 12px", borderRadius: 0, border: "none",
        background: active ? "var(--color-panel-2)" : "transparent",
        color: "var(--color-text)", cursor: "pointer", width: "100%",
        textAlign: "left", borderBottom: "1px solid var(--color-border-soft)",
        transition: "background .1s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
        <span style={{ fontWeight: 600, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 }}>
          {conv.peerName}
        </span>
        {conv.unreadCount > 0 && (
          <span style={{ fontSize: 10, fontWeight: 700, background: "var(--color-accent)", color: "#fff", borderRadius: 10, padding: "1px 6px" }}>
            {conv.unreadCount}
          </span>
        )}
      </div>
      {conv.lastMessage && (
        <span style={{ fontSize: 10, color: "var(--color-text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "100%" }}>
          {truncate(conv.lastMessage, 40)}
        </span>
      )}
    </button>
  );
}

/** A single message bubble. */
function MsgBubble({ msg }: { msg: ChatMessage }) {
  const sent = msg.direction === "sent";
  return (
    <div style={{ display: "flex", justifyContent: sent ? "flex-end" : "flex-start", marginBottom: 6 }}>
      <div style={{
        maxWidth: "72%", padding: "8px 12px", borderRadius: 12,
        borderBottomRightRadius: sent ? 2 : 12,
        borderBottomLeftRadius: sent ? 12 : 2,
        background: sent ? "var(--color-accent)" : "var(--color-panel-2)",
        color: sent ? "#fff" : "var(--color-text)",
        fontSize: 13, lineHeight: 1.5,
        border: "1px solid " + (sent ? "transparent" : "var(--color-border-soft)"),
      }}>
        <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{msg.plaintext}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 4, justifyContent: "flex-end" }}>
          <span style={{ fontSize: 9, opacity: 0.65 }}>{fmtTime(msg.timestamp)}</span>
          {sent && (
            <span style={{ fontSize: 9, opacity: 0.65 }}>
              {msg.status === "pending" ? "⏳" : msg.status === "failed" ? "✗" : "✓"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Add Contact Dialog ────────────────────────────────────────────────────────

function AddContactDialog({ onAdd, onClose }: {
  onAdd: (fp: string, name: string, key: string) => Promise<void>;
  onClose: () => void;
}) {
  const [fp, setFp] = useState("");
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setErr("");
    if (!fp.trim() || !name.trim() || !key.trim()) {
      setErr("All fields are required.");
      return;
    }
    setSaving(true);
    try {
      await onAdd(fp.trim(), name.trim(), key.trim());
      onClose();
    } catch (e: unknown) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ ...overlay, zIndex: 9200 }}>
      <div style={{
        background: "var(--color-panel)", border: "1px solid var(--color-border)",
        borderRadius: 12, padding: "20px 22px", width: 380,
        display: "flex", flexDirection: "column", gap: 12,
        boxShadow: "0 16px 60px rgba(0,0,0,.5)",
      }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Add Contact</h3>
        <p style={{ margin: 0, fontSize: 11, color: "var(--color-text-muted)" }}>
          Ask your contact to share their fingerprint (from Social → Identity) and Chat Key.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {[
            { label: "Display Name", val: name, set: setName, placeholder: "Alice" },
            { label: "Fingerprint (ab:cd:ef:…)", val: fp, set: setFp, placeholder: "ab:cd:ef:12:34:56:78:90" },
            { label: "Chat Key (X25519, base64)", val: key, set: setKey, placeholder: "base64 32-byte key…" },
          ].map(({ label, val, set, placeholder }) => (
            <div key={label} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <label style={{ fontSize: 10, color: "var(--color-text-dim)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {label}
              </label>
              <input
                value={val}
                onInput={(e) => set((e.target as HTMLInputElement).value)}
                placeholder={placeholder}
                style={inputStyle}
              />
            </div>
          ))}
        </div>
        {err && <p style={{ margin: 0, fontSize: 11, color: "var(--color-danger)" }}>{err}</p>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={btnSmall}>Cancel</button>
          <button onClick={submit} disabled={saving} style={btnAccent}>
            {saving ? "Saving…" : "Add Contact"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Settings Panel ────────────────────────────────────────────────────────────

function ChatSettingsPanel({ onClose }: { onClose: () => void }) {
  const [cfg, setCfg] = useState<ChatConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => { chatGetConfig().then(setCfg); }, []);

  const save = async () => {
    if (!cfg) return;
    setSaving(true);
    try {
      await chatSaveConfig(cfg);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  if (!cfg) return <div style={{ padding: 20, color: "var(--color-text-dim)" }}>Loading…</div>;

  return (
    <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Chat Settings</h3>
        <button onClick={onClose} style={btnSmall}>← Back</button>
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
        <input type="checkbox" checked={cfg.enabled} onChange={(e) => setCfg({ ...cfg, enabled: (e.target as HTMLInputElement).checked })} />
        <span style={{ fontSize: 13 }}>Enable Encrypted P2P Chat</span>
      </label>

      {[
        { label: "Relay URL", key: "relayUrl" as const, placeholder: "https://relay.example.com" },
        { label: "Room Key", key: "roomKey" as const, placeholder: "shared room key" },
      ].map(({ label, key, placeholder }) => (
        <div key={key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-dim)" }}>
            {label}
          </label>
          <input
            value={cfg[key] ?? ""}
            onInput={(e) => setCfg({ ...cfg, [key]: (e.target as HTMLInputElement).value || null })}
            placeholder={placeholder}
            style={inputStyle}
          />
        </div>
      ))}

      <p style={{ margin: 0, fontSize: 11, color: "var(--color-text-dim)" }}>
        Use the same Relay URL and Room Key as your Pulse config to share infrastructure, or set different values for a private chat network.
      </p>

      <button onClick={save} disabled={saving} style={btnAccent}>
        {saving ? "Saving…" : saved ? "Saved ✓" : "Save"}
      </button>
    </div>
  );
}

// ── Main Modal ────────────────────────────────────────────────────────────────

export function P2PChatModal({ onClose }: { onClose: () => void }) {
  const [pubKey, setPubKey] = useState("");
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeFingerprint, setActiveFingerprint] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [showAddContact, setShowAddContact] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [newCount, setNewCount] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const reload = useCallback(async () => {
    const [convs, key] = await Promise.all([chatGetConversations(), chatGetMyX25519Pub()]);
    setConversations(convs);
    setPubKey(key);
  }, []);

  const openConversation = useCallback(async (fp: string) => {
    setActiveFingerprint(fp);
    const msgs = await chatGetMessages(fp);
    setMessages(msgs);
    await chatMarkRead(fp);
    await reload();
  }, [reload]);

  const sendMessage = useCallback(async () => {
    if (!draft.trim() || !activeFingerprint || sending) return;
    const text = draft.trim();
    setDraft("");
    setSending(true);
    try {
      await chatSendMessage(activeFingerprint, text);
      const msgs = await chatGetMessages(activeFingerprint);
      setMessages(msgs);
      await reload();
    } catch (e: unknown) {
      setDraft(text); // restore on error
      alert(String(e));
    } finally {
      setSending(false);
    }
  }, [draft, activeFingerprint, sending, reload]);

  const fetchRemote = useCallback(async () => {
    setFetching(true);
    try {
      const n = await chatFetchRemote();
      setNewCount(n);
      setTimeout(() => setNewCount(null), 3000);
      await reload();
      if (activeFingerprint) {
        const msgs = await chatGetMessages(activeFingerprint);
        setMessages(msgs);
      }
    } finally {
      setFetching(false);
    }
  }, [activeFingerprint, reload]);

  useEffect(() => { reload(); }, [reload]);

  // Auto-scroll to bottom when messages change.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Poll every 30 s.
  useEffect(() => {
    const interval = setInterval(fetchRemote, 30_000);
    return () => clearInterval(interval);
  }, [fetchRemote]);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const activeContact = conversations.find((c) => c.peerFingerprint === activeFingerprint);

  return (
    <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={dialog} onKeyDown={handleKeyDown as never}>
        {/* ── Top bar ── */}
        <div style={topBar}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>🔒 Encrypted Chat</span>
            <MyChatKey pubKey={pubKey} />
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {newCount !== null && (
              <span style={{ fontSize: 11, color: "var(--color-success)" }}>
                {newCount === 0 ? "Up to date" : `+${newCount} new`}
              </span>
            )}
            <button onClick={fetchRemote} disabled={fetching} style={btnSmall}>
              {fetching ? "…" : "↻ Sync"}
            </button>
            <button onClick={() => setShowSettings(!showSettings)} style={btnSmall}>⚙</button>
            <button onClick={onClose} style={{ ...btnSmall, border: "none", background: "transparent", fontSize: 16, padding: "2px 6px" }}>✕</button>
          </div>
        </div>

        {showSettings ? (
          <ChatSettingsPanel onClose={() => setShowSettings(false)} />
        ) : (
          <div style={body}>
            {/* ── Left: conversation list ── */}
            <div style={leftPane}>
              <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--color-border)", display: "flex", gap: 6 }}>
                <button onClick={() => setShowAddContact(true)} style={{ ...btnSmall, flex: 1 }}>
                  + New Chat
                </button>
              </div>
              <div style={{ flex: 1, overflowY: "auto" }}>
                {conversations.length === 0 ? (
                  <p style={{ fontSize: 11, color: "var(--color-text-dim)", padding: "12px 10px", textAlign: "center" }}>
                    No conversations yet.<br />Add a contact to start chatting.
                  </p>
                ) : (
                  conversations.map((c) => (
                    <ConvRow
                      key={c.peerFingerprint}
                      conv={c}
                      active={c.peerFingerprint === activeFingerprint}
                      onClick={() => openConversation(c.peerFingerprint)}
                    />
                  ))
                )}
              </div>
            </div>

            {/* ── Right: thread ── */}
            <div style={rightPane}>
              {activeFingerprint == null ? (
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 10, color: "var(--color-text-dim)" }}>
                  <div style={{ fontSize: 32 }}>🔒</div>
                  <p style={{ fontSize: 13, textAlign: "center", maxWidth: 260 }}>
                    Select a conversation or add a new contact to start a secure, end-to-end encrypted chat.
                  </p>
                  <button onClick={() => setShowAddContact(true)} style={btnAccent}>
                    + Add Contact
                  </button>
                </div>
              ) : (
                <>
                  {/* Thread header */}
                  <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
                    <div>
                      <span style={{ fontWeight: 700, fontSize: 13 }}>{activeContact?.peerName ?? activeFingerprint}</span>
                      <span style={{ fontSize: 10, color: "var(--color-text-dim)", marginLeft: 8 }}>{activeFingerprint}</span>
                    </div>
                    <button
                      onClick={async () => {
                        if (!confirm("Delete this conversation? This cannot be undone.")) return;
                        await chatDeleteConversation(activeFingerprint);
                        setActiveFingerprint(null);
                        setMessages([]);
                        await reload();
                      }}
                      style={{ ...btnSmall, color: "var(--color-danger)", borderColor: "var(--color-danger)" }}
                    >
                      Delete
                    </button>
                  </div>

                  {/* Messages */}
                  <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px" }}>
                    {messages.length === 0 ? (
                      <p style={{ fontSize: 11, color: "var(--color-text-dim)", textAlign: "center", paddingTop: 40 }}>
                        No messages yet — send the first one!
                      </p>
                    ) : (
                      messages.map((m) => <MsgBubble key={m.id} msg={m} />)
                    )}
                    <div ref={messagesEndRef} />
                  </div>

                  {/* Input bar */}
                  <div style={{ padding: "8px 12px", borderTop: "1px solid var(--color-border)", display: "flex", gap: 8, alignItems: "flex-end", flexShrink: 0 }}>
                    <textarea
                      value={draft}
                      onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
                      onKeyDown={handleKeyDown as never}
                      placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
                      rows={1}
                      style={{ ...inputStyle, resize: "none", minHeight: 36, maxHeight: 120, overflowY: "auto", lineHeight: 1.5 }}
                    />
                    <button
                      onClick={sendMessage}
                      disabled={sending || !draft.trim()}
                      style={{ ...btnAccent, padding: "8px 14px" }}
                    >
                      {sending ? "…" : "Send"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {showAddContact && (
        <AddContactDialog
          onAdd={async (fp, name, key) => {
            await chatSaveContact(fp, name, key);
            await reload();
          }}
          onClose={() => setShowAddContact(false)}
        />
      )}
    </div>
  );
}
