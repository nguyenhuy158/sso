import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import {
  isAllowedReturnUrl,
  sessionTtl,
  RETURN_COOKIE,
  SESSION_COOKIE,
  STATE_COOKIE,
  type Env,
} from "./env";
import { authorizationUrl, exchangeCode, googleConfigured } from "./google";
import { publicJwks, signSession, verifySession } from "./jwt";
import { upsertUser } from "./users";
import { landingPage } from "./page";

const app = new Hono<{ Bindings: Env }>();

const callbackUri = (env: Env) => `${env.ISSUER}/callback`;

/**
 * Starts the flow. Apps send visitors here with ?redirect_uri=<their page>, and
 * the visitor comes back to that page signed in.
 */
app.get("/login", (c) => {
  if (!googleConfigured(c.env)) return c.text("Google sign-in is not configured", 503);

  const requested = c.req.query("redirect_uri");
  const returnTo = requested && isAllowedReturnUrl(c.env, requested) ? requested : c.env.ISSUER;
  const secure = { httpOnly: true, secure: true, sameSite: "Lax", path: "/", maxAge: 600 } as const;

  // The state is mirrored in a cookie so the callback can prove the flow started
  // in this browser rather than being replayed by someone else.
  const state = crypto.randomUUID();
  setCookie(c, STATE_COOKIE, state, secure);
  setCookie(c, RETURN_COOKIE, returnTo, secure);

  return c.redirect(authorizationUrl(c.env, { redirectUri: callbackUri(c.env), state }), 302);
});

app.get("/callback", async (c) => {
  if (!googleConfigured(c.env)) return c.text("Google sign-in is not configured", 503);

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

  let user;
  try {
    const identity = await exchangeCode(c.env, { code, redirectUri: callbackUri(c.env) });
    user = await upsertUser(c.env.DB, identity);
  } catch (error) {
    console.error("Google sign-in failed", error);
    return c.text("Google sign-in failed, please try again.", 502);
  }

  const ttl = sessionTtl(c.env);
  const now = Math.floor(Date.now() / 1000);
  const token = await signSession(c.env, {
    iss: c.env.ISSUER,
    sub: String(user.id),
    aud: c.env.ALLOWED_REDIRECT_SUFFIX.replace(/^\./, ""),
    email: user.email,
    name: user.name,
    picture: user.picture,
    iat: now,
    exp: now + ttl,
  });

  // Domain-wide cookie: every *.huyab.click app receives it without another login.
  setCookie(c, SESSION_COOKIE, token, {
    domain: c.env.COOKIE_DOMAIN,
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: ttl,
  });

  return c.redirect(isAllowedReturnUrl(c.env, returnTo) ? returnTo : c.env.ISSUER, 302);
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
    user: { id: claims.sub, email: claims.email, name: claims.name, picture: claims.picture },
    expiresAt: claims.exp,
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

app.get("/", async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  const claims = token ? await verifySession(c.env, token) : null;
  return c.html(landingPage({ issuer: c.env.ISSUER, claims }));
});

app.notFound((c) => c.text("Not found", 404));

app.onError((err, c) => {
  console.error("Unhandled error", err);
  return c.json({ detail: "Internal server error" }, 500);
});

export default app;
