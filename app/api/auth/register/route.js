import { NextResponse } from "next/server";
import { Wallet } from "xrpl";
import { getDb } from "@/lib/mongodb";
import {
  hashPassword,
  normalizeUsername,
  SESSION_COOKIE_NAME,
  serializeUserPublic,
  sessionCookieOptions,
  signSession,
  validateDisplayName,
  validatePassword,
  validateUsername,
} from "@/lib/auth";

function isOptionalEmail(email) {
  if (email == null || email === "") return true;
  if (typeof email !== "string") return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Run once per process. Drops any pre-auth `email_1`/`username_1` indexes
// left over from an earlier schema and rebuilds named, partial-filtered
// unique indexes. Idempotent — subsequent calls are no-ops.
let indexesReady = false;
async function ensureUsersIndexes(users) {
  if (indexesReady) return;
  for (const stale of ["email_1", "username_1"]) {
    try {
      await users.dropIndex(stale);
    } catch (err) {
      if (!/index not found|ns does not exist/i.test(String(err?.message))) {
        // Not fatal — just means someone beat us to it or Atlas rebuilt it.
      }
    }
  }
  try {
    await users.createIndex(
      { username: 1 },
      {
        name: "username_unique",
        unique: true,
        partialFilterExpression: { username: { $type: "string" } },
      }
    );
    await users.createIndex(
      { email: 1 },
      {
        name: "email_unique_partial",
        unique: true,
        partialFilterExpression: { email: { $type: "string" } },
      }
    );
    indexesReady = true;
  } catch (err) {
    console.error("[auth/register] ensureUsersIndexes failed", err);
    throw err;
  }
}

let cachedSharedWalletAddress = null;
function getSharedWalletAddress() {
  if (cachedSharedWalletAddress) return cachedSharedWalletAddress;
  const seed = process.env.USER_WALLET_SEED;
  if (!seed) throw new Error("USER_WALLET_SEED is not set");
  cachedSharedWalletAddress = Wallet.fromSeed(seed).address;
  return cachedSharedWalletAddress;
}

export async function POST(request) {
  try {
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { username, displayName, password, email } = body || {};

    const usernameErr = validateUsername(username);
    if (usernameErr) {
      return NextResponse.json({ error: usernameErr }, { status: 400 });
    }
    const displayNameErr = validateDisplayName(displayName);
    if (displayNameErr) {
      return NextResponse.json({ error: displayNameErr }, { status: 400 });
    }
    const passwordErr = validatePassword(password);
    if (passwordErr) {
      return NextResponse.json({ error: passwordErr }, { status: 400 });
    }
    if (!isOptionalEmail(email)) {
      return NextResponse.json(
        { error: "email, if provided, must be a valid email address" },
        { status: 400 }
      );
    }

    let walletAddress;
    try {
      walletAddress = getSharedWalletAddress();
    } catch {
      return NextResponse.json(
        { error: "Server XRPL config missing (USER_WALLET_SEED)" },
        { status: 500 }
      );
    }

    const db = await getDb();
    const users = db.collection("users");
    await ensureUsersIndexes(users);

    const normalizedUsername = normalizeUsername(username);
    const normalizedEmail =
      typeof email === "string" && email.trim().length > 0
        ? email.trim().toLowerCase()
        : null;

    const passwordHash = await hashPassword(password);
    const createdAt = new Date();
    const doc = {
      username: normalizedUsername,
      displayName: displayName.trim(),
      passwordHash,
      email: normalizedEmail,
      walletAddress,
      createdAt,
    };

    let insertedId;
    try {
      const result = await users.insertOne(doc);
      insertedId = result.insertedId;
    } catch (err) {
      if (err?.code === 11000) {
        const field = Object.keys(err?.keyPattern || { username: 1 })[0];
        return NextResponse.json(
          { error: `That ${field} is already taken` },
          { status: 409 }
        );
      }
      throw err;
    }

    const token = signSession({
      userId: insertedId.toString(),
      username: normalizedUsername,
    });

    const res = NextResponse.json(
      {
        user: serializeUserPublic({ ...doc, _id: insertedId }),
      },
      { status: 201 }
    );
    res.cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions());
    return res;
  } catch (err) {
    console.error("[POST /api/auth/register]", err);
    return NextResponse.json(
      { error: "Failed to register", detail: String(err?.message || err) },
      { status: 500 }
    );
  }
}

export const runtime = "nodejs";
