import { invoke } from "@tauri-apps/api/core";
import { useState } from "preact/hooks";

export function DLsiteLoginModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [loginId, setLoginId] = useState("");
  const [pass, setPass] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const doLogin = async () => {
    if (!loginId || !pass) return;
    setLoading(true);
    setError("");
    try {
      const ok = await invoke<boolean>("dlsite_login", { loginId, password: pass });
      if (ok) {
        onSuccess();
        onClose();
      } else {
        setError("Login failed - check your Login ID and password.");
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.8)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rounded-lg p-6 w-96 shadow-2xl" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded flex items-center justify-center font-bold text-[11px]"
            style={{ background: "var(--color-danger-strong)", color: "var(--color-white)" }}>DL</div>
          <h2 className="text-lg font-bold" style={{ color: "var(--color-white)" }}>Sign in to DLsite</h2>
        </div>
        <p className="text-xs mb-1" style={{ color: "var(--color-text-muted)" }}>
          Logging in unlocks age-gated product pages, so metadata can be fetched without the age-gate redirect.
        </p>
        <p className="text-xs mb-4" style={{ color: "var(--color-text-dim)" }}>
          Your credentials are sent directly to DLsite (login.dlsite.com) and are never stored by LIBMALY.
        </p>
        <div className="space-y-3">
          <div>
            <label className="text-[10px] uppercase tracking-widest block mb-1" style={{ color: "var(--color-text-dim)" }}>Login ID (email or username)</label>
            <input type="text" placeholder="Login ID" value={loginId}
              onInput={(e) => setLoginId((e.target as HTMLInputElement).value)}
              className="w-full px-3 py-2 rounded text-sm outline-none"
              style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border)" }} />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-widest block mb-1" style={{ color: "var(--color-text-dim)" }}>Password</label>
            <input type="password" placeholder="Password" value={pass}
              onInput={(e) => setPass((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => e.key === "Enter" && doLogin()}
              className="w-full px-3 py-2 rounded text-sm outline-none"
              style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border)" }} />
          </div>
        </div>
        {error && <p className="mt-2 text-xs" style={{ color: "var(--color-danger)" }}>{error}</p>}
        <div className="flex gap-3 justify-end mt-5">
          <button onClick={onClose}
            className="px-4 py-2 rounded text-sm"
            style={{ background: "var(--color-panel-2)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>Cancel</button>
          <button onClick={doLogin} disabled={loading || !loginId || !pass}
            className="px-5 py-2 rounded text-sm font-semibold disabled:opacity-50 flex items-center gap-2"
            style={{ background: "var(--color-danger-strong)", color: "var(--color-white)" }}>
            {loading && <span className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />}
            Sign In
          </button>
        </div>
      </div>
    </div>
  );
}
