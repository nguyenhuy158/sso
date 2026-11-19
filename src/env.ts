export interface Env {
  DB: D1Database;
  ISSUER: string;
  COOKIE_DOMAIN: string;
  ALLOWED_REDIRECT_SUFFIX: string;
  SESSION_TTL_SECONDS?: string;
  ALLOWED_APP_REDIRECTS?: string;
  /** Only this signed-in email may manage auth keys. Set with: wrangler secret put ADMIN_EMAIL */
  ADMIN_EMAIL?: string;
  /** Encrypts stored auth keys so the admin can copy them again. Set with: wrangler secret put KEY_ENCRYPTION_SECRET */
  KEY_ENCRYPTION_SECRET?: string;
  /** RSA private key as a JWK, set with: wrangler secret put JWT_PRIVATE_KEY */
  JWT_PRIVATE_KEY?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}

export const SESSION_COOKIE = "huyab_sso";
export const RETURN_COOKIE = "sso_return";
export const STATE_COOKIE = "sso_state";
export const KEY_ID = "sso-1";
export const APP_CODE_PARAM = "code";
export const APP_CHALLENGE_COOKIE = "sso_app_challenge";
export const APP_SESSION_TTL_SECONDS = 2592000;
const APP_REDIRECT_SEPARATOR = ",";

/** Reads a required secret; there is deliberately no fallback value. */
export function required(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(
      `${name} is not configured. Set it with: wrangler secret put ${name}`,
    );
  }
  return value;
}

/** Lifetime of a JWT handed out for an auth key; the key itself lasts longer. */
export const AUTH_KEY_TOKEN_TTL_SECONDS = 3600;

export const sessionTtl = (env: Env): number =>
  Number.parseInt(env.SESSION_TTL_SECONDS ?? "86400", 10);

/**
 * Guards against an open redirect: only absolute https URLs whose host sits inside
 * the configured domain are accepted as a post-login destination.
 */
export function isAllowedReturnUrl(env: Env, candidate: string): boolean {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const suffix = env.ALLOWED_REDIRECT_SUFFIX;
  const bare = suffix.startsWith(".") ? suffix.slice(1) : suffix;
  return url.hostname === bare || url.hostname.endsWith(suffix);
}

export function isAppReturnUrl(env: Env, candidate: string): boolean {
  return (env.ALLOWED_APP_REDIRECTS ?? "")
    .split(APP_REDIRECT_SEPARATOR)
    .map((uri) => uri.trim())
    .includes(candidate);
}

export function appReturnUrl(appUri: string, code: string): string {
  const url = new URL(appUri);
  url.searchParams.set(APP_CODE_PARAM, code);
  return url.toString();
}
