// Runs the whole E2E suite in one command: mint a throwaway signing key, start
// `wrangler dev` with it, run the read-only smoke then the session smoke, and
// stop the server. Your own .dev.vars is never read or touched: the test
// secrets go to a temp env file passed with --env-file.
//
// Environment:
// - E2E_PORT: port for wrangler dev (default 8787)
// - PLAYWRIGHT_CHROMIUM_PATH: use a specific Chromium
import { webcrypto } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run, startServer } from "@huyab/e2e";

const PORT = process.env.E2E_PORT || "8787";
const BASE = `http://127.0.0.1:${PORT}`;

const keyPair = await webcrypto.subtle.generateKey(
  {
    name: "RSASSA-PKCS1-v1_5",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256",
  },
  true,
  ["sign", "verify"],
);
const privateKey = JSON.stringify(
  await webcrypto.subtle.exportKey("jwk", keyPair.privateKey),
);

// Dummy Google credentials: /login only needs them present to build the
// redirect; the suites never follow it to Google.
const secretsDir = mkdtempSync(join(tmpdir(), "sso-e2e-"));
// Also runs on the Ctrl-C exit of startServer, so the key never outlives us.
process.on("exit", () => rmSync(secretsDir, { recursive: true, force: true }));
const envFile = join(secretsDir, "e2e.env");
writeFileSync(
  envFile,
  [
    `JWT_PRIVATE_KEY='${privateKey}'`,
    "GOOGLE_CLIENT_ID=e2e-client-id.apps.googleusercontent.com",
    "GOOGLE_CLIENT_SECRET=e2e-client-secret",
    "",
  ].join("\n"),
);

const suiteEnv = { E2E_BASE_URL: BASE, E2E_JWT_PRIVATE_KEY: privateKey };

let failed = false;
let server;
try {
  server = await startServer({
    command: "pnpm",
    args: [
      "exec",
      "wrangler",
      "dev",
      "--ip",
      "127.0.0.1",
      "--port",
      PORT,
      "--env-file",
      envFile,
    ],
    readyUrl: `${BASE}/.well-known/jwks.json`,
  });
  console.log(`\nServer ready at ${BASE}, running smoke suites\n`);
  await run("node", ["e2e/readonly-smoke.mjs"], {
    label: "read-only smoke",
    env: suiteEnv,
  });
  await run("node", ["e2e/ui-smoke.mjs"], {
    label: "session smoke",
    env: suiteEnv,
  });
} catch (error) {
  failed = true;
  console.error("E2E FAIL:", error.message);
} finally {
  await server?.stop();
}

process.exit(failed ? 1 : 0);
