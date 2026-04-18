import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { resolveGoal } from "@/lib/resolve";
import { requireAdmin } from "@/lib/admin-auth";

// Sweep for goals whose judgment window has passed with no verified proof
// and move them to "failed". This is how stakes actually make it to charity
// when the user never bothers to submit a selfie.
//
// "Judgment passed" for a single goal is interpreted as:
//   target.targetAt + target.windowMinutes < now
// We use the goal's own window because it's what the user agreed to, not
// the 24h CancelAfter deadline (which is a separate on-chain concept).
//
// Protected with x-admin-secret. Fine to call from a cron, a button, or
// curl during a demo.

const DEFAULT_WINDOW_MINUTES = 30;

export async function POST(request) {
  const unauthorized = requireAdmin(request);
  if (unauthorized) return unauthorized;

  try {
    const db = await getDb();
    const goals = db.collection("goals");
    const now = Date.now();

    // Pull a bounded set. In practice the active set should be tiny.
    const candidates = await goals
      .find({ status: "active" })
      .limit(200)
      .toArray();

    const failed = [];
    const skipped = [];
    const errors = [];

    for (const goal of candidates) {
      const targetAt = goal?.target?.targetAt
        ? new Date(goal.target.targetAt).getTime()
        : null;
      const windowMinutes =
        typeof goal?.target?.windowMinutes === "number" && goal.target.windowMinutes > 0
          ? goal.target.windowMinutes
          : DEFAULT_WINDOW_MINUTES;

      if (targetAt === null) {
        skipped.push({ id: goal._id.toString(), reason: "no_target_at" });
        continue;
      }

      const windowEnd = targetAt + windowMinutes * 60 * 1000;
      if (now < windowEnd) {
        skipped.push({ id: goal._id.toString(), reason: "window_not_passed" });
        continue;
      }

      try {
        const { goal: updated } = await resolveGoal(
          goal._id.toString(),
          "failed",
          "cron"
        );
        failed.push({
          id: goal._id.toString(),
          finishTxHash: updated?.escrow?.finishTxHash ?? null,
        });
      } catch (err) {
        errors.push({
          id: goal._id.toString(),
          error: String(err?.message || err),
        });
      }
    }

    return NextResponse.json({
      scanned: candidates.length,
      failedCount: failed.length,
      skippedCount: skipped.length,
      errorCount: errors.length,
      failed,
      skipped,
      errors,
    });
  } catch (err) {
    console.error("[POST /api/goals/expire]", err);
    return NextResponse.json(
      { error: "Expire sweep failed", detail: String(err?.message || err) },
      { status: 500 }
    );
  }
}

export const runtime = "nodejs";
