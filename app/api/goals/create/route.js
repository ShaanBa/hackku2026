import { NextResponse } from "next/server";
import { Wallet } from "xrpl";
import { getDb } from "@/lib/mongodb";
import { createEscrow } from "@/lib/xrpl";
import { getCharityById } from "@/lib/charities";
import { getSessionUser } from "@/lib/auth";

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function parseDate(value) {
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

let cachedOwnerAddress = null;
function getSharedOwnerAddress() {
  if (cachedOwnerAddress) return cachedOwnerAddress;
  const seed = process.env.USER_WALLET_SEED;
  if (!seed) throw new Error("USER_WALLET_SEED is not set");
  cachedOwnerAddress = Wallet.fromSeed(seed).address;
  return cachedOwnerAddress;
}

function validateLocation(loc) {
  if (!loc || typeof loc !== "object") return "location is required";
  if (!isFiniteNumber(loc.lat) || loc.lat < -90 || loc.lat > 90) {
    return "location.lat must be a number in [-90, 90]";
  }
  if (!isFiniteNumber(loc.lng) || loc.lng < -180 || loc.lng > 180) {
    return "location.lng must be a number in [-180, 180]";
  }
  if (loc.radiusMeters != null && (!isFiniteNumber(loc.radiusMeters) || loc.radiusMeters <= 0)) {
    return "location.radiusMeters must be a positive number if provided";
  }
  return null;
}

function validateSingleTarget(target) {
  if (!target || typeof target !== "object") return "target is required";
  const targetAt = parseDate(target.targetAt);
  if (!targetAt) return "target.targetAt must be a valid date";
  const windowMinutes = target.windowMinutes;
  if (windowMinutes != null && (!isFiniteNumber(windowMinutes) || windowMinutes <= 0)) {
    return "target.windowMinutes must be a positive number if provided";
  }
  return null;
}

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

    const title = body?.title;
    const stakeAmount = body?.stakeAmount;
    const type = body?.type;
    const location = body?.location;
    const target = body?.target;
    const charityId = body?.charityId;

    if (!isNonEmptyString(title)) {
      return NextResponse.json(
        { error: 'Field "title" is required' },
        { status: 400 }
      );
    }

    // Decision #1: single first. We accept recurring in the payload but
    // reject it for now so no one starts relying on half-baked behavior.
    if (type !== "single") {
      return NextResponse.json(
        {
          error:
            'Field "type" must be "single". Recurring goals are not yet implemented.',
        },
        { status: 400 }
      );
    }

    const stake =
      typeof stakeAmount === "number" && Number.isFinite(stakeAmount)
        ? stakeAmount
        : typeof stakeAmount === "string"
          ? Number.parseFloat(stakeAmount)
          : NaN;

    if (!Number.isFinite(stake) || stake <= 0) {
      return NextResponse.json(
        { error: 'Field "stakeAmount" must be a positive number of XRP' },
        { status: 400 }
      );
    }

    const locErr = validateLocation(location);
    if (locErr) {
      return NextResponse.json({ error: locErr }, { status: 400 });
    }

    const targetErr = validateSingleTarget(target);
    if (targetErr) {
      return NextResponse.json({ error: targetErr }, { status: 400 });
    }
    const targetAt = parseDate(target.targetAt);
    const windowMinutes =
      isFiniteNumber(target.windowMinutes) && target.windowMinutes > 0
        ? target.windowMinutes
        : 30;

    // Decision #10: for single goals, deadline = targetAt + 24h. This is
    // the escrow's CancelAfter, not the judgment time.
    const deadline = new Date(targetAt.getTime() + 24 * 60 * 60 * 1000);
    if (deadline.getTime() <= Date.now() + 15_000) {
      return NextResponse.json(
        {
          error:
            'Computed deadline (targetAt + 24h) must be at least ~15s in the future',
        },
        { status: 400 }
      );
    }

    const charity = getCharityById(charityId);
    if (!charity) {
      return NextResponse.json(
        { error: 'Field "charityId" does not match any known charity' },
        { status: 400 }
      );
    }
    if (!isNonEmptyString(charity.address)) {
      return NextResponse.json(
        {
          error:
            "Selected charity is missing an XRPL address. Check XRPL_CHARITY_ADDRESS env.",
        },
        { status: 500 }
      );
    }

    const userSeed = process.env.USER_WALLET_SEED;
    if (!userSeed) {
      return NextResponse.json(
        { error: "Server missing XRPL config (USER_WALLET_SEED)" },
        { status: 500 }
      );
    }

    let ownerAddress;
    try {
      ownerAddress = getSharedOwnerAddress();
    } catch {
      return NextResponse.json(
        { error: "Server XRPL config invalid (USER_WALLET_SEED)" },
        { status: 500 }
      );
    }

    const db = await getDb();
    const goals = db.collection("goals");

    // Decision #8: compound index for fast "any active goal?" lookups.
    await goals.createIndex({ userId: 1 });
    await goals.createIndex({ userId: 1, status: 1 });

    // XRPL first — if this throws, we never touch Mongo.
    const escrow = await createEscrow({
      userSeed,
      destinationAddress: charity.address,
      amountXRP: String(stake),
      deadline,
    });

    const createdAt = new Date();
    const doc = {
      userId: sessionUser._id,
      title: title.trim(),
      stakeAmount: stake,
      deadline,
      status: "active", // business state (decision #5)
      escrowState: "locked", // chain state
      createdAt,
      type: "single",
      location: {
        name: isNonEmptyString(location.name) ? location.name.trim() : null,
        lat: location.lat,
        lng: location.lng,
        radiusMeters: isFiniteNumber(location.radiusMeters) ? location.radiusMeters : 75,
      },
      target: {
        targetAt,
        windowMinutes,
      },
      charity: {
        id: charity.id,
        name: charity.name,
        address: charity.address,
      },
      ownerAddress,
      escrow: {
        sequence: escrow.escrowSequence,
        createTxHash: escrow.txHash,
        destinationAddress: charity.address,
      },
    };

    let insertedId;
    try {
      const result = await goals.insertOne(doc);
      insertedId = result.insertedId;
    } catch (dbErr) {
      console.error(
        "[POST /api/goals/create] DB insert failed AFTER escrow created",
        { escrowSequence: escrow.escrowSequence, txHash: escrow.txHash, dbErr }
      );
      return NextResponse.json(
        {
          error:
            "Escrow created on-chain but failed to save goal. Funds are recoverable after deadline via EscrowCancel.",
          escrowSequence: escrow.escrowSequence,
          txHash: escrow.txHash,
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        id: insertedId.toString(),
        userId: doc.userId.toString(),
        title: doc.title,
        stakeAmount: doc.stakeAmount,
        deadline: doc.deadline.toISOString(),
        status: doc.status,
        escrowState: doc.escrowState,
        createdAt: doc.createdAt.toISOString(),
        type: doc.type,
        location: doc.location,
        target: {
          targetAt: doc.target.targetAt.toISOString(),
          windowMinutes: doc.target.windowMinutes,
        },
        charity: doc.charity,
        ownerAddress: doc.ownerAddress,
        escrow: doc.escrow,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("[POST /api/goals/create]", err);
    return NextResponse.json(
      { error: "Failed to create goal", detail: String(err?.message || err) },
      { status: 500 }
    );
  }
}

export const runtime = "nodejs";
