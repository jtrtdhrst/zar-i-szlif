import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const listeners = {};
const context = {
  URLSearchParams,
  Intl,
  Date,
  console,
  location: { search: "", pathname: "/" },
  history: { replaceState() {} },
  localStorage: { getItem: () => null, setItem() {} },
  setTimeout() {},
  document: {
    getElementById: () => ({ set innerHTML(_) {} }),
    addEventListener(type, listener) { (listeners[type] ||= []).push(listener); },
    querySelectorAll: () => [],
  },
};
const source = await readFile(new URL("../src/static-app-v2.js", import.meta.url), "utf8");
vm.runInNewContext(`${source}\nglobalThis.__state=S;`, context);

const state = context.__state;
state.team.name = "27. Drużyna RR";
state.team.group = "Zwiadowcy";
state.activity = { number: "12", title: "Późniejsza zbiórka", date: "2099-12-15T17:00" };
state.annual.calendar = [{ title: "Najbliższa zbiórka", date: "2099-12-01T17:00" }];
state.sprawnosci[0] = { name: "Pionier", status: "W trakcie" };

const target = {
  dataset: { action: "skill-status", skillStatus: "0" },
  closest(selector) { return selector.includes("data-action") || selector.includes("data-skill-status") ? this : null; },
};
const click = () => listeners.click.forEach(listener => listener({ target }));

click();
await Promise.resolve();
assert.equal(state.sprawnosci[0].status, "Zrealizowane");
assert.equal(state.tasks.filter(task => task.source).length, 1);
assert.deepEqual(JSON.parse(JSON.stringify(state.tasks.at(-1))), {
  people: [],
  text: "Wręcz naszywkę (27. Drużyna RR) – Pionier – Zwiadowcy",
  status: "Do zrobienia",
  source: "skill:0:27. Drużyna RR:Pionier:Zwiadowcy",
  activity: { title: "Najbliższa zbiórka", date: "2099-12-01T17:00" },
});

click();
click();
click();
await Promise.resolve();
assert.equal(state.sprawnosci[0].status, "Zrealizowane");
assert.equal(state.tasks.filter(task => task.source).length, 1);
console.log("Skill completion task test passed");
