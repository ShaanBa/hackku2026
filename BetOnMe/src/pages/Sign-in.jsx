import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../lib/authContextCore";
import "./Sign-in.css";

// Translates raw API errors into friendly auth-form copy. Returns
// { message, switchTo } so we can also offer "switch to sign-in" /
// "switch to register" CTAs when appropriate.
function describeAuthError(err, mode) {
  if (!err) return { message: "Something went wrong.", switchTo: null };

  if (err.kind === "network") {
    return {
      message:
        "Couldn't reach the server. Check your internet connection and try again.",
      switchTo: null,
    };
  }

  const raw = String(err.message || "").toLowerCase();

  if (mode === "login" && err.status === 401) {
    return {
      message:
        "Wrong username or password. Make sure you're using the same username you registered with.",
      switchTo: { to: "register", label: "Don't have an account? Register" },
    };
  }

  if (mode === "register" && err.status === 409) {
    return {
      message:
        "That username is already taken. Pick another one — or sign in if it's yours.",
      switchTo: { to: "login", label: "Already have an account? Sign in" },
    };
  }

  if (raw.includes("password must be at least")) {
    return {
      message: "Password must be at least 8 characters.",
      switchTo: null,
    };
  }
  if (raw.includes("username must be 3-32")) {
    return {
      message:
        "Username must be 3–32 characters and only contain letters, numbers, or underscores.",
      switchTo: null,
    };
  }
  if (raw.includes("displayname must be 1-50")) {
    return {
      message: "Display name is required (1–50 characters).",
      switchTo: null,
    };
  }
  if (err.status >= 500) {
    return {
      message: `Server error: ${err.message}. Try again in a few seconds.`,
      switchTo: null,
    };
  }

  return { message: err.message || "Something went wrong.", switchTo: null };
}

function SignIn() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [errorSwitch, setErrorSwitch] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  function clientValidate() {
    if (!username.trim()) return "Username is required.";
    if (mode === "register") {
      if (!/^[a-zA-Z0-9_]{3,32}$/.test(username)) {
        return "Username must be 3–32 characters and only contain letters, numbers, or underscores.";
      }
      if (!displayName.trim()) return "Display name is required.";
      if (displayName.trim().length > 50) {
        return "Display name must be 50 characters or fewer.";
      }
    }
    if (!password) return "Password is required.";
    if (mode === "register" && password.length < 8) {
      return "Password must be at least 8 characters.";
    }
    return null;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setErrorSwitch(null);

    const clientErr = clientValidate();
    if (clientErr) {
      setError(clientErr);
      return;
    }

    setSubmitting(true);
    try {
      if (mode === "login") {
        await login(username, password);
      } else {
        await register({ username, displayName, password });
      }
      const to = location.state?.from || "/";
      navigate(to, { replace: true });
    } catch (err) {
      const { message, switchTo } = describeAuthError(err, mode);
      setError(message);
      setErrorSwitch(switchTo);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card box">
        <div className="brand" style={{ fontSize: 28, marginBottom: 6 }}>
          BetOnMe
        </div>
        <div className="muted" style={{ marginBottom: 20 }}>
          {mode === "login" ? "Welcome back." : "Create your account."}
        </div>

        <div className="auth-tabs">
          <button
            className={`auth-tab ${mode === "login" ? "active" : ""}`}
            onClick={() => setMode("login")}
            type="button"
          >
            Sign in
          </button>
          <button
            className={`auth-tab ${mode === "register" ? "active" : ""}`}
            onClick={() => setMode("register")}
            type="button"
          >
            Register
          </button>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          <div>
            <label className="label">Username</label>
            <input
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              placeholder="shaan"
            />
          </div>

          {mode === "register" && (
            <div>
              <label className="label">Display name</label>
              <input
                className="input"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Shaan B."
              />
            </div>
          )}

          <div>
            <label className="label">Password</label>
            <input
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className="auth-error">
              <div>{error}</div>
              {errorSwitch && (
                <button
                  type="button"
                  className="auth-error-switch"
                  onClick={() => {
                    setMode(errorSwitch.to);
                    setError(null);
                    setErrorSwitch(null);
                  }}
                >
                  {errorSwitch.label} →
                </button>
              )}
            </div>
          )}

          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? "Working…" : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default SignIn;
