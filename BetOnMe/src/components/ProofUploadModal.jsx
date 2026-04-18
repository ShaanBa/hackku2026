import { useEffect, useMemo, useState } from "react";
import api from "../lib/api";
import { txUrl } from "../lib/xrplExplorer";
import "./ProofUploadModal.css";

const ALLOWED = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
];

// iOS Safari (and WhatsApp/iMessage pipelines) strip EXIF GPS from
// uploaded photos. We ask the browser for live coordinates as a
// fallback so a real on-location check-in still verifies.
//
// Returns { status, location, errorCode } so the caller can show a
// real reason when the prompt is silently failing (most often:
// permission was denied earlier in the session and Safari refuses
// to re-prompt).
//   status: "ready" | "denied" | "unavailable" | "timeout" | "unsupported"
function getBrowserLocation(timeoutMs = 8000) {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve({ status: "unsupported", location: null });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          status: "ready",
          location: {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy ?? null,
          },
        }),
      (err) => {
        // PositionError codes:
        // 1 = PERMISSION_DENIED, 2 = POSITION_UNAVAILABLE, 3 = TIMEOUT
        const code = err?.code ?? 0;
        const status =
          code === 1 ? "denied" : code === 3 ? "timeout" : "unavailable";
        resolve({ status, location: null, errorCode: code });
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 }
    );
  });
}

// Human-readable copy for verification verdicts. The backend returns
// short machine codes; we translate them to a one-line headline plus
// a "fix" sentence telling the user exactly what to change.
const REASON_COPY = {
  ok: {
    title: "Verified",
    body: "You were at the right place at the right time.",
    fix: null,
  },
  no_exif_gps: {
    title: "No location data",
    body: "We couldn't read a GPS tag from your photo, and your browser didn't give us live coordinates either.",
    fix: "Allow location access in the banner above (or in your browser settings) and submit again. iOS Safari users: Settings → Safari → Location → Allow, then reload the page.",
  },
  no_exif_time: {
    title: "No capture time",
    body: "We couldn't read when your photo was taken.",
    fix: "Take a fresh photo with your phone's camera and try again — screenshots and edited images often lose their timestamp.",
  },
  goal_missing_location: {
    title: "Goal has no location",
    body: "This goal was saved without a map pin, so we can't check distance.",
    fix: "Delete this goal and create a new one — make sure to drop a pin on the map.",
  },
  goal_missing_target_time: {
    title: "Goal has no target time",
    body: "This goal was saved without a target time.",
    fix: "Delete this goal and create a new one with a target time.",
  },
  goal_missing_window: {
    title: "Goal has no valid window",
    body: "This recurring goal is missing its start/end times.",
    fix: "Delete this goal and create a new one.",
  },
  outside_geofence: {
    title: "Too far from the goal location",
    body: "Your check-in is outside the goal's geofence radius.",
    fix: "Walk closer to the map pin and try again. If the goal's radius is too tight, you'll need to recreate it with a wider check-in radius.",
  },
  outside_time_window: {
    title: "Outside the check-in window",
    body: "Your check-in time isn't within the goal's allowed window.",
    fix: "If you can wait, try again during the window. Otherwise, create a new goal — defaults give you ±2 hours, and you can stretch that to 24h when creating it.",
  },
  captured_in_future: {
    title: "Timestamp is in the future",
    body: "Your photo's timestamp is more than 10 minutes ahead of the server clock.",
    fix: "Check your device's date & time settings (set to automatic), then take a fresh photo and try again.",
  },
  unknown_goal_type: {
    title: "Unsupported goal type",
    body: "This goal's type isn't recognized.",
    fix: "Delete this goal and create a new one.",
  },
};

function reasonCopy(code) {
  return (
    REASON_COPY[code] || {
      title: "Rejected",
      body: code ? `Verification failed: ${code}.` : "Verification failed.",
      fix: "Try again, or check the technical details below.",
    }
  );
}

// Friendly upload-error messages for the OUTER request errors (network,
// auth, server crash, etc.) — distinct from the per-proof rejection
// reasons above, which only fire when the request reached the server
// and returned a 2xx with a verdict.
function uploadErrorMessage(err) {
  if (!err) return "Upload failed for an unknown reason.";
  if (err.kind === "network") {
    return "Couldn't reach the server. Check your internet connection and try again.";
  }
  if (err.status === 401) {
    return "Your session expired. Please sign in again, then retry.";
  }
  if (err.status === 403) {
    return "This goal doesn't belong to your account.";
  }
  if (err.status === 404) {
    return "That goal no longer exists. It may have been deleted — refresh and try again.";
  }
  if (err.status === 413) {
    return "Photo is too large. The server caps uploads at 10 MB.";
  }
  if (err.status === 415) {
    return "Unsupported photo format. JPG, PNG, WebP, or HEIC only.";
  }
  if (err.status >= 500) {
    return `Server error: ${err.message}. Try again in a few seconds.`;
  }
  return err.message || "Upload failed.";
}

function ProofUploadModal({ open, goal, onClose, onUploaded }) {
  const [file, setFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [errorDetail, setErrorDetail] = useState(null);
  const [result, setResult] = useState(null);
  // Geolocation state, fetched eagerly when the modal opens so the
  // user sees up-front whether their browser will hand us coords —
  // not after they've already picked a photo and tapped submit.
  const [locStatus, setLocStatus] = useState("idle");
  const [loc, setLoc] = useState(null);

  const requestLocation = async () => {
    setLocStatus("prompting");
    const { status, location } = await getBrowserLocation();
    setLocStatus(status);
    setLoc(location);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Kick off the geolocation prompt as soon as the modal opens so the
  // user can fix permissions before they pick a photo.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    if (locStatus !== "idle") return;
    requestLocation();
  }, [open, locStatus]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Reset all modal state when it's closed so a reopen starts clean.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) {
      setFile(null);
      setError(null);
      setErrorDetail(null);
      setResult(null);
      setSubmitting(false);
      setLocStatus("idle");
      setLoc(null);
    }
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const previewUrl = useMemo(() => {
    if (!file) return null;
    return URL.createObjectURL(file);
  }, [file]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  if (!open) return null;

  function pickFile(f) {
    setError(null);
    setErrorDetail(null);
    setResult(null);
    if (!f) {
      setFile(null);
      return;
    }
    if (f.type && !ALLOWED.includes(f.type)) {
      setError(
        `Unsupported file type "${f.type}". Use JPG, PNG, WebP, or HEIC.`
      );
      setFile(null);
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      const sizeMB = (f.size / 1024 / 1024).toFixed(2);
      setError(
        `Photo is too large (${sizeMB} MB). The server caps uploads at 10 MB — try a smaller photo or a screenshot.`
      );
      setFile(null);
      return;
    }
    setFile(f);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setErrorDetail(null);
    if (!file) return setError("Pick a photo first.");
    if (!goal?.id) {
      return setError(
        "We lost track of which goal you're checking into. Close this modal and try again."
      );
    }

    const fd = new FormData();
    fd.append("file", file);
    fd.append("goalId", goal.id);

    setSubmitting(true);
    try {
      // Prefer the location captured eagerly when the modal opened.
      // If we never got it (or the user just granted permission and
      // hasn't retried), make one last attempt now so the request
      // still has the freshest possible coords.
      let useLoc = loc;
      if (!useLoc) {
        const { location } = await getBrowserLocation();
        useLoc = location;
      }
      if (useLoc) {
        fd.append("clientLat", String(useLoc.lat));
        fd.append("clientLng", String(useLoc.lng));
        if (useLoc.accuracy !== null)
          fd.append("clientAccuracy", String(useLoc.accuracy));
        fd.append("clientCapturedAt", new Date().toISOString());
      }

      const res = await api.uploadProof(fd);
      setResult(res);
      onUploaded?.(res);
    } catch (err) {
      setError(uploadErrorMessage(err));
      setErrorDetail({
        status: err?.status ?? null,
        kind: err?.kind ?? null,
        detail: err?.detail ?? null,
      });
    } finally {
      setSubmitting(false);
    }
  }

  const verdict = result?.verification?.status;

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal proof-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Upload proof</h2>
          <button className="btn btn-ghost" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="muted" style={{ marginBottom: 12 }}>
          For <strong>{goal?.title || "this goal"}</strong>. We read EXIF GPS +
          timestamp from your photo when available, fall back to your
          browser's location otherwise, compare to the goal's geofence, and
          auto-resolve on success.
        </div>

        <form onSubmit={handleSubmit} className="modal-form">
          <div className={`loc-banner loc-${locStatus}`}>
            {locStatus === "prompting" && (
              <span>📍 Requesting your location…</span>
            )}
            {locStatus === "ready" && loc && (
              <span>
                📍 Location ready
                {typeof loc.accuracy === "number" && (
                  <span className="muted small">
                    {" "}
                    · ±{Math.round(loc.accuracy)} m
                  </span>
                )}
              </span>
            )}
            {locStatus === "denied" && (
              <div>
                <strong>📍 Location blocked.</strong>
                <div className="muted small">
                  On iPhone: Settings → Safari → Location → Allow, then
                  reload this page. On Chrome: tap the address bar lock
                  icon → Permissions → Location → Allow.
                </div>
              </div>
            )}
            {(locStatus === "timeout" ||
              locStatus === "unavailable" ||
              locStatus === "unsupported") && (
              <div>
                <strong>📍 Couldn't get your location.</strong>
                <button
                  type="button"
                  className="btn btn-ghost loc-retry"
                  onClick={requestLocation}
                >
                  Try again
                </button>
              </div>
            )}
          </div>

          <div className="form-row">
            <label className="label">Photo</label>
            <label className="file-drop">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                onChange={(e) => pickFile(e.target.files?.[0] || null)}
                style={{ display: "none" }}
              />
              {previewUrl ? (
                <img src={previewUrl} alt="preview" className="file-preview" />
              ) : (
                <div className="file-drop-empty">
                  <div className="file-drop-plus">📷</div>
                  <div>Click to choose a photo</div>
                  <div className="muted small">
                    JPG, PNG, WebP, or HEIC — up to 10 MB
                  </div>
                </div>
              )}
            </label>
            {file && (
              <div className="muted small" style={{ marginTop: 6 }}>
                {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB
              </div>
            )}
          </div>

          {error && (
            <div className="error-banner">
              <div>{error}</div>
              {errorDetail &&
                (errorDetail.status || errorDetail.detail) && (
                  <details className="error-details">
                    <summary>Technical details</summary>
                    <pre>
                      {JSON.stringify(
                        {
                          status: errorDetail.status,
                          kind: errorDetail.kind,
                          detail: errorDetail.detail,
                        },
                        null,
                        2
                      )}
                    </pre>
                  </details>
                )}
            </div>
          )}

          {result && (() => {
            const copy = reasonCopy(result.verification?.reason);
            return (
            <div
              className={`result-banner ${
                verdict === "verified" ? "ok" : "bad"
              }`}
            >
              <div className="result-title">
                {verdict === "verified" ? "✓ " : "✗ "}
                {copy.title}
              </div>
              <div className="muted small">{copy.body}</div>
              {copy.fix && (
                <div className="small fix-hint" style={{ marginTop: 6 }}>
                  <strong>How to fix:</strong> {copy.fix}
                </div>
              )}
              {typeof result.verification?.distanceMeters === "number" && (() => {
                const meters = result.verification.distanceMeters;
                const km = meters / 1000;
                // Anything over a few km is almost certainly a wrong-pin
                // problem rather than a "walk closer" problem; render in
                // km so it reads as obviously absurd ("11,285 km away") and
                // surface both coordinate pairs so the user can see exactly
                // where the goal landed vs where the photo says they are.
                const farAway = meters > 5_000;
                return (
                  <div className="muted small" style={{ marginTop: 6 }}>
                    <div>
                      distance:{" "}
                      <strong>
                        {farAway
                          ? `${km.toLocaleString(undefined, {
                              maximumFractionDigits: 0,
                            })} km`
                          : `${Math.round(meters)} m`}
                      </strong>
                      {goal?.location?.radiusMeters
                        ? ` (allowed: ${goal.location.radiusMeters} m)`
                        : ""}
                    </div>
                    {farAway && (
                      <div
                        className="small fix-hint"
                        style={{ marginTop: 6 }}
                      >
                        <strong>That's likely a goal-pin problem, not a photo problem.</strong>{" "}
                        The check-in is thousands of km from where this goal was
                        pinned on the map. Delete this goal and recreate it,
                        making sure to drop the pin on your actual location.
                      </div>
                    )}
                    {(result.gps ||
                      goal?.location?.lat != null) && (
                      <details className="error-details" style={{ marginTop: 6 }}>
                        <summary>Coordinate breakdown</summary>
                        <pre>
                          {JSON.stringify(
                            {
                              proof: result.gps
                                ? {
                                    lat: result.gps.lat,
                                    lng: result.gps.lng,
                                    source: result.gpsSource,
                                  }
                                : null,
                              goalPin: goal?.location
                                ? {
                                    lat: goal.location.lat,
                                    lng: goal.location.lng,
                                    name: goal.location.name || null,
                                    radiusMeters:
                                      goal.location.radiusMeters || null,
                                  }
                                : null,
                            },
                            null,
                            2
                          )}
                        </pre>
                      </details>
                    )}
                  </div>
                );
              })()}
              {result.resolution?.status && (
                <div className="small" style={{ marginTop: 6 }}>
                  Goal auto-resolved to{" "}
                  <strong>{result.resolution.status}</strong>
                </div>
              )}
              {result.vlm && (() => {
                const v = result.vlm;
                // Hide entirely only when the server explicitly said
                // "no Gemini key configured" — that's a deploy choice,
                // not a runtime failure worth surfacing.
                if (!v.checked && v.reason === "no_api_key") return null;

                if (!v.checked) {
                  // Translate failure reason codes to friendly copy
                  // so the user understands *why* there's no AI verdict
                  // instead of seeing nothing at all.
                  const failCopy = {
                    timeout: {
                      title: "AI check timed out",
                      body: "Gemma didn't respond in time. Your proof was still verified using GPS + timestamp.",
                    },
                    rate_limited: {
                      title: "AI check skipped (rate-limited)",
                      body: "We've hit the Gemini API quota for the moment. Your proof was still verified using GPS + timestamp.",
                    },
                    network_error: {
                      title: "AI check skipped (network)",
                      body: "Couldn't reach the Gemini API. Your proof was still verified using GPS + timestamp.",
                    },
                    auth_error: {
                      title: "AI check misconfigured",
                      body: "The Gemini API key is missing or invalid on the server. Your proof was still verified using GPS + timestamp.",
                    },
                    request_failed: {
                      title: "AI check failed",
                      body: "The vision model didn't return a verdict this time. Your proof was still verified using GPS + timestamp.",
                    },
                    empty_buffer: {
                      title: "AI check skipped",
                      body: "Couldn't read the image bytes for the AI check.",
                    },
                  };
                  const c =
                    failCopy[v.reason] || {
                      title: "AI check unavailable",
                      body: "Skipped this time. Your proof was still verified using GPS + timestamp.",
                    };
                  return (
                    <div className="vlm-badge neutral">
                      <div className="vlm-title">
                        {c.title}
                        {v.attempts > 1 && (
                          <span className="vlm-conf">
                            {" · "}
                            {v.attempts} attempts
                          </span>
                        )}
                      </div>
                      <div className="muted small">{c.body}</div>
                      {v.error && (
                        <details className="error-details">
                          <summary>Technical details</summary>
                          <pre>
                            {JSON.stringify(
                              { reason: v.reason, error: v.error, attempts: v.attempts },
                              null,
                              2
                            )}
                          </pre>
                        </details>
                      )}
                    </div>
                  );
                }

                // checked: true — model returned, render the verdict.
                return (
                  <div
                    className={`vlm-badge ${
                      v.matches === true
                        ? "ok"
                        : v.matches === false
                        ? "bad"
                        : "neutral"
                    }`}
                  >
                    <div className="vlm-title">
                      {v.matches === true
                        ? "AI confirmed"
                        : v.matches === false
                        ? "AI couldn't confirm"
                        : "AI verdict unclear"}
                      {typeof v.confidence === "number" && (
                        <span className="vlm-conf">
                          {" · "}
                          {Math.round(v.confidence * 100)}%
                        </span>
                      )}
                    </div>
                    {v.label && (
                      <div className="muted small">saw: {v.label}</div>
                    )}
                    {v.rationale && (
                      <div className="muted small vlm-rationale">
                        “{v.rationale}”
                      </div>
                    )}
                    <div className="muted small vlm-model">
                      via {v.model}
                      {v.attempts > 1 && ` · ${v.attempts} attempts`}
                    </div>
                  </div>
                );
              })()}
              {(result.resolution?.finishTxHash ||
                result.resolution?.createTxHash) && (
                <div className="tx-links small" style={{ marginTop: 8 }}>
                  {result.resolution.finishTxHash && (
                    <a
                      className="tx-chip"
                      href={txUrl(result.resolution.finishTxHash)}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      View payout on-chain ↗
                    </a>
                  )}
                  {result.resolution.createTxHash && (
                    <a
                      className="tx-chip"
                      href={txUrl(result.resolution.createTxHash)}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      View escrow on-chain ↗
                    </a>
                  )}
                </div>
              )}
            </div>
            );
          })()}

          <div className="modal-actions">
            <button type="button" className="btn" onClick={onClose}>
              {result ? "Close" : "Cancel"}
            </button>
            {!result && (
              <button
                type="submit"
                className="btn btn-primary"
                disabled={submitting || !file}
              >
                {submitting ? "Uploading…" : "Submit proof"}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

export default ProofUploadModal;
