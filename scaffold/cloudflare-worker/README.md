# Scaffold: Cloudflare Worker consumer

Copy-paste starting point for wiring a Worker up to `auth.huyab.click`. Plain
JS, Web Crypto only — no `jose` dependency, works in any Worker regardless of
framework (Hono, itty-router, raw `fetch` handler...).

Based on the reference implementation in [`cardstat`](https://github.com/nguyenhuy158/cardstat)
(`src/infrastructure/auth/sso-verifier.ts`), the most battle-tested of the
apps currently integrated. See [`../../docs/INTEGRATION.md`](../../docs/INTEGRATION.md)
for the full protocol writeup and non-Worker examples (Node/Express, Python).

## Files

- **`sso-verifier.js`** — `verifySsoToken(token, issuer)`. Verifies the RS256
  signature against the issuer's JWKS (cached per isolate, keyed by `kid` so
  key rotation doesn't break anything mid-flight). Returns claims or `null`.
  No I/O beyond the JWKS fetch — copy as-is.
- **`session.js`** — cookie parsing, login/logout URL builder, and
  `resolveUserId` (SSO claims -> a row in *your* `users` table, keyed on
  email). You will likely adjust the SQL to your schema; everything else is
  copy-as-is.

## Wiring it in

1. Copy both files into your Worker's source tree.
2. Add `SSO_ISSUER` to `wrangler.jsonc` vars: `"https://auth.huyab.click"`.
   It's a public URL, not a secret.
3. In your router / fetch handler:

```js
import { getClaimsFromRequest, resolveUserId, ssoUrl } from "./session.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/login") {
      return Response.redirect(ssoUrl(env.SSO_ISSUER, "/login", `${url.origin}/`), 302);
    }

    if (url.pathname === "/dashboard") {
      const claims = await getClaimsFromRequest(request, env.SSO_ISSUER);
      if (!claims) {
        return Response.redirect(ssoUrl(env.SSO_ISSUER, "/login", url.toString()), 302);
      }
      const userId = await resolveUserId(env.DB, claims);
      return new Response(`Hello ${claims.email}, user id ${userId}`);
    }

    // ...
  }
};
```

4. Your `users` table needs at least `id`, `email` (unique). See
   `session.js`'s `resolveUserId` for the exact shape expected.

## What you do NOT need

- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — the SSO service owns those.
- A shared JWT secret — verification uses the issuer's public key.
- Your own `/callback` route — the SSO service redirects straight back to the
  URL you passed as `redirect_uri`.

## Gotchas

Same list as the main integration doc, worth repeating here:

- The cookie is `Secure` + `Domain=.huyab.click` — it never reaches
  `localhost`. Test against a real `*.huyab.click` deployment, or mint a test
  token with the dev key (see `webhook-tester`'s local test script).
- Only guard routes that need an account. Webhook receivers and health checks
  must stay open.
- `verifySsoToken` returns `null` for literally everything short of "valid,
  current, correctly signed." Do not add a "partial trust" branch.
