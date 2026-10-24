import { describe, expect, it } from "vitest";
import { resolveHostRunContext } from "./host-run-context.js";

const activeRunId = "11111111-1111-4111-8111-111111111111";
const expiredRunId = "22222222-2222-4222-8222-222222222222";

describe("host run-context compatibility", () => {
  it("replaces an expired legacy operatorRunId with the authenticated session run", () => {
    expect(resolveHostRunContext({ operatorRunId: expiredRunId }, activeRunId)).toEqual({ runId: activeRunId, operatorRunId: activeRunId });
  });

  it("canonicalizes both fields and preserves the supervisor's fail-closed context requirement", () => {
    expect(resolveHostRunContext({ runId: activeRunId, operatorRunId: expiredRunId }, null)).toEqual({ runId: activeRunId, operatorRunId: activeRunId });
    expect(resolveHostRunContext({ operatorRunId: expiredRunId }, null)).toEqual({ runId: expiredRunId, operatorRunId: expiredRunId });
    expect(resolveHostRunContext({}, null)).toBeNull();
  });
});
