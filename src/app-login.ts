import { open, seal } from "./secret-box";

const CODE_TTL_SECONDS = 60;
const CODE_SECRET_PREFIX = "app-code:";
const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const MILLISECONDS_PER_SECOND = 1000;

type AppCode = { token: string; challenge: string; exp: number };

const nowSeconds = (now: number) => Math.floor(now / MILLISECONDS_PER_SECOND);
const codeSecret = (signingKey: string) => CODE_SECRET_PREFIX + signingKey;

export const isCodeChallenge = (value: string | undefined): value is string =>
  value !== undefined && CHALLENGE_PATTERN.test(value);

export async function s256(verifier: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  );
  return btoa(String.fromCharCode(...digest))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function sealAppCode(
  signingKey: string,
  token: string,
  challenge: string,
  now = Date.now(),
): Promise<string> {
  const code: AppCode = {
    token,
    challenge,
    exp: nowSeconds(now) + CODE_TTL_SECONDS,
  };
  return seal(codeSecret(signingKey), JSON.stringify(code));
}

export async function redeemAppCode(
  signingKey: string,
  sealed: string,
  verifier: string,
  now = Date.now(),
): Promise<string | null> {
  const plain = await open(codeSecret(signingKey), sealed);
  if (!plain) return null;
  const code = JSON.parse(plain) as AppCode;
  if (code.exp < nowSeconds(now)) return null;
  return (await s256(verifier)) === code.challenge ? code.token : null;
}
