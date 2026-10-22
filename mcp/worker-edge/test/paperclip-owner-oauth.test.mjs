import test from "node:test";
import assert from "node:assert/strict";
import { isVerifiedOwnerBoardGrant } from "../../paperclip/mcp-gateway/owner-oauth-policy.mjs";

test("owner OAuth defaults to full Board only for verified Board key",async () => {
  assert.equal(await isVerifiedOwnerBoardGrant("BOARD", async x=>x==="BOARD"),true);
  assert.equal(await isVerifiedOwnerBoardGrant("AGENT", async x=>x==="BOARD"),false);
  assert.equal(await isVerifiedOwnerBoardGrant("SERVICE", async x=>x==="BOARD"),false);
});

test("missing or failed Board authority never upgrades",async () => {
  assert.equal(await isVerifiedOwnerBoardGrant("",async()=>true),false);
  assert.equal(await isVerifiedOwnerBoardGrant(null,async()=>true),false);
  assert.equal(await isVerifiedOwnerBoardGrant("BOARD",async()=>{throw Error("upstream unavailable")}),false);
});

test("credential is trimmed before Board authority validation",async () => {
  let presented = null;
  assert.equal(await isVerifiedOwnerBoardGrant("  BOARD  ",async x=>{presented=x;return true}),true);
  assert.equal(presented,"BOARD");
});
