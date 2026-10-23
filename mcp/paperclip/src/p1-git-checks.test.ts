import { describe, expect, it } from "vitest";
import { classifyGitCheckOutput } from "./p1-git.js";

describe("GitHub CI checks fail-closed classification", () => {
  it("never promotes GraphQL permission error (exit 4) with zero checks to success", () => {
    const verdict = classifyGitCheckOutput({
      exitCode: 4,
      stdout: "",
      stderr: "GraphQL: Resource not accessible by personal access token",
    });
    expect(verdict.overallStatus).toBe("unverified");
    expect(verdict.terminal).toBe(false);
    expect(verdict.rawExitCode).toBe(4);
  });

  it("refuses zero check rows even if gh exits zero", () => {
    expect(classifyGitCheckOutput({exitCode: 0, stdout: ""}).overallStatus).toBe("unverified");
    expect(classifyGitCheckOutput({exitCode: 0, stdout: "no checks reported on this PR"}).overallStatus).toBe("unverified");
  });

  it("allows only explicit real passing checks", () => {
    const result = classifyGitCheckOutput({exitCode: 0, stdout: "verify-infrastructure\tpass\t5s\thttps://github.com/check\ncompile\tpass\t8s"});
    expect(result.overallStatus).toBe("success");
    expect(result.terminal).toBe(true);
    expect(result.checkConclusions).toHaveLength(2);
  });

  it("does not accept all-skipped jobs", () => {
    expect(classifyGitCheckOutput({exitCode: 0, stdout: "optional\tskipped\t0s"}).overallStatus).toBe("unverified");
  });

  it("does not accept unknown statuses", () => {
    expect(classifyGitCheckOutput({exitCode: 0, stdout: "compile\tunknown\t1s"}).overallStatus).toBe("unverified");
  });

  it("marks failing job a terminal failure even with another passing job", () => {
    const result = classifyGitCheckOutput({exitCode: 1, stdout: "compile\tpass\t4s\nsecurity\tfail\t1s"});
    expect(result.overallStatus).toBe("failure");
    expect(result.terminal).toBe(true);
  });

  it("treats queued and pending checks as pending, not success", () => {
    const result = classifyGitCheckOutput({exitCode: 8, stdout: "compile\tpending\t0s"});
    expect(result.overallStatus).toBe("pending");
    expect(result.terminal).toBe(false);
  });

  it("retains success when an optional step is skipped alongside actual PASS jobs", () => {
    expect(classifyGitCheckOutput({exitCode: 0, stdout: "build\tpass\t3s\noptional\tskipped\t0s"}).overallStatus).toBe("success");
  });

  it("does not let exit-zero hide a reported failure", () => {
    expect(classifyGitCheckOutput({exitCode: 0, stdout: "security\tfail\t1s"}).overallStatus).toBe("failure");
  });

  it("refuses malformed output and stderr-only network failures", () => {
    expect(classifyGitCheckOutput({exitCode: 1, stdout: "GraphQL: Resource not accessible by personal access token"}).overallStatus).toBe("unverified");
    expect(classifyGitCheckOutput({exitCode: null, stdout: "", stderr: "network timeout"}).overallStatus).toBe("unverified");
  });
});
