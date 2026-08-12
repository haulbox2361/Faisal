# HaulBoX Backend

Node/Express backend for the HaulBoX Dispatch Command frontend. It handles:

- **Login** — real "Sign in with Google" via OAuth, in a popup. Only one Google account (`ADMIN_EMAIL`) is ever allowed to sign in as Admin; everyone else must be added as a Dispatcher under their exact Gmail address from Settings — sign-in checks the email Google returns against that fixed Admin email and every registered dispatcher email, and takes a match straight to that person's own dashboard. No match → Access Denied. (The matching logic lives in the frontend; this backend runs the OAuth round trip, serves the fixed Admin email via `/api/config`, and remembers who's connected.)
- **App data** — loads, drivers, brokers, dispatchers, settings, chat, email logs — stored in **Supabase Postgres**, shared live across the Admin and every dispatcher (see `lib/db.js`, `lib/kvstore.js`, `routes/storage.js`).
- **Gmail** — sending RC/BOL/POD/package emails, and Reply-All within an existing broker thread.
- **Drive** — uploading the zipped document package for a load.

The frontend (`public/index.html`) is served by this same server, same-origin, so no CORS setup or base URL is needed — everything is relative paths (`/auth/...`, `/api/...`).

- **Driver mobile portal** — each driver signs in on their phone with just a **Driver ID + PIN** (no Google account needed), at `https://your-app-url/?driver=1`. Set/regenerate their Driver ID and PIN from Admin → Drivers → edit a driver → "Driver App Login", then tap **Copy Login Info** to text them the link + credentials. They only ever see their own loads, route, dates, and pay — never other drivers' pay, broker rates, or dispatch revenue — and can upload BOL, POD, pickup/drop-off photos, and extra documents for their own loads. This is handled by `routes/driver.js`, which is intentionally kept separate from `routes/storage.js`: it only ever reads/writes the one driver's own record and loads, never hands the whole company data blob to the browser.

> **Just want to try the app without setting up Google OAuth or Supabase yet?** The login screen has a **Demo Mode** — "Continue as Admin (Demo)" or pick a dispatcher — that skips Google entirely. It still needs `DATABASE_URL` set (Step 0 below) since that's where the demo data lives too. Everything works except Gmail send/reply and "Save to Drive".

## 0. Create a Supabase database

1. Go to [supabase.com](https://supabase.com), create a free project.
2. **Project Settings → Database → Connection string → URI** — copy the **Session pooler** connection string (port `6543`; it works better than the direct connection from hosts like Render that don't support IPv6-only routes). It looks like:
   ```
   postgresql://postgres.xxxxxxxxxxxx:[YOUR-PASSWORD]@aws-0-xx-xxxx-1.pooler.supabase.com:6543/postgres
   ```
3. Paste it into `.env` as `DATABASE_URL` (Step 2 below). The two tables the app needs (`kv_store` for app data, `google_tokens` for connected Google accounts) are created automatically on first run — no manual SQL needed.

## 1. Create Google OAuth credentials

You need your own Google Cloud project — there's no way around this step, since Google requires every app to have its own registered OAuth client.

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create (or pick) a project.
2. **APIs & Services → Library** — enable:
   - **Gmail API**
   - **Google Drive API**
3. **APIs & Services → OAuth consent screen**
   - User type: **External** is fine for a small team (add each dispatcher's Google email under "Test users" while the app is in "Testing" status, or publish it if you don't want that limit).
   - Add the scopes: `.../auth/gmail.send`, `.../auth/gmail.readonly`, `.../auth/drive.file`, plus `openid`, `email`, `profile`.
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
   - Application type: **Web application**
   - Authorized redirect URI: `http://localhost:3000/auth/google/callback` (adjust host/port if you deploy elsewhere — it must match `GOOGLE_REDIRECT_URI` in `.env` exactly, including the path)
5. Copy the generated **Client ID** and **Client Secret**.

## 2. Configure the backend

```bash
cp .env.example .env
```

Fill in `.env`:

```
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback
SESSION_SECRET=any-long-random-string
ADMIN_EMAIL=Faisaljoyia320@gmail.com
DATABASE_URL=postgresql://postgres.xxxx:[PASSWORD]@aws-0-xx-xxxx-1.pooler.supabase.com:6543/postgres
PORT=3000
```

## 3. Install and run

```bash
npm install
npm start
```

Then open **http://localhost:3000** — you'll land on the real HaulBoX login screen.

## 4. Admin sign-in and adding dispatchers

Only the Google account in `ADMIN_EMAIL` (`Faisaljoyia320@gmail.com` by default — change it in `.env` / your Render env vars if you ever need a different Admin account) can ever sign in as Admin. No bootstrap step, no "first person in wins" — the check is server-side (`GET /api/config`), so it can't be spoofed from the browser.

1. Sign in with **exactly** that Google account — you'll land straight in the Admin dashboard.
2. From Settings → Dispatchers, add your team's Google account emails as dispatchers.
3. Share the URL — each dispatcher signs in with their own Google account; if it matches a registered dispatcher email, they go straight to their own dashboard. Anyone whose email isn't the Admin email or a registered dispatcher gets an "Access Denied" screen instead of getting in.

## How the pieces fit together

| Frontend call | Backend route | What it does |
|---|---|---|
| `openGoogleOAuthPopup(accountId)` → opens `/auth/google?accountId=...` | `GET /auth/google` | Redirects to Google's consent screen |
| — | `GET /auth/google/callback` | Exchanges the code for tokens, looks up the signed-in email, stores both under `accountId`, then `postMessage`s `{type:'google-auth-success', accountId, email}` back to the opener and closes the popup |
| `backendFetch('/auth/claim', ...)` | `POST /auth/claim` | Re-keys stored tokens from the throwaway popup id to the real `'admin'` or dispatcher id, once the frontend has matched the email |
| `backendFetch('/auth/status?accountId=...')` | `GET /auth/status` | `{connected, email}` for a given account |
| `backendFetch('/auth/disconnect', ...)` | `POST /auth/disconnect` | Revokes + forgets a connected account |
| `backendFetch('/api/send-email', ...)` | `POST /api/send-email` | Sends an email via Gmail as the connected account |
| `backendFetch('/api/reply-all', ...)` | `POST /api/reply-all` | Sends a threaded reply (with Cc, In-Reply-To, References) into an existing Gmail thread |
| `backendFetch('/api/thread/:id?accountId=...')` | `GET /api/thread/:id` | Reads a thread's subject / last Message-ID / References / Cc, so replies thread correctly even if the frontend's cached copy is stale |
| `backendFetch('/api/drive-upload', ...)` | `POST /api/drive-upload` | Uploads a base64 file (the zipped load package) to the connected account's Google Drive |

Connected accounts are stored in the Supabase `google_tokens` table (created automatically on first run). Delete an entry (or use Settings → My Account → Disconnect in the app) to force a reconnect.

## Deploying to Render

1. Push this repo to GitHub (or GitLab/Bitbucket).
2. In Render, **New → Web Service**, connect the repo. Render auto-detects `render.yaml` — or set it manually: Build command `npm install`, Start command `npm start`. (Node's `PORT` env var is set automatically by Render — the app already reads `process.env.PORT`, no changes needed.)
3. Add the environment variables from `.env.example` in the Render dashboard: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `SESSION_SECRET`, `ADMIN_EMAIL`, `DATABASE_URL`.
4. Deploy. Once it's live, copy the Render URL (e.g. `https://haulbox.onrender.com`) and:
   - Set `GOOGLE_REDIRECT_URI` to `https://haulbox.onrender.com/auth/google/callback` (update it in Render's env vars).
   - In Google Cloud Console → your OAuth client → add that same URL as an **Authorized redirect URI**.
   - Redeploy (or just restart the service) so the new `GOOGLE_REDIRECT_URI` takes effect.
5. Open the Render URL and sign in with `Faisaljoyia320@gmail.com` (or whatever `ADMIN_EMAIL` is set to) — that's Admin. Add dispatchers from Settings.

> Render's free plan spins the service down after inactivity — the first request after a while takes ~30–50s to wake back up. Data isn't affected either way since everything lives in Supabase, not on Render's disk.

## Driver Pay — lease settlements (Admin only)

Drivers are leased on: each one is paid a fixed **percentage of the gross (broker rate)** of every load they run. That whole side of the business lives on the new **Driver Pay** page in the sidebar, which only ever appears for Admin — the nav item is hidden for dispatchers and view-only links, and `switchView` blocks the route server-of-truth side too, so none of these numbers reach a dispatcher's dashboard, load detail, or export.

- **Driver record** — new *Driver Pay % (Lease)* field on each driver (Admin-only field in the Add/Edit Driver modal, plus an Admin-only column on the Drivers table). Defaults come from **Settings → Default Driver Pay % (Lease)**.
- **Booking a load** — the driver's percentage is auto-filled on the Add Load form and **snapshotted onto the load** (`driverPayPct`), so raising or lowering a driver's percentage later never rewrites what they were already owed on past loads. The form also previews *Driver Pay* and *Company Margin* (both Admin-only fields).
- **Load detail** — an Admin-only *Driver Pay — Lease* block: pay %, driver pay, an editable **deduction** (advances, escrow, fuel, damage), net due, company margin, a Paid/Unpaid toggle and a free-text settlement note.
- **Driver Pay page** — filter by driver, date range (delivery date), and settlement status (*ready to pay*, *unpaid*, *paid*, *all*); summary cards for gross / driver pay / company margin / still owed; a per-driver settlement summary; and a load-by-load table with inline deductions and Paid toggles.
- **Settling up** — *Mark All Filtered Paid* settles a whole batch at once and stamps the paid date. Exports: **CSV**, **Excel**, and a per-driver **Statement** CSV (same filters, with a totals row) you can hand straight to the driver.

Existing data is migrated automatically on load — every driver without a percentage gets the company default, and every past load is backfilled with its driver's percentage and marked unpaid until you settle it.

## Driver App Backend (transactions, chat, notifications, history, docs)

Beyond the mobile driver portal described above, the backend now has the
full REST surface a real driver mobile app (e.g. Flutter) needs, without
changing anything the existing dispatch web app or web-based driver portal
already rely on.

**New tables** (auto-created on first run, same as `kv_store`/`google_tokens`):
`load_history`, `notifications`, `conversations`, `messages`, `driver_sessions`, `audit_logs`.

**Sessions.** `POST /api/driver/login` now also returns a `token` — a
Bearer session token (30-day expiry, stored in `driver_sessions`) so the
app never has to store or resend the driver's PIN. Send it as
`Authorization: Bearer <token>` on every other `/api/driver/...` call.
`POST /api/driver/logout` revokes it. The two legacy endpoints
(`/api/driver/doc`, `/api/driver/upload-doc`) still also accept
`driverId`+`pin` in the body directly, since that's what the existing
`?driver=1` web portal in `public/index.html` sends — nothing there needed
to change.

**Permissions.** Each driver record can carry a `permissions` object
(`canViewLoads`, `canUpdateLoadStatus`, `canUploadDocuments`,
`canViewTransactions`, `canChat`, `canUpdateProfile`, `canEditOwnDocuments`).
Everything defaults to `true` except `canEditOwnDocuments` (Admin-only by
default, per spec). The backend enforces these on every route — there's no
Admin UI to edit them yet, but any value set directly on the driver record
in `kv_store` takes effect immediately.

**Endpoints added:**

| Route | What it does |
|---|---|
| `GET /api/driver/me` | Profile + effective permissions |
| `GET /api/driver/dashboard` | Current load + active/completed/pending-payment/earnings summary |
| `GET /api/driver/loads?filter=active\|completed\|all` | This driver's loads |
| `GET /api/driver/loads/:id` | One load, driver-shaped |
| `GET /api/driver/loads/:id/history` | Timeline for that load |
| `POST /api/driver/loads/:id/status` | Driver checkpoint (`ACCEPTED`/`AT_PICKUP`/`IN_TRANSIT`/`AT_DELIVERY`) — written to a separate `driverProgress` field, never overwrites dispatch's own `status` |
| `GET /api/driver/transactions` | Own pay records, derived from each load's `driverPay`/`driverPaid` (same numbers as Admin's Driver Pay page, scoped to one driver) |
| `GET /api/driver/transactions/:loadId` | One transaction |
| `GET /api/driver/documents` / `POST /api/driver/documents` | Own profile documents (license, insurance, medical card, registration) with expiry flags; write requires `canEditOwnDocuments` |
| `GET /api/driver/notifications` / `POST /api/driver/notifications/:id/read` | Notification center |
| `GET /api/driver/chats`, `POST /api/driver/chats/start`, `GET/POST /api/driver/chats/:id/messages` | Chat, restricted to `driver.allowedContacts` (defaults to Admin only) |

**Admin/Dispatcher side** (`routes/chat.js`, `routes/notifications.js`) —
same conversations/messages/notifications tables, addressed the same way
Google auth already addresses accounts (`accountId` + `role`), so a
dispatcher can message a driver and see the reply, and either side can push
a notification (e.g. an ETA change) to the other.

**Audit log.** `audit_logs` records driver logins, permission-gated document
edits, etc. Insert-only, no read endpoint yet — meant for direct DB review.

**Not built yet (frontend work, next phase):** an Admin UI to edit driver
permissions/`allowedContacts`, wiring the dispatch app's own ETA-change flow
to actually call `POST /api/notifications`, and the Flutter driver app
itself.

## Notes / limitations

- The OAuth consent screen will show Google's "unverified app" warning until you submit the app for verification — normal for internal tools, just click through "Advanced → Go to (app name)" as the test user.
- Refresh tokens are only issued the *first* time a given Google account grants consent with `prompt=consent` (which this backend always requests, so re-connecting always yields a fresh one) — if you ever see "invalid_grant" errors, disconnect and reconnect that account.
- App data (loads, drivers, brokers, dispatchers, settings, chat) all lives in one Supabase table (`kv_store`) as a single JSON blob under the key `haulline:state` — fine for one small dispatch team; if you outgrow that, `lib/kvstore.js` is the one place to swap for proper relational tables.
