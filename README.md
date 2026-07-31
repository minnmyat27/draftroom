# Draftroom

Draftroom is a local-first collaborative notebook with a public website,
Supabase synchronization, and a future Codex plugin.

## Current features

- Notes stored in IndexedDB
- Automatic saving
- Full-text search across titles, content, and tags
- Favorites and archive views
- Tagging and sorting
- JSON backup export
- Owner, editor, and viewer permissions
- Single-use invitation links that expire after seven days
- Realtime updates for open shared notes
- Responsive interface
- Keyboard shortcuts: `Ctrl+K` to search and `Ctrl+N` for a new note

## Open locally

Double-click `run-dev.cmd`. It starts a small hidden Python server on port `4173`
and opens the Draftroom website at `http://localhost:4173` in the Opera GX
`Dev` profile. The authenticated notebook lives at `/app.html`.

## Data architecture

`db.js` owns browser persistence. The interface in `app.js` calls a small set of
data functions:

- `getAllNotes`
- `saveNote`
- `removeNote`
- `seedNotesIfEmpty`

The Supabase phase will add a remote repository with the same responsibilities,
authentication, Row-Level Security, synchronization state, and conflict handling.

## Planned phases

1. Offline notebook foundation
2. Supabase authentication and cloud synchronization
3. Installable PWA and resilient offline queue
4. Narrow, authenticated notes API
5. Personal Codex plugin

## Supabase setup

1. Open the Supabase project dashboard.
2. Go to **SQL Editor** and create a new query.
3. Paste the complete contents of `supabase-schema.sql`.
4. Run the query and confirm that it completes without errors.

The schema enables and forces Row-Level Security. Authenticated users receive
permission to select, insert, update, and delete rows, but policies restrict every
operation to rows whose `user_id` matches the signed-in user.

The browser connection uses `config.js`, which contains only the project URL and
Supabase publishable key. Never add a secret key, service-role key, database
password, or personal access token to this project.

After the schema is applied, use **Sign in to sync** inside Draftroom. New
accounts may need to confirm their email before their first sign-in, depending on
the project's Supabase Auth settings.

### Collaboration upgrade

After the base schema, run the complete contents of
`supabase-collaboration-upgrade.sql` in the SQL Editor. It creates:

- collaborator memberships with `editor` and `viewer` roles;
- expiring, single-use invitation links;
- private authorization helper functions;
- owner/editor/viewer RLS policies;
- a secure invitation-redemption RPC;
- Realtime publication for authorized note updates.

In **Authentication → URL Configuration**, add:

`http://localhost:4173/**`

For the current GitHub Pages deployment, also add:

`https://minnmyat27.github.io/draftroom/**`

Set the production Site URL to:

`https://minnmyat27.github.io/draftroom/`

Replace that Site URL with the custom HTTPS domain after connecting one.

Current editing uses a last-write-wins note model. It supports live updates and
shared editing, but simultaneous typing in the exact same note can overwrite the
other person's most recent unsaved text. A later CRDT-based editor can add
character-level conflict-free collaboration.
