// imports the xrpl client and wallet as well as the types from the types folder
import { Client, Wallet, xrpToDrops } from "xrpl";
import type {
  CancelEscrowParams,
  CreateEscrowParams,
  CreateEscrowResult,
  EscrowTxResult,
  FinishEscrowParams,
} from "../types/index.js";

// the testnet websocket url for the xrpl client
const TESTNET_WS = "wss://s.altnet.rippletest.net:51233";

// XRPL timestamps are seconds since Jan 1, 2000 UTC.
// JS timestamps are seconds since Jan 1, 1970 UTC.
// Difference is exactly 946,684,800 seconds.
const RIPPLE_EPOCH_OFFSET = 946_684_800;

function dateToRippleTime(date: Date): number { 
  const unixSeconds = Math.floor(date.getTime() / 1000);
  const rippleTime = unixSeconds - RIPPLE_EPOCH_OFFSET;
  if (rippleTime <= 0) {
    throw new Error(
      `Deadline ${date.toISOString()} is before the Ripple epoch (2000-01-01).`
    );
  }
  return rippleTime;
}

export async function createEscrow(
  params: CreateEscrowParams
): Promise<CreateEscrowResult> {
  const { userSeed, destinationAddress, amountXRP, deadline } = params;

  // We place FinishAfter 5 seconds ahead of wall-clock time (see comment
  // below), and require CancelAfter to be comfortably after that.
  const FINISH_AFTER_BUFFER_MS = 5_000;
  const MIN_DEADLINE_MS = FINISH_AFTER_BUFFER_MS + 10_000;
  if (deadline.getTime() <= Date.now() + MIN_DEADLINE_MS) {
    throw new Error(
      `deadline must be at least ${MIN_DEADLINE_MS / 1000}s in the future`
    );
  }

  const client = new Client(TESTNET_WS);
  await client.connect();

  try {
    const wallet = Wallet.fromSeed(userSeed);
    const cancelAfter = dateToRippleTime(deadline);
    const amountDrops = xrpToDrops(amountXRP);

    // The xrpl client library requires either Condition or FinishAfter on
    // EscrowCreate. Additionally, rippled rejects the tx with tecNO_PERMISSION
    // if FinishAfter <= the parent ledger's close time, which can be up to a
    // few seconds behind wall-clock "now". A small future buffer avoids that
    // race while still letting the pot wallet finish very soon after creation.
    const finishAfter = dateToRippleTime(
      new Date(Date.now() + FINISH_AFTER_BUFFER_MS)
    );
    if (finishAfter >= cancelAfter) {
      throw new Error("deadline must be at least a few seconds in the future");
    }

    const prepared = await client.autofill({
      TransactionType: "EscrowCreate",
      Account: wallet.address,
      Destination: destinationAddress,
      Amount: amountDrops,
      FinishAfter: finishAfter,
      CancelAfter: cancelAfter,
    });

    // autofill adds Sequence at runtime, but its return type doesn't include it.
    const escrowSequence = (prepared as { Sequence?: number }).Sequence;
    if (typeof escrowSequence !== "number") {
      throw new Error("autofill did not return a Sequence number");
    }

    const signed = wallet.sign(prepared);
    const result = await client.submitAndWait(signed.tx_blob);

    const meta = result.result.meta;
    const engineResult =
      typeof meta === "object" && meta !== null && "TransactionResult" in meta
        ? (meta as { TransactionResult: string }).TransactionResult
        : undefined;

    if (engineResult && engineResult !== "tesSUCCESS") {
      throw new Error(`EscrowCreate failed: ${engineResult}`);
    }

    return {
      escrowSequence,
      txHash: result.result.hash,
    };
  } finally {
    await client.disconnect();
  }
}

export async function finishEscrow(
  params: FinishEscrowParams
): Promise<EscrowTxResult> {
  const { potWalletSeed, userAddress, escrowSequence } = params;

  if (!Number.isInteger(escrowSequence) || escrowSequence <= 0) {
    throw new Error("escrowSequence must be a positive integer");
  }

  const client = new Client(TESTNET_WS);
  await client.connect();

  try {
    const wallet = Wallet.fromSeed(potWalletSeed);

    const prepared = await client.autofill({
      TransactionType: "EscrowFinish",
      Account: wallet.address,
      Owner: userAddress,
      OfferSequence: escrowSequence,
    });

    const signed = wallet.sign(prepared);
    const result = await client.submitAndWait(signed.tx_blob);

    const meta = result.result.meta;
    const engineResult =
      typeof meta === "object" && meta !== null && "TransactionResult" in meta
        ? (meta as { TransactionResult: string }).TransactionResult
        : undefined;

    if (engineResult && engineResult !== "tesSUCCESS") {
      throw new Error(`EscrowFinish failed: ${engineResult}`);
    }

    return { txHash: result.result.hash };
  } finally {
    await client.disconnect();
  }
}

export async function cancelEscrow(
  params: CancelEscrowParams
): Promise<EscrowTxResult> {
  const { userSeed, userAddress, escrowSequence } = params;

  if (!Number.isInteger(escrowSequence) || escrowSequence <= 0) {
    throw new Error("escrowSequence must be a positive integer");
  }

  const client = new Client(TESTNET_WS);
  await client.connect();

  try {
    const wallet = Wallet.fromSeed(userSeed);

    if (wallet.address !== userAddress) {
      throw new Error(
        `userSeed derives ${wallet.address}, not userAddress ${userAddress}`
      );
    }

    const prepared = await client.autofill({
      TransactionType: "EscrowCancel",
      Account: wallet.address,
      Owner: userAddress,
      OfferSequence: escrowSequence,
    });

    const signed = wallet.sign(prepared);
    const result = await client.submitAndWait(signed.tx_blob);

    const meta = result.result.meta;
    const engineResult =
      typeof meta === "object" && meta !== null && "TransactionResult" in meta
        ? (meta as { TransactionResult: string }).TransactionResult
        : undefined;

    if (engineResult && engineResult !== "tesSUCCESS") {
      throw new Error(`EscrowCancel failed: ${engineResult}`);
    }

    return { txHash: result.result.hash };
  } finally {
    await client.disconnect();
  }
}
