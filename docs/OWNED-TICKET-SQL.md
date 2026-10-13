# Owned ticket SQL handoff

`supabase/drafts/owned-ticket-detail.sql` is a manually reviewed, replayable draft, not a migration-history entry. It requires the foundation and order-payment RPC drafts. On 2026-10-13 Miguel reports manual execution with `Success. No rows returned` and both public/private function-existence checks true. The Dashboard screenshot shows `app-diwo`, branch `main` labelled `PRODUCTION`; this is not independent verification of project reference, execute grants, unchanged data or app Production readiness. Do not reapply simply to repeat the existence check. Hosted grant/data-invariant verification remains pending; user-confirmed signed detail/exports are recorded in [OWNED-TICKET-UI.md](OWNED-TICKET-UI.md).

The public `read_owned_ticket(uuid)` function is an invoker wrapper over a private-schema definer. The implementation derives the Clerk subject from the verified JWT and reads the current role from `public.user_roles`; buyer, admin, and door staff may read only their own ticket, with no admin ownership bypass. Only confirmed orders return. Missing and non-owned ticket IDs return no row. Valid tickets return their persisted 64-character token; used and revoked tickets retain history but return a null token.

The private helper has an empty search path and the public RPC is executable only by `authenticated`; `PUBLIC`, `anon`, and `service_role` are revoked. No table-level token grant is added. Authenticated must have execute on the helper so the invoker wrapper can call it; `diwo_private` is not a PostgREST-exposed schema. Apply manually only after reviewing the SQL. Local PGlite tests use synthetic identities and do not prove Clerk JWT verification or hosted permissions.

Run the focused validation from `web/`:

```powershell
& "..\.diwo-tools\node\node-v24.16.0-win-x64\node.exe" --test supabase/validation/tests/owned-ticket-detail.test.mjs
```
