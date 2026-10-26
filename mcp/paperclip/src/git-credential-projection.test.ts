import { afterEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyTransportGate, deriveTransportVerdict, hasGitHubTokenEnv } from "./p1-git.js";
import { gitCredentialEnv, gitFetchCredentialEnv, readBoundGitToken, redactWorkspaceOutput } from "./workspace-native.js";

const PLACEHOLDER = "PAPERCLIP_GITHUB_WRITES_DISABLED";

describe("git credential projection", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads an operator placeholder as no credential at all", () => {
    vi.stubEnv("GH_TOKEN", PLACEHOLDER);
    vi.stubEnv("GITHUB_TOKEN", PLACEHOLDER);

    expect(readBoundGitToken()).toBeNull();
    expect(gitCredentialEnv()).toBeNull();
    const probe = hasGitHubTokenEnv();
    expect(probe.present).toBe(false);
    expect(probe.kind).toBeNull();
    expect(probe.reason).toContain("placeholder");
  });

  it("projects a bound token into git so the transport can authenticate", () => {
    vi.stubEnv("GH_TOKEN", "ghp_bound_token_value");
    vi.stubEnv("GITHUB_TOKEN", "");

    const env = gitCredentialEnv();
    expect(env).not.toBeNull();
    expect(env?.PAPERCLIP_GIT_TOKEN).toBe("ghp_bound_token_value");
    expect(env?.GIT_CONFIG_COUNT).toBe("3");
    expect(env?.GIT_CONFIG_KEY_0).toBe("credential.helper");
    expect(env?.GIT_CONFIG_VALUE_0).toBe("");
    expect(env?.GIT_CONFIG_KEY_1).toBe("credential.https://github.com.helper");
    expect(env?.GIT_CONFIG_KEY_2).toBe("credential.https://www.github.com.helper");
    // The helper reads the token from the environment; the value itself is never
    // embedded in a config value (it would land in argv and in process listings).
    expect(env?.GIT_CONFIG_VALUE_1).toContain("PAPERCLIP_GIT_TOKEN");
    expect(env?.GIT_CONFIG_VALUE_1).not.toContain("ghp_bound_token_value");
    expect(env?.GIT_TERMINAL_PROMPT).toBe("0");
  });

  it("projects credentials only for origin fetches from the approved product repo", () => {
    const fixtureToken = ["bound", "opaque", "credential"].join("-");
    vi.stubEnv("GH_TOKEN", fixtureToken);
    const scoped = gitFetchCredentialEnv(
      ["git", "fetch", "origin", "main"],
      "https://github.com/miloszspyrka-code/zar-i-szlif.git",
    );

    expect(scoped?.PAPERCLIP_GIT_TOKEN).toBe(fixtureToken);
    expect(scoped?.GH_TOKEN).toBeUndefined();
    expect(scoped?.GITHUB_TOKEN).toBeUndefined();
    expect(scoped?.GIT_CONFIG_VALUE_3).toBe("false");
    expect(scoped?.GIT_CONFIG_KEY_3).toBe("fetch.recurseSubmodules");
    expect([scoped?.GIT_CONFIG_VALUE_1, scoped?.GIT_CONFIG_VALUE_2].join("\n")).not.toContain(fixtureToken);
    const fill = spawnSync("git", ["credential", "fill"], {
      input: "protocol=https\nhost=github.com\n\n",
      encoding: "utf8",
      env: { ...process.env, GH_TOKEN: "", GITHUB_TOKEN: "", ...scoped },
    });
    expect(fill.status).toBe(0);
    expect(fill.stdout).toContain(`password=${fixtureToken}`);
    expect(redactWorkspaceOutput(fill.stdout)).not.toContain(fixtureToken);
    expect(gitFetchCredentialEnv(["git", "fetch", "other", "main"], "https://github.com/miloszspyrka-code/zar-i-szlif.git")).toBeNull();
    expect(gitFetchCredentialEnv(["git", "fetch", "origin", "main"], "https://github.com/other/repo.git")).toBeNull();
    expect(gitFetchCredentialEnv(["git", "-c", "remote.origin.url=https://github.com/attacker/repo.git", "fetch", "origin", "main"], "https://github.com/miloszspyrka-code/zar-i-szlif.git")).toBeNull();
    expect(gitFetchCredentialEnv(["git", "-c", "url.https://github.com/attacker/.insteadOf=https://github.com/miloszspyrka-code/zar-i-szlif", "fetch", "origin", "main"], "https://github.com/miloszspyrka-code/zar-i-szlif.git")).toBeNull();
    expect(gitFetchCredentialEnv(["git", "--config-env=remote.origin.url=OVERRIDE", "fetch", "origin", "main"], "https://github.com/miloszspyrka-code/zar-i-szlif.git")).toBeNull();
    expect(gitFetchCredentialEnv(["git", "push", "origin", "main"], "https://github.com/miloszspyrka-code/zar-i-szlif.git")).toBeNull();
    expect(gitFetchCredentialEnv(["git", "fetch", "origin", "main"], "https://token@github.com/miloszspyrka-code/zar-i-szlif.git")).toBeNull();
    expect(gitFetchCredentialEnv(["git", "fetch", "origin", "main", "--recurse-submodules"], "https://github.com/miloszspyrka-code/zar-i-szlif.git")).toBeNull();
    expect(gitFetchCredentialEnv(["git", "fetch", "origin", "main"], "https://github.com/miloszspyrka-code/zar-i-szlif.git\nhttps://github.com/other/repo.git")).toBeNull();
  });

  it("runs a fetch with an overridden origin without projecting the bound credential", () => {
    const fixtureToken = ["bound", "override", "credential"].join("-");
    vi.stubEnv("GH_TOKEN", fixtureToken);
    const dir = mkdtempSync(join(tmpdir(), "paperclip-fetch-override-"));
    try {
      const attackerRemote = join(dir, "attacker.git");
      expect(spawnSync("git", ["init", "--bare", attackerRemote], { encoding: "utf8" }).status).toBe(0);
      const clientRepo = join(dir, "client");
      expect(spawnSync("git", ["init", clientRepo], { encoding: "utf8" }).status).toBe(0);
      expect(spawnSync("git", ["-C", clientRepo, "-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-m", "seed"], { encoding: "utf8" }).status).toBe(0);
      expect(spawnSync("git", ["-C", clientRepo, "remote", "add", "origin", `file://${attackerRemote}`], { encoding: "utf8" }).status).toBe(0);
      expect(spawnSync("git", ["-C", clientRepo, "push", "origin", "HEAD:main"], { encoding: "utf8" }).status).toBe(0);
      expect(spawnSync("git", ["--git-dir", attackerRemote, "symbolic-ref", "HEAD", "refs/heads/main"], { encoding: "utf8" }).status).toBe(0);
      const argv = ["git", "-c", `remote.origin.url=file://${attackerRemote}`, "fetch", "origin"];
      const credentialEnv = gitFetchCredentialEnv(argv, "https://github.com/miloszspyrka-code/zar-i-szlif.git");
      expect(credentialEnv).toBeNull();
      const fetch = spawnSync("git", ["-c", `safe.directory=${dir}`, ...argv.slice(1)], {
        cwd: clientRepo,
        encoding: "utf8",
        env: { PATH: process.env.PATH, HOME: dir, GIT_TERMINAL_PROMPT: "0", ...(credentialEnv ?? {}) },
      });
      expect(fetch.status, fetch.stderr).toBe(0);
      expect(credentialEnv?.PAPERCLIP_GIT_TOKEN).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("redacts embedded credentials from captured Git output", () => {
    const fixtureToken = ["ghp", "exampletoken123"].join("_");
    expect(redactWorkspaceOutput("remote https://secret-value@github.com/miloszspyrka-code/zar-i-szlif.git"))
      .toBe("remote https://[REDACTED]@github.com/miloszspyrka-code/zar-i-szlif.git");
    expect(redactWorkspaceOutput(`https://x-access-token:${fixtureToken}@github.com/owner/repo.git`))
      .not.toContain(fixtureToken);
  });

  it("does not let a placeholder hide a real token in the other spelling", () => {
    vi.stubEnv("GH_TOKEN", PLACEHOLDER);
    vi.stubEnv("GITHUB_TOKEN", "ghp_real_token_value");

    expect(readBoundGitToken()).toBe("ghp_real_token_value");
    expect(hasGitHubTokenEnv().present).toBe(true);
  });

  it("answers `git credential fill` without prompting when a token is bound", () => {
    vi.stubEnv("GH_TOKEN", "ghp_bound_token_value");
    vi.stubEnv("GITHUB_TOKEN", "");

    const env = gitCredentialEnv();
    expect(env).not.toBeNull();
    const result = spawnSync("git", ["credential", "fill"], {
      input: "protocol=https\nhost=github.com\n\n",
      encoding: "utf8",
      env: { ...process.env, ...(env as Record<string, string>) },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("username=");
    expect(result.stdout).toContain("password=ghp_bound_token_value");
    expect(result.stderr).not.toContain("could not read Username");
  });

  it("fails closed at `git credential fill` when only a placeholder is bound", () => {
    vi.stubEnv("GH_TOKEN", PLACEHOLDER);
    vi.stubEnv("GITHUB_TOKEN", PLACEHOLDER);

    expect(gitCredentialEnv()).toBeNull();
    // No projection => no helper answers => git must refuse instead of prompting.
    const result = spawnSync("git", ["credential", "fill"], {
      input: "protocol=https\nhost=github.com\n\n",
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "credential.helper",
        GIT_CONFIG_VALUE_0: "",
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("password=");
  });
});

describe("git transport agreement (probe result == transport result)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("treats an authenticated but EMPTY remote as an authenticated transport", () => {
    const verdict = deriveTransportVerdict({ exitCode: 0, credentialProjected: true, remoteRefCount: 0 });

    expect(verdict.transportAuthenticated).toBe(true);
    expect(verdict.reason).toBeNull();
    expect(verdict.remoteRefCount).toBe(0);
  });

  it("reports a denied transport as not authenticated", () => {
    const verdict = deriveTransportVerdict({ exitCode: 128, credentialProjected: true, remoteRefCount: 0 });

    expect(verdict.transportAuthenticated).toBe(false);
    expect(verdict.reason).toContain("refused");
  });

  it("does not call an anonymous contact an authenticated transport, however many refs it lists", () => {
    const verdict = deriveTransportVerdict({ exitCode: 0, credentialProjected: false, remoteRefCount: 3 });

    expect(verdict.transportAuthenticated).toBe(false);
    expect(verdict.reason).toContain("no usable GitHub credential");
  });

  it("never advertises push/create_pr while the transport is not authenticated", () => {
    const denied = applyTransportGate(
      ["read", "push", "create_pr"],
      [],
      { transportAuthenticated: false },
    );
    expect(denied.allowedOperations).toEqual(["read"]);
    expect(denied.missingPermissions).toContain("transport:not-authenticated");

    const allowed = applyTransportGate(
      ["read", "push", "create_pr"],
      [],
      { transportAuthenticated: true },
    );
    expect(allowed.allowedOperations).toEqual(["read", "push", "create_pr"]);
    expect(allowed.missingPermissions).toEqual([]);

    const readOnly = applyTransportGate(["read"], ["contents:write"], { transportAuthenticated: false });
    expect(readOnly.allowedOperations).toEqual(["read"]);
    expect(readOnly.missingPermissions).toEqual(["contents:write"]);
  });

  it("reads an empty remote as authenticated and an unreachable one as denied (real git)", () => {
    vi.stubEnv("GH_TOKEN", "ghp_bound_token_value");
    vi.stubEnv("GITHUB_TOKEN", "");
    const env = gitCredentialEnv() as Record<string, string>;
    const dir = mkdtempSync(join(tmpdir(), "paperclip-transport-"));
    try {
      spawnSync("git", ["init", "--bare", join(dir, "empty.git")], { encoding: "utf8" });
      const empty = spawnSync("git", ["ls-remote", "--heads", `file://${join(dir, "empty.git")}`], {
        encoding: "utf8",
        env: { ...process.env, ...env },
      });
      expect(empty.status).toBe(0);
      expect(empty.stdout.trim()).toBe("");
      expect(
        deriveTransportVerdict({ exitCode: empty.status, credentialProjected: true, remoteRefCount: 0 }).transportAuthenticated,
      ).toBe(true);

      const denied = spawnSync("git", ["ls-remote", "--heads", `file://${join(dir, "missing.git")}`], {
        encoding: "utf8",
        env: { ...process.env, ...env },
      });
      expect(denied.status).not.toBe(0);
      expect(
        deriveTransportVerdict({ exitCode: denied.status, credentialProjected: true, remoteRefCount: 0 }).transportAuthenticated,
      ).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
