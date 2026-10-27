import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const BASE = "https://paperclip-mcp-canary.zariszlif.pl";
const APP_UUID = "fs9rik9axzl1ubbimekvqs03";

export function assertReleaseIdentity(actual, sourceSha, resourceUuid = APP_UUID) {
  assert.match(sourceSha, /^[a-f0-9]{40}$/, "expected source SHA must be a full commit");
  assert.equal(actual?.sourceSha, sourceSha, "public canary serves the wrong source commit");
  assert.equal(actual?.resourceUuid, resourceUuid, "public canary serves the wrong Coolify app");
  assert.match(actual?.containerName || "", new RegExp("^" + resourceUuid + "-[A-Za-z0-9_-]+$"), "missing real Coolify container name");
}

async function get(path, fetcher = fetch) {
  return fetcher(BASE + path, { redirect: "manual", signal: AbortSignal.timeout(12000) });
}

export async function verifyPublicCanary(sourceSha, fetcher = fetch, retries = 48) {
  let matched = false;
  for (let i = 0; i < retries; i++) {
    try {
      const response = await get("/__release/identity", fetcher);
      if (response.status !== 200) throw new Error("release identity HTTP " + response.status);
      const identity = await response.json();
      assertReleaseIdentity(identity, sourceSha);
      console.log("PASS: public Paperclip MCP canary source, Coolify UUID and container:", identity.sourceSha, identity.containerName);
      matched = true;
      break;
    } catch (error) {
      console.log("Canary deployment readback not matched (" + (i + 1) + "/" + retries + "):", error.message);
      if (i < retries - 1) await new Promise(resolve => setTimeout(resolve, 10000));
    }
  }
  if (!matched) throw new Error("public canary never matched the merged source and actual Coolify container");

  const health = await get("/health", fetcher);
  assert.equal(health.status, 200, "Paperclip MCP health status");
  assert.equal((await health.json()).ok, true, "Paperclip MCP health payload");

  const oauth = await get("/.well-known/oauth-authorization-server", fetcher);
  assert.equal(oauth.status, 200, "OAuth metadata status");
  assert.equal((await oauth.json()).issuer, BASE, "OAuth issuer must be canary origin");

  const protectedResource = await get("/.well-known/oauth-protected-resource/mcp", fetcher);
  assert.equal(protectedResource.status, 200, "OAuth protected-resource metadata");

  const anonymous = await fetcher(BASE + "/mcp", {
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(12000),
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  assert.equal(anonymous.status, 401, "anonymous MCP tools/list must fail closed");
  console.log("PASS: health, OAuth metadata, issuer, protected-resource and unauthorized MCP denial");
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyPublicCanary(process.env.GITHUB_SHA || "").catch(error => {
    console.error("Paperclip canary release verification FAILED:", error.message);
    process.exitCode = 1;
  });
}
