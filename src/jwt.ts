import { KEY_ID, required, type Env } from "./env";

/**
 * RS256 tokens: the private key never leaves this Worker, and relying apps verify
 * with the public key published at /.well-known/jwks.json. A shared HMAC secret
 * would let any app that holds it mint tokens for every other app.
 */

const encoder = new TextEncoder();

export interface SessionClaims {
  iss: string;
  sub: string;
  aud: string;
  email: string | null;
  name: string | null;
  picture: string | null;
  iat: number;
  exp: number;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(input: string): Uint8Array {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")), (c) =>
    c.charCodeAt(0),
  );
}

/** Parses the JSON carried in one base64url segment of a JWT; throws when malformed. */
export function decodeJwtSegment<T>(segment: string): T {
  return JSON.parse(new TextDecoder().decode(base64UrlDecode(segment))) as T;
}

let cachedKey: Promise<CryptoKey> | null = null;
let cachedJwk: JsonWebKey | null = null;

function privateJwk(env: Env): JsonWebKey {
  cachedJwk ??= JSON.parse(required(env.JWT_PRIVATE_KEY, "JWT_PRIVATE_KEY")) as JsonWebKey;
  return cachedJwk;
}

function signingKey(env: Env): Promise<CryptoKey> {
  cachedKey ??= crypto.subtle.importKey(
    "jwk",
    privateJwk(env),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return cachedKey;
}

export async function signSession(env: Env, claims: SessionClaims): Promise<string> {
  const header = base64UrlEncode(
    encoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT", kid: KEY_ID })),
  );
  const payload = base64UrlEncode(encoder.encode(JSON.stringify(claims)));
  const input = `${header}.${payload}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    await signingKey(env),
    encoder.encode(input),
  );
  return `${input}.${base64UrlEncode(new Uint8Array(signature))}`;
}

/** Public half of the signing key, in the shape relying apps expect. */
export function publicJwks(env: Env): { keys: Record<string, unknown>[] } {
  const { n, e } = privateJwk(env);
  return {
    keys: [{ kty: "RSA", use: "sig", alg: "RS256", kid: KEY_ID, n, e }],
  };
}

/**
 * Verification is only needed for this service's own /me endpoint; relying apps
 * verify independently against the JWKS.
 */
export async function verifySession(env: Env, token: string): Promise<SessionClaims | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const { n, e } = privateJwk(env);
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: "RSA", n, e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );

  const signature = base64UrlDecode(parts[2]);
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    signature,
    encoder.encode(`${parts[0]}.${parts[1]}`),
  );
  if (!valid) return null;

  try {
    const claims = decodeJwtSegment<SessionClaims>(parts[1]);
    return claims.exp > Math.floor(Date.now() / 1000) ? claims : null;
  } catch {
    return null;
  }
}
