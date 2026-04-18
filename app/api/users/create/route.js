import { NextResponse } from "next/server";

// DEPRECATED: this route predates the username/password auth work.
// New clients should POST /api/auth/register instead, which creates the user
// AND sets a session cookie in one call.
//
// We leave this stub in place so a frontend still pointing at the old URL
// during the migration gets an actionable error instead of silently 404-ing.

export async function POST() {
  return NextResponse.json(
    {
      error:
        "POST /api/users/create is deprecated. Use POST /api/auth/register " +
        "with { username, displayName, password, email? } instead.",
    },
    { status: 410 }
  );
}

export const runtime = "nodejs";
