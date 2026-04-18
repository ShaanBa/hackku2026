// Very small shared guard for admin-only backend endpoints. Nothing fancy —
// a shared secret header is enough for a hackathon demo and keeps the
// manual resolve / expire sweeps from being open to the public internet.
//
// Usage from a route:
//   const unauthorized = requireAdmin(request);
//   if (unauthorized) return unauthorized;

import { NextResponse } from "next/server";

export function requireAdmin(request) {
  const expected = process.env.ADMIN_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "Server missing ADMIN_SECRET env; admin endpoints disabled" },
      { status: 503 }
    );
  }
  const provided = request.headers.get("x-admin-secret");
  if (provided !== expected) {
    return NextResponse.json(
      { error: "Unauthorized: missing or invalid x-admin-secret header" },
      { status: 401 }
    );
  }
  return null;
}
