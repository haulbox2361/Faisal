# 🧪 HaulBoX RC1 — Comprehensive Testing Checklists

**Release Candidate:** v1.0.0-RC1  
**Target Environments:** Render Production Web Portal & Android Mobile APK  

---

## 🛡️ 1. ADMIN TEST CHECKLIST

| Test ID | Test Scenario | Expected Behavior | Status | Notes |
| :--- | :--- | :--- | :---: | :--- |
| **ADM-01** | Google OAuth Login | Admin authenticates via authorized Google account (`haulbox2361@gmail.com`) and reaches command dashboard. | [ ] PASS / [ ] FAIL | |
| **ADM-02** | Master Driver Portal Toggle | Disabling `driver_portal_enabled` in Settings immediately blocks mobile traffic with 403 status. | [ ] PASS / [ ] FAIL | |
| **ADM-03** | Settings 6-Digit PIN | Accessing company settings requires valid 6-digit PIN (`123456`); rejects incorrect PIN. | [ ] PASS / [ ] FAIL | |
| **ADM-04** | Dispatcher Fleet Assignment | Admin can create dispatchers and assign specific drivers to their roster. | [ ] PASS / [ ] FAIL | |
| **ADM-05** | Load Creation & Dispatch | Admin creates load with Rate Con, pickup/delivery times, and assigns to active driver. | [ ] PASS / [ ] FAIL | |
| **ADM-06** | System Health Check | `GET /api/health` returns status `OK`, database latency < 10ms, and memory stats. | [ ] PASS / [ ] FAIL | |
| **ADM-07** | State Snapshot Backup | `exportFullSnapshot()` exports complete JSON backup with all tables intact. | [ ] PASS / [ ] FAIL | |

---

## 🎧 2. DISPATCHER TEST CHECKLIST

| Test ID | Test Scenario | Expected Behavior | Status | Notes |
| :--- | :--- | :--- | :---: | :--- |
| **DSP-01** | Dispatcher Login | Dispatcher logs in and is restricted strictly to their assigned driver fleet. | [ ] PASS / [ ] FAIL | |
| **DSP-02** | Live Fleet Telemetry Map | Dispatcher views real-time GPS locations, speed, and heading of active drivers. | [ ] PASS / [ ] FAIL | |
| **DSP-03** | Delay & ETA Warning | Dispatcher receives high-priority notification banner when driver ETA exceeds appointment cutoff. | [ ] PASS / [ ] FAIL | |
| **DSP-04** | Geofence Arrival Alert | Notification received when driver arrives at shipper or consignee facility (< 0.25 mi). | [ ] PASS / [ ] FAIL | |
| **DSP-05** | Document Review Queue | BOL and POD uploads with discrepancies appear in Dispatcher Review queue for approval. | [ ] PASS / [ ] FAIL | |
| **DSP-06** | Operations Chat Sync | Dispatcher chats seamlessly in 3-person Operations group (`Driver + Dispatcher + Admin`). | [ ] PASS / [ ] FAIL | |

---

## 🚚 3. DRIVER MOBILE APP TEST CHECKLIST

| Test ID | Test Scenario | Expected Behavior | Status | Notes |
| :--- | :--- | :--- | :---: | :--- |
| **DRV-01** | Driver Login & PIN Auth | Driver enters Driver ID & PIN; receives secure Bearer session token with auto-restore. | [ ] PASS / [ ] FAIL | |
| **DRV-02** | New Load Modal & Accept | Full-screen assignment modal appears with rate & stops; accepting transitions to `ACCEPTED`. | [ ] PASS / [ ] FAIL | |
| **DRV-03** | Google Maps Launch | Tapping `[Navigate to Pickup]` launches external Google Maps with pickup coordinates. | [ ] PASS / [ ] FAIL | |
| **DRV-04** | Start Trip & GPS Telemetry | Tapping `[START TRIP]` initiates background location stream and calculates dynamic ETA. | [ ] PASS / [ ] FAIL | |
| **DRV-05** | BOL AI Verification | Camera capture runs optical clarity & Rate Con check; advances to `LOADED` upon approval. | [ ] PASS / [ ] FAIL | |
| **DRV-06** | POD AI Verification | Consignee signature and delivery stamp check; advances to `DELIVERED` upon approval. | [ ] PASS / [ ] FAIL | |
| **DRV-07** | Operations Chat & Badges | Driver messages dispatcher, sends photo attachments, and sees unread badge count. | [ ] PASS / [ ] FAIL | |
| **DRV-08** | Payment Settlement | Direct deposit payment appears in Payments tab with total earnings breakdown. | [ ] PASS / [ ] FAIL | |

---

## 🐛 4. BUG REPORTING TEMPLATE

When an issue is identified during field testing, log it using the following format:

```markdown
### Bug Title: [Short descriptive summary]
- **Severity**: Critical / High / Medium / Low
- **Role**: Admin / Dispatcher / Driver
- **Environment**: Web (Chrome/Safari) / Android APK
- **Steps to Reproduce**:
  1. Go to '...'
  2. Click on '...'
  3. Observe error
- **Expected Result**: [What should have happened]
- **Actual Result**: [What actually happened + Console / Log output]
```
