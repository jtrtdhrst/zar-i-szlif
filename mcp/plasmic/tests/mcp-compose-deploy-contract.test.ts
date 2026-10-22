import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const compose=readFileSync(new URL("../docker-compose.mcp.yml",import.meta.url),"utf8");
const env=readFileSync(new URL("../.env.example",import.meta.url),"utf8");
describe("standalone Plasmic-only deployment",()=>{
 it("defines exactly one MCP service",()=>{assert.deepEqual([...compose.matchAll(/^  ([a-z][a-z-]+):$/gm)].map(x=>x[1]),["plasmic-mcp"]);});
 it("requires immutable approved SHA and service-scoped image",()=>{assert.match(compose,/ghcr\.io\/miloszspyrka-code\/zar-i-szlif-plasmic-mcp:\$\{IMAGE_TAG:\?/);assert.doesNotMatch(compose,/:latest/);assert.match(env,/^IMAGE_TAG=$/m);});
 it("requires auth and leaves only Plasmic port",()=>{assert.match(compose,/MCP_AUTH_TOKEN:\s*\$\{PLASMIC_MCP_TOKEN:\?/);assert.match(compose,/MCP_HTTP_PORT: "8091"/);assert.doesNotMatch(compose,/8092|OD_API_TOKEN|OPENDESIGN_BRIDGE_TOKEN/);});
 it("never builds an unversioned local image",()=>{assert.doesNotMatch(compose,/^\s+build:/m);});
});
