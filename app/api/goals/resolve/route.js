import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { resolveGoal } from "@/lib/resolve";
import { requireAdmin } from "@/lib/admin-auth";

// Manual escape hatch for demos / admin. The auto-resolve path lives in
// the proof upload handler (success case) and in the expire sweep
// (fail case). All paths go through lib/resolve.js#resolveGoal.
//
// Protected: callers must send `x-admin-secret: <ADMIN_SECRET>`.

const ALLOWED = new Set(["succeeded", "failed"]);

export async function POST(request) {
  const unauthorized = requireAdmin(request);
  if (unauthorized) return unauthorized;

  try {
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    const goalId = body?.goalId;
    const outcome = body?.outcome ?? body?.status;

    if (!goalId || !ObjectId.isValid(goalId)) {
      return NextResponse.json(
        { error: 'Field "goalId" must be a valid MongoDB ObjectId string' },
        { status: 400 }
      );
    }

    // Back-compat: accept "success" from older callers but map to "succeeded".
    const normalized =
      outcome === "success" ? "succeeded" : outcome === "fail" ? "failed" : outcome;

    if (typeof normalized !== "string" || !ALLOWED.has(normalized)) {
      return NextResponse.json(
        { error: 'Field "outcome" must be "succeeded" or "failed"' },
        { status: 400 }
      );
    }

    try {
      const { goal, alreadyResolved } = await resolveGoal(
        goalId,
        normalized,
        "admin"
      );
      if (!goal) {
        return NextResponse.json(
          { error: "Goal not found" },
          { status: 404 }
        );
      }
      return NextResponse.json({
        id: goal._id.toString(),
        userId: goal.userId?.toString?.() ?? null,
        status: goal.status,
        escrowState: goal.escrowState ?? null,
        resolvedAt: goal.resolvedAt ? new Date(goal.resolvedAt).toISOString() : null,
        resolvedBy: goal.resolvedBy ?? null,
        escrow: goal.escrow ?? null,
        alreadyResolved,
      });
    } catch (resolveErr) {
      if (/goal not found/i.test(String(resolveErr?.message))) {
        return NextResponse.json({ error: "Goal not found" }, { status: 404 });
      }
      throw resolveErr;
    }
  } catch (err) {
    console.error("[POST /api/goals/resolve]", err);
    return NextResponse.json(
      {
        error: "Failed to resolve goal",
        detail: String(err?.message || err),
      },
      { status: 500 }
    );
  }
}

export const runtime = "nodejs";
