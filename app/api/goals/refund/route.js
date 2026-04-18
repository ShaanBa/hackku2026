import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { cancelEscrow } from "@/lib/xrpl";
import { getSessionUser } from "@/lib/auth";

// User-triggered EscrowCancel. Valid only for succeeded goals whose
// CancelAfter (= goal.deadline) has already passed. This is how the user
// reclaims their stake after hitting their show-up target.
//
// Note: XRPL only lets the OWNER (user) cancel once CancelAfter fires, and
// the funds go back to the owner automatically. We use USER_WALLET_SEED
// since every hackathon user shares it.

export async function POST(request) {
  try {
    const sessionUser = await getSessionUser(request);
    if (!sessionUser) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      );
    }

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
    if (!goalId || !ObjectId.isValid(goalId)) {
      return NextResponse.json(
        { error: 'Field "goalId" must be a valid MongoDB ObjectId string' },
        { status: 400 }
      );
    }

    const db = await getDb();
    const goals = db.collection("goals");
    const _id = new ObjectId(goalId);
    const goal = await goals.findOne({ _id });
    if (!goal) {
      return NextResponse.json({ error: "Goal not found" }, { status: 404 });
    }
    if (!goal.userId.equals(sessionUser._id)) {
      return NextResponse.json(
        { error: "Goal does not belong to the signed-in user" },
        { status: 403 }
      );
    }

    if (goal.status !== "succeeded") {
      return NextResponse.json(
        {
          error:
            "Refund only available for succeeded goals. Current status: " +
            goal.status,
        },
        { status: 400 }
      );
    }

    if (goal.escrowState === "cancelled" || goal.escrowState === "finished") {
      return NextResponse.json(
        {
          error:
            "Escrow already settled. Current escrowState: " + goal.escrowState,
          escrow: goal.escrow ?? null,
        },
        { status: 400 }
      );
    }

    const deadline =
      goal.deadline instanceof Date ? goal.deadline : new Date(goal.deadline);
    if (Number.isNaN(deadline.getTime())) {
      return NextResponse.json(
        { error: "Goal has invalid deadline" },
        { status: 500 }
      );
    }
    if (Date.now() < deadline.getTime()) {
      return NextResponse.json(
        {
          error:
            "Too early: EscrowCancel only works after the goal deadline. Try again at " +
            deadline.toISOString(),
          cancellableAt: deadline.toISOString(),
        },
        { status: 400 }
      );
    }

    const userSeed = process.env.USER_WALLET_SEED;
    if (!userSeed) {
      return NextResponse.json(
        { error: "Server missing XRPL config (USER_WALLET_SEED)" },
        { status: 500 }
      );
    }
    if (!goal.ownerAddress) {
      return NextResponse.json(
        { error: "Goal is missing ownerAddress; cannot cancel escrow" },
        { status: 500 }
      );
    }
    if (!goal.escrow?.sequence) {
      return NextResponse.json(
        { error: "Goal is missing escrow.sequence; cannot cancel escrow" },
        { status: 500 }
      );
    }

    const { txHash } = await cancelEscrow({
      userSeed,
      userAddress: goal.ownerAddress,
      escrowSequence: goal.escrow.sequence,
    });

    const updated = await goals.findOneAndUpdate(
      { _id, status: "succeeded" },
      {
        $set: {
          escrowState: "cancelled",
          "escrow.cancelTxHash": txHash,
        },
      },
      { returnDocument: "after" }
    );

    return NextResponse.json({
      id: goalId,
      status: updated?.status ?? goal.status,
      escrowState: updated?.escrowState ?? "cancelled",
      escrow: updated?.escrow ?? goal.escrow,
      cancelTxHash: txHash,
    });
  } catch (err) {
    console.error("[POST /api/goals/refund]", err);
    return NextResponse.json(
      { error: "Failed to refund goal", detail: String(err?.message || err) },
      { status: 500 }
    );
  }
}

export const runtime = "nodejs";
