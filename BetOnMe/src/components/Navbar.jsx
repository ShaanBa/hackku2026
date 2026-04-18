import { Link, NavLink } from "react-router-dom";
import { useAuth } from "../lib/authContextCore";
import "./Navbar.css";

function Navbar({ onOpenSidebar }) {
  const { user, logout } = useAuth();

  return (
    <nav className="nav">
      <Link to="/" className="brand">
        BetOnMe
      </Link>

      <div className="nav-links">
        <NavLink to="/" end className={({ isActive }) => (isActive ? "active" : "")}>
          Home
        </NavLink>
        <NavLink to="/bets" className={({ isActive }) => (isActive ? "active" : "")}>
          Bets
        </NavLink>
      </div>

      <div className="nav-right">
        {user ? (
          <>
            <button
              className="btn btn-ghost profile-btn"
              onClick={onOpenSidebar}
              title="Open profile & wallet"
            >
              <span className="avatar">{user.displayName?.[0]?.toUpperCase() || "U"}</span>
              <span className="profile-name">{user.displayName}</span>
            </button>
            <button className="btn btn-ghost" onClick={logout}>
              Sign out
            </button>
          </>
        ) : (
          <Link to="/sign-in" className="btn btn-primary">
            Sign in
          </Link>
        )}
      </div>
    </nav>
  );
}

export default Navbar;
