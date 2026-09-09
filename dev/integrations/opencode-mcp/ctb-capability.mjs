import fs from "node:fs";
import path from "node:path";

// Server-side shell capability guard (CTB hardening).
//
// Architectural contract: a role WITHOUT a dev-MCP capability must not be able to
// recreate that capability through the generic shell. This guard is applied by the
// gateway to every command-carrying tool call (opencode_shell_execute,
// opencode_command_execute) BEFORE forwarding upstream, based on the resolved,
// server-authoritative effective profile.
//
// Design notes:
// - Not an infinite string blacklist: protected binaries map to capabilities, and
//   common launcher wrappers are unwrapped recursively so "cmd /c git",
//   "powershell -Command git ...", "npx wrangler", "pnpm exec wrangler" resolve to
//   the same underlying tool family.
// - Inline interpreters running code (node -e/--eval, python -c, PowerShell
//   -EncodedCommand) are denied outright when they reference protected binaries or
//   use encoded payloads; arbitrary obfuscated code execution remains a documented
//   residual risk that only a no-general-shell agent can fully eliminate.

export const SHELL_CAPABILITIES = Object.freeze({
  git: /^(?:git|gh)(?:\.exe)?$/i,
  cloudflare: /^wrangler(?:\.exe)?$/i,
  playwright: /^playwright(?:\.exe)?$/i,
  shadcn: /^shadcn(?:\.exe)?$/i,
  storybook: /^storybook(?:\.exe)?$/i,
});

const LAUNCHER_TOKENS = new Set([
  "cmd", "cmd.exe", "/c", "-c", "/k",
  "powershell", "powershell.exe", "pwsh", "pwsh.exe", "-command", "&",
  "npx", "npx.cmd", "pnpm", "pnpm.cmd", "npm", "npm.cmd", "yarn", "yarn.cmd",
  "exec", "dlx", "--", "call", "start", "/wait",
]);

// Flags that hand the interpreter arbitrary code: allowed only when the payload does
// not touch protected binaries; encoded payloads are always denied.
const INLINE_EVAL_FLAGS = new Set(["-e", "--eval", "-c", "-command", "--command"]);
const ALWAYS_DENIED_FLAGS = ["-encodedcommand", "-enc"];

function tokenize(command) {
  const tokens = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = pattern.exec(String(command))) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3]);
  }
  return tokens;
}

function requiredCapability(binary) {
  // Every whitespace-separated word of the token is checked: quoted fragments such as
  // '& git push' arrive as one token and embed the real binary after shell metacharacters.
  const candidates = String(binary).trim().split(/\s+/);
  for (const [capability, pattern] of Object.entries(SHELL_CAPABILITIES)) {
    if (candidates.some((word) => pattern.test(word))) return capability;
  }
  return null;
}

function payloadTouchesCapability(payload) {
  const hits = new Set();
  for (const [capability, pattern] of Object.entries(SHELL_CAPABILITIES)) {
    if (pattern.test(String(payload).trim()) || new RegExp(`(^|[^\\p{L}])${capability}([^\\p{L}]|$)`, "iu").test(String(payload))) hits.add(capability);
  }
  return [...hits];
}

export function analyzeShellCommand(command) {
  const tokens = tokenize(command);
  if (!tokens.length) return { protectedCapabilities: [], encodedPayload: false };
  let index = 0;
  const protectedCapabilities = new Set();
  // Phase 1: unwrap launchers until the first real binary.
  while (index < tokens.length) {
    const lower = tokens[index].toLowerCase();
    if (lower.startsWith("-enc")) return { protectedCapabilities: [], encodedPayload: true };
    if (INLINE_EVAL_FLAGS.has(lower)) return { protectedCapabilities: payloadTouchesCapability(tokens.slice(index + 1).join(" ")), encodedPayload: false };
    if (!LAUNCHER_TOKENS.has(lower)) break;
    index += 1;
  }
  if (index < tokens.length) {
    const capability = requiredCapability(tokens[index]);
    if (capability) protectedCapabilities.add(capability);
  } else {
    // Only launchers/flags with no binary: nothing protected to decide.
    return { protectedCapabilities: [], encodedPayload: false };
  }
  // Phase 2: scan remaining arguments for inline-eval payloads referencing protected tools.
  index += 1;
  while (index < tokens.length) {
    const argLower = tokens[index].toLowerCase();
    if (argLower.startsWith("-enc")) return { protectedCapabilities: [...protectedCapabilities], encodedPayload: true };
    if (INLINE_EVAL_FLAGS.has(argLower)) {
      for (const hit of payloadTouchesCapability(tokens.slice(index + 1).join(" "))) protectedCapabilities.add(hit);
      break;
    }
    index += 1;
  }
  return { protectedCapabilities: [...protectedCapabilities], encodedPayload: false };
}

// Throws CTB_SHELL_CAPABILITY_DENIED when the command requires a capability the
// resolved profile does not grant, or carries an encoded interpreter payload.
export function assertShellCommandAllowed(eagerConnections, command) {
  const granted = new Set(Array.isArray(eagerConnections) ? eagerConnections : []);
  const analysis = analyzeShellCommand(command);
  if (analysis.encodedPayload) {
    throw Object.assign(new Error("CTB_SHELL_CAPABILITY_DENIED"), { code: "CTB_SHELL_CAPABILITY_DENIED", reason: "encoded_interpreter_payload" });
  }
  const missing = analysis.protectedCapabilities.filter((capability) => !granted.has(capability));
  if (missing.length) {
    throw Object.assign(new Error("CTB_SHELL_CAPABILITY_DENIED"), { code: "CTB_SHELL_CAPABILITY_DENIED", missingCapabilities: missing });
  }
}

// Native agent -> enforceable dev-MCP capabilities. Single source of truth shared by
// agent selection and the gateway-side capability guard, so the invariant
// "effective granted capabilities == executable capabilities" is checkable in tests.
export const NATIVE_AGENT_CAPABILITIES = Object.freeze({
  "ctb-plan": [],
  "ctb-executor": [],
  "ctb-engineer": ["git"],
  "ctb-designer": ["shadcn", "storybook"],
  "ctb-ui-qa": ["playwright"],
  "ctb-cto-infra": ["cloudflare"],
});

export function capabilitiesForAgent(agentName) {
  return [...(NATIVE_AGENT_CAPABILITIES[agentName] || [])];
}
