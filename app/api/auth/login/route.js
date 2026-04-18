import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import {
  SESSION_COOKIE_NAME,
  normalizeUsername,
  serializeUserPublic,
  sessionCookieOptions,
  signSession,
  verifyPassword,
} from "@/lib/auth";

export async function POST(request) {
  try {
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const username = body?.username;
    const password = body?.password;
    if (typeof username !== "string" || typeof password !== "string") {
      return NextResponse.json(
        { error: "username and password are required" },
        { status: 400 }
      );
    }

    const db = await getDb();
    const users = db.collection("users");
    const user = await users.findOne({ username: normalizeUsername(username) });

    // Same response for "no such user" and "wrong password" to avoid
    // exposing which usernames exist.
    if (!user || !(await verifyPassword(password, user.passwordHash || ""))) {
      return NextResponse.json(
        { error: "Invalid username or password" },
        { status: 401 }
      );
    }

    const token = signSession({
      userId: user._id.toString(),
      username: user.username,
    });

    const res = NextResponse.json({ user: serializeUserPublic(user) });
    res.cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions());
    return res;
  } catch (err) {
    console.error("[POST /api/auth/login]", err);
    return NextResponse.json(
      { error: "Failed to log in", detail: String(err?.message || err) },
      { status: 500 }
    );
  }
}

export const runtime = "nodejs";
