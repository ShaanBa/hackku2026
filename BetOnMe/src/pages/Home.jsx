import { useEffect, useMemo, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import AddBetModal from "../components/AddBetModal";
import ProofUploadModal from "../components/ProofUploadModal";
import { useAuth } from "../lib/authContextCore";
import "./Home.css";

// Re-render once a minute so the "time left" stays fresh without calling
// Date.now() directly during render (React 19 purity rule).
function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function formatTimeLeft(ms) {
  if (ms <= 0) return "past due";
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m left`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h left`;
  const days = Math.floor(hrs / 24);
  return `${days}d left`;
}

function formatDateShort(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Count active goals per day of week (Mon-Sun)
function buildWeeklyBuckets(goals) {
  // Index 0=Mon … 6=Sun
  const labels = ["M", "T", "W", "T", "F", "S", "S"];
  const buckets = Array.from({ length: 7 }, () => ({ total: 0, done: 0 }));
  for (const g of goals) {
    const targetIso = g?.target?.targetAt;
    if (!targetIso) continue;
    const d = new Date(targetIso);
    const jsDay = d.getDay(); // 0=Sun..6=Sat
    const idx = (jsDay + 6) % 7;
    buckets[idx].total += 1;
    if (g.status === "succeeded") buckets[idx].done += 1;
  }
  return buckets.map((b, i) => ({ label: labels[i], ...b }));
}

function Home() {
  const { user } = useAuth();
  const { goals, refreshGoals } = useOutletContext();
  const [modalOpen, setModalOpen] = useState(false);
  const [proofOpen, setProofOpen] = useState(false);
  const now = useNow();

  const activeGoals = useMemo(
    () => (goals || []).filter((g) => g.status === "active"),
    [goals]
  );
  const currentBet = activeGoals[0] || null;

  const stats = useMemo(() => {
    const total = goals.length;
    const done = goals.filter((g) => g.status === "succeeded").length;
    const failed = goals.filter((g) => g.status === "failed").length;
    return { total, done, failed };
  }, [goals]);

  const week = useMemo(() => buildWeeklyBuckets(goals), [goals]);

  return (
    <div className="page home">
      <div className="home-grid">
        <div className="home-main">
          <section className="box current-bet">
            <div className="section-title">Current bet</div>
            {currentBet ? (
              <>
                <div className="current-bet-top">
                  <h2>{currentBet.title}</h2>
                  <span className="badge badge-active">{currentBet.status}</span>
                </div>
                <div className="current-bet-meta">
                  <div>
                    <div className="label">Wager</div>
                    <div className="big">{currentBet.stakeAmount} XRP</div>
                  </div>
                  <div>
                    <div className="label">Target</div>
                    <div>{formatDateShort(currentBet.target?.targetAt)}</div>
                  </div>
                  <div>
                    <div className="label">Window</div>
                    <div>± {currentBet.target?.windowMinutes ?? 30} min</div>
                  </div>
                  <div>
                    <div className="label">Time left</div>
                    <div>
                      {formatTimeLeft(
                        new Date(currentBet.target?.targetAt).getTime() +
                          (currentBet.target?.windowMinutes ?? 30) * 60 * 1000 -
                          now
                      )}
                    </div>
                  </div>
                </div>
                <div className="current-bet-actions">
                  <button
                    className="btn btn-primary"
                    onClick={() => setProofOpen(true)}
                  >
                    📷 Upload proof
                  </button>
                  <Link to="/bets" className="btn">
                    View all bets
                  </Link>
                  <button className="btn" onClick={() => setModalOpen(true)}>
                    + Add another
                  </button>
                </div>
              </>
            ) : (
              <div className="empty-current">
                <h2>No active bet</h2>
                <p className="muted">
                  Lock some XRP against a goal — if you show up on time and in
                  place, you get it back.
                </p>
                <button
                  className="btn btn-primary"
                  onClick={() => setModalOpen(true)}
                >
                  + Place your first bet
                </button>
              </div>
            )}
          </section>

          <section className="box week-view">
            <div className="section-title">Week overview</div>
            <div className="week-bars">
              {week.map((b, i) => {
                const h = b.total === 0 ? 6 : Math.min(120, 24 + b.total * 24);
                return (
                  <div key={i} className="week-col">
                    <div
                      className="week-bar"
                      style={{
                        height: h,
                        background:
                          b.total === 0
                            ? "rgba(255,255,255,0.05)"
                            : b.done === b.total
                              ? "linear-gradient(180deg,#4ade80,#22c55e)"
                              : "linear-gradient(180deg,#7c9cff,#5d7dff)",
                      }}
                    >
                      {b.total > 0 && (
                        <span className="week-count">
                          {b.done}/{b.total}
                        </span>
                      )}
                    </div>
                    <div className="week-label">{b.label}</div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        <aside className="home-side">
          <section className="box add-tile" onClick={() => setModalOpen(true)}>
            <div>
              <div className="section-title">Place a bet</div>
              <h3>Add bet</h3>
              <p className="muted">Goal, window, amount, charity.</p>
            </div>
            <div className="plus">+</div>
          </section>

          <section className="box ratio-tile">
            <div className="section-title">Your ratio</div>
            <div className="ratio-display">
              <span className="ratio-num">{stats.done}</span>
              <span className="ratio-sep">/</span>
              <span className="ratio-den">{stats.total}</span>
            </div>
            <div className="muted">
              {stats.total === 0
                ? "No bets yet."
                : `${stats.failed} failed · ${Math.round(
                    (stats.done / Math.max(1, stats.total)) * 100
                  )}% success`}
            </div>
          </section>

          <section className="box greeting">
            <div className="section-title">Welcome</div>
            <div>{user?.displayName || "Hello"} 👋</div>
            <div className="muted">
              Click your profile to open wallet & bet history.
            </div>
          </section>
        </aside>
      </div>

      <AddBetModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={refreshGoals}
      />
      <ProofUploadModal
        open={proofOpen}
        goal={currentBet}
        onClose={() => setProofOpen(false)}
        onUploaded={refreshGoals}
      />
    </div>
  );
}

export default Home;
