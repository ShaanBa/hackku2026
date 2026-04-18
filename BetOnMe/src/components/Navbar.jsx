import { Link } from "react-router-dom";

function Navbar() {
  return (
    <nav style={{ padding: "10px", background: "#1e293b", color: "white" }}>
      <Link to="/" style={{ marginRight: "10px" }}>Home</Link>
      <Link to="/bets" style={{ marginRight: "10px" }}>Bets</Link>
      <Link to="/profile">Profile</Link>
      <Link to="/sign-in">Sign-In</Link>
    </nav>
  );
}

export default Navbar;