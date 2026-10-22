// Self-hosted replacement for the bundled Plasmic action.
// Studio regenerates .github/workflows/plasmic.yml on publish but leaves this
// directory alone, so keeping the logic here makes the generated workflow work
// against our self-hosted Studio (bundled action installs its own CLI, which
// talks to codegen.plasmic.app and fails with "Project ... not found").
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const input = (name) => (process.env[`INPUT_${name.toUpperCase()}`] || "").trim();
const run = input("run");
const directory = input("directory") || ".";
const branch = input("branch") || "main";
const token = input("github_token");
const projectId = input("project_id");
const projectApiToken = input("project_api_token");
const title = input("title") || "chore: sync Plasmic project";

const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
const cwd = path.resolve(workspace, directory);

function sh(cmd, args, opts = {}) {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  return execFileSync(cmd, args, { cwd, stdio: "inherit", env: process.env, ...opts });
}

function setOutput(key, value) {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

function ensureWorkspace() {
  if (fs.existsSync(cwd)) return;
  throw new Error(`Directory ${directory} does not exist in branch ${branch}`);
}

function install() {
  const args = ["--yes", "pnpm@9.10.0", "install", "--ignore-workspace", "--ignore-scripts"];
  if (fs.existsSync(path.join(cwd, "pnpm-lock.yaml"))) args.push("--frozen-lockfile");
  sh("npx", args);
}

function patchCli() {
  const file = path.join(cwd, "node_modules/@plasmicapp/cli/dist/index.js");
  if (!fs.existsSync(file)) throw new Error("Plasmic CLI binary missing after install");
  const original = fs.readFileSync(file, "utf8");
  const matcher = /this\.auth\.host\s*===\s*DEFAULT_HOST\d*/g;
  const matches = [...original.matchAll(matcher)];
  if (matches.length !== 1) throw new Error(`CLI host routing signature changed: ${matches.length} matches`);
  fs.writeFileSync(file, original.replace(matcher, 'this.auth.host === "https://studio.plasmic.app"'));
  console.log("Patched CLI to use the self-hosted codegen API.");
}

function commitAndPush() {
  const rel = path.relative(workspace, cwd) || ".";
  sh("git", ["add", "-A", "--", rel], { cwd: workspace });
  const staged = execFileSync("git", ["diff", "--cached", "--name-only"], { cwd: workspace, encoding: "utf8" });
  if (staged.split("\n").some((f) => /(^|\/)(\.plasmic\.auth|\.env(\.|$))/.test(f))) {
    throw new Error("Refusing to commit private Plasmic credentials or environment files");
  }
  if (!staged.trim()) {
    console.log("No changes to commit.");
    return false;
  }
  sh("git", ["config", "user.name", "Plasmic Bot"], { cwd: workspace });
  sh("git", ["config", "user.email", "ops+git@plasmic.app"], { cwd: workspace });
  sh("git", ["commit", "-m", title], { cwd: workspace });
  const remote = token
    ? `https://x-access-token:${token}@github.com/${process.env.GITHUB_REPOSITORY}.git`
    : "origin";
  sh("git", ["push", remote, `HEAD:${branch}`], { cwd: workspace });
  return true;
}

try {
  ensureWorkspace();
  if (run === "init") {
    const hasApp = fs.existsSync(path.join(cwd, "package.json"));
    console.log(hasApp ? "Detected existing app. Moving forward..." : "No app scaffold; sync will initialize Plasmic config.");
    setOutput("synced", "false");
  } else if (run === "sync") {
    install();
    patchCli();
    sh(path.join(cwd, "node_modules/.bin/plasmic"), [
      "sync", "--yes", "--skip-upgrade-check",
      "--projects", `${projectId}:${projectApiToken}`,
    ]);
    commitAndPush();
  } else if (run === "build") {
    sh("npm", ["run", "build"]);
    setOutput("publish_dir", "out");
  } else {
    throw new Error(`Unknown run action: ${run}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
