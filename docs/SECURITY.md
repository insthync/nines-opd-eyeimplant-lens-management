# Security boundaries

- Browser accounts belong to `users`, never `_superusers`.
- Anonymous item reads and all anonymous item writes are denied by API rules. A denied list can return 200 with zero records because PocketBase rules also filter records.
- Self-registration forces an active, unverified viewer. Verification is not required to read shared team data in this starter. Disable public registration or add an approval/verification flow if membership itself needs review.
- Active viewer/editor/admin users can read ALL items. This is a single-team baseline, not multi-tenant isolation.
- App admins can change another member's name, role, active status. They cannot edit their own account or arbitrary auth fields through this app API. Members are disabled rather than deleted.
- Disabled accounts cannot log in or use an old token for protected records. Role changes are checked server-side for subsequent requests.
- Tokens are in sessionStorage; no persistent localStorage or browser superuser credential.
- Runtime data, binaries, logs, exports, backups and .env files are ignored by Git. Keep production secrets in a secret store.
- Serve public/ only; never expose the repository root as static content.

For internet deployment, configure HTTPS, rate limiting for auth/registration, access controls for the superuser dashboard, encrypted backups and a tested restore process. The registration honeypot is not a replacement for rate limiting. Email delivery, password recovery UI, audit trail, tenant isolation and a production deployment package are not included.

Setup scripts pass credentials to the PocketBase CLI or local bootstrap server. Run them on a trusted machine and use interactive password prompts rather than shell history. Choose a new runtime data directory for each app. Do not copy real source-project data for testing.
