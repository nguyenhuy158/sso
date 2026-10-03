// Runs the whole E2E suite in one command: mint a throwaway signing key, start
// `wrangler dev` with it, run the read-only smoke then the session smoke, and
// stop the server. Your own .dev.vars is never read or touched: the test
// secrets go to a temp env file passed with --env-file.
//
// Environment:
// - E2E_PORT: port for wrangler dev (default 8787)
// - PLAYWRIGHT_CHROMIUM_PATH: use a specific Chromium
import { spawn } from "node:child_process";
import { webcrypto } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = process.env.E2E_PORT || "8787";
const BASE = `http://127.0.0.1:${PORT}`;
const SERVER_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 500;

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

const suiteEnv = {
  ...process.env,
  E2E_BASE_URL: BASE,
  E2E_JWT_PRIVATE_KEY: privateKey,
};

/** Runs a command to completion; rejects on a non-zero exit. */
function run(command, args, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env: suiteEnv });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${label} failed (exit ${code})`)),
    );
  });
}

/** Waits until the Worker serves its JWKS, or throws on timeout/early exit. */
async function waitForServer(child) {
  const deadline = Date.now() + SERVER_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(`wrangler dev exited early (${child.exitCode})`);
    try {
      const response = await fetch(`${BASE}/.well-known/jwks.json`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`wrangler dev not up after ${SERVER_TIMEOUT_MS}ms`);
}

// `detached` gives the server its own process group: `pnpm exec` adds node
// layers, and killing only the outer PID would orphan wrangler/workerd on PORT.
const server = spawn(
  "pnpm",
  [
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
  {
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, CI: "1" },
    detached: true,
  },
);

/** Signals the server's whole process group (no-op once it is gone). */
function killServer(signal) {
  try {
    process.kill(-server.pid, signal);
  } catch {
    // Group already gone.
  }
}

// The detached group does not receive Ctrl-C, so clean it up ourselves.
process.once("SIGINT", () => {
  killServer("SIGKILL");
  rmSync(secretsDir, { recursive: true, force: true });
  process.exit(130);
});

let failed = false;
try {
  await waitForServer(server);
  console.log(`\nServer ready at ${BASE}, running smoke suites\n`);
  await run("node", ["e2e/readonly-smoke.mjs"], "read-only smoke");
  await run("node", ["e2e/ui-smoke.mjs"], "session smoke");
} catch (error) {
  failed = true;
  console.error("E2E FAIL:", error.message);
} finally {
  const exited = new Promise((resolve) =>
    server.once("exit", () => resolve(true)),
  );
  killServer("SIGTERM");
  // Give wrangler time to clean up, then make sure nothing outlives us.
  const stopped =
    server.exitCode !== null ||
    (await Promise.race([
      exited,
      new Promise((resolve) => setTimeout(() => resolve(false), 5000)),
    ]));
  // Kill the whole group: wrangler can exit before its workerd child does.
  killServer("SIGKILL");
  if (!stopped) console.error("wrangler did not stop on SIGTERM, sent SIGKILL");
  rmSync(secretsDir, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
