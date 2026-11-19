import { afterEach, describe, expect, it, vi } from "vitest";
import { redeemAppCode, s256, sealAppCode } from "./app-login";
import { appReturnUrl, type Env, isAppReturnUrl } from "./env";
import app from "./index";

const ORIGIN = "https://auth.test";

function envWith(first: () => Promise<unknown>): Env {
  return {
    DB: { prepare: () => ({ first }) },
    ISSUER: ORIGIN,
    COOKIE_DOMAIN: ".test",
    ALLOWED_REDIRECT_SUFFIX: ".test",
  } as unknown as Env;
}

const healthyEnv = envWith(async () => ({ "1": 1 }));
const call = (path: string, env: Env, method = "GET") =>
  app.fetch(new Request(ORIGIN + path, { method }), env);

afterEach(() => vi.restoreAllMocks());

describe("deploy-check routes", () => {
  it("serves the build info without a session", async () => {
    const response = await call("/api/version", healthyEnv);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(String(body.commit).length).toBeGreaterThan(0);
    expect(Object.keys(body).sort()).toEqual([
      "branch",
      "builtAt",
      "builtBy",
      "commit",
      "dirty",
      "shortCommit",
    ]);
  });

  it("answers health when the database works", async () => {
    const response = await call("/api/health", healthyEnv);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("answers 500 with a hint and no error text when the database fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = envWith(async () => {
      throw new Error("secret-db-detail");
    });
    const response = await call("/api/health", failing);
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(JSON.parse(text).ok).toBe(false);
    expect(JSON.parse(text).hint.length).toBeGreaterThan(0);
    expect(text).not.toContain("secret-db-detail");
    expect(log).toHaveBeenCalled();
  });

  it("does not answer the two routes for other methods", async () => {
    expect((await call("/api/version", healthyEnv, "POST")).status).toBe(404);
    expect((await call("/api/health", healthyEnv, "POST")).status).toBe(404);
  });
});

describe("existing routes", () => {
  it("keeps /me unauthenticated without a cookie", async () => {
    const response = await call("/me", healthyEnv);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ authenticated: false });
  });

  it("keeps unknown paths a 404", async () => {
    const response = await call("/nope", healthyEnv);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not found");
  });
});

describe("native app login", () => {
  const APP_URI = "huyab-home://auth";
  const VERIFIER = "v".repeat(64);
  const SIGNING_KEY = "test-signing-key";
  const appEnv = {
    ...healthyEnv,
    ALLOWED_APP_REDIRECTS: `other://x, ${APP_URI}`,
    GOOGLE_CLIENT_ID: "client",
    GOOGLE_CLIENT_SECRET: "secret",
    JWT_PRIVATE_KEY: SIGNING_KEY,
  } as Env;
  const login = async (redirect: string, challenge?: string) => {
    const query = new URLSearchParams({ redirect_uri: redirect });
    if (challenge) query.set("code_challenge", challenge);
    return call(`/login?${query}`, appEnv);
  };
  const redeem = (body: unknown) =>
    app.fetch(
      new Request(`${ORIGIN}/app-token`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
      appEnv,
    );

  it("remembers an allow-listed app URI and its challenge", async () => {
    const challenge = await s256(VERIFIER);
    const response = await login(APP_URI, challenge);
    const cookies = response.headers.get("set-cookie") ?? "";
    expect(response.status).toBe(302);
    expect(cookies).toContain(`sso_return=${encodeURIComponent(APP_URI)}`);
    expect(cookies).toContain(`sso_app_challenge=${challenge}`);
  });

  it("refuses app sign-in without a PKCE challenge", async () => {
    expect((await login(APP_URI)).status).toBe(400);
    expect((await login(APP_URI, "short")).status).toBe(400);
  });

  it("falls back to the issuer for app URIs not on the list", async () => {
    const cookies =
      (await login("evil-app://auth", await s256(VERIFIER))).headers.get(
        "set-cookie",
      ) ?? "";
    expect(cookies).not.toContain("evil-app");
    expect(cookies).not.toContain("sso_app_challenge");
    expect(cookies).toContain(`sso_return=${encodeURIComponent(ORIGIN)}`);
  });

  it("matches allow-listed URIs exactly", () => {
    expect(isAppReturnUrl(appEnv, `${APP_URI}/extra`)).toBe(false);
    expect(isAppReturnUrl(healthyEnv, APP_URI)).toBe(false);
    expect(appReturnUrl(APP_URI, "abc")).toBe(`${APP_URI}?code=abc`);
  });

  it("trades a code for the token only with the matching verifier", async () => {
    const code = await sealAppCode(SIGNING_KEY, "jwt", await s256(VERIFIER));
    expect((await redeem({ code, code_verifier: "x".repeat(64) })).status).toBe(
      400,
    );
    const response = await redeem({ code, code_verifier: VERIFIER });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      access_token: "jwt",
      token_type: "Bearer",
    });
  });

  it("rejects expired, forged and malformed codes", async () => {
    const challenge = await s256(VERIFIER);
    const old = await sealAppCode(SIGNING_KEY, "jwt", challenge, 0);
    expect(await redeemAppCode(SIGNING_KEY, old, VERIFIER)).toBeNull();
    const forged = await sealAppCode("other-key", "jwt", challenge);
    expect(await redeemAppCode(SIGNING_KEY, forged, VERIFIER)).toBeNull();
    expect((await redeem({ code: 1 })).status).toBe(400);
  });
});
