# Integrating an app with huyab.click SSO

Everything an app needs in order to let people sign in once and stay signed in
across every `*.huyab.click` service.

- **You never touch the Google console.** This service owns the only OAuth client.
- **You never hold a secret.** Verification uses a public key.
- **You add two things:** a link to the login endpoint, and a function that
  verifies a cookie.

---

## 1. How it works

```
visitor                     your app                    auth.huyab.click        Google
   |  GET /dashboard            |                              |                  |
   |--------------------------->|                              |                  |
   |   302 to auth /login       |                              |                  |
   |<---------------------------|                              |                  |
   |  GET /login?redirect_uri=https://yourapp.huyab.click/     |                  |
   |---------------------------------------------------------->|                  |
   |                            |     OAuth authorization code flow               |
   |                            |                              |<---------------->|
   |   302 back to your app, Set-Cookie huyab_sso=<JWT> for .huyab.click          |
   |<----------------------------------------------------------|                  |
   |  GET /dashboard  (cookie now sent automatically)           |                  |
   |--------------------------->|                              |                  |
   |                            | verify JWT with public key   |                  |
   |                            | (fetched once, then cached)  |                  |
```

The cookie is set with `Domain=.huyab.click`, so the browser sends it to every
subdomain without a second login.

## 2. Endpoints you use

| Endpoint | When |
| --- | --- |
| `GET https://auth.huyab.click/login?redirect_uri=<your url>` | send visitors here to sign in |
| `GET https://auth.huyab.click/logout?redirect_uri=<your url>` | sign out of every app at once |
| `GET https://auth.huyab.click/.well-known/jwks.json` | public keys, for verifying the cookie |
| `GET https://auth.huyab.click/me` | current session as JSON, if you would rather not verify locally |

`redirect_uri` must be an `https` URL whose host is inside `huyab.click`;
anything else is ignored and the visitor lands on the SSO page instead.

## 3. The cookie

Name `huyab_sso`, an RS256 JWT. HttpOnly, so only your server can read it —
browser JavaScript cannot, by design.

```json
{
  "iss": "https://auth.huyab.click",
  "sub": "7",
  "aud": "huyab.click",
  "email": "someone@gmail.com",
  "name": "Someone",
  "picture": "https://lh3.googleusercontent.com/...",
  "iat": 1786290000,
  "exp": 1786376400
}
```

`sub` is the stable user id in this SSO service. Key your own rows on it. It is a
number-as-string and never changes for a given Google account.

Sessions last 24 hours.

## 4. Verify it

Whatever the language, the checks are the same four:

1. the RS256 signature matches the public key from the JWKS,
2. `iss` equals `https://auth.huyab.click`,
3. `exp` is in the future,
4. cache the imported key — refetching JWKS per request adds a round trip to
   every page load.

### Cloudflare Workers / any WebCrypto runtime

Use [`@huyab/sso`](https://github.com/nguyenhuy158/kit#huyabsso) instead of
copying a verifier: plain TypeScript on Web Crypto, no dependency, it does all
four checks (keys cached per isolate, failed fetches not cached) and reads the
`huyab_sso` cookie or an `Authorization: Bearer` header.

```sh
pnpm add "github:nguyenhuy158/kit#v0.1.0&path:packages/sso"
```

Add `"vars": { "SSO_ISSUER": "https://auth.huyab.click" }` to `wrangler.jsonc`;
it is a public URL, not a secret. Hono:

```ts
import { requireUser, type SsoVariables } from "@huyab/sso/hono";

type Env = { Bindings: { SSO_ISSUER: string }; Variables: SsoVariables };
const app = new Hono<Env>();

// 401 {"error":"unauthorized"} unless the token verifies against SSO_ISSUER.
app.use("/api/*", requireUser());
app.get("/api/me", (c) => c.json({ email: c.get("user").email }));
```

Without Hono, guarding a page and sending signed-out visitors to the login:

```ts
import { getClaimsFromRequest, ssoUrl } from "@huyab/sso";

const user = await getClaimsFromRequest(request, env.SSO_ISSUER); // SsoClaims | null
if (!user) return Response.redirect(ssoUrl(env.SSO_ISSUER, "/login", request.url), 302);
return new Response(`Hello ${user.email}`);
```

`verifySsoToken(token, issuer, { audience: "huyab.click" })` adds the optional
`aud` check.

### Node.js / Express

```js
import { createRemoteJWKSet, jwtVerify } from "jose";

const ISSUER = "https://auth.huyab.click";
const jwks = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`)); // caches internally

export async function requireUser(req, res, next) {
  const token = req.cookies?.huyab_sso;
  if (token) {
    try {
      const { payload } = await jwtVerify(token, jwks, { issuer: ISSUER });
      req.user = payload;
      return next();
    } catch {
      /* fall through to the redirect */
    }
  }
  const back = encodeURIComponent(`${req.protocol}://${req.get("host")}${req.originalUrl}`);
  res.redirect(`${ISSUER}/login?redirect_uri=${back}`);
}
```

### Python / FastAPI

```python
import time
from fastapi import Cookie, HTTPException
from jwt import PyJWKClient, decode as jwt_decode  # pip install pyjwt[crypto]

ISSUER = "https://auth.huyab.click"
jwks_client = PyJWKClient(f"{ISSUER}/.well-known/jwks.json")  # caches internally

def current_user(huyab_sso: str | None = Cookie(default=None)) -> dict:
    if not huyab_sso:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        key = jwks_client.get_signing_key_from_jwt(huyab_sso).key
        claims = jwt_decode(huyab_sso, key, algorithms=["RS256"], issuer=ISSUER, audience="huyab.click")
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid session")
    if claims["exp"] <= time.time():
        raise HTTPException(status_code=401, detail="Session expired")
    return claims
```

### The lazy option

If verification is more than you want to write, ask the service instead. Costs a
round trip per check, so cache the answer for the request at least.

```js
const res = await fetch("https://auth.huyab.click/me", {
  headers: { Cookie: request.headers.get("Cookie") ?? "" },
});
const user = res.ok ? (await res.json()).user : null;
```

Note this only works server-side: from browser JavaScript the request needs
`credentials: "include"`, and the response has no CORS headers, so cross-origin
calls are blocked on purpose.

## 5. Signing out

Clear your own session, then hand off:

```
https://auth.huyab.click/logout?redirect_uri=https://yourapp.huyab.click/
```

Deleting only your app's cookie is not enough. The SSO cookie belongs to the
whole domain, so your app would sign the visitor straight back in on the next
request. Only the issuer can clear it.

## 6. Mapping to your own users

Do not store the email as the key — people change those. Key on `sub`:

```sql
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sso_sub TEXT NOT NULL UNIQUE,   -- claims.sub
    email TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
```

Create the row the first time you see a `sub`. There is no separate signup step:
a valid cookie means the person already authenticated with Google.

Worked example: `webhook-tester` does exactly this in
`worker/src/adapters/outbound/security/sso-verifier.ts` and
`worker/src/adapters/inbound/http/middleware.ts`.

## 7. Things that will bite you

- **Local development.** The cookie is `Secure` and scoped to `.huyab.click`, so
  it never reaches `localhost`. Either point a dev subdomain at your local
  machine, or mint test tokens with the dev key, as
  `webhook-tester` does in its local test script.
- **Public endpoints.** Guard only what needs an account. Webhook receivers,
  health checks and callbacks must stay open, otherwise the systems calling them
  get a login page.
- **One cookie, one blast radius.** A bug in any `*.huyab.click` app can act as
  the signed-in visitor against the others. Keep untrusted or experimental apps
  on a different domain.
- **Clock skew.** The `exp` check is exact. If your host's clock drifts, allow a
  small tolerance rather than rejecting valid sessions.
- **Do not put the JWT in `localStorage`.** It arrives HttpOnly precisely so an
  XSS cannot steal it; copying it into JavaScript-readable storage throws that
  away.
