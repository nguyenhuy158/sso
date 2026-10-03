# Repository Guidelines

## Project Structure & Module Organization

Single sign-on for every app on `*.huyab.click`, served at `auth.huyab.click`.
One Cloudflare Worker (Hono + TypeScript) runs the Google OAuth flow, stores
users in the shared D1 database and issues an RS256 JWT in the domain-wide
`huyab_sso` cookie. Relying apps verify it against `/.well-known/jwks.json`.

```text
src/
  index.ts                     # Hono app: /login, /callback, /logout, /me, JWKS, landing page
  env.ts                       # Env bindings, cookie names, redirect allow-list, session TTL
  google.ts                    # Google OAuth URL + code exchange
  jwt.ts                       # RS256 sign/verify, public JWKS export
  users.ts                     # sso_users upsert (D1)
  page.ts                      # Server-rendered landing page (HTML string, no framework)
scripts/keygen.mjs             # Generate the RSA private key JWK for JWT_PRIVATE_KEY
schema.sql                     # D1 schema; every table is prefixed sso_ (shared DB)
docs/INTEGRATION.md            # Guide for relying apps (Workers, Express, FastAPI)
scaffold/cloudflare-worker/    # Copy-paste consumer files for other Workers (plain JS)
wrangler.jsonc                 # Worker config: vars, custom domain, shared D1 binding
.dev.vars.example              # Template for local secrets
```

## Build, Test, and Development Commands

- `pnpm install`: install dependencies.
- `pnpm dev`: run the Worker locally with `wrangler dev` (needs `.dev.vars`).
- `pnpm build`: bundle the Worker into `dist/` without deploying
  (`wrangler deploy --dry-run`); catches bundling errors the typecheck misses.
- `pnpm check`: `tsc --noEmit` over `src/`.
- `pnpm lint`: Biome lint + format check (`biome check .`); `pnpm format`
  rewrites files with Biome. Format only files you touch.
- `pnpm db:local` / `pnpm db:remote`: apply `schema.sql` to the local or
  remote D1 database.
- `pnpm keygen`: print a new RSA private key JWK.
- `pnpm run deploy`: `wrangler deploy` to `auth.huyab.click`.

Secrets (`JWT_PRIVATE_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) are set
with `wrangler secret put`, never committed. See `README.md` for first-time setup.

Use `pnpm` for all package commands (pinned via `packageManager`, Node version
in `.nvmrc`). Note `pnpm deploy` is a pnpm built-in; always `pnpm run deploy`.

## Coding Style & Naming Conventions

Use TypeScript with strict compiler settings. Two-space indentation, double
quotes, semicolons, trailing commas in multi-line literals. Prefer named
exports and `import type` for types. Keep route handlers in `src/index.ts`
thin; put protocol logic (OAuth, JWT, D1) in its own module. Escape every
value interpolated into HTML (`esc()` in `page.ts`). New D1 tables must use the
`sso_` prefix because the database is shared with other projects.

Security invariants — do not weaken without a deliberate decision:

- `redirect_uri` is honoured only for `https` URLs under
  `ALLOWED_REDIRECT_SUFFIX`; anything else falls back to `ISSUER` (no open
  redirect).
- OAuth `state` is mirrored in an HttpOnly cookie and checked on `/callback`.
- The session cookie stays HttpOnly, Secure, SameSite=Lax on `COOKIE_DOMAIN`.
- The private key never leaves this Worker; apps only ever see the public JWKS.

## Testing Guidelines

There is no automated test suite yet. Before pushing, run `pnpm check`
and exercise the flow locally with `pnpm dev` (`/login` → Google →
`/callback` → `/me`). If you add tests, use Vitest and colocate them beside the
module (`src/jwt.test.ts`).

## Commit & Pull Request Guidelines

Use Conventional Commits with an emoji prefix, for example
`✨ feat: add /me picture field` or `🐛 fix: reject redirect to bare apex`.
Pull requests should include a short summary, typecheck results, a linked issue
if available, and note any change to cookie, token or redirect behavior because
every `*.huyab.click` app depends on it.

## Agent-Specific Instructions

Keep responses short and focused. If a requirement is unclear, ask before making
assumptions. Changes to claims, cookie attributes or the JWKS shape are breaking
for every relying app: update `docs/INTEGRATION.md` and
`scaffold/cloudflare-worker/` in the same change.
Design UI/UX to fit inside a single viewport by default. Avoid page-level
scrolling; use compact layouts, tabs, panes, or contained internal lists when
content can overflow.
