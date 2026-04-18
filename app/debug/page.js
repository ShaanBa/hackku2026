"use client";

import { useCallback, useEffect, useState } from "react";

// Minimal test UI for the backend. Not the final product — just a panel
// per feature so the team can verify every route without curl. If the
// real UI wants to reuse anything, lift it into components later.

const TABS = [
  { id: "auth", label: "1. Auth" },
  { id: "create", label: "2. Create goal" },
  { id: "goals", label: "3. My goals" },
  { id: "admin", label: "4. Admin" },
];

function cx(...parts) {
  return parts.filter(Boolean).join(" ");
}

async function api(path, { method = "GET", body, headers } = {}) {
  const init = {
    method,
    credentials: "include",
    headers: { ...(headers || {}) },
  };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers["Content-Type"] = "application/json";
  }
  const res = await fetch(path, init);
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { ok: res.ok, status: res.status, data };
}

function Panel({ title, children }) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

function Field({ label, children, hint }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-zinc-700 dark:text-zinc-300">
        {label}
      </span>
      {children}
      {hint ? (
        <span className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</span>
      ) : null}
    </label>
  );
}

function Input(props) {
  return (
    <input
      {...props}
      className={cx(
        "rounded border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm",
        "focus:border-zinc-900 focus:outline-none",
        "dark:border-zinc-700 dark:bg-zinc-900",
        props.className
      )}
    />
  );
}

function Button({ children, variant = "primary", ...rest }) {
  const base =
    "inline-flex items-center justify-center rounded px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
  const styles = {
    primary:
      "bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-white dark:text-black dark:hover:bg-zinc-300",
    ghost:
      "border border-zinc-300 text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-800",
    danger:
      "bg-red-600 text-white hover:bg-red-500",
  };
  return (
    <button type="button" {...rest} className={cx(base, styles[variant], rest.className)}>
      {children}
    </button>
  );
}

function Result({ value }) {
  if (value == null) return null;
  return (
    <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-zinc-50 p-3 text-xs text-zinc-800 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-200 dark:ring-zinc-800">
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}

// ---------- panels ----------

function AuthPanel({ me, refreshMe }) {
  const [mode, setMode] = useState("register"); // or "login"
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setResult(null);
    const path =
      mode === "register" ? "/api/auth/register" : "/api/auth/login";
    const body =
      mode === "register"
        ? {
            username,
            displayName,
            password,
            email: email.trim() || undefined,
          }
        : { username, password };
    const res = await api(path, { method: "POST", body });
    setResult({ status: res.status, ...res.data });
    if (res.ok) {
      await refreshMe();
    }
    setBusy(false);
  }

  async function logout() {
    setBusy(true);
    const res = await api("/api/auth/logout", { method: "POST" });
    setResult({ status: res.status, ...res.data });
    await refreshMe();
    setBusy(false);
  }

  return (
    <Panel title="Auth">
      {me?.user ? (
        <>
          <div className="rounded border border-green-300 bg-green-50 p-3 text-sm dark:border-green-700 dark:bg-green-950/40">
            Signed in as{" "}
            <strong>{me.user.displayName}</strong>{" "}
            <span className="text-zinc-500">
              (@{me.user.username}) · wallet {me.user.walletAddress?.slice(0, 10)}…
            </span>
          </div>
          <Button onClick={logout} variant="ghost" disabled={busy}>
            Log out
          </Button>
        </>
      ) : (
        <>
          <div className="flex gap-2">
            <Button
              onClick={() => setMode("register")}
              variant={mode === "register" ? "primary" : "ghost"}
            >
              Register
            </Button>
            <Button
              onClick={() => setMode("login")}
              variant={mode === "login" ? "primary" : "ghost"}
            >
              Log in
            </Button>
          </div>

          <Field label="Username">
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="demo_user"
            />
          </Field>
          {mode === "register" && (
            <>
              <Field label="Display name">
                <Input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Demo User"
                />
              </Field>
              <Field label="Email (optional)">
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </Field>
            </>
          )}
          <Field label="Password" hint="Minimum 8 characters.">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Button onClick={submit} disabled={busy}>
            {busy ? "…" : mode === "register" ? "Create account" : "Log in"}
          </Button>
        </>
      )}
      <Result value={result} />
    </Panel>
  );
}

function CreateGoalPanel({ me, charities, onCreated }) {
  const [title, setTitle] = useState("Show up at the gym");
  const [stake, setStake] = useState("1");
  const [charityId, setCharityId] = useState("");
  const [lat, setLat] = useState("38.9543");
  const [lng, setLng] = useState("-95.2558");
  const [radius, setRadius] = useState("100");
  const [locationName, setLocationName] = useState("Gym");
  const [minutesFromNow, setMinutesFromNow] = useState("2");
  const [windowMinutes, setWindowMinutes] = useState("30");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!charityId && charities?.length) setCharityId(charities[0].id);
  }, [charities, charityId]);

  function useMyLocation() {
    if (!navigator.geolocation) {
      setResult({ error: "Browser has no geolocation API" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(String(pos.coords.latitude));
        setLng(String(pos.coords.longitude));
      },
      (err) => setResult({ error: `Geolocation failed: ${err.message}` }),
      { enableHighAccuracy: true, timeout: 10_000 }
    );
  }

  async function submit() {
    setBusy(true);
    setResult(null);
    const targetAt = new Date(
      Date.now() + Math.max(1, Number(minutesFromNow)) * 60 * 1000
    ).toISOString();
    const body = {
      title,
      stakeAmount: Number(stake),
      type: "single",
      charityId,
      location: {
        name: locationName || undefined,
        lat: Number(lat),
        lng: Number(lng),
        radiusMeters: Number(radius),
      },
      target: { targetAt, windowMinutes: Number(windowMinutes) },
    };
    const res = await api("/api/goals/create", { method: "POST", body });
    setResult({ status: res.status, ...res.data });
    if (res.ok) onCreated?.();
    setBusy(false);
  }

  if (!me?.user) {
    return (
      <Panel title="Create goal">
        <p className="text-sm text-zinc-500">Log in to create a goal.</p>
      </Panel>
    );
  }

  return (
    <Panel title="Create goal">
      <Field label="Title">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Stake (XRP)">
          <Input
            type="number"
            min="0.01"
            step="0.01"
            value={stake}
            onChange={(e) => setStake(e.target.value)}
          />
        </Field>
        <Field label="Charity (on fail)">
          <select
            value={charityId}
            onChange={(e) => setCharityId(e.target.value)}
            className="rounded border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            {charities?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Location name">
        <Input
          value={locationName}
          onChange={(e) => setLocationName(e.target.value)}
        />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Latitude">
          <Input value={lat} onChange={(e) => setLat(e.target.value)} />
        </Field>
        <Field label="Longitude">
          <Input value={lng} onChange={(e) => setLng(e.target.value)} />
        </Field>
        <Field label="Radius (m)">
          <Input
            type="number"
            min="10"
            step="10"
            value={radius}
            onChange={(e) => setRadius(e.target.value)}
          />
        </Field>
      </div>
      <Button variant="ghost" onClick={useMyLocation}>
        Use my current location
      </Button>

      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Target in (minutes from now)"
          hint="When you plan to show up."
        >
          <Input
            type="number"
            min="1"
            value={minutesFromNow}
            onChange={(e) => setMinutesFromNow(e.target.value)}
          />
        </Field>
        <Field label="Window (± minutes)">
          <Input
            type="number"
            min="1"
            value={windowMinutes}
            onChange={(e) => setWindowMinutes(e.target.value)}
          />
        </Field>
      </div>

      <Button onClick={submit} disabled={busy || !charityId}>
        {busy ? "Creating…" : "Create goal (signs EscrowCreate on XRPL testnet)"}
      </Button>
      <Result value={result} />
    </Panel>
  );
}

function GoalsPanel({ me, goals, refreshGoals }) {
  const [result, setResult] = useState(null);

  if (!me?.user) {
    return (
      <Panel title="My goals">
        <p className="text-sm text-zinc-500">Log in to see your goals.</p>
      </Panel>
    );
  }

  async function refund(goalId) {
    const res = await api("/api/goals/refund", {
      method: "POST",
      body: { goalId },
    });
    setResult({ status: res.status, ...res.data });
    refreshGoals();
  }

  async function uploadProof(goalId, file) {
    const form = new FormData();
    form.append("goalId", goalId);
    form.append("file", file);
    const res = await api("/api/proofs/upload", { method: "POST", body: form });
    setResult({ status: res.status, ...res.data });
    refreshGoals();
  }

  return (
    <Panel title="My goals">
      <div className="flex items-center justify-between">
        <span className="text-sm text-zinc-500">
          {goals?.length ?? 0} goal{(goals?.length ?? 0) === 1 ? "" : "s"}
        </span>
        <Button variant="ghost" onClick={refreshGoals}>
          Refresh
        </Button>
      </div>

      {(goals ?? []).map((g) => (
        <div
          key={g.id}
          className="rounded border border-zinc-200 p-3 text-sm dark:border-zinc-800"
        >
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="font-semibold">{g.title}</div>
              <div className="text-xs text-zinc-500">
                {g.stakeAmount} XRP · target{" "}
                {g.target?.targetAt
                  ? new Date(g.target.targetAt).toLocaleString()
                  : "?"}{" "}
                · charity {g.charity?.name ?? "—"}
              </div>
              <div className="text-xs">
                status:{" "}
                <span
                  className={cx(
                    "font-mono",
                    g.status === "active" && "text-amber-600",
                    g.status === "succeeded" && "text-green-600",
                    g.status === "failed" && "text-red-600"
                  )}
                >
                  {g.status}
                </span>
                {" · "}escrow: <span className="font-mono">{g.escrowState}</span>
              </div>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="text-xs">
              <span className="mr-2 rounded bg-zinc-200 px-2 py-1 font-medium dark:bg-zinc-800">
                Upload selfie
              </span>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadProof(g.id, f);
                }}
              />
            </label>
            <Button variant="ghost" onClick={() => refund(g.id)}>
              Claim refund (after deadline)
            </Button>
          </div>
        </div>
      ))}

      {goals?.length === 0 && (
        <p className="text-sm text-zinc-500">
          No goals yet. Create one in tab 2.
        </p>
      )}

      <Result value={result} />
    </Panel>
  );
}

function AdminPanel({ refreshGoals }) {
  const [secret, setSecret] = useState("");
  const [goalId, setGoalId] = useState("");
  const [outcome, setOutcome] = useState("failed");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  async function resolve() {
    setBusy(true);
    const res = await api("/api/goals/resolve", {
      method: "POST",
      headers: { "x-admin-secret": secret },
      body: { goalId, outcome },
    });
    setResult({ status: res.status, ...res.data });
    refreshGoals();
    setBusy(false);
  }

  async function expire() {
    setBusy(true);
    const res = await api("/api/goals/expire", {
      method: "POST",
      headers: { "x-admin-secret": secret },
    });
    setResult({ status: res.status, ...res.data });
    refreshGoals();
    setBusy(false);
  }

  return (
    <Panel title="Admin (demo escape hatch)">
      <p className="text-xs text-zinc-500">
        These endpoints require the <code>x-admin-secret</code> header. Default
        in <code>.env.local</code> is <code>dev-secret-change-me</code>.
      </p>
      <Field label="Admin secret">
        <Input value={secret} onChange={(e) => setSecret(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Goal id (for manual resolve)">
          <Input value={goalId} onChange={(e) => setGoalId(e.target.value)} />
        </Field>
        <Field label="Outcome">
          <select
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            className="rounded border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="failed">failed (EscrowFinish → charity)</option>
            <option value="succeeded">succeeded (no on-chain tx)</option>
          </select>
        </Field>
      </div>
      <div className="flex gap-2">
        <Button onClick={resolve} disabled={busy || !goalId || !secret}>
          Resolve goal
        </Button>
        <Button variant="ghost" onClick={expire} disabled={busy || !secret}>
          Run expire sweep
        </Button>
      </div>
      <Result value={result} />
    </Panel>
  );
}

// ---------- page shell ----------

export default function Home() {
  const [tab, setTab] = useState("auth");
  const [me, setMe] = useState(null);
  const [charities, setCharities] = useState([]);
  const [goals, setGoals] = useState([]);

  const refreshMe = useCallback(async () => {
    const res = await api("/api/auth/me");
    setMe(res.data ?? { user: null });
  }, []);

  const refreshGoals = useCallback(async () => {
    const res = await api("/api/goals/mine");
    if (res.ok) setGoals(res.data?.goals ?? []);
    else setGoals([]);
  }, []);

  useEffect(() => {
    refreshMe();
    api("/api/charities").then((res) => {
      setCharities(res.data?.charities ?? []);
    });
  }, [refreshMe]);

  useEffect(() => {
    if (me?.user) refreshGoals();
    else setGoals([]);
  }, [me, refreshGoals]);

  return (
    <div className="min-h-dvh bg-zinc-50 text-zinc-900 dark:bg-black dark:text-zinc-100">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-6 pt-8 pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            hackku2026 · backend test harness
          </h1>
          <p className="text-sm text-zinc-500">
            Every backend route, clickable. Not the final UI.
          </p>
        </div>
        <div className="text-right text-xs text-zinc-500">
          {me?.user ? (
            <>
              <div>signed in</div>
              <div className="font-mono">@{me.user.username}</div>
            </>
          ) : (
            <div>not signed in</div>
          )}
        </div>
      </header>

      <nav className="sticky top-0 z-10 mx-auto flex max-w-3xl gap-2 bg-zinc-50/90 px-6 py-3 backdrop-blur dark:bg-black/80">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cx(
              "rounded px-3 py-1.5 text-sm font-medium",
              tab === t.id
                ? "bg-zinc-900 text-white dark:bg-white dark:text-black"
                : "text-zinc-600 hover:bg-zinc-200 dark:text-zinc-300 dark:hover:bg-zinc-800"
            )}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-6">
        {tab === "auth" && <AuthPanel me={me} refreshMe={refreshMe} />}
        {tab === "create" && (
          <CreateGoalPanel
            me={me}
            charities={charities}
            onCreated={refreshGoals}
          />
        )}
        {tab === "goals" && (
          <GoalsPanel me={me} goals={goals} refreshGoals={refreshGoals} />
        )}
        {tab === "admin" && <AdminPanel refreshGoals={refreshGoals} />}
      </main>

      <footer className="mx-auto max-w-3xl px-6 pb-10 text-xs text-zinc-500">
        See <code>BACKEND_INTEGRATION_SUMMARY.md</code> and{" "}
        <code>SCHEMA.md</code> for the full contract.
      </footer>
    </div>
  );
}
