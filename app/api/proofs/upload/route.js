import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import exifr from "exifr";
import { getDb } from "@/lib/mongodb";
import { verifyProof } from "@/lib/verification";
import { resolveGoal } from "@/lib/resolve";
import { getSessionUser } from "@/lib/auth";

// Accepts multipart/form-data with these fields:
//   - file     (required) the image File blob
//   - goalId   (required) MongoDB ObjectId string
//   - userId   (required) MongoDB ObjectId string
// On success: parses EXIF for GPS + DateTimeOriginal, writes the file to
// /public/uploads/<uuid>.<ext>, persists a proof document with
// verification.{status,reason,checkedAt,distanceMeters}, and if the goal
// is a verified "single" goal, auto-resolves it to succeeded.

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");
const MAX_BYTES = 10 * 1024 * 1024; // 10MB cap — plenty for a phone selfie
const ALLOWED_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

async function ensureUploadDir() {
  try {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
  } catch (err) {
    if (err?.code !== "EEXIST") throw err;
  }
}

function extFromMime(mime) {
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/png") return ".png";
  if (mime === "image/webp") return ".webp";
  if (mime === "image/heic" || mime === "image/heif") return ".heic";
  return ".bin";
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

    // Tolerant parsing: fall back to JSON for back-compat during migration.
    const contentType = request.headers.get("content-type") || "";

    let goalId, imageFile, imageUrlOverride;
    // Browser-side fallback fields — populated from the form when
    // multipart upload is used. Used only if EXIF doesn't yield GPS.
    let clientLatRaw = null;
    let clientLngRaw = null;
    let clientAccuracyRaw = null;
    let clientCapturedAtRaw = null;

    if (contentType.includes("multipart/form-data")) {
      let form;
      try {
        form = await request.formData();
      } catch {
        return NextResponse.json(
          { error: "Invalid multipart body" },
          { status: 400 }
        );
      }
      goalId = form.get("goalId");
      imageFile = form.get("file");
      clientLatRaw = form.get("clientLat");
      clientLngRaw = form.get("clientLng");
      clientAccuracyRaw = form.get("clientAccuracy");
      clientCapturedAtRaw = form.get("clientCapturedAt");
      if (!(imageFile instanceof Blob)) {
        return NextResponse.json(
          { error: 'Field "file" (an image) is required' },
          { status: 400 }
        );
      }
      if (imageFile.size === 0) {
        return NextResponse.json(
          { error: 'Field "file" is empty' },
          { status: 400 }
        );
      }
      if (imageFile.size > MAX_BYTES) {
        return NextResponse.json(
          { error: `File too large: max ${MAX_BYTES} bytes` },
          { status: 413 }
        );
      }
      if (imageFile.type && !ALLOWED_MIMES.has(imageFile.type)) {
        return NextResponse.json(
          { error: `Unsupported file type: ${imageFile.type}` },
          { status: 415 }
        );
      }
    } else if (contentType.includes("application/json")) {
      let body;
      try {
        body = await request.json();
      } catch {
        return NextResponse.json(
          { error: "Invalid JSON body" },
          { status: 400 }
        );
      }
      goalId = body?.goalId;
      imageUrlOverride = body?.imageUrl; // legacy path, no EXIF verification possible
    } else {
      return NextResponse.json(
        { error: "Content-Type must be multipart/form-data or application/json" },
        { status: 400 }
      );
    }

    if (typeof goalId !== "string" || !ObjectId.isValid(goalId)) {
      return NextResponse.json(
        { error: 'Field "goalId" must be a valid MongoDB ObjectId string' },
        { status: 400 }
      );
    }

    const db = await getDb();
    const goals = db.collection("goals");
    const proofs = db.collection("proofs");

    const goal = await goals.findOne({ _id: new ObjectId(goalId) });
    if (!goal) {
      return NextResponse.json({ error: "Goal not found" }, { status: 404 });
    }
    if (!goal.userId.equals(sessionUser._id)) {
      return NextResponse.json(
        { error: "Goal does not belong to the signed-in user" },
        { status: 403 }
      );
    }

    let imageUrl = null;
    let capturedAt = null;
    let gps = null;
    // Tracks whether the coords we verified against came from the
    // photo's EXIF ("exif") or the browser geolocation fallback
    // ("client"). Useful for audits and demo transparency.
    let gpsSource = null;
    let capturedAtSource = null;

    if (imageFile) {
      const arrayBuffer = await imageFile.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // exifr.parse returns { GPSLatitude, GPSLongitude, DateTimeOriginal, ... }
      // with GPS already converted to decimal. Some phones strip GPS on web
      // upload — that's caught below.
      let exifData = {};
      try {
        exifData = (await exifr.parse(buffer, { gps: true })) || {};
      } catch {
        exifData = {};
      }

      const lat = exifData.latitude ?? exifData.GPSLatitude ?? null;
      const lng = exifData.longitude ?? exifData.GPSLongitude ?? null;
      if (typeof lat === "number" && typeof lng === "number") {
        gps = { lat, lng, accuracyMeters: null };
        gpsSource = "exif";
      }
      if (exifData.DateTimeOriginal) {
        capturedAt = new Date(exifData.DateTimeOriginal);
        capturedAtSource = "exif";
      } else if (exifData.CreateDate) {
        capturedAt = new Date(exifData.CreateDate);
        capturedAtSource = "exif";
      }

      // Disk persistence is best-effort. Vercel serverless mounts a
      // read-only filesystem (only /tmp is writable, and even that is
      // ephemeral per invocation), so writes will throw EROFS / EACCES.
      // EXIF parsing already happened in-memory above, so verification
      // and goal resolution still work — we just don't keep the image
      // file. For a real product, swap this for Vercel Blob / S3.
      try {
        await ensureUploadDir();
        const ext = extFromMime(imageFile.type);
        const filename = `${crypto.randomUUID()}${ext}`;
        const diskPath = path.join(UPLOAD_DIR, filename);
        await fs.writeFile(diskPath, buffer);
        imageUrl = `/uploads/${filename}`;
      } catch (writeErr) {
        console.warn(
          "[proofs/upload] could not persist image to disk; continuing without it:",
          writeErr?.message || writeErr
        );
        imageUrl = null;
      }
    } else {
      imageUrl = imageUrlOverride ?? null;
    }

    // Browser-provided fallback: iOS Safari and most messaging apps
    // strip EXIF GPS during upload, so the client-side submit may
    // attach live navigator.geolocation coordinates. We only use them
    // if EXIF didn't give us anything.
    if (!gps && clientLatRaw != null && clientLngRaw != null) {
      const lat = Number(clientLatRaw);
      const lng = Number(clientLngRaw);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        const acc =
          clientAccuracyRaw != null && Number.isFinite(Number(clientAccuracyRaw))
            ? Number(clientAccuracyRaw)
            : null;
        gps = { lat, lng, accuracyMeters: acc };
        gpsSource = "client";
      }
    }
    if (!capturedAt && clientCapturedAtRaw) {
      const parsed = new Date(clientCapturedAtRaw);
      if (!Number.isNaN(parsed.getTime())) {
        capturedAt = parsed;
        capturedAtSource = "client";
      }
    }

    const verdict = verifyProof(goal, { gps, capturedAt });
    const createdAt = new Date();

    await proofs.createIndex({ goalId: 1 });

    const doc = {
      goalId: new ObjectId(goalId),
      userId: sessionUser._id,
      imageUrl,
      capturedAt,
      capturedAtSource,
      gps,
      gpsSource,
      createdAt,
      verification: {
        status: verdict.ok ? "verified" : "rejected",
        reason: verdict.reason,
        checkedAt: createdAt,
        distanceMeters: verdict.distanceMeters,
      },
    };

    const insertResult = await proofs.insertOne(doc);

    // Decision #6: auto-resolve on verified proof. Single goals complete
    // immediately; recurring would bump a counter here (not implemented yet).
    let resolution = null;
    if (verdict.ok && goal.type === "single" && goal.status === "active") {
      try {
        const { goal: resolvedGoal } = await resolveGoal(
          goalId,
          "succeeded",
          "proof"
        );
        resolution = {
          status: resolvedGoal?.status ?? null,
          escrowState: resolvedGoal?.escrowState ?? null,
          resolvedAt: resolvedGoal?.resolvedAt
            ? new Date(resolvedGoal.resolvedAt).toISOString()
            : null,
          // Surface on-chain hashes so the UI can deep-link to the XRPL
          // testnet explorer in the success banner. On the "succeeded"
          // path there is no finishTxHash yet (that's the later refund),
          // but createTxHash proves the stake really was locked.
          createTxHash: resolvedGoal?.escrow?.createTxHash ?? null,
          finishTxHash: resolvedGoal?.escrow?.finishTxHash ?? null,
        };
      } catch (resolveErr) {
        // We still return the proof — resolution failure shouldn't throw
        // away the uploaded proof record.
        console.error("[proofs/upload] auto-resolve failed", resolveErr);
        resolution = { error: String(resolveErr?.message || resolveErr) };
      }
    }

    return NextResponse.json(
      {
        id: insertResult.insertedId.toString(),
        goalId: doc.goalId.toString(),
        userId: doc.userId.toString(),
        imageUrl: doc.imageUrl,
        capturedAt: doc.capturedAt ? doc.capturedAt.toISOString() : null,
        capturedAtSource: doc.capturedAtSource,
        gps: doc.gps,
        gpsSource: doc.gpsSource,
        createdAt: doc.createdAt.toISOString(),
        verification: {
          status: doc.verification.status,
          reason: doc.verification.reason,
          checkedAt: doc.verification.checkedAt.toISOString(),
          distanceMeters: doc.verification.distanceMeters,
        },
        resolution,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("[POST /api/proofs/upload]", err);
    return NextResponse.json(
      { error: "Failed to store proof", detail: String(err?.message || err) },
      { status: 500 }
    );
  }
}

export const runtime = "nodejs";
