import { NextResponse } from "next/server";
import { Client } from "xrpl";
import { getSessionUser } from "@/lib/auth";

// Lightweight read-only endpoint so the UI can render a live balance for
// the signed-in user's shared demo wallet. Opens its own WS connection to
// the testnet per request — fine for a hackathon demo; swap for a pooled
// client if we ever care about throughput.

const TESTNET_WS = "wss://s.altnet.rippletest.net:51233";

// Walk the transaction metadata to find this account's balance change.
// Works across every tx type (Payment, EscrowCreate, EscrowFinish,
// EscrowCancel, Trust...) without special-casing each one — we just look
// at what actually moved on the AccountRoot node.
function computeAccountDelta(meta, address) {
  if (!meta || !Array.isArray(meta.AffectedNodes)) return 0;

  for (const node of meta.AffectedNodes) {
    const modified = node.ModifiedNode;
    const created = node.CreatedNode;
    const deleted = node.DeletedNode;

    if (modified?.LedgerEntryType === "AccountRoot") {
      const acct =
        modified.FinalFields?.Account ?? modified.PreviousFields?.Account;
      if (acct !== address) continue;
      const final = modified.FinalFields?.Balance;
      const prev = modified.PreviousFields?.Balance;
      if (final === undefined || prev === undefined) return 0;
      return (Number(final) - Number(prev)) / 1_000_000;
    }

    if (created?.LedgerEntryType === "AccountRoot") {
      const acct = created.NewFields?.Account;
      if (acct !== address) continue;
      const bal = created.NewFields?.Balance;
      if (bal === undefined) return 0;
      return Number(bal) / 1_000_000;
    }

    if (deleted?.LedgerEntryType === "AccountRoot") {
      const acct = deleted.FinalFields?.Account;
      if (acct !== address) continue;
      const bal = deleted.FinalFields?.Balance;
      if (bal === undefined) return 0;
      return -Number(bal) / 1_000_000;
    }
  }
  return 0;
}

function humanLabel(tx, address) {
  const type = tx?.TransactionType;
  const dest = tx?.Destination;
  const account = tx?.Account;

  switch (type) {
    case "EscrowCreate":
      return account === address
        ? "Escrow created (stake locked)"
        : "Escrow created (incoming)";
    case "EscrowFinish":
      return dest === address ? "Escrow received" : "Payout sent to charity";
    case "EscrowCancel":
      return "Escrow refunded";
    case "Payment":
      return dest === address ? "Payment received" : "Payment sent";
    case "AccountSet":
      return "Account settings";
    case "TrustSet":
      return "Trust line";
    default:
      return type || "Transaction";
  }
}

// XRPL ripple-epoch offset: seconds since 2000-01-01T00:00:00Z
const RIPPLE_EPOCH_OFFSET = 946684800;

function rippleTimeToIso(t) {
  if (typeof t !== "number") return null;
  return new Date((t + RIPPLE_EPOCH_OFFSET) * 1000).toISOString();
}

export async function GET(request) {
  const sessionUser = await getSessionUser(request);
  if (!sessionUser) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const address = sessionUser.walletAddress;
  if (!address) {
    return NextResponse.json(
      { error: "User has no walletAddress on record" },
      { status: 500 }
    );
  }

  const client = new Client(TESTNET_WS);
  try {
    await client.connect();

    const infoRes = await client.request({
      command: "account_info",
      account: address,
      ledger_index: "validated",
    });
    const drops = infoRes?.result?.account_data?.Balance;
    const sequence = infoRes?.result?.account_data?.Sequence ?? null;
    const balanceXRP =
      typeof drops === "string" || typeof drops === "number"
        ? Number(drops) / 1_000_000
        : null;

    // Pull recent history so the UI can render a bank-account-style ledger.
    let transactions = [];
    try {
      const txRes = await client.request({
        command: "account_tx",
        account: address,
        limit: 15,
        ledger_index_min: -1,
        ledger_index_max: -1,
      });
      const raw = Array.isArray(txRes?.result?.transactions)
        ? txRes.result.transactions
        : [];
      transactions = raw
        .map((entry) => {
          // xrpl.js returns tx_json on newer nodes and tx on older ones —
          // tolerate both so this doesn't silently go empty.
          const tx = entry.tx_json || entry.tx || {};
          const meta = entry.meta;
          const validated = entry.validated !== false;
          if (!validated) return null;
          const hash = tx.hash || entry.hash;
          if (!hash) return null;
          return {
            hash,
            type: tx.TransactionType || "Unknown",
            label: humanLabel(tx, address),
            deltaXRP: computeAccountDelta(meta, address),
            date: rippleTimeToIso(tx.date),
          };
        })
        .filter(Boolean);
    } catch (txErr) {
      console.warn("[GET /api/wallet] account_tx failed", txErr);
    }

    return NextResponse.json({ address, balanceXRP, sequence, transactions });
  } catch (err) {
    const code = err?.data?.error || err?.error;
    if (code === "actNotFound") {
      return NextResponse.json({
        address,
        balanceXRP: null,
        sequence: null,
        transactions: [],
        note: "Account not funded on testnet yet.",
      });
    }
    console.error("[GET /api/wallet]", err);
    return NextResponse.json(
      { error: "Failed to read wallet", detail: String(err?.message || err) },
      { status: 500 }
    );
  } finally {
    try {
      await client.disconnect();
    } catch {
      // ignore
    }
  }
}

export const runtime = "nodejs";
