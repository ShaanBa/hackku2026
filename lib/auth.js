// Minimal session auth for the hackathon. We roll a tiny HMAC-signed cookie
// instead of pulling in NextAuth — we only need one credentials flow and
// NextAuth adds a lot of surface area for that.
//
// The cookie is an opaque string: base64url(payloadJson).base64url(hmac).
// The payload carries { userId, username, iat, exp } and we sign it with
// SESSION_SECRET so the client can't forge or tamper with it.

import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";

export const SESSION_COOKIE_NAME = "hk_session";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const BCRYPT_ROUNDS = 10;

// ---------- password helpers ----------

export async function hashPassword(plain) {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain, hashed) {
  if (typeof plain !== "string" || typeof hashed !== "string") return false;
  return bcrypt.compare(plain, hashed);
}

// ---------- username / password validation ----------

const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;

export function validateUsername(username) {
  if (typeof username !== "string") return "username must be a string";
  if (!USERNAME_RE.test(username)) {
    return "username must be 3-32 chars, letters/numbers/underscores only";
  }
  return null;
}

export function validateDisplayName(displayName) {
  if (typeof displayName !== "string") return "displayName must be a string";
  const trimmed = displayName.trim();
  if (trimmed.length < 1 || trimmed.length > 50) {
    return "displayName must be 1-50 chars";
  }
  return null;
}

export function validatePassword(password) {
  if (typeof password !== "string") return "password must be a string";
  if (password.length < 8) return "password must be at least 8 chars";
  if (password.length > 200) return "password is too long";
  return null;
}

export function normalizeUsername(username) {
  return username.trim().toLowerCase();
}

// ---------- session token (signed cookie) ----------

function base64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlDecodeToBuffer(str) {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  return Buffer.from(str.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("SESSION_SECRET is missing or too short (>= 16 chars)");
  }
  return secret;
}

export function signSession(payload) {
  const now = Math.floor(Date.now() / 1000);
  const full = {
    userId: payload.userId,
    username: payload.username,
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
  };
  const body = base64url(JSON.stringify(full));
  const sig = crypto.createHmac("sha256", getSecret()).update(body).digest();
  return `${body}.${base64url(sig)}`;
}

export function verifySession(token) {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;

  let expectedSig;
  try {
    expectedSig = crypto
      .createHmac("sha256", getSecret())
      .update(body)
      .digest();
  } catch {
    return null;
  }
  const providedSig = base64urlDecodeToBuffer(sig);
  if (
    expectedSig.length !== providedSig.length ||
    !crypto.timingSafeEqual(expectedSig, providedSig)
  ) {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(base64urlDecodeToBuffer(body).toString("utf8"));
  } catch {
    return null;
  }
  if (
    !payload ||
    typeof payload.userId !== "string" ||
    typeof payload.exp !== "number" ||
    payload.exp < Math.floor(Date.now() / 1000)
  ) {
    return null;
  }
  return payload;
}

// ---------- request helpers ----------

// Works with Next.js route handler Request objects (no cookies() import
// required; we read the Cookie header directly so this is framework-agnostic).
export function readSessionFromRequest(request) {
  const header = request.headers.get("cookie") || "";
  const match = header
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${SESSION_COOKIE_NAME}=`));
  if (!match) return null;
  const token = decodeURIComponent(match.slice(SESSION_COOKIE_NAME.length + 1));
  return verifySession(token);
}

// Returns the live user document (minus passwordHash) or null if the session
// is invalid, expired, or the user has been deleted.
export async function getSessionUser(request) {
  const session = readSessionFromRequest(request);
  if (!session) return null;
  if (!ObjectId.isValid(session.userId)) return null;
  const db = await getDb();
  const users = db.collection("users");
  const user = await users.findOne(
    { _id: new ObjectId(session.userId) },
    { projection: { passwordHash: 0 } }
  );
  if (!user) return null;
  return user;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
    // `secure` would normally be true in prod; Next dev is http://localhost
    // so we leave it off to keep the cookie usable.
    secure: process.env.NODE_ENV === "production",
  };
}

export function serializeUserPublic(user) {
  if (!user) return null;
  return {
    id: user._id?.toString?.() ?? null,
    username: user.username ?? null,
    displayName: user.displayName ?? null,
    email: user.email ?? null,
    walletAddress: user.walletAddress ?? null,
    createdAt: user.createdAt ? new Date(user.createdAt).toISOString() : null,
  };
}
