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

Prefer copying files over retyping a snippet? [`scaffold/cloudflare-worker`](../scaffold/cloudflare-worker)
has the Worker example below as ready-to-copy files (`sso-verifier.js` +
`session.js`), plus the `resolveUserId` pattern from section 6.

### Cloudflare Workers / any WebCrypto runtime

```ts
const ISSUER = "https://auth.huyab.click";
let cachedKey: Promise<CryptoKey> | null = null;

function publicKey() {
  cachedKey ??= (async () => {
    const { keys } = await fetch(`${ISSUER}/.well-known/jwks.json`).then((r) => r.json());
    return crypto.subtle.importKey(
      "jwk",
      { ...keys[0], ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
  })();
  return cachedKey;
}

const decode = (part: string) =>
  Uint8Array.from(
    atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=")),
    (c) => c.charCodeAt(0),
  );

export async function currentUser(request: Request) {
  const token = request.headers.get("Cookie")?.match(/(?:^|;\s*)huyab_sso=([^;]+)/)?.[1];
  if (!token) return null;

  const [header, payload, signature] = token.split(".");
  if (!signature) return null;

  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    await publicKey(),
    decode(signature),
    new TextEncoder().encode(`${header}.${payload}`),
  );
  if (!valid) return null;

  const claims = JSON.parse(new TextDecoder().decode(decode(payload)));
  if (claims.iss !== ISSUER) return null;
  if (claims.exp <= Math.floor(Date.now() / 1000)) return null;
  return claims;
}
```

Guarding a route with it:

```ts
app.get("/dashboard", async (c) => {
  const user = await currentUser(c.req.raw);
  if (!user) {
    const back = encodeURIComponent(new URL(c.req.url).origin + "/dashboard");
    return c.redirect(`https://auth.huyab.click/login?redirect_uri=${back}`, 302);
  }
  return c.html(`<p>Hello ${user.email}</p>`);
});
```

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
