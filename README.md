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
npm install
npm run db:remote                                  # sso_ tables in the shared D1
npm run keygen | npx wrangler secret put JWT_PRIVATE_KEY
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npm run deploy
```

The Google OAuth client needs exactly one authorized redirect URI, added once:

```
https://auth.huyab.click/callback
```

That is the whole point of this service: new apps never touch the Google console
again.

## Using it from an app

Send visitors who need an account to the login endpoint:

```
https://auth.huyab.click/login?redirect_uri=https://yourapp.huyab.click/
```

Then verify the cookie. The snippet below is a Worker; anything that can fetch a
URL and check an RSA signature works the same way.

```ts
const ISSUER = "https://auth.huyab.click";
let jwks: CryptoKey | null = null;

async function publicKey() {
  if (jwks) return jwks;
  const { keys } = await fetch(`${ISSUER}/.well-known/jwks.json`).then((r) => r.json());
  jwks = await crypto.subtle.importKey(
    "jwk",
    { ...keys[0], ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return jwks;
}

const decode = (part: string) =>
  Uint8Array.from(
    atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=")),
    (c) => c.charCodeAt(0),
  );

export async function currentUser(request: Request) {
  const token = request.headers.get("Cookie")?.match(/huyab_sso=([^;]+)/)?.[1];
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
  if (claims.iss !== ISSUER || claims.exp <= Date.now() / 1000) return null;
  return claims; // { sub, email, name, picture, exp }
}
```

Cache the imported key across requests, as above — fetching the JWKS on every
request would add a round trip to each page load.

## Local development

```sh
cp .dev.vars.example .dev.vars      # then: npm run keygen, paste into JWT_PRIVATE_KEY
npm run db:local
npm run dev
```

## Trade-off worth knowing

One domain-wide cookie means one compromised app can leak the session for all of
them. The cookie is HttpOnly, so an XSS cannot read it directly, but a bug in any
`*.huyab.click` app can still act as the signed-in user against the others.
