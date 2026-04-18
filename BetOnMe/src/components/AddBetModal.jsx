import { useEffect, useState } from "react";
import api from "../lib/api";
import MapPicker from "./MapPicker";
import "./AddBetModal.css";

// Default center: University of Kansas rec center. Users pick on the map.
const DEFAULT_LAT = 38.9543;
const DEFAULT_LNG = -95.2535;

function toDatetimeLocalValue(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function AddBetModal({ open, onClose, onCreated }) {
  const [charities, setCharities] = useState([]);
  const [form, setForm] = useState(() => {
    const start = new Date(Date.now() + 60 * 60 * 1000); // +1h
    return {
      title: "",
      stake: "2",
      targetAt: toDatetimeLocalValue(start),
      windowMinutes: 30,
      locationName: "",
      lat: DEFAULT_LAT,
      lng: DEFAULT_LNG,
      radiusMeters: 75,
      charityId: "redcross",
    };
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    api
      .charities()
      .then((res) => setCharities(res.charities || []))
      .catch(() => setCharities([]));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  function update(patch) {
    setForm((f) => ({ ...f, ...patch }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    const stakeNum = Number(form.stake);
    if (!form.title.trim()) return setError("Goal title is required");
    if (!Number.isFinite(stakeNum) || stakeNum <= 0)
      return setError("Stake must be a positive number of XRP");
    if (!form.targetAt) return setError("Target time is required");

    const targetDate = new Date(form.targetAt);
    if (Number.isNaN(targetDate.getTime()))
      return setError("Target time is invalid");

    const payload = {
      title: form.title.trim(),
      stakeAmount: stakeNum,
      type: "single",
      charityId: form.charityId,
      location: {
        name: form.locationName.trim() || null,
        lat: Number(form.lat),
        lng: Number(form.lng),
        radiusMeters: Number(form.radiusMeters) || 75,
      },
      target: {
        targetAt: targetDate.toISOString(),
        windowMinutes: Number(form.windowMinutes) || 30,
      },
    };

    setSubmitting(true);
    try {
      const res = await api.createGoal(payload);
      onCreated?.(res);
      onClose?.();
    } catch (err) {
      setError(err.message || "Failed to create goal");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Add Bet</h2>
          <button className="btn btn-ghost" onClick={onClose}>
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-form">
          <div className="form-row">
            <label className="label" htmlFor="title">
              Goal
            </label>
            <input
              id="title"
              className="input"
              placeholder="e.g. Go to the gym"
              value={form.title}
              onChange={(e) => update({ title: e.target.value })}
            />
          </div>

          <div className="form-grid">
            <div className="form-row">
              <label className="label">Target time</label>
              <input
                type="datetime-local"
                className="input"
                value={form.targetAt}
                onChange={(e) => update({ targetAt: e.target.value })}
              />
            </div>

            <div className="form-row">
              <label className="label">Window (± minutes)</label>
              <input
                type="number"
                min="5"
                max="240"
                className="input"
                value={form.windowMinutes}
                onChange={(e) => update({ windowMinutes: e.target.value })}
              />
            </div>
          </div>

          <div className="form-grid">
            <div className="form-row">
              <label className="label">Amount (XRP)</label>
              <input
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                className="input"
                value={form.stake}
                onChange={(e) => update({ stake: e.target.value })}
              />
            </div>

            <div className="form-row">
              <label className="label">Charity (on fail)</label>
              <select
                className="select"
                value={form.charityId}
                onChange={(e) => update({ charityId: e.target.value })}
              >
                {charities.length === 0 ? (
                  <option value="redcross">American Red Cross</option>
                ) : (
                  charities.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>

          <hr />

          <div className="form-row">
            <label className="label">Location name (optional)</label>
            <input
              className="input"
              placeholder="e.g. Gym"
              value={form.locationName}
              onChange={(e) => update({ locationName: e.target.value })}
            />
          </div>

          <div className="form-row">
            <label className="label">Pick location on map</label>
            <MapPicker
              value={{ lat: Number(form.lat), lng: Number(form.lng) }}
              radiusMeters={Number(form.radiusMeters) || 75}
              onChange={({ lat, lng }) => update({ lat, lng })}
            />
          </div>

          <div className="form-row">
            <label className="label">
              Check-in radius: {form.radiusMeters} m
            </label>
            <input
              type="range"
              min="20"
              max="500"
              step="5"
              className="range"
              value={form.radiusMeters}
              onChange={(e) => update({ radiusMeters: Number(e.target.value) })}
            />
          </div>

          {error && <div className="error-banner">{error}</div>}

          <div className="modal-actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? "Creating…" : "Add bet"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default AddBetModal;
