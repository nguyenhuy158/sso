// Dev-only smoke for the signed-in side. Google cannot be driven from a test,
// so this mints session tokens with the throwaway signing key that
// e2e/run.mjs hands to `wrangler dev`, then checks how the Worker treats them.
// Never point this at production: it needs the private key.
//
// Environment:
// - E2E_BASE_URL: default http://127.0.0.1:8787
// - E2E_JWT_PRIVATE_KEY: private JWK the local Worker signs with (set by run.mjs)
// - PLAYWRIGHT_CHROMIUM_PATH: see findChromium in @huyab/e2e
import { webcrypto } from "node:crypto";
import { BASE, findChromium } from "@huyab/e2e";
import { chromium } from "playwright-core";

const WAIT = { timeout: 15000 };
const SESSION_COOKIE = "huyab_sso";
const KEY_ID = "sso-1";
const EMAIL = "e2e@huyab.cfd";

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
    iss: "https://auth.huyab.cfd",
    sub: "42",
    aud: "huyab.cfd",
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
    JSON.stringify({ sub: "1", email: "admin@huyab.cfd", exp: 4e9 }),
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
    `${BASE}/logout?redirect_uri=https%3A%2F%2Fe2e.huyab.cfd%2F`,
    {
      redirect: "manual",
    },
  );
  if (
    back.status !== 302 ||
    back.headers.get("location") !== "https://e2e.huyab.cfd/"
  ) {
    throw new Error(
      `/logout with allowed redirect: ${back.status} ${back.headers.get("location")}`,
    );
  }
  ok("/logout clears the cookie and ignores foreign redirect_uri");

  // 6. Auth keys: only the admin can make one, and it buys a short-lived token.
  const asCookie = (value) => ({ cookie: `${SESSION_COOKIE}=${value}` });
  const jsonHeaders = (value) => ({
    ...asCookie(value),
    "content-type": "application/json",
  });
  const makeKey = (headers, body) =>
    fetch(`${BASE}/keys`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

  if (
    (await makeKey({ "content-type": "application/json" }, {})).status !== 401
  )
    throw new Error("POST /keys without a session was not 401");
  const stranger = await mintToken({ email: "stranger@huyab.cfd" });
  if (
    (await makeKey(jsonHeaders(stranger), { label: "x", days: 1 })).status !==
    403
  )
    throw new Error("POST /keys by a non-admin was not 403");
  const formPost = await fetch(`${BASE}/keys`, {
    method: "POST",
    headers: { ...asCookie(token), "content-type": "text/plain" },
    body: "label=x",
  });
  if (formPost.status !== 415)
    throw new Error(`POST /keys with a non-JSON body: ${formPost.status}`);
  if (
    (await makeKey(jsonHeaders(token), { label: "x", days: 91 })).status !== 400
  )
    throw new Error("POST /keys accepted a lifetime over 90 days");
  ok("/keys rejects anonymous, non-admin, non-JSON and over-long requests");

  const created = await makeKey(jsonHeaders(token), { label: "e2e", days: 30 });
  const key = await created.json();
  if (created.status !== 201 || !key.key?.startsWith("hsk_") || !key.id) {
    throw new Error(`POST /keys: ${created.status} ${JSON.stringify(key)}`);
  }
  ok("admin can make an auth key");

  const exchange = (secret) =>
    fetch(`${BASE}/token`, {
      method: "POST",
      headers: secret ? { authorization: `Bearer ${secret}` } : {},
    });
  const issued = await exchange(key.key);
  const issuedBody = await issued.json();
  if (
    issued.status !== 200 ||
    issuedBody.token_type !== "Bearer" ||
    issuedBody.expires_in !== 3600
  ) {
    throw new Error(
      `POST /token: ${issued.status} ${JSON.stringify(issuedBody)}`,
    );
  }
  const viaKey = await me(issuedBody.access_token);
  if (
    viaKey.status !== 200 ||
    viaKey.body.user?.email !== EMAIL ||
    viaKey.body.user?.id !== "42"
  ) {
    throw new Error(`/me with a key token: ${JSON.stringify(viaKey)}`);
  }
  ok("/token trades the key for a JWT with the owner's claims");

  const listed = await (
    await fetch(`${BASE}/keys`, { headers: asCookie(token) })
  ).json();
  const row = listed.keys?.find((item) => item.id === key.id);
  if (!row?.lastUsedAt || JSON.stringify(listed).includes(key.key)) {
    throw new Error(`GET /keys: ${JSON.stringify(listed)}`);
  }
  ok("/keys lists the key with last use and never shows the secret");

  const reveal = await fetch(`${BASE}/keys/${key.id}/secret`, {
    headers: asCookie(token),
  });
  const revealed = await reveal.json();
  if (
    reveal.status !== 200 ||
    revealed.key !== key.key ||
    !row.revealable ||
    reveal.headers.get("cache-control") !== "no-store"
  )
    throw new Error(`GET /keys/:id/secret: ${reveal.status}`);
  const strangerReveal = await fetch(`${BASE}/keys/${key.id}/secret`, {
    headers: asCookie(stranger),
  });
  if (
    strangerReveal.status !== 403 ||
    (await strangerReveal.text()).includes(key.key)
  )
    throw new Error("a non-admin could ask for a stored key");
  ok("admin can copy a stored key again, others cannot");

  if (
    (await exchange(`${key.key}x`)).status !== 401 ||
    (await exchange()).status !== 401
  )
    throw new Error("/token accepted a wrong or missing key");
  const revoke = await fetch(`${BASE}/keys/${key.id}`, {
    method: "DELETE",
    headers: asCookie(token),
  });
  if (revoke.status !== 200 || (await exchange(key.key)).status !== 401)
    throw new Error("a revoked key still worked");
  ok("wrong, missing and revoked keys get 401");
  const afterRevoke = await fetch(`${BASE}/keys/${key.id}/secret`, {
    headers: asCookie(token),
  });
  if (afterRevoke.status !== 404)
    throw new Error("a revoked key could still be shown");
  ok("a revoked key cannot be shown");

  // 7. The admin panel: only the admin sees it, and it creates, copies and revokes.
  const strangerMe = await (
    await fetch(`${BASE}/me`, { headers: asCookie(stranger) })
  ).json();
  if (strangerMe.isAdmin !== false)
    throw new Error("/me marks a non-admin as admin");
  await page.goto(`${BASE}/`);
  await page.waitForSelector("input[aria-label='Key name']", WAIT);
  await page.fill("input[aria-label='Key name']", "ui key");
  await page.click("form button[type=submit]");
  await page.waitForFunction(
    () =>
      document
        .querySelector("input[aria-label='New key']")
        ?.value.startsWith("hsk_"),
    null,
    WAIT,
  );
  await page.waitForSelector(
    "li:has-text('ui key') button:has-text('Copy')",
    WAIT,
  );
  const fits = await page.evaluate(
    () => document.documentElement.scrollHeight <= window.innerHeight,
  );
  if (!fits) throw new Error("the admin page scrolls the viewport");
  page.once("dialog", (dialog) => dialog.accept());
  await page.click("li:has-text('ui key') button:has-text('Revoke')");
  await page.waitForSelector("li:has-text('ui key'):has-text('revoked')", WAIT);
  ok("admin panel creates, lists and revokes a key within one viewport");
} catch (error) {
  failed += 1;
  console.log("FAIL:", error.message);
  await page.screenshot({ path: "e2e-failure.png" }).catch(() => {});
} finally {
  await browser.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
