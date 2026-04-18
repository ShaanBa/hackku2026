import { NextResponse } from "next/server";
import { getSessionUser, serializeUserPublic } from "@/lib/auth";

export async function GET(request) {
  const user = await getSessionUser(request);
  if (!user) {
    return NextResponse.json({ user: null }, { status: 200 });
  }
  return NextResponse.json({ user: serializeUserPublic(user) });
}

export const runtime = "nodejs";
