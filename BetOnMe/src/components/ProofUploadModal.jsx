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
function getBrowserLocation(timeoutMs = 8000) {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? null,
        }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 }
    );
  });
}

// Human-readable reasons for verification verdicts. The backend returns
// short machine codes; this maps them to something a user can act on.
const REASON_COPY = {
  ok: "Looks good — you were at the right place at the right time.",
  no_exif_gps:
    "We couldn't read a GPS tag from your photo and didn't get a browser location. Try again with location permission enabled.",
  no_exif_time:
    "We couldn't read a capture time from your photo. Try a freshly taken photo (not a screenshot).",
  goal_missing_location:
    "This goal has no location configured — re-create the goal with a pin.",
  goal_missing_target_time:
    "This goal has no target time set — re-create the goal.",
  goal_missing_window: "This recurring goal has no valid time window.",
  outside_geofence:
    "You're outside the goal's geofence. Get closer to the pin and try again.",
  outside_time_window:
    "This check-in is outside the allowed time window for the goal.",
  captured_in_future:
    "Your photo's timestamp is in the future — check your phone's clock.",
  unknown_goal_type: "Unsupported goal type.",
};

function ProofUploadModal({ open, goal, onClose, onUploaded }) {
  const [file, setFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Reset all modal state when it's closed so a reopen starts clean.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) {
      setFile(null);
      setError(null);
      setResult(null);
      setSubmitting(false);
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
    setResult(null);
    if (!f) {
      setFile(null);
      return;
    }
    if (f.type && !ALLOWED.includes(f.type)) {
      setError(`Unsupported file type: ${f.type}`);
      setFile(null);
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      setError("File too large (max 10 MB).");
      setFile(null);
      return;
    }
    setFile(f);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (!file) return setError("Pick a photo first.");
    if (!goal?.id) return setError("Missing goal id.");

    const fd = new FormData();
    fd.append("file", file);
    fd.append("goalId", goal.id);

    setSubmitting(true);
    try {
      // Ask for live GPS while we prepare the request. If the user
      // denies/times out, we just submit without it — EXIF may still
      // work, and if it doesn't the backend returns a clear error.
      const loc = await getBrowserLocation();
      if (loc) {
        fd.append("clientLat", String(loc.lat));
        fd.append("clientLng", String(loc.lng));
        if (loc.accuracy !== null)
          fd.append("clientAccuracy", String(loc.accuracy));
        fd.append("clientCapturedAt", new Date().toISOString());
      }

      const res = await api.uploadProof(fd);
      setResult(res);
      onUploaded?.(res);
    } catch (err) {
      setError(err.message || "Upload failed");
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

          {error && <div className="error-banner">{error}</div>}

          {result && (
            <div
              className={`result-banner ${
                verdict === "verified" ? "ok" : "bad"
              }`}
            >
              <div className="result-title">
                {verdict === "verified" ? "✓ Verified" : "✗ Rejected"}
              </div>
              <div className="muted small">
                {REASON_COPY[result.verification?.reason] ||
                  result.verification?.reason ||
                  "(no reason)"}
              </div>
              {typeof result.verification?.distanceMeters === "number" && (
                <div className="muted small">
                  distance: {Math.round(result.verification.distanceMeters)} m
                </div>
              )}
              {result.resolution?.status && (
                <div className="small" style={{ marginTop: 6 }}>
                  Goal auto-resolved to{" "}
                  <strong>{result.resolution.status}</strong>
                </div>
              )}
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
          )}

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
