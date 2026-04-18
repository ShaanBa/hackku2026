import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import AddBetModal from "../components/AddBetModal";
import ProofUploadModal from "../components/ProofUploadModal";
import api from "../lib/api";
import { useDevMode } from "../lib/devModeCore";
import { txUrl } from "../lib/xrplExplorer";
import "./Bets.css";

function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function timeLeftLabel(targetIso, windowMinutes, now) {
  if (!targetIso) return "—";
  const end =
    new Date(targetIso).getTime() + (windowMinutes ?? 30) * 60 * 1000;
  const ms = end - now;
  if (ms <= 0) return "past due";
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

function statusBadgeClass(status) {
  switch (status) {
    case "active":
      return "badge badge-active";
    case "succeeded":
      return "badge badge-success";
    case "failed":
      return "badge badge-failed";
    case "expired":
      return "badge badge-expired";
    default:
      return "badge";
  }
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: "2-digit",
    day: "2-digit",
    year: "2-digit",
  });
}

const FILTERS = [
  { id: "all", label: "All", match: () => true },
  { id: "active", label: "Active", match: (g) => g.status === "active" },
  { id: "succeeded", label: "Succeeded", match: (g) => g.status === "succeeded" },
  { id: "failed", label: "Failed", match: (g) => g.status === "failed" },
];

function TxChip({ hash, label, title }) {
  const href = txUrl(hash);
  if (!href) return null;
  return (
    <a
      className="tx-chip"
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      title={title || hash}
    >
      {label} ↗
    </a>
  );
}

function Bets() {
  const { goals, goalsLoading, goalsError, refreshGoals } = useOutletContext();
  const [modalOpen, setModalOpen] = useState(false);
  const [proofGoal, setProofGoal] = useState(null);
  const [rowErr, setRowErr] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [filter, setFilter] = useState("all");
  const now = useNow();
  const { enabled: devMode, adminSecret } = useDevMode();

  const counts = useMemo(() => {
    const out = {};
    for (const f of FILTERS) {
      out[f.id] = goals.filter(f.match).length;
    }
    return out;
  }, [goals]);

  const visibleGoals = useMemo(() => {
    const f = FILTERS.find((x) => x.id === filter) || FILTERS[0];
    return goals.filter(f.match);
  }, [goals, filter]);

  async function forceResolve(goal, outcome) {
    setRowErr(null);
    if (!adminSecret) {
      setRowErr("Dev mode: paste the admin secret in the sidebar first.");
      return;
    }
    setBusyId(goal.id);
    try {
      await api.resolveGoal({ goalId: goal.id, outcome }, adminSecret);
      await refreshGoals();
    } catch (err) {
      setRowErr(err.message || `Failed to force ${outcome}`);
    } finally {
      setBusyId(null);
    }
  }

  const emptyLabel = goals.length === 0
    ? "No bets yet. Place your first one to get started."
    : `No ${filter === "all" ? "" : filter + " "}bets.`;

  return (
    <div className="page bets">
      <header className="bets-header">
        <div>
          <div className="section-title">BetOnMe</div>
          <h1>Your bets</h1>
        </div>
        <button className="btn btn-primary" onClick={() => setModalOpen(true)}>
          + Add bet
        </button>
      </header>

      {goalsError && <div className="error-banner">{goalsError}</div>}
      {rowErr && <div className="error-banner">{rowErr}</div>}
      {devMode && (
        <div className="dev-banner">
          Dev mode is <strong>ON</strong> — force-resolve buttons are visible on
          active bets.
        </div>
      )}

      <div className="filter-chips" role="tablist" aria-label="Filter bets">
        {FILTERS.map((c) => (
          <button
            key={c.id}
            role="tab"
            aria-selected={filter === c.id}
            className={`chip ${filter === c.id ? "active" : ""}`}
            onClick={() => setFilter(c.id)}
          >
            {c.label}
            <span className="chip-count">{counts[c.id]}</span>
          </button>
        ))}
      </div>

      <div className="box table-wrap">
        <table className="bets-table">
          <thead>
            <tr>
              <th>Goal</th>
              <th>Time left</th>
              <th>Wager</th>
              <th>Date placed</th>
              <th>Status</th>
              <th style={{ textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {goalsLoading && goals.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="muted"
                  style={{ textAlign: "center", padding: 24 }}
                >
                  Loading…
                </td>
              </tr>
            ) : visibleGoals.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="muted"
                  style={{ textAlign: "center", padding: 24 }}
                >
                  {emptyLabel}
                </td>
              </tr>
            ) : (
              visibleGoals.map((g) => (
                <tr key={g.id}>
                  <td>
                    <div className="goal-cell">
                      <span className="goal-title">{g.title}</span>
                      {g.location?.name && (
                        <span className="muted small">@ {g.location.name}</span>
                      )}
                      <div className="tx-chips">
                        <TxChip
                          hash={g.escrow?.createTxHash}
                          label="escrow tx"
                          title="View EscrowCreate on the XRPL testnet explorer"
                        />
                        <TxChip
                          hash={g.escrow?.finishTxHash}
                          label="payout tx"
                          title="View EscrowFinish (payout to charity) on the XRPL testnet explorer"
                        />
                      </div>
                    </div>
                  </td>
                  <td>
                    {g.status === "active"
                      ? timeLeftLabel(
                          g.target?.targetAt,
                          g.target?.windowMinutes,
                          now
                        )
                      : g.status}
                  </td>
                  <td>{g.stakeAmount} XRP</td>
                  <td>{fmtDate(g.createdAt)}</td>
                  <td>
                    <span className={statusBadgeClass(g.status)}>
                      {g.status}
                    </span>
                  </td>
                  <td>
                    <div className="row-actions">
                      {g.status === "active" && (
                        <button
                          className="btn"
                          onClick={() => setProofGoal(g)}
                          disabled={busyId === g.id}
                        >
                          Upload proof
                        </button>
                      )}
                      {devMode && g.status === "active" && (
                        <>
                          <button
                            className="btn"
                            onClick={() => forceResolve(g, "succeeded")}
                            disabled={busyId === g.id}
                            title="Dev: mark succeeded"
                          >
                            ✓
                          </button>
                          <button
                            className="btn btn-danger"
                            onClick={() => forceResolve(g, "failed")}
                            disabled={busyId === g.id}
                            title="Dev: mark failed (payout to charity)"
                          >
                            ✗
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <button
          className="fab"
          onClick={() => setModalOpen(true)}
          title="Add bet"
        >
          +
        </button>
      </div>

      <AddBetModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={refreshGoals}
      />
      <ProofUploadModal
        open={Boolean(proofGoal)}
        goal={proofGoal}
        onClose={() => setProofGoal(null)}
        onUploaded={refreshGoals}
      />
    </div>
  );
}

export default Bets;
