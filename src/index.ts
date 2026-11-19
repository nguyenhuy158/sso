import { type Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { isCodeChallenge, redeemAppCode, sealAppCode } from "./app-login";
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
  DEVICE_CODE_TTL_SECONDS,
  DEVICE_GRANT_TYPE,
  DEVICE_POLL_INTERVAL_SECONDS,
  decideDevice,
  pendingDevice,
  pollDevice,
  startDevice,
} from "./device";
import { d1DeviceStore } from "./device-store";
import {
  APP_CHALLENGE_COOKIE,
  APP_SESSION_TTL_SECONDS,
  AUTH_KEY_TOKEN_TTL_SECONDS,
  appReturnUrl,
  type Env,
  isAllowedReturnUrl,
  isAppReturnUrl,
  RETURN_COOKIE,
  required,
  SESSION_COOKIE,
  STATE_COOKIE,
  sessionTtl,
} from "./env";
import { authorizationUrl, exchangeCode, googleConfigured } from "./google";
import {
  APP_TOKEN_USE,
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
  const secure = {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 600,
  } as const;
  const forApp = requested !== undefined && isAppReturnUrl(c.env, requested);
  if (forApp) {
    const challenge = c.req.query("code_challenge");
    if (!isCodeChallenge(challenge))
      return c.text("code_challenge (S256) is required for app sign-in", 400);
    setCookie(c, APP_CHALLENGE_COOKIE, challenge, secure);
  }
  const returnTo =
    forApp || (requested && isAllowedReturnUrl(c.env, requested))
      ? requested
      : c.env.ISSUER;

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
  const appChallenge = getCookie(c, APP_CHALLENGE_COOKIE);
  deleteCookie(c, STATE_COOKIE, { path: "/" });
  deleteCookie(c, RETURN_COOKIE, { path: "/" });
  deleteCookie(c, APP_CHALLENGE_COOKIE, { path: "/" });

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

  if (isAppReturnUrl(c.env, returnTo) && isCodeChallenge(appChallenge)) {
    const appToken = await signSession(c.env, {
      ...buildClaims(
        c.env,
        { ...user, sub: String(user.id) },
        APP_SESSION_TTL_SECONDS,
      ),
      token_use: APP_TOKEN_USE,
    });
    const code = await sealAppCode(
      required(c.env.JWT_PRIVATE_KEY, "JWT_PRIVATE_KEY"),
      appToken,
      appChallenge,
    );
    return c.redirect(appReturnUrl(returnTo, code), 302);
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
const JSON_CONTENT_TYPE = "application/json";
const FORM_CONTENT_TYPE = "application/x-www-form-urlencoded";
const DEVICE_PAGE_FLAG = "device";
const USER_CODE_PARAM = "user_code";

function isAdminEmail(env: Env, email: string | null | undefined): boolean {
  return !!email && email.toLowerCase() === env.ADMIN_EMAIL?.toLowerCase();
}

async function requireBrowserSession(
  c: Context<{ Bindings: Env }>,
): Promise<SessionClaims | Response> {
  const token = getCookie(c, SESSION_COOKIE);
  const claims = token ? await verifySession(c.env, token) : null;
  if (!claims || claims.token_use === APP_TOKEN_USE)
    return c.json({ error: "unauthorized" }, 401);
  return claims;
}

const isJsonRequest = (c: Context<{ Bindings: Env }>) =>
  c.req.header("content-type")?.toLowerCase().startsWith(JSON_CONTENT_TYPE) ??
  false;

/** Signed-in admin from the cookie, or the error response to return. */
async function requireAdmin(
  c: Context<{ Bindings: Env }>,
): Promise<SessionClaims | Response> {
  if (!c.env.ADMIN_EMAIL) return c.json({ error: "auth_keys_disabled" }, 503);
  const claims = await requireBrowserSession(c);
  if (claims instanceof Response) return claims;
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
  if (!isJsonRequest(c)) return c.json({ error: "expected_json" }, 415);
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

app.post("/app-token", async (c) => {
  c.header("Cache-Control", "no-store");
  const body = await c.req
    .json<{ code?: unknown; code_verifier?: unknown }>()
    .catch(() => ({}) as { code?: unknown; code_verifier?: unknown });
  const { code, code_verifier: verifier } = body;
  const token =
    typeof code === "string" && typeof verifier === "string"
      ? await redeemAppCode(
          required(c.env.JWT_PRIVATE_KEY, "JWT_PRIVATE_KEY"),
          code,
          verifier,
        )
      : null;
  if (!token) return c.json({ error: "invalid_code" }, 400);
  return c.json({
    access_token: token,
    token_type: "Bearer",
    expires_in: APP_SESSION_TTL_SECONDS,
  });
});

async function readFields(
  c: Context<{ Bindings: Env }>,
): Promise<Record<string, unknown>> {
  const type = c.req.header("content-type")?.toLowerCase() ?? "";
  if (type.startsWith(FORM_CONTENT_TYPE))
    return (await c.req.parseBody().catch(() => ({}))) as Record<
      string,
      unknown
    >;
  return (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
}

const devicePage = (env: Env) => `${env.ISSUER}/device`;

app.post("/device/code", async (c) => {
  c.header("Cache-Control", "no-store");
  const fields = await readFields(c);
  const { deviceCode, userCode } = await startDevice(
    d1DeviceStore(c.env.DB),
    fields.client_name,
  );
  const verificationUri = devicePage(c.env);
  return c.json({
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: verificationUri,
    verification_uri_complete: `${verificationUri}?${USER_CODE_PARAM}=${userCode}`,
    expires_in: DEVICE_CODE_TTL_SECONDS,
    interval: DEVICE_POLL_INTERVAL_SECONDS,
  });
});

app.get("/device", (c) => {
  const target = new URLSearchParams({ [DEVICE_PAGE_FLAG]: "" });
  const userCode = c.req.query(USER_CODE_PARAM);
  if (userCode) target.set(USER_CODE_PARAM, userCode);
  return c.redirect(`/?${target}`, 302);
});

app.post("/device/lookup", async (c) => {
  const session = await requireBrowserSession(c);
  if (session instanceof Response) return session;
  if (!isJsonRequest(c)) return c.json({ error: "expected_json" }, 415);
  const { user_code } = await readFields(c);
  const row =
    typeof user_code === "string"
      ? await pendingDevice(d1DeviceStore(c.env.DB), user_code)
      : null;
  if (!row) return c.json({ error: "invalid_code" }, 404);
  return c.json({ user_code: row.user_code, client_name: row.client_name });
});

app.post("/device/approve", async (c) => {
  const session = await requireBrowserSession(c);
  if (session instanceof Response) return session;
  if (!isJsonRequest(c)) return c.json({ error: "expected_json" }, 415);
  const { user_code, allow } = await readFields(c);
  if (typeof user_code !== "string" || typeof allow !== "boolean")
    return c.json({ error: "invalid_request" }, 400);
  const decided = await decideDevice(
    d1DeviceStore(c.env.DB),
    user_code,
    {
      sub: session.sub,
      email: session.email,
      name: session.name,
      picture: session.picture,
    },
    allow,
  );
  if (!decided) return c.json({ error: "invalid_code" }, 404);
  console.log(allow ? "device_approved" : "device_denied", session.sub);
  return c.json({ allowed: allow });
});

app.post("/device/token", async (c) => {
  c.header("Cache-Control", "no-store");
  const { grant_type, device_code } = await readFields(c);
  if (grant_type !== DEVICE_GRANT_TYPE)
    return c.json({ error: "unsupported_grant_type" }, 400);
  if (typeof device_code !== "string")
    return c.json({ error: "invalid_request" }, 400);
  const result = await pollDevice(d1DeviceStore(c.env.DB), device_code);
  if (result.status !== "approved")
    return c.json({ error: result.status }, 400);
  const accessToken = await signSession(c.env, {
    ...buildClaims(c.env, result.identity, APP_SESSION_TTL_SECONDS),
    token_use: APP_TOKEN_USE,
  });
  return c.json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: APP_SESSION_TTL_SECONDS,
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
