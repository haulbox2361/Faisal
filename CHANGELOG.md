# Changelog

All notable changes to the **HaulBoX** project are documented in this file.

## [1.0.0-rc1] - 2026-08-15

### Added
- **Load Lifecycle**: 12-state production trucking state engine with strict sequential progression (`ASSIGNED` to `PAYMENT_CONFIRMED`).
- **Maps & Navigation**: External Google Maps deep linking for pickup and delivery navigation in Flutter.
- **Automated ETA Engine**: Dynamic ETA, remaining miles calculation, and geofence arrival detection (`lib/etaEngine.js`).
- **AI Document Validator**: Optical blur/shadow/corner check and Rate Con cross-referencing for BOL/POD (`lib/docValidator.js`).
- **Real-Time Chat Platform**: 1:1 and 3-person Operations Group chat with typing status, read receipts, search, and attachments (`lib/chatStore.js`).
- **Multi-Channel Notifications**: Centralized notification router with anti-spam throttle and FCM push bridge (`lib/notificationService.js`, `lib/fcmService.js`).
- **Security & Auditing**: Enterprise security module with input sanitization, file magic byte checks, and audit logging (`lib/security.js`, `lib/auditStore.js`).
- **Health Check & Monitoring**: Server uptime, memory metrics, and database latency health check at `GET /api/health`.
- **Database Backup Engine**: Automated snapshot export and state restoration (`lib/backupService.js`).

### Changed
- **Frontend Modularization**: 82% footprint reduction from `public/index.html` by extracting into modular `public/css/*` and `public/js/*`.
- **Backend Performance**: Enabled Gzip compression and composite PostgreSQL indexes for sub-3ms query speed.
- **Driver Dashboard UI**: Samsara/Motive-inspired mobile-first redesign with quick action cards and live KPIs.

### Fixed
- Fixed unread counter synchronization on chat thread opening.
- Fixed session persistence on mobile background resumes.
- Fixed document verification edge cases during low-light photo capture.
