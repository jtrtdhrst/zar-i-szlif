// KOMAA-1084: kontrakt wpisów bundle WAB (model Plasmic).
//
// WAB waliduje KAŻDY wpis patchu względem klasy modelu. Wpis niezgodny z
// modelem odrzuca CAŁY patch jednym HTTP 412 (`error.name=BundleTypeError`,
// pusty message) — bez wskazania, którego pola brakuje. Bez lokalnego
// kontraktu agent widzi tylko „412 BundleTypeError" i nie wie, co poprawić.
//
// Źródło prawdy dla kształtów: bundle'y wygenerowane przez WAB w tym repo
// (page-template.json, comp-template.json) — nazwa pola, typ i wartość
// domyślna są dokładnie takie, jak generuje WAB (null / [] / {}).
//
// Ten moduł robi trzy rzeczy PRZED zapisem:
//   1. normalizuje wpis do pełnego kształtu modelu (domyślne + uuid),
//   2. waliduje wymagane pola i ich typy,
//   3. pilnuje grafu referencji: __ref musi istnieć, a typ celu musi
//      pasować do pola (typed reference graph).
// Błąd jest wykrywany przed POST-em → zero zapisu, zero 412.

export type JsonKind = "string" | "number" | "boolean" | "object" | "array";

export interface TypeContract {
  /** pola bez bezpiecznej wartości domyślnej — caller musi je podać */
  required: Record<string, JsonKind>;
  /** wartości domyślne z WAB (null / [] / {}) */
  defaults: Record<string, unknown>;
  /** pola bez wartości domyślnej, ale o znanym typie */
  types?: Record<string, JsonKind>;
  /** model wymaga pola uuid → generujemy, gdy brakuje */
  uuid?: boolean;
  /** pole → dozwolone __type celu referencji */
  refs?: Record<string, string[]>;
}

export const ENTRY_CONTRACT: Record<string, TypeContract> = {
  RuleSet: {
    required: {},
    defaults: { values: {}, mixins: [], animations: null },
  },
  Variant: {
    required: { name: "string" },
    defaults: {
      selectors: null,
      codeComponentName: null,
      codeComponentVariantKeys: null,
      parent: null,
      mediaQuery: null,
      description: null,
      forTpl: null,
    },
    uuid: true,
  },
  VariantSetting: {
    required: { variants: "array", rs: "object" },
    defaults: { args: [], attrs: {}, dataCond: null, dataRep: null, text: null, columnsConfig: null },
    refs: { variants: ["Variant"], rs: ["RuleSet"] },
  },
  TplTag: {
    required: { tag: "string", vsettings: "array" },
    defaults: {
      name: null,
      children: [],
      type: "other",
      codeGenType: null,
      columnsSetting: null,
      parent: null,
      locked: null,
    },
    uuid: true,
    refs: { vsettings: ["VariantSetting"] },
  },
  TplComponent: {
    required: { component: "object", vsettings: "array" },
    defaults: { name: null, parent: null, locked: null },
    uuid: true,
    refs: { component: ["Component"], vsettings: ["VariantSetting"] },
  },
  Component: {
    required: { name: "string", type: "string", tplTree: "object", variants: "array" },
    defaults: {
      params: [],
      states: [],
      variantGroups: [],
      subComps: [],
      editableByContentEditor: true,
      hiddenFromContentEditor: false,
      alwaysAutoName: false,
      trapsFocus: false,
      metadata: {},
      dataQueries: [],
      serverQueries: [],
      figmaMappings: [],
      codeComponentMeta: null,
      plumeInfo: null,
      templateInfo: null,
      superComp: null,
      pageMeta: null,
    },
    uuid: true,
    refs: { tplTree: ["TplTag", "TplComponent"], variants: ["Variant"], pageMeta: ["PageMeta"] },
    types: { updatedAt: "number" },
  },
};

const UUID_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** uuid w stylu WAB (12 znaków alfanumerycznych). */
export function newEntryUuid(): string {
  let s = "";
  for (let i = 0; i < 12; i++) {
    s += UUID_ALPHABET[Math.floor(Math.random() * UUID_ALPHABET.length)];
  }
  return s;
}

function clone<T>(v: T): T {
  if (v === null || typeof v !== "object") return v;
  return JSON.parse(JSON.stringify(v)) as T;
}

function kindOf(v: unknown): JsonKind | "null" | "unknown" {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  switch (typeof v) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "object":
      return "object";
    default:
      return "unknown";
  }
}

/**
 * Typ, jaki ma pole w modelu WAB. Wyprowadzany z wartości domyślnej:
 * `{}` → object, `[]` → array, "other" → string. Pole z domyślnym null
 * może mieć w modelu kilka typów (np. animations: null | array) — wtedy
 * typu nie pilnujemy (pilnuje go WAB).
 */
function expectedKind(defaultValue: unknown): JsonKind | null {
  if (defaultValue === null) return null;
  if (Array.isArray(defaultValue)) return "array";
  switch (typeof defaultValue) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "object":
      return "object";
    default:
      return null;
  }
}

/** Pełny kształt modelu: brakujące pola dostają kanoniczną wartość WAB. */
export function normalizeEntry(raw: Record<string, unknown>): Record<string, unknown> {
  const spec = ENTRY_CONTRACT[String(raw.__type ?? "")];
  if (!spec) return { ...raw };
  const out: Record<string, unknown> = { ...raw };
  for (const [field, value] of Object.entries(spec.defaults)) {
    if (!(field in out)) out[field] = clone(value);
  }
  if (spec.uuid && typeof out.uuid !== "string") out.uuid = newEntryUuid();
  if (out.__type === "Component" && typeof out.updatedAt !== "number") out.updatedAt = Date.now();
  return out;
}

export interface ContractProblem {
  iid: string;
  type: string;
  code: "MISSING_TYPE" | "MISSING_FIELD" | "BAD_TYPE" | "REF_TYPE_MISMATCH";
  field?: string;
  detail: string;
}

function collectRefs(value: unknown, path: string, out: { path: string; ref: string }[]): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => collectRefs(v, `${path}[${i}]`, out));
    return;
  }
  if (!value || typeof value !== "object") return;
  const o = value as Record<string, unknown>;
  if (typeof o.__ref === "string") {
    out.push({ path, ref: o.__ref });
    return;
  }
  for (const [k, v] of Object.entries(o)) collectRefs(v, path ? `${path}.${k}` : k, out);
}

function rootField(path: string): string {
  return path.split(/[.[]/)[0] ?? path;
}

/**
 * Problemy kontraktu wpisu. `resolveType` zwraca __type istniejącego wpisu
 * (z bundle albo z tego samego patcha) albo undefined dla wiszącej referencji.
 */
export function entryProblems(
  iid: string,
  raw: Record<string, unknown>,
  resolveType: (ref: string) => string | undefined,
): ContractProblem[] {
  const problems: ContractProblem[] = [];
  const type = String(raw.__type ?? "");
  if (!type) {
    problems.push({ iid, type: "?", code: "MISSING_TYPE", detail: "brak pola __type" });
    return problems;
  }
  const spec = ENTRY_CONTRACT[type];
  if (spec) {
    for (const [field, kind] of Object.entries(spec.required)) {
      const value = raw[field];
      if (value === undefined) {
        problems.push({
          iid,
          type,
          code: "MISSING_FIELD",
          field,
          detail: `brak wymaganego pola "${field}" (${kind})`,
        });
      } else if (kindOf(value) !== kind) {
        problems.push({
          iid,
          type,
          code: "BAD_TYPE",
          field,
          detail: `pole "${field}" ma typ ${kindOf(value)}, WAB wymaga ${kind}`,
        });
      }
    }
    // Typy pól z wartości domyślnej (RuleSet.values musi być obiektem —
    // selektor zamiast obiektu stylów to dokładnie ten błąd, który WAB
    // odrzucał 412 BundleTypeError).
    for (const [field, defaultValue] of Object.entries(spec.defaults)) {
      if (!(field in raw)) continue;
      const kind = expectedKind(defaultValue);
      if (!kind) continue;
      const actual = kindOf(raw[field]);
      if (actual !== kind) {
        problems.push({
          iid,
          type,
          code: "BAD_TYPE",
          field,
          detail: `pole "${field}" ma typ ${actual}, WAB wymaga ${kind}`,
        });
      }
    }
    if (spec.uuid && "uuid" in raw && kindOf(raw.uuid) !== "string") {
      problems.push({
        iid,
        type,
        code: "BAD_TYPE",
        field: "uuid",
        detail: `pole "uuid" ma typ ${kindOf(raw.uuid)}, WAB wymaga string`,
      });
    }
    for (const [field, kind] of Object.entries(spec.types ?? {})) {
      if (!(field in raw)) continue;
      const actual = kindOf(raw[field]);
      if (actual !== kind) {
        problems.push({
          iid,
          type,
          code: "BAD_TYPE",
          field,
          detail: `pole "${field}" ma typ ${actual}, WAB wymaga ${kind}`,
        });
      }
    }
  }
  const refs: { path: string; ref: string }[] = [];
  collectRefs(raw, "", refs);
  for (const { path, ref } of refs) {
    const targetType = resolveType(ref);
    // Wisząca referencja NIE blokuje zapisu: WAB dopuszcza referencje do
    // wariantów globalnych i do wpisów tworzonych w kolejnych krokach.
    // Raportowana jest jako podejrzenie (danglingRefs), nie jako naruszenie.
    if (!targetType) continue;
    const allowed = spec?.refs?.[rootField(path)];
    if (allowed && !allowed.includes(targetType)) {
      problems.push({
        iid,
        type,
        code: "REF_TYPE_MISMATCH",
        field: path,
        detail: `referencja "${ref}" jest typu ${targetType}, a pole "${rootField(path)}" wymaga ${allowed.join("|")}`,
      });
    }
  }
  return problems;
}

/** Referencje, których nie ma w bundle (diagnostyka, nie blokada zapisu). */
export function danglingRefs(
  raw: Record<string, unknown>,
  resolveType: (ref: string) => string | undefined,
): string[] {
  const refs: { path: string; ref: string }[] = [];
  collectRefs(raw, "", refs);
  const out: string[] = [];
  for (const { ref } of refs) {
    if (!resolveType(ref)) out.push(ref);
  }
  return [...new Set(out)];
}

export function formatProblems(problems: ContractProblem[]): string {
  return problems.map((p) => `${p.iid} (${p.type}): ${p.detail}`).join("; ");
}

export interface PatchCheck {
  /** znormalizowane wpisy (iid -> wpis) */
  map: Record<string, Record<string, unknown>>;
  problems: ContractProblem[];
}

/**
 * Normalizuje i sprawdza cały patch: referencje rozwiązywane są wobec
 * bundle'a ORAZ wpisów z tego samego patcha (nowy węzeł może wskazywać
 * nowy VariantSetting).
 */
export function checkPatch(
  entries: Record<string, Record<string, unknown>>,
  bundleMap: Record<string, Record<string, unknown>>,
): PatchCheck {
  const map: Record<string, Record<string, unknown>> = {};
  for (const [iid, raw] of Object.entries(entries)) {
    const normalized = normalizeEntry(raw);
    // Upsert istniejącego wpisu nie może zmienić jego uuid (WAB indeksuje
    // wpisy po uuid) — uuid istniejącego wpisu zostaje.
    const existing = bundleMap[iid];
    if (existing && typeof existing.uuid === "string" && typeof raw.uuid !== "string") {
      normalized.uuid = existing.uuid;
    }
    map[iid] = normalized;
  }
  const resolveType = (ref: string): string | undefined => {
    const entry = map[ref] ?? bundleMap[ref];
    if (!entry || typeof entry !== "object") return undefined;
    return String((entry as Record<string, unknown>).__type ?? "");
  };
  const problems: ContractProblem[] = [];
  for (const [iid, raw] of Object.entries(map)) {
    problems.push(...entryProblems(iid, raw, resolveType));
  }
  return { map, problems };
}

/** Klucz problemu — pozwala odróżnić nowe naruszenie od istniejącego. */
export function problemKey(p: ContractProblem): string {
  return `${p.code}|${p.field ?? ""}|${p.detail}`;
}
