import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getSessionUser } from "@/lib/auth";
import { expireUserGoalsIfDue } from "@/lib/expire";

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

export async function GET(request, context) {
  const { userId } = await context.params;

  if (!ObjectId.isValid(userId)) {
    return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
  }

  const sessionUser = await getSessionUser(request);
  if (!sessionUser) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  // Users may only read their own goals. Admin override can come later via
  // the same x-admin-secret header used elsewhere.
  if (sessionUser._id.toString() !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const db = await getDb();
    const goals = db.collection("goals");

    // Lazy-expire past-due active goals before reading. Same budget as
    // /api/goals/mine so behavior is consistent.
    await expireUserGoalsIfDue(db, new ObjectId(userId), { limit: 5 });

    const cursor = goals
      .find({ userId: new ObjectId(userId) })
      .sort({ createdAt: -1 });

    const list = await cursor.toArray();

    return NextResponse.json({ goals: list.map(serializeGoal) });
  } catch (err) {
    console.error("[GET /api/goals/user/[userId]]", err);
    return NextResponse.json(
      { error: "Failed to fetch goals" },
      { status: 500 }
    );
  }
}

export const runtime = "nodejs";
