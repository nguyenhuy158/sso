/**
 * Verify the `huyab_sso` cookie issued by auth.huyab.click. Plain Web Crypto,
 * no dependency — works in any Cloudflare Worker regardless of framework.
 *
 * Adapted from the reference implementation in `cardstat`
 * (src/infrastructure/auth/sso-verifier.ts). If your runtime has `jose`
 * available, `createRemoteJWKSet` + `jwtVerify` does the same thing with less
 * code — see docs/INTEGRATION.md's Node/Express example.
 */

/** Cache per isolate: fetching the JWKS on every request adds a needless round trip. */
const keyCache = new Map();

function publicKey(issuer, kid) {
  const cacheKey = `${issuer}#${kid}`;
  const cached = keyCache.get(cacheKey);
  if (cached) return cached;

  const pending = (async () => {
    const response = await fetch(`${issuer}/.well-known/jwks.json`);
    if (!response.ok) throw new Error(`JWKS fetch failed: ${response.status}`);

    const { keys } = await response.json();
    const jwk = keys?.find((key) => key.kid === kid) ?? keys?.[0];
    if (!jwk) throw new Error("JWKS has no usable key");

    return crypto.subtle.importKey(
      "jwk",
      { ...jwk, ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
  })();

  keyCache.set(cacheKey, pending);
  // A failed fetch must not poison the cache for the rest of the isolate's life.
  pending.catch(() => keyCache.delete(cacheKey));
  return pending;
}

function base64UrlDecode(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Returns the claims when the token is valid, `null` for every other case
 * (malformed, bad signature, wrong issuer, expired, JWKS unreachable). There
 * is no partial-trust result — callers treat `null` as "not signed in".
 *
 * @param {string} token - raw value of the `huyab_sso` cookie
 * @param {string} issuer - e.g. "https://auth.huyab.click"
 * @returns {Promise<{iss: string, sub: string, email: string, name?: string, picture?: string, exp: number} | null>}
 */
export async function verifySsoToken(token, issuer) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  try {
    const header = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[0])));

    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      await publicKey(issuer, header.kid ?? ""),
      base64UrlDecode(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    );
    if (!valid) return null;

    const claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1])));
    if (claims.iss !== issuer) return null;
    if (!claims.exp || claims.exp <= Math.floor(Date.now() / 1000)) return null;
    if (!claims.sub || !claims.email) return null;

    return claims;
  } catch {
    return null;
  }
}
