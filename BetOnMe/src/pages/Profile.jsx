import { useOutletContext } from "react-router-dom";
import { useAuth } from "../lib/authContextCore";

function Profile() {
  const { user, logout } = useAuth();
  const { goals } = useOutletContext();

  const done = goals.filter((g) => g.status === "succeeded").length;
  const failed = goals.filter((g) => g.status === "failed").length;
  const active = goals.filter((g) => g.status === "active").length;

  return (
    <div className="page">
      <h1 style={{ marginBottom: 16 }}>Profile</h1>

      <div className="box" style={{ marginBottom: 16 }}>
        <div className="section-title">Account</div>
        <div style={{ display: "grid", gap: 6 }}>
          <div>
            <strong>{user?.displayName}</strong>{" "}
            <span className="muted">@{user?.username}</span>
          </div>
          <div className="muted">Wallet: {user?.walletAddress || "—"}</div>
        </div>
      </div>

      <div className="box" style={{ marginBottom: 16 }}>
        <div className="section-title">Stats</div>
        <div style={{ display: "flex", gap: 24 }}>
          <div>
            <div className="label">Active</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{active}</div>
          </div>
          <div>
            <div className="label">Succeeded</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{done}</div>
          </div>
          <div>
            <div className="label">Failed</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{failed}</div>
          </div>
        </div>
      </div>

      <button className="btn btn-danger" onClick={logout}>
        Sign out
      </button>
    </div>
  );
}

export default Profile;
