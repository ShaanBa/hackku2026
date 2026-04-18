// Centralized resolver for goal state transitions. Both the automatic path
// (proof upload verified) and the manual escape hatch (POST /api/goals/resolve)
// call this. That way on-chain side effects only live in one place.

import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { finishEscrow } from "@/lib/xrpl";

/**
 * Move a goal from "active" to "succeeded" or "failed".
 *
 * On `failed`: the pot wallet submits EscrowFinish, which routes the stake
 * directly to the charity Destination (Option B). We record the finishTxHash
 * and flip escrowState to "finished".
 *
 * On `succeeded`: nothing happens on-chain here. The user reclaims their
 * stake later via POST /api/goals/refund, which does EscrowCancel after
 * the deadline passes.
 *
 * This function is idempotent-ish: if the goal is no longer "active",
 * it returns the current doc untouched without throwing, so a retrying
 * caller (or a race between manual + auto resolve) doesn't double-submit.
 */
export async function resolveGoal(goalId, outcome, triggeredBy) {
  if (!ObjectId.isValid(goalId)) {
    throw new Error(`invalid goalId: ${goalId}`);
  }
  if (outcome !== "succeeded" && outcome !== "failed") {
    throw new Error(`invalid outcome: ${outcome}`);
  }

  const db = await getDb();
  const goals = db.collection("goals");
  const _id = new ObjectId(goalId);

  const goal = await goals.findOne({ _id });
  if (!goal) {
    throw new Error(`goal not found: ${goalId}`);
  }

  // Short-circuit if already resolved. Avoids double EscrowFinish calls when
  // the auto-resolve fires moments before a manual override.
  if (goal.status !== "active") {
    return { goal, alreadyResolved: true };
  }

  const now = new Date();

  if (outcome === "succeeded") {
    const updated = await goals.findOneAndUpdate(
      { _id, status: "active" },
      {
        $set: {
          status: "succeeded",
          resolvedAt: now,
          resolvedBy: triggeredBy || "system",
        },
      },
      { returnDocument: "after" }
    );
    return { goal: updated, alreadyResolved: false };
  }

  // outcome === "failed" — pot signs EscrowFinish. This moves funds from the
  // user's escrow directly to the charity address set at create time.
  const potSeed = process.env.POT_WALLET_SEED;
  if (!potSeed) {
    throw new Error("POT_WALLET_SEED is not set; cannot finish escrow");
  }
  if (!goal.ownerAddress) {
    throw new Error("goal is missing ownerAddress; cannot finish escrow");
  }
  if (!goal.escrow?.sequence) {
    throw new Error("goal is missing escrow.sequence; cannot finish escrow");
  }

  const { txHash } = await finishEscrow({
    potWalletSeed: potSeed,
    userAddress: goal.ownerAddress,
    escrowSequence: goal.escrow.sequence,
  });

  const updated = await goals.findOneAndUpdate(
    { _id, status: "active" },
    {
      $set: {
        status: "failed",
        escrowState: "finished",
        "escrow.finishTxHash": txHash,
        resolvedAt: now,
        resolvedBy: triggeredBy || "system",
      },
    },
    { returnDocument: "after" }
  );

  return { goal: updated, alreadyResolved: false };
}
