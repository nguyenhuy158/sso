import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = join(ROOT, "src", "build-info.generated.ts");
const UNKNOWN = "unknown";

function git(...args) {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

const env = process.env;
const commit = env.WORKERS_CI_COMMIT_SHA || git("rev-parse", "HEAD") || UNKNOWN;
const branchFromGit = git("rev-parse", "--abbrev-ref", "HEAD");
const info = {
  commit,
  shortCommit: commit === UNKNOWN ? UNKNOWN : commit.slice(0, 7),
  branch:
    env.WORKERS_CI_BRANCH ||
    (branchFromGit === "HEAD" ? "" : branchFromGit) ||
    UNKNOWN,
  builtBy:
    env.WORKERS_CI === "1" || env.WORKERS_CI_BRANCH
      ? "workers-builds"
      : "local",
  dirty: git("status", "--porcelain") !== "",
  builtAt: new Date().toISOString(),
};

const contents = `import type { BuildInfo } from "./build-info";

export const BUILD_INFO: BuildInfo = ${JSON.stringify(info, null, 2)};
`;

let current = "";
try {
  current = readFileSync(OUTPUT, "utf8");
} catch {
  current = "";
}

const withoutTimestamp = (text) => text.replace(/"builtAt": "[^"]*"/, "");
if (withoutTimestamp(current) !== withoutTimestamp(contents)) {
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, contents);
}
