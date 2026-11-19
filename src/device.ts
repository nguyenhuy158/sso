const DEVICE_CODE_BYTES = 32;
const USER_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";
const USER_CODE_GROUP = 4;
const USER_CODE_LENGTH = USER_CODE_GROUP * 2;
const USER_CODE_SEPARATOR = "-";
const NOT_USER_CODE_CHARS = /[^A-Z]/g;
const MAX_CLIENT_NAME_LENGTH = 60;
const DEFAULT_CLIENT_NAME = "Device";
const SLOW_DOWN_STEP_SECONDS = 5;
const MILLISECONDS_PER_SECOND = 1000;
const SHA_256 = "SHA-256";

export const DEVICE_CODE_TTL_SECONDS = 900;
export const DEVICE_POLL_INTERVAL_SECONDS = 5;
export const DEVICE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";

export type DeviceIdentity = {
  sub: string;
  email: string | null;
  name: string | null;
  picture: string | null;
};

export type DeviceRow = {
  device_code_hash: string;
  user_code: string;
  client_name: string;
  expires_at: number;
  interval_seconds: number;
  last_polled_at: number | null;
  sub: string | null;
  email: string | null;
  name: string | null;
  picture: string | null;
  approved_at: number | null;
  denied_at: number | null;
};

export interface DeviceStore {
  insert(row: DeviceRow): Promise<void>;
  byHash(hash: string): Promise<DeviceRow | null>;
  byUserCode(userCode: string): Promise<DeviceRow | null>;
  update(row: DeviceRow): Promise<void>;
  remove(hash: string): Promise<void>;
  removeExpired(now: number): Promise<void>;
}

export type PollResult =
  | { status: "approved"; identity: DeviceIdentity }
  | {
      status:
        | "authorization_pending"
        | "slow_down"
        | "access_denied"
        | "expired_token"
        | "invalid_grant";
    };

export const nowSeconds = (now = Date.now()) =>
  Math.floor(now / MILLISECONDS_PER_SECOND);

function base64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function hashDeviceCode(deviceCode: string) {
  const digest = await crypto.subtle.digest(
    SHA_256,
    new TextEncoder().encode(deviceCode),
  );
  return base64Url(new Uint8Array(digest));
}

export function newUserCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(USER_CODE_LENGTH));
  const chars = [...bytes].map(
    (byte) => USER_CODE_ALPHABET[byte % USER_CODE_ALPHABET.length],
  );
  return (
    chars.slice(0, USER_CODE_GROUP).join("") +
    USER_CODE_SEPARATOR +
    chars.slice(USER_CODE_GROUP).join("")
  );
}

export function normalizeUserCode(input: string): string | null {
  const letters = input.toUpperCase().replace(NOT_USER_CODE_CHARS, "");
  if (letters.length !== USER_CODE_LENGTH) return null;
  if ([...letters].some((char) => !USER_CODE_ALPHABET.includes(char)))
    return null;
  return (
    letters.slice(0, USER_CODE_GROUP) +
    USER_CODE_SEPARATOR +
    letters.slice(USER_CODE_GROUP)
  );
}

export function clientName(input: unknown) {
  const name = typeof input === "string" ? input.trim() : "";
  return name ? name.slice(0, MAX_CLIENT_NAME_LENGTH) : DEFAULT_CLIENT_NAME;
}

export async function startDevice(
  store: DeviceStore,
  name: unknown,
  now = nowSeconds(),
) {
  await store.removeExpired(now);
  const deviceCode = base64Url(
    crypto.getRandomValues(new Uint8Array(DEVICE_CODE_BYTES)),
  );
  const userCode = newUserCode();
  await store.insert({
    device_code_hash: await hashDeviceCode(deviceCode),
    user_code: userCode,
    client_name: clientName(name),
    expires_at: now + DEVICE_CODE_TTL_SECONDS,
    interval_seconds: DEVICE_POLL_INTERVAL_SECONDS,
    last_polled_at: null,
    sub: null,
    email: null,
    name: null,
    picture: null,
    approved_at: null,
    denied_at: null,
  });
  return { deviceCode, userCode };
}

export async function pendingDevice(
  store: DeviceStore,
  input: string,
  now = nowSeconds(),
) {
  const userCode = normalizeUserCode(input);
  const row = userCode ? await store.byUserCode(userCode) : null;
  if (!row || row.expires_at <= now || row.approved_at || row.denied_at)
    return null;
  return row;
}

export async function decideDevice(
  store: DeviceStore,
  input: string,
  identity: DeviceIdentity,
  allow: boolean,
  now = nowSeconds(),
) {
  const row = await pendingDevice(store, input, now);
  if (!row) return false;
  await store.update(
    allow
      ? { ...row, ...identity, approved_at: now }
      : { ...row, denied_at: now },
  );
  return true;
}

export async function pollDevice(
  store: DeviceStore,
  deviceCode: string,
  now = nowSeconds(),
): Promise<PollResult> {
  const hash = await hashDeviceCode(deviceCode);
  const row = await store.byHash(hash);
  if (!row) return { status: "invalid_grant" };
  if (row.expires_at <= now) {
    await store.remove(hash);
    return { status: "expired_token" };
  }
  if (row.denied_at) {
    await store.remove(hash);
    return { status: "access_denied" };
  }
  if (row.approved_at && row.sub) {
    await store.remove(hash);
    return {
      status: "approved",
      identity: {
        sub: row.sub,
        email: row.email,
        name: row.name,
        picture: row.picture,
      },
    };
  }
  const tooSoon =
    row.last_polled_at !== null &&
    now - row.last_polled_at < row.interval_seconds;
  await store.update({
    ...row,
    last_polled_at: now,
    interval_seconds: tooSoon
      ? row.interval_seconds + SLOW_DOWN_STEP_SECONDS
      : row.interval_seconds,
  });
  return { status: tooSoon ? "slow_down" : "authorization_pending" };
}
