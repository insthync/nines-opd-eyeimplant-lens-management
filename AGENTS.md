# pb-crud-app-starter

Read README.md and docs/ARCHITECTURE.md, docs/SECURITY.md, docs/HANDOFF.md. Run git status --short before editing and preserve unrelated changes.

- Thai UI by default. Preserve id="add-case-button".
- Only public/ is a static web root.
- Keep authorization in PocketBase API rules, not only UI controls.
- No browser superuser credentials. No committed credentials, binaries, pb_data, backups or exports.
- Never inspect, mutate or test real pb_data without explicit authorization. Tests use OS temporary directories.
- New migrations for applied schema changes. Do not rewrite deployed migrations.
- Keep Bash scripts LF-only and Linux/macOS compatible.
- Change every frontend asset ?v= in public/index.html and public/register.html together to one Asia/Bangkok YYYYMMDDHHmm timestamp after frontend changes.
- Validate JS syntax, PowerShell parsing, Bash syntax, git diff --check. Auth/data changes: node tests/integration.mjs. UI changes: local browser verification at desktop and narrow widths.
- Update docs/HANDOFF.md after material work and update architecture/security contracts when they change.
