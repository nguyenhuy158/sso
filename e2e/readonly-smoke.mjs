// Read-only smoke: only GETs public pages and endpoints, never follows the
// Google redirect, never signs anyone in and writes nothing. Safe against
// production: `pnpm e2e:prod` (auth.huyab.click). `pnpm e2e` runs it first
// against local `wrangler dev`, so dev and prod share these checks.
//
// Environment:
// - E2E_BASE_URL: default http://127.0.0.1:8787
// - PLAYWRIGHT_CHROMIUM_PATH: see e2e/chromium.mjs
import { chromium } from "playwright-core";
import { findChromium } from "./chromium.mjs";

const BASE = (process.env.E2E_BASE_URL || "http://127.0.0.1:8787").replace(
  /\/$/,
  "",
);
const WAIT = { timeout: 15000 };
const ALLOWED_RETURN = "https://e2e.huyab.click/after-login";
const FOREIGN_RETURN = "https://evil.example/steal";

let passed = 0;
let failed = 0;

function ok(name) {
  passed += 1;
  console.log(`PASS ${name}`);
}

/** GET without following redirects; throws unless the status matches. */
async function get(path, expectedStatus) {
  const response = await fetch(BASE + path, { redirect: "manual" });
  if (response.status !== expectedStatus) {
    throw new Error(
      `GET ${path}: expected ${expectedStatus}, got ${response.status}`,
    );
  }
  return response;
}

/** Value of one cookie from a response's Set-Cookie headers, decoded. */
function setCookieValue(response, name) {
  const line = response.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith(`${name}=`));
  return line && decodeURIComponent(line.slice(name.length + 1).split(";")[0]);
}

/** Where /login sends the visitor afterwards, read from its sso_return cookie. */
async function loginReturnTarget(redirectUri) {
  const response = await get(
    `/login?redirect_uri=${encodeURIComponent(redirectUri)}`,
    302,
  );
  const location = new URL(response.headers.get("location") ?? "");
  if (location.origin !== "https://accounts.google.com") {
    throw new Error(`/login should redirect to Google, got ${location.href}`);
  }
  const state = location.searchParams.get("state");
  if (!state || setCookieValue(response, "sso_state") !== state) {
    throw new Error(
      "/login must mirror the OAuth state in the sso_state cookie",
    );
  }
  if (!location.searchParams.get("redirect_uri")?.endsWith("/callback")) {
    throw new Error(
      `Google redirect_uri should be <issuer>/callback, got ${location.href}`,
    );
  }
  return setCookieValue(response, "sso_return");
}

console.log(`Read-only smoke against ${BASE}\n`);

const browser = await chromium.launch({ executablePath: findChromium() });
const page = await browser.newPage();
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));

try {
  // 1. Landing page renders the signed-out card.
  const landing = await page.goto(`${BASE}/`);
  if (landing?.status() !== 200)
    throw new Error(`GET / returned ${landing?.status()}`);
  await page.waitForSelector("h1:has-text('huyab.click SSO')", WAIT);
  await page.waitForSelector(
    "a.btn[href='/login']:has-text('Sign in with Google')",
    WAIT,
  );
  if (pageErrors.length > 0)
    throw new Error(`page errors: ${pageErrors.join("; ")}`);
  ok("landing page renders signed-out card");

  // 2. JWKS publishes only the public half of the signing key.
  const jwks = await (await get("/.well-known/jwks.json", 200)).json();
  const [key] = jwks.keys ?? [];
  if (
    key?.kty !== "RSA" ||
    key.alg !== "RS256" ||
    key.kid !== "sso-1" ||
    !key.n ||
    !key.e
  ) {
    throw new Error(`unexpected JWKS: ${JSON.stringify(jwks)}`);
  }
  if (["d", "p", "q", "dp", "dq", "qi"].some((field) => field in key)) {
    throw new Error("JWKS leaks private key material");
  }
  ok("JWKS exposes the RS256 public key only");

  // 3. /me without a session cookie is a 401, not an error page.
  const me = await (await get("/me", 401)).json();
  if (me.authenticated !== false) throw new Error(`/me: ${JSON.stringify(me)}`);
  ok("/me without a session returns 401");

  // 4. /login starts the Google flow and only remembers allow-listed returns.
  const foreign = await loginReturnTarget(FOREIGN_RETURN);
  if (!foreign || foreign.includes("evil.example")) {
    throw new Error(
      `foreign redirect_uri must fall back to the issuer, got ${foreign}`,
    );
  }
  if ((await loginReturnTarget(ALLOWED_RETURN)) !== ALLOWED_RETURN) {
    throw new Error(
      "allow-listed redirect_uri should be kept as the return target",
    );
  }
  ok("/login redirects to Google and rejects foreign redirect_uri");

  // 5. A callback without the mirrored state is refused before touching Google.
  await get("/callback?state=forged&code=forged", 400);
  ok("/callback without matching state returns 400");

  // 6. Unknown paths are a plain 404.
  await get("/definitely-not-a-route", 404);
  ok("unknown path returns 404");
} catch (error) {
  failed += 1;
  console.log("FAIL:", error.message);
  await page.screenshot({ path: "e2e-failure.png" }).catch(() => {});
} finally {
  await browser.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
