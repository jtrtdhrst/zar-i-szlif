import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

// Strony aplikacji "Żar i Szlif — App" są źródłem natywnego importu do
// nowego projektu Plasmic Studio (KOMAA-1176). Test pilnuje ograniczeń
// importu (flex-only, bez JS, bez podbitek rastrowych) oraz podstaw a11y,
// żeby źródło dało się zaimportować natywnie i pozostało edytowalne.
const root = fileURLToPath(new URL("../", import.meta.url));
const home = readFileSync(`${root}/content/app/zar-i-szlif-app-home-camp.html`, "utf8");
const login = readFileSync(`${root}/content/app/zar-i-szlif-app-login.html`, "utf8");
const pages = { "home camp": home, login };

const attr = (html, tag, name) => {
  const out = [];
  const re = new RegExp(`<${tag}\\b[^>]*>`, "gi");
  for (const match of html.matchAll(re)) {
    const value = new RegExp(`\\b${name}="([^"]*)"`, "i").exec(match[0]);
    if (value) out.push(value[1]);
  }
  return out;
};

test("app pages satisfy the Plasmic import constraints", () => {
  for (const [name, html] of Object.entries(pages)) {
    assert.doesNotMatch(html, /<script/i, `${name}: Plasmic import does not allow JavaScript`);
    assert.doesNotMatch(html, /\sstyle="/i, `${name}: use the style block, not inline styles`);
    assert.doesNotMatch(html, /display\s*:\s*grid/i, `${name}: Plasmic supports flex only`);
    assert.doesNotMatch(html, /grid-template/i, `${name}: Plasmic supports flex only`);
    assert.doesNotMatch(html, /:root/i, `${name}: Plasmic does not allow :root variables`);
    assert.doesNotMatch(html, /currentColor/i, `${name}: Plasmic does not support currentColor`);
    assert.doesNotMatch(html, /data:image\/svg\+xml/i, `${name}: inline SVG only, no data URIs`);
    assert.doesNotMatch(html, /-webkit-|-moz-|-ms-/, `${name}: no vendor prefixes`);
    assert.doesNotMatch(html, /<img\b/i, `${name}: no raster images, characters stay vector`);
    assert.match(html, /display\s*:\s*flex/i, `${name}: layout must be flex based`);
    assert.match(html, /@media\s*\(max-width:\s*1024px\)/, `${name}: 1440/1024 breakpoint missing`);
    assert.match(html, /@media\s*\(max-width:\s*640px\)/, `${name}: 390 breakpoint missing`);
    assert.match(html, /<html lang="pl">/, `${name}: Polish language declaration missing`);
  }
});

test("app pages keep basic accessibility structure", () => {
  for (const [name, html] of Object.entries(pages)) {
    const ids = attr(html, "a", "id").concat(attr(html, "input", "id"), attr(html, "p", "id"), attr(html, "div", "id"));
    assert.equal(new Set(ids).size, ids.length, `${name}: duplicate element ids`);
    assert.equal((html.match(/<h1\b/gi) ?? []).length, 1, `${name}: exactly one h1 expected`);
    assert.match(html, /class="zl-skip" href="#zl-zawartosc"/, `${name}: skip link missing`);
    assert.match(html, /id="zl-zawartosc"/, `${name}: skip link target missing`);

    const inputIds = attr(html, "input", "id");
    assert.ok(inputIds.length > 0, `${name}: expected form controls`);
    for (const id of inputIds) {
      assert.match(html, new RegExp(`<label[^>]*for="${id}"`), `${name}: input ${id} has no label`);
    }
    for (const svg of html.match(/<svg\b[^>]*>/g) ?? []) {
      assert.match(svg, /role="img"/, `${name}: svg needs role=img`);
      assert.match(svg, /aria-label="[^"]+"/, `${name}: svg needs aria-label`);
    }
    for (const nav of html.match(/<nav\b[^>]*>/g) ?? []) {
      assert.match(nav, /aria-label="[^"]+"/, `${name}: nav needs aria-label`);
    }
    for (const link of html.match(/<a\b[^>]*>([\s\S]*?)<\/a>/g) ?? []) {
      const text = link.replace(/<[^>]+>/g, "").trim();
      assert.ok(text.length > 0, `${name}: link without discernible text`);
    }
  }
});

test("home camp page carries the approved home screen content", () => {
  for (const phrase of [
    "Najbliższa zbiórka",
    "Plan zbiórki",
    "Pozostałe zadania: 2",
    "Pozostałe materiały: 2",
    "Kolejne aktywności",
    "Otwórz kartę zbiórki",
    "Osobiste Iskry",
    "Drużynowe Iskry",
    "Zwiadowcy",
  ]) {
    assert.ok(home.includes(phrase), `home camp page is missing: ${phrase}`);
  }
  for (const place of [
    "Ognisko",
    "Namiot Zastępu",
    "Stół Wypraw",
    "Pracownia Iskry",
    "Gniazdo Szlifa",
    "Tablica Sprawności i Stopni",
  ]) {
    assert.ok(home.includes(place), `home camp page is missing camp place: ${place}`);
  }
  assert.equal((home.match(/<svg\b/gi) ?? []).length, 2, "home camp page carries both approved mascots");
});

test("login page carries the approved onboarding entry", () => {
  for (const phrase of [
    "Rozpocznij budowę obozowiska",
    "Mam już konto",
    "Kod drużyny",
    "Wybór zwierzaka",
    "Potwierdź wolny gatunek",
  ]) {
    assert.ok(login.includes(phrase), `login page is missing: ${phrase}`);
  }
  assert.match(login, /<input[^>]*name="kod-druzyny"/, "team code field missing");
  assert.match(login, /<input[^>]*name="staz-rr"/, "private experience question missing");
  assert.match(login, /<input[^>]*name="prowadzenie-zbiorek"/, "private experience question missing");
});
