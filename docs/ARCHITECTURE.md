# Architecture

Browser → static files in public/ → same-origin PocketBase REST API → SQLite

PocketBase version is pinned to 0.39.8, matching the source project. No build step and no frontend dependencies. Node.js is needed only for the integration test.

## Collections

- `users`: PocketBase auth fields plus required `name` (120 characters), role select (`viewer`, `editor`, `admin`) and `active` boolean.
- `items`: required `title` (200), optional `description` (4000), integer `quantity` (0–1,000,000), required `due_date` (YYYY-MM-DD), status (`todo`, `doing`, `done`), created/updated timestamps.

API rules require active users from the `users` collection. All active users can read items; editor/admin can write. Users can view themselves; admin can list other users and update other users. Creation and deletion through the generic users API are locked. The users update hook accepts only name/role/active from app clients. App admins cannot modify their own account, preserving at least one active app admin from self-lockout. A superuser can recover accounts.

`POST /api/starter/register` explicitly creates an active, unverified viewer and ignores client privilege fields. It has a 16 KB body limit and honeypot. Database schema validates lengths/types/selects; the items hook trims the title and validates calendar dates on create/update. No scheduling or overlap logic belongs to this generic application.

## Frontend

`api.js` stores user tokens in sessionStorage scoped by API base URL. `app.js` refreshes authentication when loading a list, then renders role-aware controls. A 401 clears the session; other failures preserve login and display an error. API rules remain authoritative when roles change during an open session. Account data is not refreshed continuously.

`app.js` builds list content with textContent, not user-controlled HTML. Searches encode query parameters and quote filter values. List generations discard outdated responses after a new search, navigation or logout. Forms disable the submit button while saving. Native dialogs provide keyboard focus containment and Escape dismissal.

## Schema changes

Use a new migration for every applied schema change. Test against temporary data. Serve only public/; database, scripts, binaries and Git metadata must never be under the static web root.

References: [PocketBase API rules](https://pocketbase.io/docs/api-rules-and-filters/) and [JavaScript routing](https://pocketbase.io/docs/js-routing/).
