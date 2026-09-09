import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const listeners = {};
const context = {
  URLSearchParams,
  Intl,
  Date,
  console,
  __SKILL_ICON_ASSETS__: {},
  location: { search: "", pathname: "/" },
  history: { replaceState() {} },
  window: { addEventListener() {} },
  localStorage: { getItem: () => null, setItem() {} },
  setTimeout() {},
  requestAnimationFrame() {},
  MutationObserver: class { observe() {} },
  document: {
    body: { append() {} },
    getElementById: () => ({ innerHTML: "" }),
    addEventListener(type, listener) { (listeners[type] ||= []).push(listener); },
    querySelector: () => null,
    querySelectorAll: () => [],
  },
};
const source = await readFile(new URL("../src/static-app-v2.js", import.meta.url), "utf8");
vm.runInNewContext(`${source}\nglobalThis.__state=S; globalThis.__completeActivitySkillPoint=completeActivitySkillPoint;`, context);

const state = context.__state;
state.team.skillRecords = [{
  id: "skill-pionier",
  title: "Pionier",
  group: "Pionierstwo",
  groupLabel: "Pionierstwo",
  level: "Zwiadowcy",
  aspect: "fizyczny",
  requirements: [{ text: "Zbuduj szałas", status: "W trakcie" }],
}];
state.annualPlans = [{ months: [{ activities: [{ date: "2099-12-01", title: "Najbliższa zbiórka" }] }] }];

context.__completeActivitySkillPoint("skill-pionier", 0, true);
assert.equal(state.team.skillHistoryRecords.length, 1);
assert.equal(state.tasks.filter(task => task.source === "skill-completion:skill-pionier").length, 1);
assert.deepEqual(JSON.parse(JSON.stringify(state.tasks.find(task => task.source === "skill-completion:skill-pionier"))), {
  people: [],
  text: "Wręcz naszywkę (Pionierstwo) – Pionier – Zwiadowcy",
  status: "Do zrobienia",
  source: "skill-completion:skill-pionier",
  activityNumber: "annual:0:0:0",
  activityTitle: "Najbliższa zbiórka",
  activityDate: "2099-12-01",
});

context.__completeActivitySkillPoint("skill-pionier", 0, false);
context.__completeActivitySkillPoint("skill-pionier", 0, true);
assert.equal(state.tasks.filter(task => task.source === "skill-completion:skill-pionier").length, 1);

state.team.skillRecords.push({
  id: "skill-ratownik",
  title: "Ratownik",
  group: "Pierwsza pomoc",
  level: "Zwiadowcy",
  aspect: "fizyczny",
  requirements: [{ text: "Opatrz ranę", status: "W trakcie" }],
});
state.annualPlans = [];
context.__completeActivitySkillPoint("skill-ratownik", 0, true);
const unlinkedTask = state.tasks.find(task => task.source === "skill-completion:skill-ratownik");
assert.equal(unlinkedTask.activityNumber, undefined);
assert.equal(unlinkedTask.activityTitle, undefined);
console.log("Skill completion task test passed");
