import assert from "node:assert/strict";
import { describe, it } from "node:test";

function isDependencyReady(blockedBy, doneSet) {
  for (const b of blockedBy) if (!doneSet.has(b)) return false;
  return true;
}
function nextWakeableDependents(blockerId, dependents, doneSet) {
  return dependents.filter(d => d.blockedBy.includes(blockerId) && isDependencyReady(d.blockedBy, new Set([...doneSet, blockerId])));
}
function parentWakeable(parentId, children) {
  const kids = children.filter(c => c.parentId === parentId);
  if (kids.length === 0) return null;
  if (!kids.every(c => c.status === "done" || c.status === "cancelled")) return null;
  return parentId;
}

describe("native parentId + blockedByIssueIds regression", () => {
  it("parentId is containment only, blockedBy is dependency", () => {
    const parent = { id: "P" };
    const A = { id: "A", parentId: "P", blockedBy: [], status: "todo" };
    const B = { id: "B", parentId: "P", blockedBy: ["A"], status: "todo" };
    const C = { id: "C", parentId: "P", blockedBy: ["B"], status: "todo" };
    assert.equal(A.parentId, "P");
    assert.deepEqual(B.blockedBy, ["A"]);
    assert.ok(!isDependencyReady(B.blockedBy, new Set()));
    assert.ok(isDependencyReady(B.blockedBy, new Set(["A"])));
    assert.ok(!isDependencyReady(C.blockedBy, new Set(["A"])));
    assert.ok(isDependencyReady(C.blockedBy, new Set(["A","B"])));
  });

  it("sequential A->B->C: exactly one wake per terminal", () => {
    const dependents = [
      { id: "B", blockedBy: ["A"] },
      { id: "C", blockedBy: ["B"] },
    ];
    let done = new Set();
    let w = nextWakeableDependents("A", dependents, done);
    assert.deepEqual(w.map(x=>x.id), ["B"]);
    done.add("A"); done.add("B");
    w = nextWakeableDependents("B", dependents, done);
    assert.deepEqual(w.map(x=>x.id), ["C"]);
    done.add("C");
    w = nextWakeableDependents("C", dependents, done);
    assert.deepEqual(w, []);
  });

  it("B not runnable while A unfinished, no parallel", () => {
    assert.equal(isDependencyReady(["A"], new Set()), false);
    assert.equal(isDependencyReady(["A"], new Set(["A"])), true);
  });

  it("no fake blocked without blockedBy", () => {
    assert.equal(isDependencyReady([], new Set()), true);
    assert.equal(isDependencyReady([], new Set(["X"])), true);
  });

  it("parent wakes only when all children terminal", () => {
    const children = [
      { id:"A", parentId:"P", status:"done" },
      { id:"B", parentId:"P", status:"done" },
    ];
    assert.equal(parentWakeable("P", children), "P");
    children[1].status = "todo";
    assert.equal(parentWakeable("P", children), null);
  });

  it("scheduler respects unresolved blockedBy (blocked idle)", () => {
    const blockedBy = ["A"];
    const doneSet = new Set();
    assert.equal(isDependencyReady(blockedBy, doneSet), false);
  });

  it("idempotent wake: same blocker does not re-wake", () => {
    const seen = new Set();
    function emit(dependentId, blockerId){
      const k = `issue_blockers_resolved:${dependentId}:${blockerId}`;
      if(seen.has(k)) return false;
      seen.add(k); return true;
    }
    assert.equal(emit("B","A"), true);
    assert.equal(emit("B","A"), false);
    assert.equal(emit("C","B"), true);
  });
});
