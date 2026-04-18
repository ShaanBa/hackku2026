# Database Schema — hackku2026

> Source of truth for MongoDB collections used by this app.  
> If the code and this file disagree, **update this file in the same PR**.

Database name: `app` (override with `MONGODB_DB`).  
All collections live in the `app` database. `test-db` pings the `admin` DB only for
health checks — no data is stored there.

---

## Product Model (read this first)

The app is a **personal show-up accountability** tool backed by XRP escrow.

- A user sets a **show-up goal**: "go to Gym X" either as a one-off at a specific
  time (`single`) or a count inside a window (`recurring`, e.g. "5 sessions this
  week at Gym X").
- The user **stakes XRP** into an XRPL escrow for the duration of the goal.
- When the user visits the location, the app **prompts for a selfie**. The
  selfie's **EXIF metadata** (GPS coordinates + capture timestamp) is the
  verification signal — did they show up at the right place at the right time?
- At resolution time the server **auto-judges** from verified proofs:
  - `single` — did any proof fall inside the target geofence within the target
    time window?
  - `recurring` — did the user accumulate `requiredCount` verified proofs
    before `deadline` (respecting spacing rules, e.g. one per day)?
- Outcomes map to XRPL actions:
  - **Succeeded** → nothing happens on-chain yet → user calls `EscrowCancel`
    after `CancelAfter` (the goal deadline) and gets their stake back.
  - **Failed** → server calls `EscrowFinish` before `CancelAfter` → stake
    is forfeited to the **charity the user chose at goal creation**.

### Fail → charity payout

✅ **DECIDED: Option B — charity is the direct Destination of the escrow.**

At goal creation, the escrow's `Destination` is set to the user's chosen
charity address (frozen per goal). On fail, the pot wallet signs and submits
a single `EscrowFinish` transaction — funds move **user → charity atomically**
without ever touching the pot balance. The app therefore cannot intercept
stakes, which is both technically cleaner and a strong narrative.

**Required code changes in `lib/xrpl.ts`:**

1. Rename `CreateEscrowParams.potAddress` → `destinationAddress`.
2. Pass `goal.charity.address` as the destination when calling `createEscrow`.
3. `finishEscrow` already works unchanged — it doesn't care who `Destination` is.

The pot wallet (`POT_WALLET_SEED`) stays as the **signer/fee-payer** for all
`EscrowFinish` transactions. It needs a small XRP balance for fees but never
receives user stakes.

### On-chain timing reality (important for product decisions)

`createEscrow` in `lib/xrpl.ts` sets:

- `FinishAfter` = now + 5s  (pot can slash anytime from then on).
- `CancelAfter` = `goal.deadline`  (user can refund from then on).

Consequence: **a successful user cannot refund their stake until `deadline`
passes**, even if they succeeded early. Pick `deadline` thoughtfully:

- Single same-day goal → `deadline` should be end-of-day (or +24h), not the
  appointment time itself. Otherwise the refund window opens the same moment
  the "you missed it" slash window opens.
- Recurring weekly goal → natural fit; `deadline` = end of week.

---

## Collections

### `users`

| Field           | Type      | Required | Notes                                                                                 |
| --------------- | --------- | -------- | ------------------------------------------------------------------------------------- |
| `_id`           | ObjectId  | yes      | Mongo-assigned.                                                                       |
| `username`      | string    | yes      | Lowercased, 3–32 chars, `[a-zA-Z0-9_]`. **Unique index.** Used for login.             |
| `displayName`   | string    | yes      | 1–50 chars. Rendered in the app.                                                      |
| `passwordHash`  | string    | yes      | bcrypt hash. **Never returned by any API.**                                           |
| `email`         | string    | no       | Lowercased if present. Unique *only when set* (partial unique index).                 |
| `walletAddress` | string    | yes      | Derived server-side from `USER_WALLET_SEED` (all users share one wallet for now).     |
| `createdAt`     | Date      | yes      | Set by server.                                                                        |

**Indexes**
- `{ username: 1 }` unique (created lazily in `POST /api/auth/register`).
- `{ email: 1 }` unique, partial filter `{ email: { $type: "string" } }` (created lazily).

**Writers / Readers**
- Write: `POST /api/auth/register` (previously `POST /api/users/create`, now deprecated/410).
- Read:  `GET /api/auth/me`, session lookup in every authenticated route.

**Auth flow (sessions)**

- `POST /api/auth/register` — creates user, sets `hk_session` cookie.
- `POST /api/auth/login` — verifies `{username, password}`, sets cookie.
- `POST /api/auth/logout` — clears cookie.
- `GET /api/auth/me` — returns current user or `{ user: null }`.

The cookie is an HMAC-signed `base64url(payload).base64url(sig)` blob holding
`{ userId, username, iat, exp }`. It's `httpOnly`, `SameSite=Lax`, 7-day TTL,
and signed with `SESSION_SECRET`. Any authenticated API route reads it via
`lib/auth.js#getSessionUser(request)` and refuses with **401** if absent/invalid.

---

### `goals`

| Field                  | Type      | Required | Notes                                                    |
| ---------------------- | --------- | -------- | -------------------------------------------------------- |
| `_id`                  | ObjectId  | yes      |                                                          |
| `userId`               | ObjectId  | yes      | Ref → `users._id`. **Indexed.**                          |
| `title`                | string    | yes      | Trimmed.                                                 |
| `stakeAmount`          | number    | yes      | **Units: XRP** (e.g. `1.5`). Converted to drops in XRPL layer. |
| `deadline`             | Date      | yes      | ISO 8601 on the wire. Stored as BSON Date.              |
| `status`               | string    | yes      | Business state (#5): `"active" \| "succeeded" \| "failed"`. |
| `createdAt`            | Date      | yes      |                                                          |
| `escrow`                    | object    | yes¹     | **New (integration branch)** — set at goal creation.     |
| `escrow.sequence`           | number    | yes¹     | XRPL `OfferSequence` — required for finish/cancel.       |
| `escrow.createTxHash`       | string    | yes¹     | Hex tx hash of the `EscrowCreate`.                       |
| `escrow.destinationAddress` | string    | yes¹     | Charity XRPL address (Option B — see Product Model).     |
| `escrow.finishTxHash`       | string?   | no       | Set when pot submits `EscrowFinish` on fail (#7).        |
| `escrow.cancelTxHash`       | string?   | no       | Set when user submits `EscrowCancel` on refund (#7).     |
| `escrowState`               | string    | yes      | On-chain lifecycle: `"locked" \| "finished" \| "cancelled"` (#5). Starts `"locked"`. |
| `resolvedAt`                | Date?     | no       | Timestamp of the last `status` change (#7).              |
| `resolvedBy`                | string    | no       | `"user" \| "system"` or a user `ObjectId` (#7).          |

¹ Required for all goals created on or after the `integration` branch. Pre-existing
goals from Alex's original branch do not have this subdocument.

**Indexes**
- `{ userId: 1 }` (created lazily in `POST /api/goals/create`).
- `{ userId: 1, status: 1 }` compound — per decision #8, for fast "any active
  goal?" lookups and the history UI. To be added when the create route is
  updated.

**Writers / Readers**
- Write: `POST /api/goals/create`, `POST /api/goals/resolve`
- Read:  `GET /api/goals/user/[userId]`, `POST /api/proofs/upload` (ownership check)

**Important:** `GET /api/goals/user/[userId]` currently **does not project the
`escrow` subdocument** in its response. Per decision #6/#7, it must return
`escrowState` and `escrow.sequence` at minimum so the UI can trigger refunds
and render history.

#### Proposed additions (to support the real product)

The current `goals` schema cannot represent a show-up goal — no location, no
target time, no cadence. These are the fields the product needs:

| Field                   | Type                                              | Notes                                                         |
| ----------------------- | ------------------------------------------------- | ------------------------------------------------------------- |
| `type`                  | `"single" \| "recurring"`                         | Decides resolution logic.                                     |
| `location.name`         | string                                            | Display name, e.g. "LA Fitness — Westside".                   |
| `location.lat`          | number                                            | Degrees, WGS84.                                               |
| `location.lng`          | number                                            | Degrees, WGS84.                                               |
| `location.radiusMeters` | number                                            | Acceptable geofence radius (e.g. 50).                         |
| `target.targetAt`       | Date                                              | `single` only — the appointment time.                         |
| `target.windowMinutes`  | number                                            | `single` only — ± minutes around `targetAt` that count.       |
| `target.startAt`        | Date                                              | `recurring` only — window start.                              |
| `target.endAt`          | Date                                              | `recurring` only — window end (also typically `deadline`).    |
| `target.requiredCount`  | number                                            | `recurring` only — e.g. 5 sessions.                           |
| `target.minSpacingHours`| number                                            | `recurring` only — prevents 5 proofs in one hour. Optional.   |
| `progress.completedCount` | number                                          | `recurring` only — cached count of verified proofs. Optional. |
| `ownerAddress`          | string                                            | User's XRPL address at create time (needed by `cancelEscrow`).|
| `charity.name`          | string                                            | Display name, e.g. "Red Cross".                               |
| `charity.address`       | string                                            | XRPL address. Frozen at create time — cannot change later.    |

Without `type`, `location`, and `target.*`, the resolve route cannot decide
success/failure automatically — it can only take a human's word for it.

---

### `proofs`

| Field       | Type      | Required | Notes                                 |
| ----------- | --------- | -------- | ------------------------------------- |
| `_id`       | ObjectId  | yes      |                                       |
| `goalId`    | ObjectId  | yes      | Ref → `goals._id`. **Indexed.**       |
| `userId`    | ObjectId  | yes      | Ref → `users._id`.                    |
| `imageUrl`  | string    | yes      | Must be `http://` or `https://`.      |
| `createdAt` | Date      | yes      |                                       |

**Indexes**
- `{ goalId: 1 }` (created lazily in `POST /api/proofs/upload`).

**Writers / Readers**
- Write: `POST /api/proofs/upload`
- Read:  (none yet — feature still TBD)

#### Proposed additions (to support the real product)

Verification is the whole point of this collection, so it needs structured
fields, not just a URL.

| Field                         | Type                                             | Notes                                                     |
| ----------------------------- | ------------------------------------------------ | --------------------------------------------------------- |
| `capturedAt`                  | Date                                             | Parsed from EXIF `DateTimeOriginal`. Authoritative time.  |
| `gps.lat`                     | number                                           | Parsed from EXIF GPS tags.                                |
| `gps.lng`                     | number                                           |                                                           |
| `gps.accuracyMeters`          | number                                           | If provided by the capture device.                        |
| `verification.status`         | `"pending" \| "verified" \| "rejected"`          | Default `pending` on upload.                              |
| `verification.reason`         | string                                           | e.g. `"outside_geofence"`, `"outside_time_window"`, `"no_exif_gps"`, `"ok"`. |
| `verification.checkedAt`      | Date                                             | When the server judged it.                                |
| `verification.distanceMeters` | number                                           | Distance from goal location at capture time. For audit.   |

**Upload flow (proposed):** client sends the image; server strips EXIF,
persists `imageUrl` + `capturedAt` + `gps.*`, then runs the verification check
inline (does it fall in the goal's geofence + time window?) and writes
`verification.status` before returning. For `recurring` goals, if the status
becomes `verified`, also bump `goal.progress.completedCount`.

---

## Conventions

- **IDs.** All cross-collection references are stored as BSON `ObjectId`, not
  strings. API responses convert to string via `.toString()`. Query inputs
  must be validated with `ObjectId.isValid(...)` before casting.
- **Dates.** Stored as BSON `Date`. Serialized as ISO 8601 (`toISOString()`).
  Never store a Unix timestamp number in Mongo.
- **Money units.** `stakeAmount` is **XRP** (floating point). Never drops. The
  conversion to drops happens inside `lib/xrpl.ts` via `xrpToDrops`.
- **XRPL epoch.** `FinishAfter` / `CancelAfter` seconds are computed in
  `lib/xrpl.ts` (`RIPPLE_EPOCH_OFFSET`). App/DB layer always uses JS Dates.
- **Indexes.** Created lazily on first write. Fine for a hackathon; for prod,
  move to a startup/migration script.

---

## Decisions

Summary table — full rationale for each is below.

| #  | Topic                          | Decision                                                                 |
| -- | ------------------------------ | ------------------------------------------------------------------------ |
| 1  | Goal types                     | Ship `single` first; `recurring` later if time permits                   |
| 2  | Location source                | Map picker at goal creation                                              |
| 3  | EXIF parsing                   | Server-side with `exifr`; reject uploads with no GPS                     |
| 4  | `walletAddress` semantics      | Server derives from `USER_WALLET_SEED` — never trust client input        |
| 5  | Status vocabulary              | Split into `status` (business) + `escrowState` (chain)                   |
| 6  | Auto-resolve vs. manual        | Auto as primary; manual route kept as escape hatch                       |
| 7  | Audit / history fields         | Yes — need to display "past bets"                                        |
| 8  | Uniqueness / throttling        | No unique indexes; add `{userId, status}` compound; app-layer spacing    |
| 9  | `ownerAddress` on goals        | Store on goal at create time (from `USER_WALLET_SEED`)                   |
| 10 | Deadline vs. target time       | For `single`, `deadline = target.targetAt + 24h` (escrow refund window)  |
| –  | Charity payout (Option A/B)    | **Option B** — charity is the direct escrow Destination                  |

### 1. Goal types — **single first**
Implement `single` end-to-end (geofence + time-window check on a single
proof). `recurring` reuses the same verification, just accumulates count
until deadline. Adds incremental.

### 2. Location source — **map picker**
Client-side map picker at goal creation sends `{lat, lng, radiusMeters}` to
the server. Default `radiusMeters = 75` to tolerate GPS drift.

### 3. EXIF handling — **server-side with `exifr`**
Client uploads the image via multipart to `/api/proofs/upload`. Server parses
EXIF so the client can't lie about GPS/time. If EXIF GPS is missing (e.g.
iOS share-sheet strip), reject with `no_exif_gps` and prompt the user to
retry via native camera capture.

### 4. `walletAddress` semantics — **server-derived**
`users.walletAddress` is derived server-side from `Wallet.fromSeed(USER_WALLET_SEED).address`.
Do not accept it from client input. For the hackathon all users share the
same seed, so all users share the same `walletAddress` (documented cosmetic
field). Migrate to per-user seeds later.

### 5. Status vocabulary — **split**
- `status: "active" | "succeeded" | "failed"` — business state.
- `escrowState: "locked" | "finished" | "cancelled"` — chain state.

Business logic stays readable; chain state can advance independently
(e.g. goal `succeeded` Tuesday → user refunds Friday → `escrowState`
becomes `cancelled`).

### 6. Auto-resolve vs. manual — **auto primary, manual as escape hatch**
The proof upload handler calls an internal helper `resolveGoal(goalId)`
whenever a verified proof lands; a cron sweeps for `deadline` expiry.
`POST /api/goals/resolve` stays as a manual override for demos or admin
intervention, calling the same helper.

### 7. Audit / history fields — **yes**
Add to `goals.escrow`:

- `finishTxHash: string` — set when the pot submits `EscrowFinish`.
- `cancelTxHash: string` — set when the user submits `EscrowCancel`.

And to `goals` top-level:

- `resolvedAt: Date` — timestamp of last status change.
- `resolvedBy: "user" | "system" | ObjectId` — who triggered it.

Required for the "past bets" history UI.

### 8. Uniqueness / throttling — **no unique constraints**
Add a compound index `{ userId: 1, status: 1 }` for fast "any active goal?"
lookups. Enforce time spacing (for `recurring`) at the app layer via
`target.minSpacingHours`, not via Mongo uniqueness.

### 9. `ownerAddress` on `goals` — **store on the goal doc**
At create time, compute `Wallet.fromSeed(USER_WALLET_SEED).address` and
copy it onto `goal.ownerAddress`. Keeps resolve self-contained and survives
later edits to the user doc.

### 10. Deadline vs. target time — **deadline = target.targetAt + 24h**
For `single` goals, the escrow's `CancelAfter` (= `deadline`) is set to
24 hours after the appointment time, not to the appointment time itself.
Judgment still happens against `target.targetAt` and `target.windowMinutes`
— `deadline` is used **only** for the escrow's refund unlock. This prevents
"you can refund the exact moment you were supposed to show up" awkwardness.

For `recurring` goals, `deadline = target.endAt` (natural fit, the week's
over anyway).

---

## Change Log

- **2026-04-18** Initial schema document. Captures state of the `integration`
  branch after merging `feat/xrpl-escrow` into `alexdatabase`. Adds
  `goals.escrow` subdocument. Flags 7 open questions for team alignment.
- **2026-04-18** Added Product Model section based on product description:
  show-up goals with EXIF-verified selfies and XRPL escrow. Added proposed
  fields on `goals` (location, target, ownerAddress, progress) and `proofs`
  (capturedAt, gps, verification) needed to support the product. Rewrote
  open questions from 7 to 10, now product-specific.
- **2026-04-18** Locked in all 10 decisions + charity payout option
  (Option B: charity is the direct escrow Destination). Converted "Open
  Questions" section into "Decisions" with a summary table. Added split
  `status` + `escrowState` fields, `escrow.{finishTxHash,cancelTxHash}`,
  `resolvedAt`, `resolvedBy`, and `{userId, status}` compound index to the
  goals collection. Implementation pending.
