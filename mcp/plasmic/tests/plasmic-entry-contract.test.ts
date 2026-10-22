// KOMAA-1084: kontrakt wpisów bundle WAB — jednostka + ochrona przed dryfem.
//
// WAB odrzuca patch, w którym wpis nie odpowiada klasie modelu (412,
// BundleTypeError). Kontrakt w services/plasmic-mcp/contract.ts odtwarza ten
// model lokalnie. Testy pilnują dwóch rzeczy:
//   1. normalizator produkuje DOKŁADNIE kształt, który generuje WAB
//      (bundle'y WAB w page-template.json / comp-template.json),
//   2. nieprawidłowy wpis jest odrzucany z konkretnym komunikatem, a nie
//      dopiero przez serwer.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ENTRY_CONTRACT,
  checkPatch,
  danglingRefs,
  entryProblems,
  normalizeEntry,
} from "../services/plasmic-mcp/contract.ts";

const SERVICE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "services", "plasmic-mcp");

function loadFixture(name: string): Record<string, Record<string, unknown>> {
  const raw = JSON.parse(readFileSync(join(SERVICE_DIR, name), "utf8")) as {
    entries: Record<string, Record<string, unknown>>;
  };
  return raw.entries;
}

const resolveIn = (map: Record<string, Record<string, unknown>>) => (ref: string) => {
  const target = map[ref];
  return target ? String(target.__type ?? "") : undefined;
};

describe("KOMAA-1084: kontrakt WAB — zgodność z bundle'ami wygenerowanymi przez WAB", () => {
  for (const fixture of ["page-template.json", "comp-template.json"]) {
    it(`${fixture}: każdy wpis przechodzi kontrakt bez naruszeń`, () => {
      const entries = loadFixture(fixture);
      const resolve = resolveIn(entries);
      const problems = Object.entries(entries).flatMap(([iid, raw]) =>
        entryProblems(iid, raw, resolve),
      );
      assert.deepEqual(problems, [], "bundle WAB nie może łamać własnego kontraktu");
    });
    it(`${fixture}: normalizacja nie zmienia kompletnego wpisu WAB`, () => {
      const entries = loadFixture(fixture);
      for (const [iid, raw] of Object.entries(entries)) {
        const type = String(raw.__type);
        if (!ENTRY_CONTRACT[type]) continue;
        assert.deepEqual(
          normalizeEntry(raw),
          raw,
          `${iid} (${type}): normalizacja kompletnego wpisu WAB musi być bez zmian`,
        );
      }
    });

    it(`${fixture}: pola domyślne pokrywają dokładnie pola WAB poza wymaganymi`, () => {
      const entries = loadFixture(fixture);
      for (const [iid, raw] of Object.entries(entries)) {
        const type = String(raw.__type);
        const spec = ENTRY_CONTRACT[type];
        if (!spec) continue;
        const required = Object.keys(spec.required).sort();
        const invented = Object.keys(normalizeEntry({ __type: type }))
          .filter((k) => k !== "__type" && !required.includes(k))
          .sort();
        const fromWab = Object.keys(raw)
          .filter((k) => k !== "__type" && !required.includes(k))
          .sort();
        assert.deepEqual(
          invented,
          fromWab,
          `${iid} (${type}): normalizator musi odtwarzać pola WAB (poza wymaganymi)`,
        );
      }
    });
  }
});

describe("KOMAA-1084: kontrakt WAB — prawdziwy bundle z projektu, w którym padło 412", () => {
  // Zamrożony bundle WAB (rewizja 106, projekt Designer'a) — ten sam wpis,
  // na którym serwer odrzucił patch z 412 BundleTypeError. Wszystkie jego
  // wpisy muszą przechodzić kontrakt: inaczej nasza walidacja odrzucałaby
  // poprawne dane WAB.
  it("każdy wpis realnego bundle WAB przechodzi kontrakt", () => {
    const raw = JSON.parse(
      readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), "fixtures", "wab-rev106-login-bundle.json"),
        "utf8",
      ),
    ) as { entries: Record<string, Record<string, unknown>> };
    const resolve = resolveIn(raw.entries);
    const problems = Object.entries(raw.entries).flatMap(([iid, entry]) =>
      entryProblems(iid, entry, resolve),
    );
    assert.deepEqual(problems, [], JSON.stringify(problems.slice(0, 5)));
  });
});

describe("KOMAA-1084: kontrakt WAB — walidacja", () => {
  it("częściowy RuleSet bez values/mixins jest odrzucany z nazwą brakujących pól", () => {
    const problems = entryProblems("rs1", { __type: "RuleSet" }, () => undefined);
    assert.equal(problems.length, 0, "RuleSet ma wartości domyślne dla wszystkich pól");
  });

  it("RuleSet z values jako string (selektor zamiast obiektu) jest odrzucany", () => {
    const problems = entryProblems(
      "rs1",
      { __type: "RuleSet", values: "color:red", mixins: [] },
      () => undefined,
    );
    assert.equal(problems.length, 1);
    assert.equal(problems[0]!.code, "BAD_TYPE");
    assert.equal(problems[0]!.field, "values");
  });

  it("Variant bez nazwy jest odrzucany (nazwa nie ma wartości domyślnej)", () => {
    const problems = entryProblems("v1", { __type: "Variant" }, () => undefined);
    assert.equal(problems.length, 1);
    assert.equal(problems[0]!.code, "MISSING_FIELD");
    assert.equal(problems[0]!.field, "name");
  });

  it("TplTag bez tagu i bez vsettings jest odrzucany", () => {
    const problems = entryProblems("t1", { __type: "TplTag" }, () => undefined);
    const fields = problems.map((p) => p.field).sort();
    assert.deepEqual(fields, ["tag", "vsettings"]);
    assert.ok(problems.every((p) => p.code === "MISSING_FIELD"));
  });

  it("VariantSetting bez rs jest odrzucany", () => {
    const problems = entryProblems(
      "vs1",
      { __type: "VariantSetting", variants: [] },
      () => undefined,
    );
    assert.equal(problems.length, 1);
    assert.equal(problems[0]!.code, "MISSING_FIELD");
    assert.equal(problems[0]!.field, "rs");
  });

  it("wpis bez __type jest odrzucany", () => {
    const problems = entryProblems("x1", { name: "x" }, () => undefined);
    assert.equal(problems.length, 1);
    assert.equal(problems[0]!.code, "MISSING_TYPE");
  });

  it("nieznany typ przechodzi bez zmian (WAB może znać typ, którego my nie znamy)", () => {
    const raw = { __type: "SomeNewWabType", foo: 1 };
    assert.deepEqual(normalizeEntry(raw), raw);
    assert.deepEqual(entryProblems("x2", raw, () => undefined), []);
  });

  it("zła referencja (vsettings → RuleSet zamiast VariantSetting) jest odrzucana", () => {
    const bundle = { rs1: { __type: "RuleSet", values: {}, mixins: [], animations: null } };
    const problems = entryProblems(
      "t1",
      { __type: "TplTag", tag: "div", vsettings: [{ __ref: "rs1" }] },
      resolveIn(bundle),
    );
    assert.equal(problems.length, 1);
    assert.equal(problems[0]!.code, "REF_TYPE_MISMATCH");
  });

  it("wisząca referencja nie blokuje zapisu (wariant globalny / wpis w kolejnym kroku)", () => {
    const problems = entryProblems(
      "t1",
      { __type: "TplTag", tag: "div", vsettings: [{ __ref: "nie-ma-mnie" }] },
      () => undefined,
    );
    assert.deepEqual(problems, []);
    assert.deepEqual(danglingRefs({ __ref: "nie-ma-mnie" }, () => undefined), ["nie-ma-mnie"]);
  });
});

describe("KOMAA-1084: kontrakt WAB — normalizacja", () => {
  it("RuleSet dostaje komplet pól WAB (values/mixins/animations)", () => {
    assert.deepEqual(normalizeEntry({ __type: "RuleSet" }), {
      __type: "RuleSet",
      values: {},
      mixins: [],
      animations: null,
    });
  });

  it("Variant dostaje uuid i pola nullowne", () => {
    const n = normalizeEntry({ __type: "Variant", name: "focus" });
    assert.equal(n.name, "focus");
    assert.equal(typeof n.uuid, "string");
    assert.equal((n.uuid as string).length, 12);
    assert.equal(n.selectors, null);
    assert.equal(n.forTpl, null);
  });

  it("istniejące pola nie są nadpisywane", () => {
    const n = normalizeEntry({ __type: "RuleSet", values: { color: "red" } });
    assert.deepEqual(n.values, { color: "red" });
  });

  it("checkPatch rozwiązuje referencje wewnątrz tego samego patcha", () => {
    const checked = checkPatch(
      {
        rs1: { __type: "RuleSet" },
        vs1: { __type: "VariantSetting", variants: [{ __ref: "v1" }], rs: { __ref: "rs1" } },
        v1: { __type: "Variant", name: "focus" },
      },
      {},
    );
    assert.deepEqual(checked.problems, [], JSON.stringify(checked.problems));
    assert.equal(checked.map.vs1!.__type, "VariantSetting");
  });

  it("checkPatch nie blokuje wiszącej referencji, ale ją raportuje", () => {
    const checked = checkPatch(
      { vs1: { __type: "VariantSetting", variants: [{ __ref: "brak" }], rs: { __ref: "brak" } } },
      {},
    );
    assert.deepEqual(checked.problems, [], "wisząca referencja nie blokuje zapisu");
    assert.deepEqual(danglingRefs(checked.map.vs1!, () => undefined), ["brak"]);
  });

  it("checkPatch odrzuca złą referencję (cel z innego typu)", () => {
    const checked = checkPatch(
      {
        rs1: { __type: "RuleSet" },
        t1: { __type: "TplTag", tag: "div", vsettings: [{ __ref: "rs1" }] },
      },
      {},
    );
    assert.equal(checked.problems.length, 1);
    assert.equal(checked.problems[0]!.code, "REF_TYPE_MISMATCH");
  });

  it("upsert istniejącego wpisu zachowuje jego uuid", () => {
    const checked = checkPatch(
      { t1: { __type: "TplTag", tag: "div" } },
      { t1: { __type: "TplTag", tag: "span", uuid: "STARYUUID01" } },
    );
    assert.equal(checked.map.t1!.uuid, "STARYUUID01");
  });
});
