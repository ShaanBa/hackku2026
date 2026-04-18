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
| `ADMIN_SECRET` | Shared secret required as the `x-admin-secret` header on admin endpoints (`/api/goals/resolve`, `/api/goals/expire`). |
| `SESSION_SECRET` | HMAC key for signed login cookies. Must be ≥ 16 chars. Rotating it logs everyone out. |

See `.env.example` for placeholders. Local secrets stay in `.env.local` (gitignored).

## New and updated libraries

| Path | Purpose |
|------|---------|
| `lib/charities.js` | Preset charities (`id`, `name`, `description`, `address`). `charityId` on goal create must match one of these ids. |
| `lib/verification.js` | Haversine distance and `verifyProof(goal, proof)` (geofence + time window for `single` goals). |
| `lib/resolve.js` | `resolveGoal(goalId, outcome, triggeredBy)` — updates Mongo; on `failed`, calls XRPL `finishEscrow`; on `succeeded`, only DB (refund is separate). Idempotent if goal is no longer `active`. |
| `lib/xrpl.ts` | `CreateEscrowParams` now uses `destinationAddress` (charity), not `potAddress`. |
| `types/index.ts` | Same rename for TypeScript types. |
| `lib/admin-auth.js` | `requireAdmin(request)` — checks `x-admin-secret` header against `ADMIN_SECRET` env. |
| `lib/auth.js` | Username/password auth: bcrypt hashing, HMAC-signed session cookie, `getSessionUser(request)` for route handlers. |

## Dependencies

- **`exifr`** — server-side EXIF parsing in proof upload (GPS + capture time).
- **`bcryptjs`** — password hashing for the username/password auth flow.

## API routes (behavior overview)

### Auth (`/api/auth/*`)

All four routes are cookie-based; the frontend must use `credentials: "include"` (or `"same-origin"`) on fetches.

#### `POST /api/auth/register`

- Body: `{ "username", "displayName", "password", "email"? }`.
- Validations: `username` 3–32 chars `[a-zA-Z0-9_]`; `displayName` 1–50 chars; `password` ≥ 8 chars; `email` optional but must be a valid format if present.
- Creates user (with bcrypt-hashed `passwordHash`, derived `walletAddress`), sets the `hk_session` cookie, returns `{ user: { id, username, displayName, email, walletAddress, createdAt } }`.
- Conflicts: 409 `"That username is already taken"` (or `email`).

#### `POST /api/auth/login`

- Body: `{ "username", "password" }`.
- On success: sets `hk_session` cookie, returns `{ user }`.
- On failure: 401 `"Invalid username or password"` (same response for "no such user" to avoid enumeration).

#### `POST /api/auth/logout`

- No body. Clears the cookie. Returns `{ ok: true }`.

#### `GET /api/auth/me`

- Always 200. Returns `{ user }` if logged in, `{ user: null }` otherwise.

### `GET /api/charities`

- Returns `{ "charities": [{ id, name, description }, ...] }`.
- No XRPL addresses in the response — use the `id` in `POST /api/goals/create`.

### `POST /api/users/create` (deprecated)

- Returns **410 Gone** with a message pointing to `POST /api/auth/register`.

### `POST /api/goals/create` (auth)

- **Auth:** requires a valid `hk_session` cookie; 401 otherwise.
- Body: `title`, `stakeAmount`, `type` (must be `"single"` for now), `location` (`lat`, `lng`, optional `name`, `radiusMeters`), `target` for singles (`targetAt`, optional `windowMinutes`), `charityId` (must match `lib/charities.js`). **`userId` is ignored** — server uses the session user.
- Computes **`deadline` = `targetAt` + 24h** (used as escrow cancel horizon, not the “show up” judgment window).
- Creates XRPL escrow with **Destination = charity address**; persists `escrow.sequence`, `escrow.createTxHash`, `escrow.destinationAddress`, `ownerAddress`, `status: "active"`, `escrowState: "locked"`, plus embedded `charity` snapshot.

### `GET /api/goals/mine` (auth)

- Convenience: returns the signed-in user's goals with the full schema projection.

### `GET /api/goals/user/[userId]` (auth)

- Same response as `/mine` but requires that `userId` matches the signed-in user. 403 otherwise.

### `POST /api/goals/resolve` (admin)

- Header: **`x-admin-secret: $ADMIN_SECRET`** required. 401 otherwise.
- Body: `{ "goalId": "...", "outcome": "succeeded" | "failed" }` (also accepts legacy `"success"` / `"fail"`).
- Delegates to `resolveGoal`. **Failed** path submits **EscrowFinish** and sets `escrowState: "finished"` and `escrow.finishTxHash` when successful. Writes `resolvedBy: "admin"`.

### `POST /api/goals/expire` (admin)

- Header: **`x-admin-secret: $ADMIN_SECRET`** required. 401 otherwise.
- No body required.
- Scans up to 200 active goals; for any single goal whose `target.targetAt + target.windowMinutes` is already past, calls `resolveGoal` with `failed` + `resolvedBy: "cron"` (so the stake moves to charity).
- Returns `{ scanned, failedCount, skippedCount, errorCount, failed[], skipped[], errors[] }` for visibility.

### `POST /api/proofs/upload` (auth)

- **Auth:** requires session cookie. The proof's `userId` comes from the session.
- Preferred: **`multipart/form-data`** with `goalId` and `file` (image).
- Size cap **10MB**; only `image/jpeg|png|webp|heic|heif` accepted. Returns 413 / 415 when violated.
- Parses EXIF for GPS and capture time; runs `verifyProof`; stores `verification.{status,reason,checkedAt,distanceMeters}`.
- For **`single`** goals that are still **`active`**, a **verified** proof triggers auto-resolve to **`succeeded`** (writes `resolvedBy: "proof"`).
- **Legacy:** `application/json` with `imageUrl` still accepted; without EXIF, verification typically ends as `rejected` (`no_exif_gps` / `no_exif_time`).

### `POST /api/goals/refund` (auth)

- **Auth:** session cookie required; the goal's `userId` must match the session user (403 otherwise).
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
- **No scheduler** runs the expire sweep automatically; hit `POST /api/goals/expire` from a cron, a button, or `curl` during demos.
- **Proof images** are written under `public/uploads/` locally; not ideal for serverless hosting without switching to object storage.
- **Charity address** may equal pot on testnet until you assign a separate `XRPL_CHARITY_ADDRESS`.
- **`ADMIN_SECRET`** is a shared constant; fine for a hackathon but not for real users.

## Git

- Changes were committed and pushed to **`origin/integration`** (commit message starts with `feat(backend): wire charity payouts, EXIF verification, refund flow`).

For field-level schema detail, keep using **`SCHEMA.md`** as the source of truth.
