import type { DeviceRow, DeviceStore } from "./device";

const COLUMNS: (keyof DeviceRow)[] = [
  "device_code_hash",
  "user_code",
  "client_name",
  "expires_at",
  "interval_seconds",
  "last_polled_at",
  "sub",
  "email",
  "name",
  "picture",
  "approved_at",
  "denied_at",
];
const PLACEHOLDERS = COLUMNS.map(() => "?").join(", ");
const ASSIGNMENTS = COLUMNS.slice(1)
  .map((column) => `${column} = ?`)
  .join(", ");

export function d1DeviceStore(db: D1Database): DeviceStore {
  return {
    async insert(row) {
      await db
        .prepare(
          `INSERT INTO sso_device_codes (${COLUMNS.join(", ")}) VALUES (${PLACEHOLDERS})`,
        )
        .bind(...COLUMNS.map((column) => row[column]))
        .run();
    },
    byHash: (hash) =>
      db
        .prepare("SELECT * FROM sso_device_codes WHERE device_code_hash = ?")
        .bind(hash)
        .first<DeviceRow>(),
    byUserCode: (userCode) =>
      db
        .prepare("SELECT * FROM sso_device_codes WHERE user_code = ?")
        .bind(userCode)
        .first<DeviceRow>(),
    async update(row) {
      await db
        .prepare(
          `UPDATE sso_device_codes SET ${ASSIGNMENTS} WHERE device_code_hash = ?`,
        )
        .bind(
          ...COLUMNS.slice(1).map((column) => row[column]),
          row.device_code_hash,
        )
        .run();
    },
    async remove(hash) {
      await db
        .prepare("DELETE FROM sso_device_codes WHERE device_code_hash = ?")
        .bind(hash)
        .run();
    },
    async removeExpired(now) {
      await db
        .prepare("DELETE FROM sso_device_codes WHERE expires_at <= ?")
        .bind(now)
        .run();
    },
  };
}
