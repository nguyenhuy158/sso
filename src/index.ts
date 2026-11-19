import { type Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import {
  createAuthKey,
  getSealedKey,
  listAuthKeys,
  MAX_LABEL_LENGTH,
  parseKeyDays,
  redeemAuthKey,
  revokeAuthKey,
} from "./auth-keys";
import { BUILD_INFO } from "./build-info";
import {
  AUTH_KEY_TOKEN_TTL_SECONDS,
  appReturnUrl,
  type Env,
  isAllowedReturnUrl,
  isAppReturnUrl,
  RETURN_COOKIE,
  SESSION_COOKIE,
  STATE_COOKIE,
  sessionTtl,
} from "./env";
import { authorizationUrl, exchangeCode, googleConfigured } from "./google";
import {
  buildClaims,
  publicJwks,
  type SessionClaims,
  signSession,
  verifySession,
} from "./jwt";
import { open } from "./secret-box";
import { type SsoUser, upsertUser } from "./users";

const app = new Hono<{ Bindings: Env }>();

const VERSION_PATH = "/api/version";
const HEALTH_PATH = "/api/health";
const HEALTH_PROBE = "SELECT 1";
const HEALTH_FAILURE_HINT =
  "D1 binding DB is not answering; check the database binding";

app.get(VERSION_PATH, (c) => c.json(BUILD_INFO));

app.get(HEALTH_PATH, async (c) => {
  try {
    await c.env.DB.prepare(HEALTH_PROBE).first();
    return c.json({ ok: true });
  } catch (error) {
    console.error("Health check failed", error);
    return c.json({ ok: false, hint: HEALTH_FAILURE_HINT }, 500);
  }
});

const callbackUri = (env: Env) => `${env.ISSUER}/callback`;

/**
 * Starts the flow. Apps send visitors here with ?redirect_uri=<their page>, and
 * the visitor comes back to that page signed in.
 */
app.get("/login", (c) => {
  if (!googleConfigured(c.env))
    return c.text("Google sign-in is not configured", 503);

  const requested = c.req.query("redirect_uri");
  const returnTo =
    requested &&
    (isAllowedReturnUrl(c.env, requested) || isAppReturnUrl(c.env, requested))
      ? requested
      : c.env.ISSUER;
  const secure = {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 600,
  } as const;

  // The state is mirrored in a cookie so the callback can prove the flow started
  // in this browser rather than being replayed by someone else.
  const state = crypto.randomUUID();
  setCookie(c, STATE_COOKIE, state, secure);
  setCookie(c, RETURN_COOKIE, returnTo, secure);

  return c.redirect(
    authorizationUrl(c.env, { redirectUri: callbackUri(c.env), state }),
    302,
  );
});

app.get("/callback", async (c) => {
  if (!googleConfigured(c.env))
    return c.text("Google sign-in is not configured", 503);

  const expectedState = getCookie(c, STATE_COOKIE);
  const returnTo = getCookie(c, RETURN_COOKIE) ?? c.env.ISSUER;
  deleteCookie(c, STATE_COOKIE, { path: "/" });
  deleteCookie(c, RETURN_COOKIE, { path: "/" });

  const state = c.req.query("state");
  if (!expectedState || !state || state !== expectedState) {
    return c.text("Sign-in session expired, please try again.", 400);
  }

  const code = c.req.query("code");
  if (!code) return c.text("Google did not return an authorization code.", 400);

  let user: SsoUser;
  try {
    const identity = await exchangeCode(c.env, {
      code,
      redirectUri: callbackUri(c.env),
    });
    user = await upsertUser(c.env.DB, identity);
  } catch (error) {
    console.error("Google sign-in failed", error);
    return c.text("Google sign-in failed, please try again.", 502);
  }

  const ttl = sessionTtl(c.env);
  const token = await signSession(
    c.env,
    buildClaims(c.env, { ...user, sub: String(user.id) }, ttl),
  );

  // Domain-wide cookie: every *.huyab.cfd app receives it without another login.
  setCookie(c, SESSION_COOKIE, token, {
    domain: c.env.COOKIE_DOMAIN,
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: ttl,
  });

  if (isAppReturnUrl(c.env, returnTo)) {
    return c.redirect(appReturnUrl(returnTo, token), 302);
  }
  return c.redirect(
    isAllowedReturnUrl(c.env, returnTo) ? returnTo : c.env.ISSUER,
    302,
  );
});

/** Public key set; relying apps fetch this to verify tokens on their own. */
app.get("/.well-known/jwks.json", (c) => {
  const body = publicJwks(c.env);
  c.header("Cache-Control", "public, max-age=3600");
  return c.json(body);
});

/** Convenience endpoint for apps that would rather ask than verify locally. */
app.get("/me", async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  const claims = token ? await verifySession(c.env, token) : null;
  if (!claims) return c.json({ authenticated: false }, 401);
  return c.json({
    authenticated: true,
    user: {
      id: claims.sub,
      email: claims.email,
      name: claims.name,
      picture: claims.picture,
    },
    expiresAt: claims.exp,
    isAdmin: isAdminEmail(c.env, claims.email),
  });
});

const BEARER = /^Bearer\s+(.+)$/i;

function isAdminEmail(env: Env, email: string | null | undefined): boolean {
  return !!email && email.toLowerCase() === env.ADMIN_EMAIL?.toLowerCase();
}

/** Signed-in admin from the cookie, or the error response to return. */
async function requireAdmin(
  c: Context<{ Bindings: Env }>,
): Promise<SessionClaims | Response> {
  if (!c.env.ADMIN_EMAIL) return c.json({ error: "auth_keys_disabled" }, 503);
  const token = getCookie(c, SESSION_COOKIE);
  const claims = token ? await verifySession(c.env, token) : null;
  if (!claims) return c.json({ error: "unauthorized" }, 401);
  if (!isAdminEmail(c.env, claims.email)) {
    return c.json({ error: "forbidden" }, 403);
  }
  return claims;
}

/** Makes an auth key. The key is in this response only; keep it in BWS. */
app.post("/keys", async (c) => {
  const admin = await requireAdmin(c);
  if (admin instanceof Response) return admin;
  // JSON only: a cross-site form cannot send this content type with the cookie.
  if (
    !c.req.header("content-type")?.toLowerCase().startsWith("application/json")
  ) {
    return c.json({ error: "expected_json" }, 415);
  }
  const body = await c.req
    .json<{ label?: unknown; days?: unknown }>()
    .catch(() => null);
  const label = typeof body?.label === "string" ? body.label.trim() : "";
  const days = parseKeyDays(body?.days);
  if (!label || label.length > MAX_LABEL_LENGTH || days === null) {
    return c.json({ error: "invalid_request" }, 400);
  }
  const { key, summary } = await createAuthKey(c.env.DB, admin, {
    label,
    days,
    encryptionSecret: c.env.KEY_ENCRYPTION_SECRET,
  });
  c.header("Cache-Control", "no-store");
  return c.json({ key, ...summary }, 201);
});

app.get("/keys", async (c) => {
  const admin = await requireAdmin(c);
  if (admin instanceof Response) return admin;
  return c.json({ keys: await listAuthKeys(c.env.DB) });
});

/** Shows a stored key again. Active keys made while KEY_ENCRYPTION_SECRET was set only. */
app.get("/keys/:id/secret", async (c) => {
  const admin = await requireAdmin(c);
  if (admin instanceof Response) return admin;
  const id = c.req.param("id");
  const sealed = await getSealedKey(c.env.DB, id);
  const key =
    sealed && c.env.KEY_ENCRYPTION_SECRET
      ? await open(c.env.KEY_ENCRYPTION_SECRET, sealed)
      : null;
  c.header("Cache-Control", "no-store");
  if (!key) return c.json({ error: "not_available" }, 404);
  console.log("auth_key_revealed", id);
  return c.json({ key });
});

app.delete("/keys/:id", async (c) => {
  const admin = await requireAdmin(c);
  if (admin instanceof Response) return admin;
  return (await revokeAuthKey(c.env.DB, c.req.param("id")))
    ? c.json({ revoked: true })
    : c.json({ error: "not_found" }, 404);
});

/** Trades an auth key for a short-lived JWT with the same claims as the cookie. */
app.post("/token", async (c) => {
  const key = c.req.header("Authorization")?.match(BEARER)?.[1]?.trim();
  const redeemed = key ? await redeemAuthKey(c.env.DB, key) : null;
  c.header("Cache-Control", "no-store");
  if (!redeemed) return c.json({ error: "invalid_key" }, 401);
  console.log("auth_key_used", redeemed.id);
  const accessToken = await signSession(
    c.env,
    buildClaims(
      c.env,
      { ...redeemed.owner, name: redeemed.owner.owner_name },
      AUTH_KEY_TOKEN_TTL_SECONDS,
    ),
  );
  return c.json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: AUTH_KEY_TOKEN_TTL_SECONDS,
  });
});

/** Clearing the domain-wide cookie signs the visitor out of every app at once. */
const logout = (c: Context<{ Bindings: Env }>) => {
  deleteCookie(c, SESSION_COOKIE, { domain: c.env.COOKIE_DOMAIN, path: "/" });
  const returnTo = c.req.query("redirect_uri");
  return returnTo && isAllowedReturnUrl(c.env, returnTo)
    ? c.redirect(returnTo, 302)
    : c.json({ message: "Logged out" });
};

app.get("/logout", logout);
app.post("/logout", logout);

app.notFound((c) => c.text("Not found", 404));

app.onError((err, c) => {
  console.error("Unhandled error", err);
  return c.json({ detail: "Internal server error" }, 500);
});

export default app;
