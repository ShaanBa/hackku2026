// Thin wrapper around fetch(). Session cookie is httpOnly + same-origin
// (thanks to the Vite proxy), so we just rely on `credentials: "include"`.
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

  const res = await fetch(path, opts);
  const ct = res.headers.get("content-type") || "";
  const data = ct.includes("application/json") ? await res.json() : await res.text();

  if (!res.ok) {
    const msg =
      (data && typeof data === "object" && (data.error || data.message)) ||
      (typeof data === "string" && data) ||
      `Request failed: ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
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
