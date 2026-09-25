# 🚀 HaulBoX & Vetta Complete Production Deployment Guide

This guide walks you through deploying all three core components of the platform:
1. **HaulBoX Dispatch Command & Backend** (Node.js / Express / Socket.IO / Supabase / Google OAuth)
2. **VETTA Corporate Website** (Next.js 16 / React 19 / Tailwind CSS / Resend / Supabase)
3. **HaulBoX Driver Mobile App** (Flutter / Android APK / Google Play Store)

---

## 📋 System Architecture

```
                    ┌─────────────────────────┐
                    │      VETTA Website      │
                    │   (Next.js on Vercel/   │
                    │      Render/Docker)     │
                    └─────────────────────────┘

                    ┌─────────────────────────┐
                    │     HaulBoX Backend     │
                    │    & Dispatch Portal    │
                    │  (Node.js on Render /   │
                    │     Railway / Docker)   │
                    └───────────┬─────────────┘
                                │
        ┌───────────────────────┼─────────────────────────┐
        │                       │                         │
┌───────▼────────┐      ┌───────▼────────┐       ┌────────▼───────┐
│ Supabase Cloud │      │  Google Cloud  │       │ HaulBoX Mobile │
│   PostgreSQL   │      │  OAuth / Gmail │       │   Driver App   │
│  (Data Store)  │      │  Drive / Cloud │       │ (Android/iOS)  │
└────────────────┘      └────────────────┘       └────────────────┘
```

---

## Part 1: HaulBoX Backend & Dispatch Command Web App

The backend serves the real-time dispatch dashboard (`public/index.html`), driver REST APIs, Socket.IO updates, and Google Workspace integrations.

### Prerequisites:
1. **Supabase Database** (Free tier available at [supabase.com](https://supabase.com))
   - Create a project.
   - Go to **Project Settings → Database → Connection String → URI**.
   - Select **Session Pooler** (port `6543`).
   - Example: `postgresql://postgres.xxx:[PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres`
   - *Note: All tables (`kv_store`, `google_tokens`, etc.) are auto-created by the server on first launch.*

2. **Google Cloud OAuth 2.0 Credentials**
   - Go to [Google Cloud Console](https://console.cloud.google.com/).
   - Enable **Gmail API** and **Google Drive API**.
   - Create an OAuth 2.0 Client ID (Web Application).
   - Set Authorized Redirect URI to:
     - Local: `http://localhost:3000/auth/google/callback`
     - Production: `https://<YOUR-APP-NAME>.onrender.com/auth/google/callback` (or your custom domain)

3. **Mistral AI API Key** (Optional for BOL/POD AI document extraction)
   - Obtain from [console.mistral.ai](https://console.mistral.ai/).

---

### Option A: Deploying to Render (Recommended - 1-Click via Blueprint)

1. Push this repository to **GitHub** or **GitLab**.
2. Go to your [Render Dashboard](https://dashboard.render.com/).
3. Click **New + → Blueprint** and select your repository.
4. Render will read [`render.yaml`](file:///c:/Users/AL%20MADINA%20COMPUTER/Documents/VETTA%20Projects/VETTA%20Projects/HaulBoX/HaulBoX/render.yaml) automatically.
5. In the environment setup, configure the following variables:

| Environment Variable | Recommended Value / Description |
|----------------------|---------------------------------|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Your Supabase Session Pooler URI |
| `SESSION_SECRET` | Auto-generated 32+ character random string |
| `SUPER_ADMIN_EMAIL` | `haulbox2361@gmail.com` |
| `ADMIN_EMAIL` | `haulbox2361@gmail.com` |
| `ADMIN_EMAILS` | `haulbox2361@gmail.com` |
| `SETTINGS_ADMIN_PIN` | A secure 6-digit PIN to protect the Admin Settings page |
| `GOOGLE_CLIENT_ID` | Your Google OAuth Client ID |
| `GOOGLE_CLIENT_SECRET` | Your Google OAuth Client Secret |
| `GOOGLE_REDIRECT_URI` | `https://<YOUR-RENDER-SUBDOMAIN>.onrender.com/auth/google/callback` |
| `MISTRAL_API_KEY` | Your Mistral AI API key (for document scan extraction) |

6. Click **Apply**.
7. Once deployment finishes, verify health:
   - Browse to `https://<YOUR-APP-NAME>.onrender.com/api/health`
   - It will return `{"status":"OK", "database":{"status":"healthy"}}`.

---

### Option B: Deploying with Docker / VPS / Railway / Fly.io

A production multi-stage [`Dockerfile`](file:///c:/Users/AL%20MADINA%20COMPUTER/Documents/VETTA%20Projects/VETTA%20Projects/HaulBoX/HaulBoX/Dockerfile) and [`docker-compose.yml`](file:///c:/Users/AL%20MADINA%20COMPUTER/Documents/VETTA%20Projects/VETTA%20Projects/HaulBoX/HaulBoX/docker-compose.yml) are included.

To build and run locally or on a VPS:
```bash
# Build the container
docker build -t haulbox-backend:latest .

# Run the container
docker run -d \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e DATABASE_URL="your-supabase-db-url" \
  -e SESSION_SECRET="your-session-secret" \
  -e SUPER_ADMIN_EMAIL="haulbox2361@gmail.com" \
  -e ADMIN_EMAIL="haulbox2361@gmail.com" \
  -e SETTINGS_ADMIN_PIN="123456" \
  --name haulbox_app haulbox-backend:latest
```

Or run everything (including local PostgreSQL if you don't use Supabase) via Docker Compose:
```bash
docker compose up -d
```

---

## Part 2: VETTA Corporate Website (Next.js 16)

Located in [`vetta-website/`](file:///c:/Users/AL%20MADINA%20COMPUTER/Documents/VETTA%20Projects/VETTA%20Projects/HaulBoX/HaulBoX/vetta-website).

### Option A: Deploying to Vercel (Recommended)
1. Go to [vercel.com](https://vercel.com) and click **Add New → Project**.
2. Connect your Git repository.
3. Set **Root Directory** to `vetta-website`.
4. Configure Environment Variables:
   - `NEXT_PUBLIC_SITE_URL`: `https://yourdomain.com` (or your Vercel URL)
   - `NEXT_PUBLIC_SITE_NAME`: `VETTA`
   - `NEXT_PUBLIC_SUPABASE_URL`: Your Supabase URL (for contact inquiries)
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Your Supabase Anon Key
   - `SUPABASE_SERVICE_ROLE_KEY`: Your Supabase Service Role Key
   - `RESEND_API_KEY`: Your Resend API key (for email contact form alerts)
   - `EMAIL_FROM_ADDRESS`: `hello@yourdomain.com`
   - `EMAIL_TO_ADDRESS`: `inquiries@yourdomain.com`
5. Click **Deploy**.

### Option B: Deploying with Docker
A production [`vetta-website/Dockerfile`](file:///c:/Users/AL%20MADINA%20COMPUTER/Documents/VETTA%20Projects/VETTA%20Projects/HaulBoX/HaulBoX/vetta-website/Dockerfile) is provided.
```bash
cd vetta-website
docker build -t vetta-website:latest .
docker run -d -p 3001:3000 --env-file .env.local vetta-website:latest
```

---

## Part 3: HaulBoX Driver Mobile App (Flutter)

Located in [`haulbox_app/`](file:///c:/Users/AL%20MADINA%20COMPUTER/Documents/VETTA%20Projects/VETTA%20Projects/HaulBoX/HaulBoX/haulbox_app).

### 1. Ready-to-Install APKs
If you want to immediately install or distribute the driver app to your drivers, the pre-built APKs are located directly in the root repository:
- `HaulBoX-Driver-App-v1.0.0.apk`
- `HaulBoX-Driver-App.apk`

Drivers simply download the APK on any Android phone, tap to install, and enter:
- **Driver ID** (from Admin Portal → Drivers)
- **PIN** (from Admin Portal → Drivers)

### 2. Building a New APK Configured for Your Live Backend
When your backend is live (e.g. `https://haulbox-live.onrender.com`), compile a new release APK pointing directly to your live server without modifying any source code:

```bash
cd haulbox_app

# Fetch packages
flutter pub get

# Build Release APK with your live backend URL
flutter build apk --release --dart-define=API_URL=https://<YOUR-BACKEND-DOMAIN>
```
The output APK will be saved at:
`haulbox_app/build/app/outputs/flutter-apk/app-release.apk`

### 3. Google Play Store Release (AAB Bundle)
To submit to the Google Play Store:
1. Generate an Android keystore:
   ```bash
   keytool -genkey -v -keystore android/app/upload-keystore.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload
   ```
2. Build an Android App Bundle (.aab):
   ```bash
   flutter build appbundle --release --dart-define=API_URL=https://<YOUR-BACKEND-DOMAIN>
   ```
3. Upload `haulbox_app/build/app/outputs/bundle/release/app-release.aab` to the Google Play Console.

---

## ✅ Deployment Verification Checklist

Before opening to public traffic:
- [ ] Backend `/api/health` returns `200 OK` with database `healthy`.
- [ ] Log in to HaulBoX Admin via Google OAuth with `haulbox2361@gmail.com`.
- [ ] Open Settings with `SETTINGS_ADMIN_PIN` to confirm access restriction.
- [ ] Add a test Driver and generate a Driver ID + PIN.
- [ ] Install the Driver Mobile App on an Android device or emulator and log in with the test Driver ID + PIN.
- [ ] Submit a test contact message on the VETTA Website to verify Supabase/Resend email notifications.
