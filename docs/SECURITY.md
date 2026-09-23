# Security boundaries

- Browser accounts belong to `users`, never `_superusers`.
- Anonymous reads and writes are denied by API rules on every collection. A denied list can return 200 with zero records because PocketBase rules also filter records.
- Self-registration (`POST /api/eyeimplant/register`) forces an active, unverified viewer and ignores client privilege fields. Verification is not required to read shared team data. Disable public registration or add an approval flow if membership itself needs review.
- Active viewer/editor/admin users can read ALL clinical data (single-team baseline, not multi-tenant isolation). Only editor/admin can write; admin additionally deletes cases/lots and manages members.
- Patient-safety rules are enforced server-side only, never in the UI: status transitions exist solely behind `/api/eyeimplant/*` routes (viewer cannot verify, the second checker must differ from the first, confirmation requires two checks plus non-expired sufficient stock, usage requires OR verification, expired lots are blocked). `qty_reserved` is not writable through the records API, and `implant_usages`/`case_logs` are read-only for all API clients so traceability cannot be edited or deleted from the app.
- Change control: case status can never be PATCHed; completed/cancelled cases are frozen; patient/eye/surgery date/surgeon/procedure are locked after confirmation (cancel-and-recreate is the only path).
- App admins can change another member's name, role, active status. They cannot edit their own account or arbitrary auth fields. Members are disabled, never deleted.
- Disabled accounts cannot log in or use an old token for protected records. Role changes apply to subsequent requests immediately.
- Tokens live in sessionStorage; no persistent localStorage and no browser superuser credential.
- Runtime data, binaries, logs, exports, backups and .env files are ignored by Git. Keep production secrets in a secret store.
- Serve public/ only; never expose the repository root as static content.

For internet deployment, configure HTTPS, rate limiting for auth/registration, access controls for the superuser dashboard, encrypted backups and a tested restore process. The registration honeypot is not a replacement for rate limiting. Email delivery, password recovery UI, PDF document generation, PO tracking and a production deployment package are not included. Recall workflows expose patient identifiers to every active viewer — restrict membership accordingly.

Setup scripts pass credentials to the PocketBase CLI or local bootstrap server. Run them on a trusted machine and use interactive password prompts rather than shell history.
