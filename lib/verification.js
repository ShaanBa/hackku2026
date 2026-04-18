// Pure helpers for judging whether a proof selfie counts as "showed up".
// No DB or XRPL access lives here; those happen in the caller.

const EARTH_RADIUS_METERS = 6_371_000;

function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

// Great-circle distance between two lat/lng points on Earth, in meters.
// Accurate enough for geofencing at city scale (< 10km).
export function haversineMeters(lat1, lng1, lat2, lng2) {
  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);
  const deltaPhi = toRadians(lat2 - lat1);
  const deltaLambda = toRadians(lng2 - lng1);

  const a =
    Math.sin(deltaPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_METERS * c;
}

// Check a proof against a goal's location + time window.
//
// goal: Mongo goal document (expects goal.type, goal.location.{lat,lng,radiusMeters},
//       and goal.target.{targetAt, windowMinutes} for single goals, or
//       goal.target.{startAt, endAt} for recurring).
// proof: { capturedAt: Date, gps: { lat, lng } }
//
// Returns { ok, reason, distanceMeters }. `reason` is machine-readable
// and also stored on the proof doc for audit.
export function verifyProof(goal, proof) {
  if (!proof?.gps || typeof proof.gps.lat !== "number" || typeof proof.gps.lng !== "number") {
    return { ok: false, reason: "no_exif_gps", distanceMeters: null };
  }
  if (!proof.capturedAt || Number.isNaN(new Date(proof.capturedAt).getTime())) {
    return { ok: false, reason: "no_exif_time", distanceMeters: null };
  }
  if (
    !goal?.location ||
    typeof goal.location.lat !== "number" ||
    typeof goal.location.lng !== "number"
  ) {
    return { ok: false, reason: "goal_missing_location", distanceMeters: null };
  }

  const distanceMeters = haversineMeters(
    proof.gps.lat,
    proof.gps.lng,
    goal.location.lat,
    goal.location.lng
  );

  const radius =
    typeof goal.location.radiusMeters === "number" && goal.location.radiusMeters > 0
      ? goal.location.radiusMeters
      : 75;

  if (distanceMeters > radius) {
    return { ok: false, reason: "outside_geofence", distanceMeters };
  }

  const captured = new Date(proof.capturedAt).getTime();
  const now = Date.now();

  // A proof timestamp from the future is almost certainly spoofed.
  // Allow a small skew for device clock drift.
  if (captured > now + 10 * 60 * 1000) {
    return { ok: false, reason: "captured_in_future", distanceMeters };
  }

  if (goal.type === "single") {
    const targetAt = goal.target?.targetAt
      ? new Date(goal.target.targetAt).getTime()
      : null;
    const windowMs =
      typeof goal.target?.windowMinutes === "number" && goal.target.windowMinutes > 0
        ? goal.target.windowMinutes * 60 * 1000
        : 30 * 60 * 1000;
    if (targetAt === null) {
      return { ok: false, reason: "goal_missing_target_time", distanceMeters };
    }
    if (Math.abs(captured - targetAt) > windowMs) {
      return { ok: false, reason: "outside_time_window", distanceMeters };
    }
  } else if (goal.type === "recurring") {
    const startAt = goal.target?.startAt
      ? new Date(goal.target.startAt).getTime()
      : null;
    const endAt = goal.target?.endAt
      ? new Date(goal.target.endAt).getTime()
      : null;
    if (startAt === null || endAt === null) {
      return { ok: false, reason: "goal_missing_window", distanceMeters };
    }
    if (captured < startAt || captured > endAt) {
      return { ok: false, reason: "outside_time_window", distanceMeters };
    }
  } else {
    // Unknown goal type: refuse rather than silently verify on geofence alone.
    // The API currently rejects anything other than "single" at create time,
    // so reaching here means the DB has legacy or malformed data.
    return { ok: false, reason: "unknown_goal_type", distanceMeters };
  }

  return { ok: true, reason: "ok", distanceMeters };
}
