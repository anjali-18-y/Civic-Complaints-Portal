Expose Civic Connect as an MCP server so AI assistants (ChatGPT, Claude, Cursor, etc.) can connect and use its tools.

## What gets built

1. **Install packages**: `@lovable.dev/mcp-js` and `zod`.

2. **Tool files** under `src/lib/mcp/tools/` (one per file, each a `defineTool`):
   - `list-reports.ts` — list civic reports for the signed-in user (or all reports if admin), with optional status/category filters. Read-only.
   - `get-report.ts` — fetch a single report by id (RLS enforced). Read-only.
   - `create-report.ts` — submit a new civic report (title, description, category, priority, optional lat/lng/address). Mutating.
   - `update-report-status.ts` — admin/staff only; update a report's status. Mutating.

   Each tool uses Zod input schemas, sets accurate `annotations` (readOnlyHint / destructiveHint), and derives the user from the verified OAuth token via `ctx.getUserId()` / `ctx.getToken()` — never from tool input.

3. **MCP entry** `src/lib/mcp/index.ts` — `defineMcp` with name `civic-connect-mcp`, clear title, version, `instructions`, and the four tools. Import-safe (no top-level env reads / IO). OAuth issuer built from `VITE_SUPABASE_PROJECT_ID`.

4. **Vite plugin**: add `mcpPlugin()` from `@lovable.dev/mcp-js/stacks/supabase/vite` to `vite.config.ts`. This generates `supabase/functions/mcp/index.ts` at build time (not hand-authored).

5. **Auth — Supabase OAuth 2.1 as authorization server** (required because tools read/write per-user data under RLS):
   - Enable Supabase OAuth server + dynamic client registration via `supabase--configure_oauth_server`.
   - Add a consent route at `/.lovable/oauth/consent` (new `src/pages/OAuthConsent.tsx` + route in `App.tsx`) using `supabase.auth.oauth.getAuthorizationDetails` / `approveAuthorization` / `denyAuthorization`.
   - Update `Auth.tsx` so unauthenticated visitors on the consent page bounce to `/auth?next=...` and return to the full consent URL after sign-in (validated as same-origin relative path). Only email/password today, so no social redirect changes needed.
   - Wire `auth: auth.oauth.issuer(...)` in `defineMcp` with `https://${VITE_SUPABASE_PROJECT_ID}.supabase.co/auth/v1` and `acceptedAudiences: "authenticated"`. Tools build a per-request Supabase client with the forwarded bearer token so RLS runs as the real user.

6. **Favicon**: add a simple Civic Connect SVG favicon so the connector card has a proper icon.

7. **Validate + deploy**:
   - Regenerate `.lovable/mcp/manifest.json` via `app_mcp_server--extract_mcp_manifest`.
   - Deploy the generated `mcp` function via `supabase--deploy_edge_functions`.

## Notes / assumptions
- Uses existing `reports` and `user_roles` tables and existing RLS — no schema changes.
- Admin-only actions rely on existing `is_admin()` via RLS; `update-report-status` also guards in code.
- No new secrets required.
- Does not touch the flagged "Anyone can view reports" policy — remains a separate open item.

Confirm and I'll build it.