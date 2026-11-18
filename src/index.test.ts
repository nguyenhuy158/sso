import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "./env";
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
