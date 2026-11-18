import type { SessionClaims } from "./jwt";
import { seal } from "./secret-box";

export const KEY_PREFIX = "hsk_";
export const DEFAULT_KEY_DAYS = 90;
export const MAX_KEY_DAYS = 90;
export const MAX_LABEL_LENGTH = 80;

const SECRET_BYTES = 32;
const ID_BYTES = 4;
const SECONDS_PER_DAY = 86400;

export interface AuthKeySummary {
  id: string;
  label: string;
  email: string | null;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  revealable: boolean;
}

interface AuthKeyRow {
  id: string;
  label: string;
  email: string | null;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
  revealable: number;
}

interface OwnerRow {
  sub: string;
  email: string | null;
  owner_name: string | null;
  picture: string | null;
}

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const randomBytes = (length: number): Uint8Array =>
  crypto.getRandomValues(new Uint8Array(length));

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return toHex(new Uint8Array(digest));
}

const isoFromNow = (seconds: number): string =>
  new Date(Date.now() + seconds * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");

const toSummary = (row: AuthKeyRow): AuthKeySummary => ({
  id: row.id,
  label: row.label,
  email: row.email,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  revokedAt: row.revoked_at,
  lastUsedAt: row.last_used_at,
  revealable: row.revealable === 1,
});

/** Parses the requested lifetime; returns null when it is not a whole number of days in range. */
export function parseKeyDays(value: unknown): number | null {
  if (value === undefined) return DEFAULT_KEY_DAYS;
  if (!Number.isInteger(value)) return null;
  const days = value as number;
  return days >= 1 && days <= MAX_KEY_DAYS ? days : null;
}

const SUMMARY_COLUMNS =
  "id, label, email, created_at, expires_at, revoked_at, last_used_at, key_enc IS NOT NULL AS revealable";

/**
 * Makes a key for the signed-in admin. Lookup uses the SHA-256 hash. With an
 * encryption secret the key is also stored sealed (AES-GCM) so the admin can copy
 * it again; a database leak alone then still does not leak usable keys.
 */
export async function createAuthKey(
  db: D1Database,
  owner: SessionClaims,
  params: { label: string; days: number; encryptionSecret?: string },
): Promise<{ key: string; summary: AuthKeySummary }> {
  const id = toHex(randomBytes(ID_BYTES));
  const key = `${KEY_PREFIX}${id}_${toHex(randomBytes(SECRET_BYTES))}`;
  const row = await db
    .prepare(
      `INSERT INTO sso_auth_keys (id, label, key_hash, sub, email, owner_name, picture, expires_at, key_enc)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING ${SUMMARY_COLUMNS}`,
    )
    .bind(
      id,
      params.label,
      await sha256Hex(key),
      owner.sub,
      owner.email,
      owner.name,
      owner.picture,
      isoFromNow(params.days * SECONDS_PER_DAY),
      params.encryptionSecret ? await seal(params.encryptionSecret, key) : null,
    )
    .first<AuthKeyRow>();
  if (!row) throw new Error("Failed to create auth key");
  return { key, summary: toSummary(row) };
}

export async function listAuthKeys(db: D1Database): Promise<AuthKeySummary[]> {
  const { results } = await db
    .prepare(
      `SELECT ${SUMMARY_COLUMNS}
       FROM sso_auth_keys ORDER BY created_at DESC, id`,
    )
    .all<AuthKeyRow>();
  return results.map(toSummary);
}

/** Returns false when no active key has this id. */
export async function revokeAuthKey(
  db: D1Database,
  id: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE sso_auth_keys SET revoked_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
       WHERE id = ? AND revoked_at IS NULL`,
    )
    .bind(id)
    .run();
  return result.meta.changes > 0;
}

/**
 * Looks up an active, unexpired key by its hash and returns the owner it acts as.
 * A wrong, revoked or expired key all give the same null.
 */
export async function redeemAuthKey(
  db: D1Database,
  key: string,
): Promise<{ id: string; owner: OwnerRow } | null> {
  if (!key.startsWith(KEY_PREFIX)) return null;
  const row = await db
    .prepare(
      `UPDATE sso_auth_keys SET last_used_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
       WHERE key_hash = ? AND revoked_at IS NULL
         AND expires_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
       RETURNING id, sub, email, owner_name, picture`,
    )
    .bind(await sha256Hex(key))
    .first<OwnerRow & { id: string }>();
  if (!row) return null;
  const { id, ...owner } = row;
  return { id, owner };
}

/** Sealed copy of an active, unexpired key, or null when it is gone, revoked, expired or was never stored. */
export async function getSealedKey(
  db: D1Database,
  id: string,
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT key_enc FROM sso_auth_keys
       WHERE id = ? AND revoked_at IS NULL AND key_enc IS NOT NULL
         AND expires_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`,
    )
    .bind(id)
    .first<{ key_enc: string }>();
  return row?.key_enc ?? null;
}
