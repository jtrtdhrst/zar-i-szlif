import assert from "node:assert/strict";
import { isFallbackSuppressed, isFallbackEligibleError } from "./ctb-policy.mjs";

// KOMAA-168 A/2 regression: a caller-requested model must fail truthfully. The gateway
// fallback (default -> fallback model) must NEVER mask an explicit bad modelID as success.
let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`KOMAA-168 ${name}: PASS`);
}

// A provider/model failure the gateway would otherwise try to mask with the fallback.
const providerModelFailure = Object.assign(new Error("model nemotron-unknown not found"), { code: "UPSTREAM_MODEL_NOT_FOUND" });
assert.equal(isFallbackEligibleError(providerModelFailure), true, "bad model must be fallback-eligible by pattern");

check("explicit-bad-model-suppresses-fallback", () => {
  // Explicit model requested + failure -> fallback suppressed (no silent retry).
  assert.equal(isFallbackSuppressed({ explicitModel: true, fallbackModel: { providerID: "opencode", modelID: "mimo-v2.5-free" }, failure: providerModelFailure }), true);
});

check("default-model-keeps-fallback", () => {
  // Gateway default (not caller-requested) + eligible failure -> fallback allowed.
  assert.equal(isFallbackSuppressed({ explicitModel: false, fallbackModel: { providerID: "opencode", modelID: "mimo-v2.5-free" }, failure: providerModelFailure }), false);
});

check("no-fallback-model-suppresses", () => {
  assert.equal(isFallbackSuppressed({ explicitModel: false, fallbackModel: null, failure: providerModelFailure }), true);
});

check("ctb-error-suppresses-fallback", () => {
  // A gateway/policy error must never consume the single fallback attempt.
  const ctbErr = Object.assign(new Error("denied"), { code: "CTB_CAPABILITY_DENIED" });
  assert.equal(isFallbackSuppressed({ explicitModel: false, fallbackModel: { providerID: "opencode", modelID: "mimo-v2.5-free" }, failure: ctbErr }), true);
});

check("explicit-bad-model-with-no-configured-fallback-suppresses", () => {
  assert.equal(isFallbackSuppressed({ explicitModel: true, fallbackModel: null, failure: providerModelFailure }), true);
});

console.log(`KOMAA-168 fallback-suppression regression: ${passed}/5 PASS`);
process.exit(0);
