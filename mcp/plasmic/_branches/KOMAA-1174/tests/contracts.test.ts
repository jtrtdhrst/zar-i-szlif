// Testy jednostkowe: kontrakty (hash, konflikt, idempotencja, locki, audyt).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256, checkSyncConflict } from "../libs/contracts/sync.ts";
import { makeDesignContext } from "../libs/contracts/design-context.ts";
import { idempotent } from "../libs/contracts/idempotency.ts";
import { withProjectLock } from "../libs/contracts/locks.ts";
import { auditLog } from "../libs/contracts/audit.ts";

describe("sync", () => {
  it("sha256 jest deterministyczny", () => {
    assert.equal(sha256({ a: 1 }), sha256({ a: 1 }));
    assert.notEqual(sha256({ a: 1 }), sha256({ a: 2 }));
  });
  it("brak zmian = ok", () => {
    assert.equal(checkSyncConflict({ source: "a", target: "a", lastSync: "a" }).status, "ok");
  });
  it("zmiana jednej strony = ok", () => {
    assert.equal(checkSyncConflict({ source: "b", target: "a", lastSync: "a" }).status, "ok");
  });
  it("zmiana obu stron = SYNC_CONFLICT", () => {
    const r = checkSyncConflict({ source: "b", target: "c", lastSync: "a" });
    assert.equal(r.status, "conflict");
    assert.match((r as { diff: string }).diff, /SYNC_CONFLICT/);
  });
  it("pierwszy sync (lastSync null) nigdy nie konfliktuje", () => {
    assert.equal(checkSyncConflict({ source: "b", target: "c", lastSync: null }).status, "ok");
  });
});

describe("design-context", () => {
  it("ma wersję i wymagane pola", () => {
    const ctx = makeDesignContext({
      project: { id: "p", name: "P" },
      tokens: {},
      components: [],
      constraints: [],
      sourceRefs: [],
    });
    assert.equal(ctx.version, "1");
  });
});

describe("idempotencja + locki + audyt", () => {
  it("powtórka klucza zwraca zapamiętany wynik bez drugiego wywołania", async () => {
    const dir = await mkdtemp(join(tmpdir(), "idem-"));
    let calls = 0;
    const fn = async () => (++calls, { v: 1 });
    const r1 = await idempotent(dir, "k", fn);
    const r2 = await idempotent(dir, "k", fn);
    assert.equal(calls, 1);
    assert.equal(r1.deduped, false);
    assert.equal(r2.deduped, true);
    assert.deepEqual(r2.result, { v: 1 });
  });
  it("lock serializuje zapisy projektu", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lock-"));
    const order: number[] = [];
    await Promise.all([
      withProjectLock(dir, "p1", async () => {
        await new Promise((r) => setTimeout(r, 100));
        order.push(1);
      }),
      withProjectLock(dir, "p1", async () => {
        order.push(2);
      }),
    ]);
    assert.deepEqual(order, [1, 2]);
  });
  it("audyt dopisuje JSONL bez sekretów", async () => {
    const dir = await mkdtemp(join(tmpdir(), "audit-"));
    const f = join(dir, "a.jsonl");
    await auditLog(f, { tool: "plasmic_update", project: "p", ok: true });
    const line = JSON.parse(await readFile(f, "utf8"));
    assert.equal(line.tool, "plasmic_update");
    assert.ok(line.timestamp);
  });
});
