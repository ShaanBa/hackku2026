import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../lib/authContextCore";
import { useDevMode } from "../lib/devModeCore";
import api from "../lib/api";
import { acctUrl, txUrl } from "../lib/xrplExplorer";
import "./Sidebar.css";

function truncateAddr(addr) {
  if (!addr) return "—";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatXRP(balance) {
  if (balance === null || balance === undefined) return "—";
  if (!Number.isFinite(balance)) return "—";
  // Show up to 6 decimal places (1 XRP = 1,000,000 drops), strip trailing zeros
  const full = balance.toFixed(6).replace(/\.?0+$/, "");
  return `${full} XRP`;
}

function formatDelta(delta) {
  if (!Number.isFinite(delta)) return "0 XRP";
  const abs = Math.abs(delta).toFixed(6).replace(/\.?0+$/, "");
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "";
  return `${sign}${abs} XRP`;
}

function formatShortDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    month: "2-digit",
    day: "2-digit",
  });
}

function Sidebar({ open, onClose, goals = [] }) {
  const { user } = useAuth();
  const { enabled, setEnabled, adminSecret, setAdminSecret } = useDevMode();

  const [wallet, setWallet] = useState(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const [walletError, setWalletError] = useState(null);
  const [copied, setCopied] = useState(false);

  const refreshWallet = useCallback(async () => {
    if (!user) return;
    setWalletLoading(true);
    setWalletError(null);
    try {
      const res = await api.wallet();
      setWallet(res);
    } catch (err) {
      setWalletError(err.message || "Failed to load wallet");
    } finally {
      setWalletLoading(false);
    }
  }, [user]);

  // Fetch on open and whenever the user's goals list changes — because goal
  // resolution (success refund / fail payout) is what moves the balance.
  useEffect(() => {
    if (!open || !user) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshWallet();
  }, [open, user, goals, refreshWallet]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose?.();
    }
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const resolved = goals.filter(
    (g) => g.status === "succeeded" || g.status === "failed"
  );

  function copyAddress() {
    const addr = user?.walletAddress;
    if (!addr) return;
    try {
      navigator.clipboard?.writeText(addr);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore
    }
  }

  const address = user?.walletAddress;
  const explorerHref = acctUrl(address);

  return (
    <>
      <div className={`sidebar-scrim ${open ? "open" : ""}`} onClick={onClose} />
      <aside className={`sidebar ${open ? "open" : ""}`} aria-hidden={!open}>
        <div className="sidebar-header">
          <div className="sidebar-avatar">
            {user?.displayName?.[0]?.toUpperCase() || "U"}
          </div>
          <div>
            <div className="sidebar-name">{user?.displayName || "Not signed in"}</div>
            <div className="sidebar-username muted">
              {user ? `@${user.username}` : ""}
            </div>
          </div>
          <button className="btn btn-ghost sidebar-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="sidebar-section">
          <div className="section-title">Wallet</div>
          <div className="wallet-card">
            <div className="wallet-label muted">
              XRPL address (shared demo wallet)
            </div>
            <div className="wallet-row">
              <span className="wallet-addr" title={address || ""}>
                {truncateAddr(address)}
              </span>
              <button
                type="button"
                className="btn btn-ghost wallet-copy"
                onClick={copyAddress}
                disabled={!address}
                title="Copy address"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>

            <hr />

            <div className="wallet-label muted">Live testnet balance</div>
            <div className="wallet-row">
              <span className="wallet-balance">
                {walletLoading ? "…" : formatXRP(wallet?.balanceXRP)}
              </span>
              <button
                type="button"
                className="btn btn-ghost wallet-copy"
                onClick={refreshWallet}
                disabled={walletLoading}
                title="Refresh balance"
              >
                ↻
              </button>
            </div>
            {wallet?.note && (
              <div className="muted small" style={{ marginTop: 4 }}>
                {wallet.note}
              </div>
            )}
            {walletError && (
              <div className="small" style={{ color: "#fda4a4", marginTop: 4 }}>
                {walletError}
              </div>
            )}

            <hr />

            <div className="wallet-label muted">Recent transactions</div>
            {walletLoading && !wallet ? (
              <div className="muted small">Loading…</div>
            ) : wallet?.transactions?.length ? (
              <ul className="ledger">
                {wallet.transactions.map((t) => {
                  const cls =
                    t.deltaXRP > 0
                      ? "delta-pos"
                      : t.deltaXRP < 0
                      ? "delta-neg"
                      : "";
                  return (
                    <li key={t.hash} className="ledger-row">
                      <div className="ledger-main">
                        <span className={`ledger-delta ${cls}`}>
                          {formatDelta(t.deltaXRP)}
                        </span>
                        <span className="ledger-label" title={t.type}>
                          {t.label}
                        </span>
                      </div>
                      <div className="ledger-meta">
                        <span className="ledger-date muted">
                          {formatShortDate(t.date)}
                        </span>
                        <a
                          className="ledger-link"
                          href={txUrl(t.hash)}
                          target="_blank"
                          rel="noreferrer noopener"
                          title="View on testnet explorer"
                        >
                          ↗
                        </a>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="muted small">No transactions yet.</div>
            )}

            {explorerHref && (
              <a
                className="btn btn-primary wallet-explorer"
                href={explorerHref}
                target="_blank"
                rel="noreferrer noopener"
              >
                View on testnet.xrpl.org ↗
              </a>
            )}
          </div>
        </div>

        <div className="sidebar-section">
          <div className="section-title">Dev mode</div>
          <label className="dev-toggle">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <span>Enable dev actions (force succeed / fail)</span>
          </label>
          {enabled && (
            <div style={{ marginTop: 10 }}>
              <label className="label">Admin secret</label>
              <input
                type="password"
                className="input"
                value={adminSecret}
                onChange={(e) => setAdminSecret(e.target.value)}
                placeholder="ADMIN_SECRET from .env.local"
              />
              <div className="muted small" style={{ marginTop: 4 }}>
                Needed to call <code>/api/goals/resolve</code>. Stored in your
                browser only.
              </div>
            </div>
          )}
        </div>

        <div className="sidebar-section">
          <div className="section-title">Bet history</div>
          {resolved.length === 0 ? (
            <div className="muted">No resolved bets yet.</div>
          ) : (
            <ul className="history">
              {resolved.slice(0, 8).map((g) => (
                <li key={g.id} className="history-row">
                  <span className="history-title">{g.title}</span>
                  <span
                    className={`badge ${
                      g.status === "succeeded" ? "badge-success" : "badge-failed"
                    }`}
                  >
                    {g.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </>
  );
}

export default Sidebar;
