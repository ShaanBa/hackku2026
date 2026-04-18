import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getSessionUser } from "@/lib/auth";
import { expireUserGoalsIfDue } from "@/lib/expire";

// Convenience endpoint so the frontend never has to echo userId back.
// Equivalent to GET /api/goals/user/<sessionUser.id>.

function toIsoOrNull(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function serializeGoal(g) {
  return {
    id: g._id.toString(),
    userId: g.userId?.toString?.() ?? null,
    title: g.title,
    stakeAmount: g.stakeAmount,
    deadline: toIsoOrNull(g.deadline),
    status: g.status,
    escrowState: g.escrowState ?? null,
    createdAt: toIsoOrNull(g.createdAt),
    type: g.type ?? null,
    location: g.location ?? null,
    target: g.target
      ? {
          targetAt: toIsoOrNull(g.target.targetAt),
          windowMinutes: g.target.windowMinutes ?? null,
          startAt: toIsoOrNull(g.target.startAt),
          endAt: toIsoOrNull(g.target.endAt),
          requiredCount: g.target.requiredCount ?? null,
          minSpacingHours: g.target.minSpacingHours ?? null,
        }
      : null,
    charity: g.charity ?? null,
    ownerAddress: g.ownerAddress ?? null,
    escrow: g.escrow ?? null,
    resolvedAt: toIsoOrNull(g.resolvedAt),
    resolvedBy: g.resolvedBy ?? null,
  };
}

export async function GET(request) {
  const sessionUser = await getSessionUser(request);
  if (!sessionUser) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const db = await getDb();

    // Lazy-expire past-due active goals before reading. Caps at 5 per call
    // so XRPL latency is bounded; per-goal errors are logged and skipped.
    await expireUserGoalsIfDue(db, sessionUser._id, { limit: 5 });

    const list = await db
      .collection("goals")
      .find({ userId: sessionUser._id })
      .sort({ createdAt: -1 })
      .toArray();

    return NextResponse.json({ goals: list.map(serializeGoal) });
  } catch (err) {
    console.error("[GET /api/goals/mine]", err);
    return NextResponse.json(
      { error: "Failed to fetch goals" },
      { status: 500 }
    );
  }
}

export const runtime = "nodejs";
