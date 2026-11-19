# huyab.cfd SSO

One Google OAuth client for every app on `*.huyab.cfd`. A visitor signs in once
at `auth.huyab.cfd`; every other app reads the resulting cookie.

- **Session cookie** `huyab_sso`, set with `Domain=.huyab.cfd`, so every
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
| `POST /token` | `Authorization: Bearer <auth key>` returns a 1 hour JWT for CLIs |
| `POST /keys`, `GET /keys`, `GET /keys/:id/secret`, `DELETE /keys/:id` | make, list, show again and revoke auth keys (signed-in `ADMIN_EMAIL` only) |
| `GET /api/version` | public build info (commit, branch, builtAt) |
| `GET /api/health` | public health check: `{ok:true}` or 500 `{ok:false,hint}` |

`redirect_uri` is only honoured for `https` URLs inside `huyab.cfd`; anything
else falls back to this service's own page, so the login endpoint cannot be used
as an open redirect.

Native apps sign in through `/login?redirect_uri=<app URI>` when the URI is listed
exactly in `ALLOWED_APP_REDIRECTS` (`wrangler.jsonc`, comma-separated). After Google
the browser goes to `<app URI>?sso=<jwt>`, so the app can send it as `Authorization: Bearer`.

## Auth keys for CLIs

An auth key lets a CLI get a token without Google, like a Tailscale auth key. Signed in as `ADMIN_EMAIL`, open `https://auth.huyab.cfd`: the **Auth keys** panel makes a key (name, 1-90 days, default 90), copies it, and revokes it. Put the key in BWS.

Keys are looked up by SHA-256 hash. When `KEY_ENCRYPTION_SECRET` is set they are also stored encrypted (AES-GCM), so the admin can copy a key again (`GET /keys/:id/secret`, admin only, active keys only). Without the secret a key is shown once and cannot be recovered. Losing the secret loses the copy button, not the keys.

```sh
# Same thing without the UI (cookie of the signed-in admin):
curl -X POST https://auth.huyab.cfd/keys -H 'content-type: application/json' \
  -H "cookie: huyab_sso=<your cookie>" -d '{"label":"mac cli","days":90}'
# Trade the key for a 1 hour JWT:
curl -sX POST https://auth.huyab.cfd/token -H "Authorization: Bearer $KEY" | jq -r .access_token
```

Send the JWT as `Authorization: Bearer` to any app that reads Bearer (`@huyab/sso`). A key acts as the admin who made it. First deploy: `pnpm db:remote`, then `wrangler secret put ADMIN_EMAIL` and `wrangler secret put KEY_ENCRYPTION_SECRET`.

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
https://auth.huyab.cfd/callback
```

That is the whole point of this service: new apps never touch the Google console
again.

## Using it from an app

Full integration guide, with examples for Workers, Node/Express and FastAPI:
[docs/INTEGRATION.md](docs/INTEGRATION.md). The short version follows.

Send visitors who need an account to the login endpoint:

```
https://auth.huyab.cfd/login?redirect_uri=https://yourapp.huyab.cfd/
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
`*.huyab.cfd` app can still act as the signed-in user against the others.
