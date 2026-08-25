import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./ctb-gateway.mjs", import.meta.url), "utf8");
assert.equal(/extractSessionId|ses\|session.*\[A-Za-z0-9_\-]+|JSON\.stringify\(result\)/.test(source), false, "CTB must not derive run identity from tool output text");
assert.match(source, /ctb\.executionContext\?\.sessionId \|\| forwarded\.sessionId \|\| forwarded\.id/);
assert.match(source, /if \(!sessionId \|\| !runs\[sessionId\] \|\| !activeCtbExecutions\.has\(sessionId\)\) return/);
console.log("CTB run identity fake ses_test_old_id regression: PASS");
