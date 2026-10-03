// Dev-only smoke for the signed-in side. Google cannot be driven from a test,
// so this mints session tokens with the throwaway signing key that
// e2e/run.mjs hands to `wrangler dev`, then checks how the Worker treats them.
// Never point this at production: it needs the private key.
//
// Environment:
// - E2E_BASE_URL: default http://127.0.0.1:8787
// - E2E_JWT_PRIVATE_KEY: private JWK the local Worker signs with (set by run.mjs)
// - PLAYWRIGHT_CHROMIUM_PATH: see e2e/chromium.mjs
import { webcrypto } from "node:crypto";
import { chromium } from "playwright-core";
import { findChromium } from "./chromium.mjs";

const BASE = (process.env.E2E_BASE_URL || "http://127.0.0.1:8787").replace(
  /\/$/,
  "",
);
const WAIT = { timeout: 15000 };
const SESSION_COOKIE = "huyab_sso";
const KEY_ID = "sso-1";
const EMAIL = "e2e@huyab.click";

if (!process.env.E2E_JWT_PRIVATE_KEY) {
  console.error("E2E_JWT_PRIVATE_KEY is not set; run `pnpm e2e` instead.");
  process.exit(1);
}

let passed = 0;
let failed = 0;

function ok(name) {
  passed += 1;
  console.log(`PASS ${name}`);
}

const base64Url = (bytes) => Buffer.from(bytes).toString("base64url");

const signingKey = await webcrypto.subtle.importKey(
  "jwk",
  JSON.parse(process.env.E2E_JWT_PRIVATE_KEY),
  { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
  false,
  ["sign"],
);

/** RS256 session token shaped like the ones /callback issues. */
async function mintToken(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: "https://auth.huyab.click",
    sub: "42",
    aud: "huyab.click",
    email: EMAIL,
    name: "E2E User",
    picture: null,
    iat: now,
    exp: now + 600,
    ...overrides,
  };
  const header = base64Url(
    JSON.stringify({ alg: "RS256", typ: "JWT", kid: KEY_ID }),
  );
  const input = `${header}.${base64Url(JSON.stringify(claims))}`;
  const signature = await webcrypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    signingKey,
    new TextEncoder().encode(input),
  );
  return `${input}.${base64Url(new Uint8Array(signature))}`;
}

/** GET /me carrying the given session token. */
async function me(token) {
  const response = await fetch(`${BASE}/me`, {
    headers: { cookie: `${SESSION_COOKIE}=${token}` },
  });
  return { status: response.status, body: await response.json() };
}

const browser = await chromium.launch({ executablePath: findChromium() });
const context = await browser.newContext();
const page = await context.newPage();
page.on("pageerror", (error) => console.log("PAGE ERROR:", error.message));

try {
  const token = await mintToken();

  // 1. /me accepts a token signed with the Worker's key.
  const valid = await me(token);
  if (
    valid.status !== 200 ||
    valid.body.user?.email !== EMAIL ||
    valid.body.user?.id !== "42"
  ) {
    throw new Error(
      `/me with a valid token: ${valid.status} ${JSON.stringify(valid.body)}`,
    );
  }
  ok("/me accepts a valid session token");

  // 2. The landing page switches to the signed-in card.
  await context.addCookies([{ name: SESSION_COOKIE, value: token, url: BASE }]);
  await page.goto(`${BASE}/`);
  await page.waitForSelector(`.who:has-text('${EMAIL}')`, WAIT);
  await page.waitForSelector(
    "a[href='/logout']:has-text('Sign out of every app')",
    WAIT,
  );
  ok("landing page shows the signed-in user");

  // 3. A tampered payload keeps the old signature and must be rejected.
  const [header, , signature] = token.split(".");
  const forgedPayload = base64Url(
    JSON.stringify({ sub: "1", email: "admin@huyab.click", exp: 4e9 }),
  );
  if ((await me(`${header}.${forgedPayload}.${signature}`)).status !== 401) {
    throw new Error("/me accepted a token with a tampered payload");
  }
  ok("/me rejects a tampered token");

  // 4. An expired token is rejected even with a valid signature.
  const expired = await mintToken({ iat: 1, exp: 2 });
  if ((await me(expired)).status !== 401)
    throw new Error("/me accepted an expired token");
  ok("/me rejects an expired token");

  // 5. Logout clears the domain-wide cookie and only follows allow-listed returns.
  const logout = await fetch(
    `${BASE}/logout?redirect_uri=https%3A%2F%2Fevil.example%2F`,
    {
      redirect: "manual",
    },
  );
  const cleared = logout.headers
    .getSetCookie()
    .find((c) => c.startsWith(`${SESSION_COOKIE}=;`));
  if (logout.status !== 200 || !cleared?.includes("Max-Age=0")) {
    throw new Error(`/logout: ${logout.status}, Set-Cookie ${cleared}`);
  }
  const back = await fetch(
    `${BASE}/logout?redirect_uri=https%3A%2F%2Fe2e.huyab.click%2F`,
    {
      redirect: "manual",
    },
  );
  if (
    back.status !== 302 ||
    back.headers.get("location") !== "https://e2e.huyab.click/"
  ) {
    throw new Error(
      `/logout with allowed redirect: ${back.status} ${back.headers.get("location")}`,
    );
  }
  ok("/logout clears the cookie and ignores foreign redirect_uri");
} catch (error) {
  failed += 1;
  console.log("FAIL:", error.message);
  await page.screenshot({ path: "e2e-failure.png" }).catch(() => {});
} finally {
  await browser.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
