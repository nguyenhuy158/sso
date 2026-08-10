/**
 * Cookie plumbing + user resolution around `sso-verifier.js`. Copy both files
 * into your app; the only thing you'll likely change is `resolveUserId`'s SQL
 * to match your own schema.
 */

import { verifySsoToken } from "./sso-verifier.js";

/** Cookie set by every *.huyab.click app's SSO integration — do not rename. */
export const SSO_COOKIE = "huyab_sso";

export function parseCookie(header, name) {
  return header?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))?.[1];
}

/** Build a login/logout redirect URL back to your app. */
export function ssoUrl(issuer, path, redirectTo) {
  const target = new URL(`${issuer}${path}`);
  target.searchParams.set("redirect_uri", redirectTo);
  return target.toString();
}

/** Claims of the signed-in visitor, or `null`. Reads the cookie from a `Request`. */
export async function getClaimsFromRequest(request, issuer) {
  const token = parseCookie(request.headers.get("Cookie"), SSO_COOKIE);
  if (!token) return null;
  return verifySsoToken(token, issuer);
}

/**
 * Turn SSO claims into a row in your own `users` table.
 *
 * Key on `email`, not `sub`: email is what the SSO issuer guarantees unique
 * (Google already verified it), and it survives the SSO service ever
 * changing how it generates `sub`. Adjust the columns to your schema; this is
 * the shape used by `cardstat`, `chia-keo`, `anchi`.
 *
 * @param {D1Database} db
 * @param {{sub: string, email: string, name?: string, picture?: string}} claims
 * @returns {Promise<string>} your app's internal user id
 */
export async function resolveUserId(db, claims) {
  const existing = await db.prepare("SELECT id FROM users WHERE email = ?").bind(claims.email).first();
  if (existing) return existing.id;

  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO users (id, email, name, picture)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(email) DO NOTHING`
    )
    .bind(id, claims.email, claims.name ?? claims.email, claims.picture ?? null)
    .run();

  // Two first-time requests from the same person can race; the loser reads
  // back the winner's row instead of creating a second user.
  const row = await db.prepare("SELECT id FROM users WHERE email = ?").bind(claims.email).first();
  if (!row) throw new Error("Failed to create user for SSO session");
  return row.id;
}
