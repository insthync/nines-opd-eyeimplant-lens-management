# Handoff

Updated: 2026-09-23 (Asia/Bangkok)

## State

- Project: OPD Eye Implant & Lens Management, built on the pb-crud-app-starter base. Local Git repository on `main` with the starter initial commit; this change set is uncommitted working-tree work.
- Stack unchanged: static HTML/CSS/JavaScript, PocketBase 0.39.8, SQLite, Thai UI, no build step. Clinical blue theme, desktop sidebar + mobile hamburger drawer.
- Scope delivered: dashboard with Exception Center, surgery schedule/cases, implant reservations with two-person verification and 12-point safety checklist confirmation, stock inventory with receiving and expiry/min-stock alerts, OR verification, usage recording with automatic stock deduction, two-way traceability (patient ↔ implant, lot/serial recall), master data (patients/implants/vendors/doctors/procedures), member management, audit log (`case_logs`).
- Out of scope by request: Purchase/PO Tracking and Reports pages, PDF documents, Google Drive integration, email flows.
- Schema lives in `pocketbase/pb_migrations/1790200000_eye_implant.js` (new migration; starter migration untouched; starter `items` collection dropped with a full down migration). Workflow/authorization in `pocketbase/pb_hooks/workflow.pb.js`, field validation in `validation.pb.js`, registration renamed to `/api/eyeimplant/register`.

## Verified

- 135 API/authorization/workflow/validation/traceability/static-serving assertions against an OS temporary database, including: migrate-up-twice idempotency, role matrix per collection, unique HN/product code, auto case/reservation numbers, full lifecycle (draft → check 1 → same-person second check rejected → check 2 → confirm blocked without stock → receive → confirm reserves stock → locked fields after confirmation → OR verify → use deducts stock and writes usage → completed), cancellation releases stock, expired-lot confirmation blocked, `qty_reserved` direct writes rejected, recall by lot, usage/log records immutable for API clients, registration privilege injection ignored, token promotion/disable semantics, pagination/search filters, private-path 404s.
- Browser verification (via `node tests/integration.mjs --preview` with synthetic data, desktop 1280 px and mobile 390 px): login/dashboard/cases/reservations/inventory/usage/masters/members rendering; end-to-end UI workflow across two different accounts (admin first check → editor second check → checklist blocks until all 12 items → confirm with lot selection); viewer read-only with hidden write controls and members menu; traceability by patient and by lot; mobile drawer/hamburger with backdrop; no horizontal overflow on any of the seven views at either width; no console errors. Two frontend bugs found and fixed during this pass (masters dialog mount error, verify-stage text parsing) plus a seed time-format bug in the demo data.
- `node --check` on all public scripts, migrations, hooks and the test; `git diff --check` clean; shared asset timestamp bumped together in index.html and register.html.
- PocketBase JSVM quirks documented in code comments: hook callbacks execute outside the file closure (callbacks are self-contained) and goja lacks full Intl (Bangkok time derived from UTC+7 arithmetic instead of `toLocaleDateString`).

## Known gaps / remaining work

- No Purchase/PO Tracking, Reports, PDF generation or Google Drive folders (explicitly excluded from this phase).
- No email verification/recovery UI, CI, or production hosting package. Recall exposes patient identifiers to all active viewers — tighten membership or add field-level rules before real patient data.
- Single-team shared data; no tenant/ownership isolation.
- `--preview` demo data is synthetic; no real `pb_data` was created or opened. Setup scripts must be run for a persistent environment.
- Linux/macOS scripts were not executed end-to-end on those operating systems.
- Browser automation note: Playwright-locator clicks time out against this IAB backend even though elements are genuinely clickable (verified by DOM hit-test); form submissions were driven with `requestSubmit()` during verification.
