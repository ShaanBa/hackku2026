// Thin wrapper around fetch(). Session cookie is httpOnly + same-origin
// (thanks to the Vite proxy in dev / single-origin Vercel deploy in prod),
// so we just rely on `credentials: "include"`.
//
// Every thrown error has:
//   err.message  — human-readable, ready to show in a banner
//   err.status   — HTTP status (0 if the request never reached the server)
//   err.kind     — "network" | "client" | "server" | "auth"
//   err.detail   — full server response body (object or string), for debug
//   err.code     — server's machine-readable code if provided

function describeStatus(status) {
  if (status === 0) return "the server didn't respond";
  if (status === 401) return "you're not signed in";
  if (status === 403) return "you don't have permission";
  if (status === 404) return "endpoint not found";
  if (status === 409) return "a conflict with existing data";
  if (status === 413) return "the upload is too big";
  if (status === 415) return "unsupported file type";
  if (status === 429) return "you're sending requests too fast";
  if (status >= 500) return "the server hit an error";
  if (status >= 400) return "the request was rejected";
  return `status ${status}`;
}

function classifyKind(status) {
  if (status === 0) return "network";
  if (status === 401) return "auth";
  if (status >= 400 && status < 500) return "client";
  if (status >= 500) return "server";
  return "client";
}

async function request(path, { method = "GET", body, headers } = {}) {
  const opts = {
    method,
    credentials: "include",
    headers: { ...(headers || {}) },
  };
  if (body instanceof FormData) {
    opts.body = body;
  } else if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(path, opts);
  } catch (netErr) {
    // Browser couldn't even reach the server: offline, DNS, CORS preflight
    // failure, blocked by an extension, etc. Make this loud so users stop
    // seeing the cryptic "Failed to fetch".
    const err = new Error(
      "Couldn't reach the server. Check your internet connection and try again."
    );
    err.status = 0;
    err.kind = "network";
    err.detail = String(netErr?.message || netErr);
    throw err;
  }

  const ct = res.headers.get("content-type") || "";
  let data;
  try {
    data = ct.includes("application/json")
      ? await res.json()
      : await res.text();
  } catch (parseErr) {
    data = `(failed to parse response: ${parseErr?.message || parseErr})`;
  }

  if (!res.ok) {
    const serverError =
      (data && typeof data === "object" && (data.error || data.message)) ||
      (typeof data === "string" && data.length > 0 && data) ||
      null;

    const detailHint =
      data && typeof data === "object" && data.detail
        ? ` (${String(data.detail).slice(0, 200)})`
        : "";

    const message = serverError
      ? `${serverError}${detailHint}`
      : `Request failed — ${describeStatus(res.status)} (HTTP ${res.status}).`;

    const err = new Error(message);
    err.status = res.status;
    err.kind = classifyKind(res.status);
    err.detail = data;
    err.code =
      data && typeof data === "object" && typeof data.code === "string"
        ? data.code
        : null;
    throw err;
  }
  return data;
}

export const api = {
  // --- auth ---
  register: (payload) => request("/api/auth/register", { method: "POST", body: payload }),
  login: (payload) => request("/api/auth/login", { method: "POST", body: payload }),
  logout: () => request("/api/auth/logout", { method: "POST" }),
  me: () => request("/api/auth/me"),

  // --- goals ---
  createGoal: (payload) => request("/api/goals/create", { method: "POST", body: payload }),
  myGoals: () => request("/api/goals/mine"),
  resolveGoal: (payload, adminSecret) =>
    request("/api/goals/resolve", {
      method: "POST",
      body: payload,
      headers: adminSecret ? { "x-admin-secret": adminSecret } : {},
    }),
  refundGoal: (payload) =>
    request("/api/goals/refund", { method: "POST", body: payload }),

  // --- proofs ---
  uploadProof: (formData) =>
    request("/api/proofs/upload", { method: "POST", body: formData }),

  // --- charities ---
  charities: () => request("/api/charities"),

  // --- wallet ---
  wallet: () => request("/api/wallet"),
};

export default api;
