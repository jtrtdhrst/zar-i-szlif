import assert from "node:assert/strict";
import test from "node:test";
import {
  FORBIDDEN_MUTATING_TOOLS,
  READ_ONLY_TOOLS,
  isReadOnlyTool,
} from "../../scripts/read-only-tools.mjs";

test("read-only allowlist has explicit names and no mutating wrappers", () => {
  assert.ok(READ_ONLY_TOOLS.size > 50, "allowlist unexpectedly small");
  for (const name of FORBIDDEN_MUTATING_TOOLS) {
    assert.equal(isReadOnlyTool(name), false, `${name} must not be dispatched by the read-only canary`);
  }
  // Regression: the previous prefix rule matched this mutating multi-action wrapper.
  assert.equal(isReadOnlyTool("paperclipScheduledTasks"), false);
  assert.equal(isReadOnlyTool("paperclipWikiList"), true);
  assert.equal(isReadOnlyTool("paperclipGetIssue"), true);
});

test("unknown tools are not treated as read-only", () => {
  assert.equal(isReadOnlyTool("paperclipDefinitelyNotATool"), false);
  assert.equal(isReadOnlyTool(""), false);
});
