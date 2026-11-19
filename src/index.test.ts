import { afterEach, describe, expect, it, vi } from "vitest";
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
  const appEnv = {
    ...healthyEnv,
    ALLOWED_APP_REDIRECTS: `other://x, ${APP_URI}`,
    GOOGLE_CLIENT_ID: "client",
    GOOGLE_CLIENT_SECRET: "secret",
  } as Env;
  const returnCookie = async (redirect: string) => {
    const response = await call(
      `/login?redirect_uri=${encodeURIComponent(redirect)}`,
      appEnv,
    );
    expect(response.status).toBe(302);
    return response.headers.get("set-cookie") ?? "";
  };

  it("remembers an allow-listed app URI as the return target", async () => {
    expect(await returnCookie(APP_URI)).toContain(
      `sso_return=${encodeURIComponent(APP_URI)}`,
    );
  });

  it("falls back to the issuer for app URIs not on the list", async () => {
    const cookie = await returnCookie("evil-app://auth");
    expect(cookie).not.toContain("evil-app");
    expect(cookie).toContain(`sso_return=${encodeURIComponent(ORIGIN)}`);
  });

  it("does not accept a prefix of an allow-listed URI", async () => {
    expect(isAppReturnUrl(appEnv, `${APP_URI}/extra`)).toBe(false);
    expect(isAppReturnUrl(healthyEnv, APP_URI)).toBe(false);
  });

  it("hands the token to the app as the sso query parameter", () => {
    expect(appReturnUrl(APP_URI, "a.b.c")).toBe(`${APP_URI}?sso=a.b.c`);
  });
});
