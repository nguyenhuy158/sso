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
  jwt.ts                       # RS256 sign/verify, base64url JWT decoding, public JWKS export
  users.ts                     # sso_users upsert (D1)
  page.ts                      # Server-rendered landing page (HTML string, no framework)
scripts/keygen.mjs             # Generate the RSA private key JWK for JWT_PRIVATE_KEY
e2e/                           # E2E smoke (playwright-core): run.mjs, readonly-smoke.mjs, ui-smoke.mjs
migrations/                    # D1 migrations; every table is prefixed sso_ (shared DB), history in sso_migrations
docs/INTEGRATION.md            # Guide for relying apps (Workers, Express, FastAPI)
wrangler.jsonc                 # Worker config: vars, custom domain, shared D1 binding
.dev.vars.example              # Template for local secrets
```

## Ecosystem

How this repo fits with the others:
[kit/docs/ECOSYSTEM.md](https://github.com/nguyenhuy158/kit/blob/main/docs/ECOSYSTEM.md).

- Kit packages used: `@huyab/config` (Biome, tsconfig), `@huyab/e2e` (E2E
  server lifecycle, Chromium lookup) and the reusable `check.yml` CI. Not
  `@huyab/sso`: this Worker is the issuer and verifies its own tokens with the
  public half of its private key, without fetching the JWKS. Relying apps use
  `@huyab/sso`.
- Talks to: Google OAuth and the shared D1 `db` (`sso_users`). Relied on by
  every app that reads the `huyab_sso` cookie + JWKS: ai-english, chia-keo,
  notes, monitor, share, cardstat, hooks, games, mailer, and the iOS
  clients (chia-keo-ios, notes-ios, monitor-ios) through WebView login.

## Build, Test, and Development Commands

- `pnpm install`: install dependencies.
- `pnpm dev`: run the Worker locally with `wrangler dev` (needs `.dev.vars`).
- `pnpm build`: bundle the Worker into `dist/` without deploying
  (`wrangler deploy --dry-run`); catches bundling errors the typecheck misses.
- `pnpm check`: `tsc --noEmit` over `src/`.
- `pnpm lint`: Biome lint + format check (`biome check .`); `pnpm format`
  rewrites files with Biome. Format only files you touch.
- `pnpm db:local` / `pnpm db:remote`: apply pending `migrations/` to the local or
  remote D1 database.
- `pnpm keygen`: print a new RSA private key JWK.
- `pnpm e2e`: E2E smoke against local `wrangler dev`; `pnpm e2e:prod`: the
  read-only part against `https://auth.huyab.click`.
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

There are no unit tests yet. Before pushing, run `pnpm check`, `pnpm build`
and `pnpm e2e`. If you add unit tests, use Vitest and colocate them beside the
module (`src/jwt.test.ts`).

E2E lives in `e2e/` (playwright-core; server lifecycle and Chromium lookup from
`@huyab/e2e`, Chromium from `PLAYWRIGHT_CHROMIUM_PATH`, the Playwright cache or
a system Chrome):

- `pnpm e2e` (`e2e/run.mjs`) mints a throwaway signing key, starts
  `wrangler dev` with it via `--env-file` (your `.dev.vars` is not used), then
  runs `readonly-smoke.mjs` and `ui-smoke.mjs`. The second one signs session
  tokens with that key to cover `/me`, the signed-in page, tampered/expired
  tokens and `/logout`. CI runs this as the `e2e` job.
- `pnpm e2e:prod` runs only `readonly-smoke.mjs` against production. It must
  stay GET-only: `/`, `/.well-known/jwks.json`, `/me`, `/login` (redirect not
  followed), `/callback` with a forged state (400) and a 404 path. Never add
  sign-in, token minting or anything that writes to it.

The real Google round trip (`/login` → Google → `/callback`) is still manual
with `pnpm dev`.

## Commit & Pull Request Guidelines

Use Conventional Commits with an emoji prefix, for example
`✨ feat: add /me picture field` or `🐛 fix: reject redirect to bare apex`.
Pull requests should include a short summary, typecheck results, a linked issue
if available, and note any change to cookie, token or redirect behavior because
every `*.huyab.click` app depends on it.

## Agent-Specific Instructions

Keep responses short and focused. If a requirement is unclear, ask before making
assumptions. Changes to claims, cookie attributes or the JWKS shape are breaking
for every relying app: update `docs/INTEGRATION.md` in the same change and
`@huyab/sso` in kit (new tag, then bump every consumer).
Design UI/UX to fit inside a single viewport by default. Avoid page-level
scrolling; use compact layouts, tabs, panes, or contained internal lists when
content can overflow.
