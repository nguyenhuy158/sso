import type { GoogleIdentity } from "./google";

export interface SsoUser {
  id: number;
  google_sub: string;
  email: string | null;
  name: string | null;
  picture: string | null;
}

/** Creates the account on first sign-in, refreshing the profile on every later one. */
export async function upsertUser(db: D1Database, identity: GoogleIdentity): Promise<SsoUser> {
  const row = await db
    .prepare(
      `INSERT INTO sso_users (google_sub, email, name, picture, last_login_at)
       VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
       ON CONFLICT(google_sub) DO UPDATE SET
         email = excluded.email,
         name = excluded.name,
         picture = excluded.picture,
         last_login_at = excluded.last_login_at
       RETURNING *`,
    )
    .bind(identity.sub, identity.email, identity.name, identity.picture)
    .first<SsoUser>();

  if (!row) throw new Error("Failed to upsert user");
  return row;
}
