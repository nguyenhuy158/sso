export const PATHS = {
  me: "/me",
  login: "/login",
  logout: "/logout",
  keys: "/keys",
  jwks: "/.well-known/jwks.json",
  deviceLookup: "/device/lookup",
  deviceApprove: "/device/approve",
} as const;

const JSON_CONTENT_TYPE = "application/json";
const HTTP_UNAUTHORIZED = 401;

export type User = {
  id: string;
  email?: string;
  name?: string;
  picture?: string;
};

export type Session = {
  user: User;
  expiresAt: number;
  isAdmin: boolean;
};

export type AuthKey = {
  id: string;
  label: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  revealable: boolean;
};

export type CreatedKey = AuthKey & { key: string };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body as T;
}

export async function loadSession(): Promise<Session | null> {
  const response = await fetch(PATHS.me);
  if (response.status === HTTP_UNAUTHORIZED) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export const listKeys = () =>
  request<{ keys: AuthKey[] }>(PATHS.keys).then((body) => body.keys);

export const createKey = (label: string, days: number) =>
  request<CreatedKey>(PATHS.keys, {
    method: "POST",
    headers: { "content-type": JSON_CONTENT_TYPE },
    body: JSON.stringify({ label, days }),
  });

export const revealKey = (id: string) =>
  request<{ key: string }>(
    `${PATHS.keys}/${encodeURIComponent(id)}/secret`,
  ).then((body) => body.key);

export const revokeKey = (id: string) =>
  request<{ revoked: boolean }>(`${PATHS.keys}/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

export type DeviceRequest = { user_code: string; client_name: string };

const postJson = <T>(path: string, body: unknown) =>
  request<T>(path, {
    method: "POST",
    headers: { "content-type": JSON_CONTENT_TYPE },
    body: JSON.stringify(body),
  });

export const lookupDevice = (userCode: string) =>
  postJson<DeviceRequest>(PATHS.deviceLookup, { user_code: userCode });

export const decideDevice = (userCode: string, allow: boolean) =>
  postJson<{ allowed: boolean }>(PATHS.deviceApprove, {
    user_code: userCode,
    allow,
  });
