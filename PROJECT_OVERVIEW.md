# 🚚 HaulBoX — Complete System Blueprint & Exhaustive Operational Manual

> **The Ultimate Guide to Understanding Every Line of Code, Feature, Workflow, Integration, and Data Flow in HaulBoX**  
> *Prepared for Developers, Operations Managers, Dispatchers, and Administrators.*

---

## 📑 Comprehensive Table of Contents
1. [Executive Summary & Core Mission](#1-executive-summary--core-mission)
2. [High-Level Architecture & Technical Stack](#2-high-level-architecture--technical-stack)
3. [User Roles, Authentication & Permissions Matrix](#3-user-roles-authentication--permissions-matrix)
4. [Deep-Dive: How Every Feature Works (Step-by-Step)](#4-deep-dive-how-every-feature-works-step-by-step)
   - 4.1 [Interactive 3D WebGL Brand Center](#41-interactive-3d-webgl-brand-center)
   - 4.2 [Dashboard KPIs, Modals & Live Calculations](#42-dashboard-kpis-modals--live-calculations)
   - 4.3 [Add Load Workflow with Multi-Engine AI OCR](#43-add-load-workflow-with-multi-engine-ai-ocr)
   - 4.4 [Automated Geocoding & OSRM Distance Engine](#44-automated-geocoding--osrm-distance-engine)
   - 4.5 [Load Board Pipeline & Document Flow](#45-load-board-pipeline--document-flow)
   - 4.6 [Admin Load Deletion with Dual Real-Time Notifications](#46-admin-load-deletion-with-dual-real-time-notifications)
   - 4.7 [Driver Mobile Portal (`/driver`) & In-App Doc Viewer](#47-driver-mobile-portal-driver--in-app-doc-viewer)
   - 4.8 [Driver Pay, Lease Percentages & Settlements (Admin)](#48-driver-pay-lease-percentages--settlements-admin)
   - 4.9 [WhatsApp-Style Chat & Real-Time Messaging](#49-whatsapp-style-chat--real-time-messaging)
   - 4.10 [Gmail Reply-All Integration](#410-gmail-reply-all-integration)
   - 4.11 [Google Drive Package Archival](#411-google-drive-package-archival)
   - 4.12 [FMCSA Live MC Number Verification](#412-fmcsa-live-mc-number-verification)
5. [Database Schema & Data Persistence](#5-database-schema--data-persistence)
6. [Complete REST API Endpoint Reference](#6-complete-rest-api-endpoint-reference)
7. [Directory Structure & Code File Breakdown](#7-directory-structure--code-file-breakdown)
8. [Setup, Deployment & Environment Configuration](#8-setup-deployment--environment-configuration)
9. [Troubleshooting & Maintenance Playbook](#9-troubleshooting--maintenance-playbook)

---

## 1. Executive Summary & Core Mission

**HaulBoX** is a unified freight operations and dispatch management platform designed to eliminate manual data entry, automate document processing, streamline driver communications, and secure revenue accounting.

### Key Value Pillars:
- **Instant Load Booking via AI**: Extracts 100% of Rate Confirmation details in seconds.
- **Single Source of Truth**: Dispatchers, Admins, and Drivers work from a synchronized real-time state.
- **Zero-Barrier Driver Experience**: Drivers log into a dedicated mobile web app using simple credentials (Driver Code + PIN), navigate via GPS, upload BOL/POD photos directly from their phone camera, review settlements, and view PDF Rate Confirmations.
- **Enterprise Accounting**: Automated lease calculations, deductions, batch payouts, and statement generation.

---

## 2. High-Level Architecture & Technical Stack

```
                                    ┌──────────────────────────────────────────────┐
                                    │             CLIENT WEB BROWSERS              │
                                    │  • Desktop / Tablet: public/index.html       │
                                    │  • Mobile Driver App: public/driver-portal   │
                                    └──────────────────────┬───────────────────────┘
                                                           │ (REST APIs / JSON)
                                                           ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                           NODE.JS / EXPRESS BACKEND SERVER                                       │
│                                                     (server.js)                                                  │
├──────────────────────┬──────────────────────┬────────────────────────┬───────────────────┬───────────────────────┤
│  routes/auth.js      │  routes/driver.js    │  routes/storage.js     │  routes/chat.js   │  routes/mistral.js    │
│  Google OAuth 2.0    │  Driver Session &    │  KV State Sync         │  Messaging &      │  AI OCR Proxy         │
│  SSO & Account Claim │  Load Shaping        │  Supabase Postgres     │  Thread Storage   │  Document Extraction  │
├──────────────────────┴──────────────────────┴────────────────────────┴───────────────────┴───────────────────────┤
│                                                CORE UTILITIES (lib/)                                             │
│  • lib/db.js: PostgreSQL pool & DDL schema             • lib/etaEngine.js: Distance & GPS Tracker                │
│  • lib/kvstore.js: Atomic JSON state storage           • lib/googleClient.js: Gmail & Google Drive API Client    │
│  • lib/driverSessions.js: 30-Day Bearer Tokens         • lib/auditStore.js: System Security Audit Trail          │
└──────────────────────────────────────────────────────────┬───────────────────────────────────────────────────────┘
                                                           │ (Pooler Connection)
                                                           ▼
                                    ┌──────────────────────────────────────────────┐
                                    │             SUPABASE POSTGRESQL              │
                                    │  • kv_store              • conversations     │
                                    │  • google_tokens         • messages          │
                                    │  • driver_sessions       • audit_logs        │
                                    └──────────────────────────────────────────────┘
```

---

## 3. User Roles, Authentication & Permissions Matrix

| Feature / Capability | Admin (`ADMIN_EMAIL`) | Dispatcher | Driver (`/driver`) | View-Only Link |
|---|---|---|---|---|
| **Login Method** | Google OAuth (`ADMIN_EMAIL`) | Google OAuth (Registered) | Driver Code + PIN | Access Token URL |
| **Add / Book New Loads** | ✅ Full Access | ✅ Full Access | ❌ Blocked | ❌ Read Only |
| **Delete Loads (Any Stage)**| ✅ Full Access (Alerts Sent)| ❌ Blocked | ❌ Blocked | ❌ Read Only |
| **Driver Pay & Margin** | ✅ Full Visibility | ❌ Masked / Hidden | 👁️ Own Net Pay Only | ❌ Masked |
| **Batch Settlements** | ✅ Full Access | ❌ Blocked | ❌ Blocked | ❌ Blocked |
| **Rate Confirmation (RC)** | ✅ Upload / View | ✅ Upload / View | ✅ View / Download | 👁️ View Only |
| **Upload BOL & POD** | ✅ Full Access | ✅ Full Access | ✅ In-App Camera/File | ❌ Blocked |
| **Google Drive Package Sync**| ✅ Full Access | ✅ Full Access | ❌ N/A | ❌ Blocked |
| **Live WhatsApp Chat** | ✅ Full Team Chat | ✅ Assigned Drivers | ✅ Assigned Contacts | ❌ Blocked |
| **System Settings** | ✅ Full Control | 👁️ Limited View | ❌ N/A | ❌ Blocked |

---

## 4. Deep-Dive: How Every Feature Works (Step-by-Step)

### 4.1 Interactive 3D WebGL Brand Center
- **Where**: `public/index.html` (Lines 4630–4800).
- **How it works**:
  1. Utilizes **Three.js** inside a WebGL `<canvas id="haulbox-cube-canvas">`.
  2. Renders a beveled 3D cube with raised brand face textures: Truck, AI Brain, Driver, Documents, Payouts, and Support.
  3. Uses spherical coordinates and ambient mouse/pointer vector projection to smoothly rotate towards user cursor movements.
  4. Features solid enterprise branding: Pure White **`Haul`** + Solid Sky Blue **`BoX`**.

---

### 4.2 Dashboard KPIs, Modals & Live Calculations
- **Where**: `public/index.html` (`renderDashboard()`).
- **How it works**:
  1. Evaluates all loads in memory against `getTodayIsoString()`.
  2. **Active Loads KPI**: Opens `#modal-kpi-detail` displaying all uncompleted loads with one-click navigation.
  3. **Today's Deliveries / Pickups**: Filters loads scheduled for today.
  4. **Available Drivers Roster**: Iterates `STATE.drivers`, checking whether each driver has an active load. If busy, computes their release date (`driverAvailability()`).

---

### 4.3 Add Load Workflow with Multi-Engine AI OCR
- **Where**: `public/index.html` (`goToLoadStep2()`, `submitLoadForm()`), `routes/mistral.js`.
- **How it works**:
  1. **Step 1: Broker & File Drop**:
     - User enters Broker Name. Input listener checks `STATE.brokers` or runs FMCSA lookup to autofill MC number.
     - User uploads PDF or image Rate Confirmation.
     - `onRcPicked()` reads the file as base64 and passes it to the configured AI engine (Mistral `pixtral-12b-2409`, Gemini, Claude, or OCR.space).
  2. **AI Extraction**:
     - The AI parses the binary document and returns structured JSON: `load_number`, `rate`, `miles`, `pickup_date`, `delivery_date`, `pickup_city`, `dropoff_city`, `broker_mc`, and contact info.
  3. **Step 2: Auto-Routing & Review**:
     - Auto-populates `#f-systemdate` with today's date (`YYYY-MM-DD`).
     - Triggers `calcMilesFromRoute()` to geocode coordinates and calculate driving distance via OSRM.
     - Automatically snapshots the driver's pay percentage (`driverPayPct`) onto the load object.
     - Saves record to Supabase, generates notifications, and triggers fire-and-forget Google Drive upload.

---

### 4.4 Automated Geocoding & OSRM Distance Engine
- **Where**: `public/index.html` (`geocodeCity()`, `calcMilesFromRoute()`).
- **How it works**:
  1. Queries OpenStreetMap Nominatim for pickup and drop-off coordinates (`latitude`, `longitude`).
  2. Submits coordinates to Open Source Routing Machine (`router.project-osrm.org`).
  3. Calculates exact driving miles (meters / 1609.34) and updates the Miles input and Rate Per Mile computation.

---

### 4.5 Load Board Pipeline & Document Flow
- **Where**: `public/index.html` (`renderLoadBoard()`, `openLoadModal()`).
- **Lifecycle Pipeline**:
  1. `Pending RC`: Awaiting Rate Confirmation.
  2. `Booked`: RC attached; assigned to driver.
  3. `Loaded`: Bill of Lading (BOL) attached.
  4. `Drop-off / Delivered`: Proof of Delivery (POD) attached.
  5. `Payment Stages`: Uninvoiced ➔ Invoiced ➔ Paid.
- **Features in Load Detail Modal**:
  - **GPS Route Actions**: One-click direct links to Google Maps turn-by-turn navigation for entire route, pickup address, or delivery address.
  - **Doc Slots**: Slots for RC, BOL, POD, Pickup Photos, Delivery Photos, and Extra Receipts.
  - **Document Zip Generator**: Bundles all files in memory using `JSZip` into `Load# · Lane · Driver.zip`.

---

### 4.6 Admin Load Deletion with Dual Real-Time Notifications
- **Where**: `public/index.html` (`confirmDeleteLoad()`).
- **How it works**:
  1. Admin clicks Delete button in Load Board table or Load Details modal.
  2. If the load is Delivered / Completed, system prompts confirmation acknowledging that notifications will be dispatched.
  3. Sends instant notification to the **Dispatcher** (`Load Deleted — #<num>`).
  4. Sends instant notification to the **Driver** (`Load Removed — #<num>`) and logs an unread alert in mobile portal storage (`dp_notifs_<driverId>`).
  5. Removes load permanently from `STATE.loads` and commits update to Supabase.

---

### 4.7 Driver Mobile Portal (`/driver`) & In-App Doc Viewer
- **Where**: `public/driver-portal.html`, `routes/driver.js`.
- **How it works**:
  1. **Authentication**: Driver logs in using Driver Code + PIN. Server verifies against `state.drivers` and issues a 30-day Bearer token.
  2. **Live Trip Hero**: Displays current load number, broker, earnings, and progress button.
  3. **In-App Document Viewer (`#dp-doc-modal`)**:
     - Driver taps **"View"** on Rate Confirmation, BOL, or POD.
     - `viewLoadDoc()` calls `POST /api/driver/doc`.
     - Images render in the high-res photo modal; PDFs render directly in the embedded fullscreen viewer with download links.
  4. **Progress Advancement**:
     - Tap **Accept Load** ➔ **Start Trip** ➔ **Arrived Pickup** ➔ **Upload BOL** ➔ **In Transit** ➔ **Arrived Delivery** ➔ **Upload POD** ➔ **Completed**.
     - Automatically updates dispatcher dashboard timeline in real time.

---

### 4.8 Driver Pay, Lease Percentages & Settlements (Admin)
- **Where**: `public/index.html` (`renderDriverPayPage()`, `toggleDriverPaid()`).
- **How it works**:
  1. Leased drivers earn a contract percentage of gross revenue (e.g. 88%).
  2. When booking a load, the percentage is snapshotted onto `load.driverPayPct`.
  3. Admin can enter custom deductions per load (advances, escrow, damage).
  4. **Settlements**: Admin marks loads as Paid. Driver sees settlement in mobile portal and can tap **"Confirm Payment Received"** or **"Dispute Payment"**.
  5. Admin can export CSV, Excel (.xlsx), or official Driver Settlement Statements.

---

### 4.9 WhatsApp-Style Chat & Real-Time Messaging
- **Where**: `public/index.html`, `public/driver-portal.html`, `routes/chat.js`.
- **How it works**:
  1. Provides familiar WhatsApp styling with unread badges, emoji picker, attachment previews, and search.
  2. Messages stored in Supabase `messages` table with timestamps, attachments, and delivery status.
  3. Supports direct 1-on-1 chats and operations group channels.

---

### 4.10 Gmail Reply-All Integration
- **Where**: `public/index.html` (`sendDoc()`), `routes/api.js`, `lib/googleClient.js`.
- **How it works**:
  1. Links each load to its original broker Gmail thread ID (`gmail_thread_id`).
  2. When sending BOL or POD, the system uses `POST /api/reply-all`.
  3. Preserves `In-Reply-To`, `References`, and all original `Cc` recipients, sending from the authenticated user's own connected Google Account.

---

### 4.11 Google Drive Package Archival
- **Where**: `public/index.html`, `routes/api.js`.
- **How it works**:
  1. On booking, automatically uploads the Rate Confirmation to Google Drive.
  2. When load reaches Delivered stage with all docs present, user can click **"Save Package to Drive"** to zip all paperwork and photos into the linked Drive account.

---

### 4.12 FMCSA Live MC Number Verification
- **Where**: `public/index.html`, `routes/api.js` (`/api/mc-lookup`).
- **How it works**:
  1. Dispatcher types 5–8 digits into MC number field.
  2. System queries FMCSA national registry API to verify operating authority and auto-fill the legal company name.

---

## 5. Database Schema & Data Persistence

### PostgreSQL Tables (Managed via Supabase):
1. **`kv_store`**:
   - `key` (TEXT PRIMARY KEY) ➔ `haulline:state`
   - `value` (TEXT) ➔ Complete JSON state blob (`loads`, `drivers`, `brokers`, `dispatchers`, `settings`, `chat`).
2. **`google_tokens`**:
   - `account_id` (TEXT PRIMARY KEY), `tokens` (JSONB), `email` (TEXT), `updated_at` (TIMESTAMP).
3. **`driver_sessions`**:
   - `token` (TEXT PRIMARY KEY), `driver_id` (TEXT), `created_at` (TIMESTAMP), `expires_at` (TIMESTAMP).
4. **`conversations` & `messages`**:
   - Stores threaded chats, participant IDs, message text, and base64 attachments.
5. **`notifications`**:
   - `id`, `recipient_role`, `recipient_id`, `title`, `body`, `read`, `created_at`.
6. **`audit_logs` & `load_history`**:
   - Immutable security log tracking logins, deletions, status changes, and edits.

---

## 6. Complete REST API Endpoint Reference

### Authentication & Config
- `GET /api/config` ➔ Returns locked `{ adminEmail }`.
- `GET /auth/google` ➔ Initiates OAuth consent flow.
- `GET /auth/google/callback` ➔ OAuth token exchange callback.
- `POST /auth/claim` ➔ Re-keys temporary tokens to user account ID.
- `GET /auth/status` ➔ Returns connected Google account email.
- `POST /auth/disconnect` ➔ Revokes OAuth connection.

### State & Storage
- `GET /api/state` ➔ Fetches full application state blob.
- `POST /api/state` ➔ Persists updated state blob.

### Driver Mobile API
- `POST /api/driver/login` ➔ Authenticates driver code + PIN; issues Bearer token.
- `GET /api/driver/me` ➔ Profile and permissions.
- `GET /api/driver/dashboard` ➔ Active load, summary metrics, and GPS status.
- `GET /api/driver/loads` ➔ List assigned loads (active/completed).
- `POST /api/driver/loads/:id/status` ➔ Updates driver workflow checkpoint.
- `POST /api/driver/loads/:id/eta` ➔ Updates driver manual ETA.
- `POST /api/driver/doc` ➔ Retrieves document data URL for in-app viewing.
- `POST /api/driver/upload-doc` ➔ Uploads BOL/POD/photo files.
- `GET /api/driver/transactions` ➔ Pay settlement ledger.
- `POST /api/driver/transactions/:id/accept` ➔ Confirms payment received.
- `POST /api/driver/transactions/:id/dispute` ➔ Reports payment dispute to Admin.

### Email & Google Drive
- `POST /api/send-email` ➔ Sends email via Gmail API.
- `POST /api/reply-all` ➔ Sends threaded reply into existing broker conversation.
- `POST /api/drive-upload` ➔ Uploads zipped package to Google Drive.

### AI & Third-Party
- `POST /api/ai/mistral-extract` ➔ Server-side proxy for Mistral AI vision OCR.
- `GET /api/mc-lookup` ➔ FMCSA MC number registry lookup.

---

## 7. Directory Structure & Code File Breakdown

```text
c:\HaulBoX\haulbox-restored\Faisal\
│
├── public/
│   ├── index.html              # Core SPA: Dashboard, 3D Logo, Load Board, Add Load, Driver Pay, Settings
│   └── driver-portal.html       # Mobile PWA: Live Trip, GPS Tracking, In-App Doc Viewer, Pay, Chat
│
├── routes/
│   ├── api.js                  # Email, Drive upload, MC lookup, settlement routes
│   ├── auth.js                 # Google OAuth 2.0 flow & token management
│   ├── driver.js               # Driver authentication, load shaping, doc viewing & GPS tracking
│   ├── chat.js                 # Messaging, conversations, and attachment handling
│   ├── notifications.js        # Notification push & status endpoints
│   ├── storage.js              # State synchronization & KV store persistence
│   └── mistral.js              # Mistral OCR & AI document extraction proxy
│
├── lib/
│   ├── db.js                   # Supabase PostgreSQL connection pool & schema definitions
│   ├── kvstore.js              # Key-value state persistence engine
│   ├── driverSessions.js       # Bearer token generator and validator for drivers
│   ├── etaEngine.js            # Real-time ETA and distance tracking logic
│   ├── googleClient.js         # Gmail & Google Drive API client
│   ├── auditStore.js           # Security audit logs
│   ├── chatStore.js            # Chat message persistence engine
│   ├── historyStore.js         # Load timeline history store
│   └── notificationStore.js    # Notification persistence & dispatch
│
├── server.js                   # Node/Express main server entrypoint
├── package.json                # Dependencies and startup scripts
├── PROJECT_OVERVIEW.md         # Comprehensive project manual & technical blueprint
└── README.md                   # Quickstart guide
```

---

## 8. Setup, Deployment & Environment Configuration

### Step 1: Clone & Install Dependencies
```bash
npm install
```

### Step 2: Environment Variables (`.env`)
```ini
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback
SESSION_SECRET=your-secure-random-secret-string
ADMIN_EMAIL=Faisaljoyia320@gmail.com
DATABASE_URL=postgresql://postgres:[PASSWORD]@[HOST].pooler.supabase.com:6543/postgres
PORT=3000
```

### Step 3: Running Locally
```bash
npm start
```
- Open `http://localhost:3000` for Dispatcher / Admin Portal.
- Open `http://localhost:3000/driver` for Driver Portal.

### Step 4: Production Deployment (e.g. Render / Railway)
1. Set Build Command: `npm install`
2. Set Start Command: `npm start`
3. Add environment variables in host dashboard.
4. Update `GOOGLE_REDIRECT_URI` to match your live production URL.

---

## 9. Troubleshooting & Maintenance Playbook

| Issue / Symptom | Probable Cause | Resolution |
|---|---|---|
| **Google Sign-In "Access Denied"** | Email does not match `ADMIN_EMAIL` or registered Dispatchers | Add user's Gmail in Admin ➔ Settings ➔ Dispatchers. |
| **Driver "File not available" on View RC** | Old load record missing binary data URL | Ensure Rate Confirmation was attached during load creation or upload via Load Details. |
| **AI OCR Fails to Extract** | Missing or invalid AI API key | Add API key in Settings ➔ AI RC Extraction (Mistral, Gemini, or Claude). |
| **Render Spin-Down Delay** | Free-tier host sleeping after inactivity | Allow 30–45s for initial cold boot or upgrade to persistent instance. |
| **Database Disconnection** | Expired Supabase connection string | Check `DATABASE_URL` in `.env` and verify Session Pooler port (`6543`). |

---

*HaulBoX — Built for unmatched speed, reliability, and enterprise trucking excellence.*
