# huyab.click SSO

One Google OAuth client for every app on `*.huyab.click`. A visitor signs in once
at `auth.huyab.click`; every other app reads the resulting cookie.

- **Session cookie** `huyab_sso`, set with `Domain=.huyab.click`, so every
  subdomain receives it. HttpOnly, Secure, SameSite=Lax.
- **Token** RS256 JWT. The private key stays in this Worker; apps verify with the
  public key at `/.well-known/jwks.json`. No app can mint a token for another app,
  which a shared HMAC secret would have allowed.
- **Users** live in the shared D1 instance under the `sso_` table prefix.

## Endpoints

| Route | Purpose |
| --- | --- |
| `GET /login?redirect_uri=<url>` | starts the Google flow, returns the visitor to `<url>` |
| `GET /callback` | Google's redirect target; issues the cookie |
| `GET /logout?redirect_uri=<url>` | clears the cookie, signing out of every app |
| `GET /me` | current session as JSON, or 401 |
| `GET /.well-known/jwks.json` | public keys for verification |

`redirect_uri` is only honoured for `https` URLs inside `huyab.click`; anything
else falls back to this service's own page, so the login endpoint cannot be used
as an open redirect.

## Setup

```sh
pnpm install
pnpm db:remote                                  # sso_ tables in the shared D1
pnpm keygen | pnpm wrangler secret put JWT_PRIVATE_KEY
pnpm wrangler secret put GOOGLE_CLIENT_ID
pnpm wrangler secret put GOOGLE_CLIENT_SECRET
pnpm run deploy
```

The Google OAuth client needs exactly one authorized redirect URI, added once:

```
https://auth.huyab.click/callback
```

That is the whole point of this service: new apps never touch the Google console
again.

## Using it from an app

Full integration guide, with examples for Workers, Node/Express and FastAPI:
[docs/INTEGRATION.md](docs/INTEGRATION.md). The short version follows.

Send visitors who need an account to the login endpoint:

```
https://auth.huyab.click/login?redirect_uri=https://yourapp.huyab.click/
```

Then verify the cookie. JavaScript/TypeScript apps use
[`@huyab/sso`](https://github.com/nguyenhuy158/kit#huyabsso) (Web Crypto, no
dependency, JWKS key cached per isolate) instead of copying a verifier:

```sh
pnpm add "github:nguyenhuy158/kit#v0.1.0&path:packages/sso"
```

```ts
import { getClaimsFromRequest, ssoUrl } from "@huyab/sso";

const claims = await getClaimsFromRequest(request, env.SSO_ISSUER); // { sub, email, name, picture, exp } | null
if (!claims) return Response.redirect(ssoUrl(env.SSO_ISSUER, "/login", request.url), 302);
```

Hono apps can guard routes with `requireUser()` from `@huyab/sso/hono`. Anything
else that can fetch a URL and check an RSA signature works the same way; see the
guide.

## Local development

```sh
cp .dev.vars.example .dev.vars      # then: pnpm keygen, paste into JWT_PRIVATE_KEY
pnpm db:local
pnpm dev
```

## Trade-off worth knowing

One domain-wide cookie means one compromised app can leak the session for all of
them. The cookie is HttpOnly, so an XSS cannot read it directly, but a bug in any
`*.huyab.click` app can still act as the signed-in user against the others.
