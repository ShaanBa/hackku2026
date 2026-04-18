# Backend integration summary

This document describes the backend work merged on the `integration` branch so the team can build the UI and demo flows without guessing at APIs or env vars. It aligns with `SCHEMA.md` (especially Option B: charity as escrow destination).

## Goals of the change

- Unblock frontend: stable request/response shapes for users, goals, proofs, resolve, and refund.
- Match the product model: show-up goals with location + time window, proof verification from EXIF, XRPL escrow with stakes going to a preset charity on failure.
- Single place for on-chain resolution logic (`lib/resolve.js`) so manual and automatic paths stay consistent.

## Environment variables

| Variable | Role |
|----------|------|
| `MONGODB_URI` | MongoDB connection (required). |
| `USER_WALLET_SEED` | Shared test user wallet; used to derive `walletAddress` for `/api/users/create`, to sign `EscrowCreate` and `EscrowCancel`, and as `ownerAddress` on goals. |
| `POT_WALLET_SEED` | Pot wallet; signs `EscrowFinish` when a goal **fails** so funds move per escrow rules. |
| `XRPL_POT_WALLET_ADDRESS` | Pot’s classic address (reference / debugging). |
| `XRPL_CHARITY_ADDRESS` | Charity’s classic address; used as the on-chain escrow **Destination** (Option B). Until you use a second testnet wallet, it may match the pot address and still work. |

See `.env.example` for placeholders. Local secrets stay in `.env.local` (gitignored).

## New and updated libraries

| Path | Purpose |
|------|---------|
| `lib/charities.js` | Preset charities (`id`, `name`, `description`, `address`). `charityId` on goal create must match one of these ids. |
| `lib/verification.js` | Haversine distance and `verifyProof(goal, proof)` (geofence + time window for `single` goals). |
| `lib/resolve.js` | `resolveGoal(goalId, outcome, triggeredBy)` — updates Mongo; on `failed`, calls XRPL `finishEscrow`; on `succeeded`, only DB (refund is separate). Idempotent if goal is no longer `active`. |
| `lib/xrpl.ts` | `CreateEscrowParams` now uses `destinationAddress` (charity), not `potAddress`. |
| `types/index.ts` | Same rename for TypeScript types. |

## Dependencies

- **`exifr`** — server-side EXIF parsing in proof upload (GPS + capture time).

## API routes (behavior overview)

### `POST /api/users/create`

- Body: `{ "email": "..." }` only.
- **Server derives** `walletAddress` from `USER_WALLET_SEED`. Any client-supplied wallet field is ignored.

### `POST /api/goals/create`

- Requires: `userId`, `title`, `stakeAmount`, `type` (must be `"single"` for now), `location` (`lat`, `lng`, optional `name`, `radiusMeters`), `target` for singles (`targetAt`, optional `windowMinutes`), `charityId` (must match `lib/charities.js`).
- Computes **`deadline` = `targetAt` + 24h** (used as escrow cancel horizon, not the “show up” judgment window).
- Creates XRPL escrow with **Destination = charity address**; persists `escrow.sequence`, `escrow.createTxHash`, `escrow.destinationAddress`, `ownerAddress`, `status: "active"`, `escrowState: "locked"`, plus embedded `charity` snapshot.

### `GET /api/goals/user/[userId]`

- Returns goals with the full projection: `type`, `location`, `target`, `charity`, `ownerAddress`, `escrow`, `escrowState`, `resolvedAt`, `resolvedBy`, etc.

### `POST /api/goals/resolve`

- Body: `{ "goalId": "...", "outcome": "succeeded" | "failed" }` (also accepts legacy `"success"` / `"fail"`).
- Delegates to `resolveGoal`. **Failed** path submits **EscrowFinish** and sets `escrowState: "finished"` and `escrow.finishTxHash` when successful.

### `POST /api/proofs/upload`

- Preferred: **`multipart/form-data`** with `goalId`, `userId`, and `file` (image).
- Parses EXIF for GPS and capture time; runs `verifyProof`; stores `verification.{status,reason,checkedAt,distanceMeters}`.
- For **`single`** goals that are still **`active`**, a **verified** proof triggers auto-resolve to **`succeeded`** via `resolveGoal`.
- **Legacy:** `application/json` with `imageUrl` still accepted; without EXIF, verification typically ends as `rejected` (`no_exif_gps` / `no_exif_time`).

### `POST /api/goals/refund` (new)

- Body: `{ "goalId": "..." }`.
- Only when `status === "succeeded"` and current time **≥ `deadline`**, submits **EscrowCancel** with the user seed and updates `escrowState: "cancelled"` and `escrow.cancelTxHash`.
- Returns **400** with `cancellableAt` if tried too early.

## XRPL flow (short)

1. **Create goal** — User signs `EscrowCreate`; funds lock; **Destination** is the charity address (Option B).
2. **Fail (manual or future cron)** — Pot signs `EscrowFinish`; stake moves to **Destination** (charity).
3. **Succeed** — DB only until user claims: after **deadline**, user calls **refund** → `EscrowCancel` returns escrowed XRP to the owner.

## Smoke checks that were run

- User create with derived wallet.
- Goal create with new fields + on-chain escrow + Mongo write.
- List goals with full fields.
- Manual `failed` resolve → `finishTxHash` present, `escrowState: "finished"`.
- Manual `succeeded` resolve → no finish tx, status updated.
- Refund before deadline → rejected with `cancellableAt`.
- Legacy JSON proof → rejected verification when no GPS.

## Known limitations (not blocking a hackathon demo)

- **`type: "recurring"`** is rejected until that path is implemented.
- **No cron** yet for auto-failing goals that never get a proof or manual resolve; use `POST /api/goals/resolve` for demos.
- **Proof images** are written under `public/uploads/` locally; not ideal for serverless hosting without switching to object storage.
- **Charity address** may equal pot on testnet until you assign a separate `XRPL_CHARITY_ADDRESS`.

## Git

- Changes were committed and pushed to **`origin/integration`** (commit message starts with `feat(backend): wire charity payouts, EXIF verification, refund flow`).

For field-level schema detail, keep using **`SCHEMA.md`** as the source of truth.
