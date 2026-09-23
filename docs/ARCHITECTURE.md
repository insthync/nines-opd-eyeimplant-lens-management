# Architecture

Browser → static files in public/ → same-origin PocketBase REST API → SQLite

PocketBase version is pinned to 0.39.8. No build step and no frontend dependencies. Node.js is needed only for the integration test.

## Collections

Created by `pocketbase/pb_migrations/1789800000_starter.js` (users) and `1790200000_eye_implant.js` (everything else; it also removes the generic starter `items` collection, recreated by its down migration).

| Collection | Purpose / key fields | API rules (active = logged-in active `users`; writer = editor|admin; admin) |
| --- | --- | --- |
| `users` | auth + `name`, `role` (viewer/editor/admin), `active` | read self (admin reads all); update other members as admin; create/delete locked |
| `patients` | `hn` (unique, normalized uppercase), `name`, dob, sex, phone, allergies, active | read: active; write: writer |
| `vendors`, `doctors`, `procedures` | master data (`name` unique for vendors) | read: active; write: writer |
| `implants` | `product_code` (unique, uppercase), `implant_type` select (8 IOL/implant types), brand/model/power/cylinder/a_constant, unit_price, min/max stock, vendor relation, lot/serial/expiry control flags | read: active; write: writer |
| `stock_lots` | implant relation, lot, serial, expiry, `qty_physical`, `qty_reserved` | read: active; create/update: writer; delete: admin |
| `surgery_cases` | `case_number` (unique, auto `EYE-YYYYMM-NNNN`), patient, surgery_date/time, `eye` select od/os/ou only, surgeon, procedure, diagnosis, or_room, priority, `status` (draft/confirmed/or_verified/completed/cancelled), created_by | read: active; create/update: writer; delete: admin |
| `reservations` | `reservation_number` (unique, auto `RES-YYYYMM-NNNN`), case, implant, power/cylinder snapshot, quantity, `status` (draft/first_checked/verified/confirmed/used/cancelled), first/second checker + timestamps, confirmed_by/at/lot, cancel_reason | read: active; create: writer; update: writer while `status = "draft"`; delete: writer on drafts, else admin |
| `implant_usages` | case, reservation, patient, implant, lot, serial, expiry, power used, remark, used_by, used_at | read: active; create/update/delete: **null** (workflow route only, keeps stock deduction atomic) |
| `case_logs` | audit trail: case, reservation, action, detail, user, created | read: active; writes server-only |

## Workflow routes (pocketbase/pb_hooks/workflow.pb.js)

All state transitions run server-side via `POST /api/eyeimplant/{action}` (single self-contained dispatcher; PocketBase re-evaluates JSVM callbacks outside the file closure, so each callback must be self-contained). Every action requires an active editor/admin, writes a `case_logs` entry with a Bangkok timestamp, and uses transactions for multi-record updates:

- `verify` — first check (draft → first_checked) and second check (→ verified). The second checker must differ from the first.
- `confirm` — requires verified; picks a lot (explicit or earliest-expiring valid one); rejects expired lots and insufficient stock; reserves stock (`qty_reserved` += quantity) and confirms the case.
- `cancel-reservation` — releases reserved stock, downgrades the case when no active reservations remain, requires a reason.
- `or-verify` — case confirmed → or_verified.
- `use` — requires case or_verified; deducts physical stock, releases the reservation, writes the immutable `implant_usages` traceability record, completes the case when all reservations settle.
- `receive` — stock intake without PO; merges into an existing lot row when implant+lot+serial+expiry match.
- `cancel-case` — cancels the case and all its open reservations, releasing reserved stock.

`POST /api/eyeimplant/register` (registration.pb.js) creates an active unverified viewer, ignoring client privilege fields (16 KB body limit + honeypot).

## Validation hooks (pocketbase/pb_hooks/validation.pb.js)

- users: admin may only send name/role/active (unchanged from starter).
- patients: HN trimmed/uppercased, required with name; real-calendar dob.
- implants: product code trimmed/uppercased.
- surgery_cases: auto case number, forced draft status, created_by from auth, calendar date checks; on update, status changes are rejected outright, completed/cancelled cases are frozen, and patient/eye/surgery_date/surgeon/procedure are locked once confirmed.
- reservations: auto reservation number, power/cylinder snapshot from the implant master, forced draft status, rejected on cancelled/completed cases; updates only while draft and never for status.
- stock_lots: `qty_reserved` may never be written through the records API (workflow-owned); expiry calendar check.

## Frontend

`api.js` stores tokens in sessionStorage scoped by API base; a 401 clears the session. Views register into `window.Views` and `app.js` drives sidebar navigation (desktop sidebar, mobile hamburger drawer). `ui.js` provides the shared list controller (filters/search/pagination/generation counters), dialog builder and domain helpers (readiness, expiry states). All rendering uses textContent only. Asset `?v=` cache-busters are bumped together in index.html and register.html (Asia/Bangkok YYYYMMDDHHmm).

Readiness logic (shared by dashboard and schedule): cancelled/completed map to their own state; otherwise READY requires every non-cancelled reservation confirmed/used on a non-expired lot; cases due today/tomorrow that are not READY escalate to PROBLEM.

## Schema changes

Use a new migration for every applied schema change. Test against temporary data (`node tests/integration.mjs`). Serve only public/; database, scripts, binaries and Git metadata must never be under the static web root.

References: [PocketBase API rules](https://pocketbase.io/docs/api-rules-and-filters/) and [JavaScript routing](https://pocketbase.io/docs/js-routing/).
