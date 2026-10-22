// Fail closed on retired MCP integrations while preserving the OpenCode agent runtime.
import { readFileSync, existsSync } from "node:fs";
import assert from "node:assert/strict";
const target=JSON.parse(readFileSync("ops/coolify/targets.json","utf8"));
const banned=["mcp/opendesign","mcp/opencode","dev/integrations/opencode-mcp","ops/design-stack/services/opendesign-bridge-mcp","ops/design-stack/libs/od-client","mcp/plasmic/services/opendesign-bridge-mcp","mcp/plasmic/libs/od-client"];
for(const p of banned)assert.equal(existsSync(p),false,"retired MCP source must be absent: "+p);
for(const t of target.coolifyTargets){assert.ok(!/opendesign|opencode/i.test(t.id+" "+t.sourceDirectory+" "+(t.buildContext||"")),"retired MCP may not be a Coolify target: "+t.id);}
for(const p of ["mcp/plasmic/Dockerfile.mcp","mcp/plasmic/docker-compose.mcp.yml","ops/design-stack/Dockerfile.mcp","ops/design-stack/docker-compose.mcp.yml"]){
 const c=readFileSync(p,"utf8");
 assert.doesNotMatch(c,/opendesign|opencode|OD_API_TOKEN|8092/i,"retired MCP referenced in active packaging: "+p);
 assert.match(c,/plasmic/i,"Plasmic must remain active");
}
assert.equal(existsSync("opencode.json"),true,"OpenCode agent runtime config must be preserved");
for(const p of ["mcp/plasmic/docker-compose.mcp.yml","ops/design-stack/docker-compose.mcp.yml"]){
 const c=readFileSync(p,"utf8");
 assert.equal((c.match(/^  plasmic-mcp:/gm)||[]).length,1,"exactly one Plasmic service");
 assert.match(c,/IMAGE_TAG:\?/,"pin to approved main SHA");
}
console.log("PASS: OpenDesign/OpenCode MCP retired; Plasmic-only builds and OpenCode agent runtime preserved");
