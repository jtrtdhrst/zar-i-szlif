import { describe, expect, it } from "vitest";
import { resolveHostRunContext } from "./host-run-context.js";

const activeRunId = "11111111-1111-4111-8111-111111111111";
const expiredRunId = "22222222-2222-4222-8222-222222222222";
const operatorRunId = "33333333-3333-4333-8333-333333333333";

describe("host run-context compatibility", () => {
  it("does not relabel the authenticated session run as an operator run", () => {
    expect(resolveHostRunContext({ operatorRunId: expiredRunId }, activeRunId)).toEqual({ runId: activeRunId });
  });

  it("canonicalizes both fields and preserves the supervisor's fail-closed context requirement", () => {
    expect(resolveHostRunContext({ runId: activeRunId, operatorRunId: expiredRunId }, null)).toEqual({ runId: activeRunId });
    expect(resolveHostRunContext({ operatorRunId }, null)).toEqual({ operatorRunId });
    expect(resolveHostRunContext({}, null)).toBeNull();
  });
});
