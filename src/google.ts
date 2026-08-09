import { required, type Env } from "./env";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export interface GoogleIdentity {
  sub: string;
  email: string | null;
  name: string | null;
  picture: string | null;
}

export const googleConfigured = (env: Env): boolean =>
  Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

export function authorizationUrl(env: Env, params: { redirectUri: string; state: string }): string {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", required(env.GOOGLE_CLIENT_ID, "GOOGLE_CLIENT_ID"));
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", params.state);
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

export async function exchangeCode(
  env: Env,
  params: { code: string; redirectUri: string },
): Promise<GoogleIdentity> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: params.code,
      client_id: required(env.GOOGLE_CLIENT_ID, "GOOGLE_CLIENT_ID"),
      client_secret: required(env.GOOGLE_CLIENT_SECRET, "GOOGLE_CLIENT_SECRET"),
      redirect_uri: params.redirectUri,
      grant_type: "authorization_code",
    }),
  });

  const token = (await response.json()) as { id_token?: string; error_description?: string; error?: string };
  if (!response.ok || !token.id_token) {
    throw new Error(token.error_description ?? token.error ?? "Google token exchange failed");
  }

  // The id_token came straight from Google's token endpoint over TLS, so the
  // transport authenticates it and its signature need not be re-checked here.
  const payload = token.id_token.split(".")[1];
  if (!payload) throw new Error("Malformed id_token");
  const normalised = payload.replace(/-/g, "+").replace(/_/g, "/");
  const claims = JSON.parse(
    new TextDecoder().decode(
      Uint8Array.from(atob(normalised.padEnd(Math.ceil(normalised.length / 4) * 4, "=")), (c) =>
        c.charCodeAt(0),
      ),
    ),
  ) as { sub?: string; email?: string; email_verified?: boolean; name?: string; picture?: string };

  if (!claims.sub) throw new Error("id_token has no subject");
  return {
    sub: claims.sub,
    email: claims.email_verified === false ? null : (claims.email ?? null),
    name: claims.name ?? null,
    picture: claims.picture ?? null,
  };
}
