# Handoff

Updated: 2026-09-19 (Asia/Bangkok)

## State

- Created at `D:/Projects/WebApps/pb-crud-app-starter` as a separate local Git repository. No remote, commit, GitHub template setting or production deployment has been created.
- Stack: static HTML/CSS/JavaScript, PocketBase 0.39.8, SQLite. No frontend build dependencies.
- Thai login/registration, session handling, shared CRUD items, search/status filtering, pagination, desktop/mobile layouts.
- Admin member list, name/role/active editing for other members, self-edit protection. All authorization enforced server-side.
- Only public/ is served. Source OR Planning Board database was never accessed or copied; only its reusable setup scripts, registration hook and ignored PocketBase binary were reused. Source repository files remain unchanged.
- README and customization guide explain how to start a new app and add fields. AGENTS.md preserves the validation and security conventions.

## Verified

- 61 API/security/validation/static-serving assertions with OS temporary data: guest isolation, viewer read-only, editor/admin CRUD, member management boundaries, promotion and deactivation with existing tokens, registration privilege injection, calendar validation, pagination/search, private-file URL rejection.
- Migrations applied twice successfully (idempotent).
- PowerShell setup: created then updated initial admin using isolated temporary data, without touching real pb_data.
- Browser at default desktop width (~1265 px) and mobile 390 px: login, create/search, edit with persisted values, status update, admin member edit and role change, viewer controls/read-only details, session restore after reload, logout and registration success. No browser warning/error logs during these checks; narrow layout did not overflow horizontally.
- JavaScript syntax for public scripts, migrations, hooks and test; PowerShell parser for all scripts; Bash syntax for each script and LF-only line endings.
- Shared asset timestamp `202609191219` across both HTML pages.
- Repository whitespace and ignore checks completed before delivery.

## Scope / remaining work

- Form fields are defined in code, not a drag-and-drop form builder.
- Data is shared across active team members; no ownership or multi-tenant isolation.
- No production database or real admin credentials created. Run setup for the target environment.
- Temporary preview server was stopped. Automatic command approval rejected cleanup of two synthetic test directories under OS Temp: `pb-crud-starter-test-Go7rRN` and `pb-starter-setup-8399c6223a914c259a9786f98f400d32`. These remain outside the repository; no real user data is involved.
- Linux/macOS scripts were syntax-checked here, not executed end-to-end on those operating systems.
- No email recovery/verification UI, audit log, CI or production hosting package. Deployment and backup operation need setup for each real application.
