import { idempotent } from "@design-stack/contracts/idempotency";
import { withProjectLock } from "@design-stack/contracts/locks";
import { auditLog } from "@design-stack/contracts/audit";
import { sha256 } from "@design-stack/contracts/sync";
import {
  PlasmicClient,
  type BundleDoc,
  type BundleEntry,
} from "@design-stack/plasmic-client";
import type { ToolDef } from "@design-stack/mcp-server";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { checkPatch, danglingRefs, entryProblems, formatProblems, problemKey } from "./contract.ts";

export interface PlasmicCtx {
  client: PlasmicClient;
  stateDir: string;
  auditFile: string;
  agent?: string;
  run?: string;
}

const MAX_OUT = 50_000;
const cap = (s: string) => (s.length > MAX_OUT ? s.slice(0, MAX_OUT) + "…[truncated]" : s);
const newIid = () =>
  `mcp${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

const HERE = dirname(fileURLToPath(import.meta.url));

interface Fixture {
  entries: Record<string, Record<string, unknown>>;
  sitePatchFields: string[];
}

function loadFixture(name: string): Fixture {
  return JSON.parse(readFileSync(join(HERE, name), "utf8")) as Fixture;
}

/**
 * Klonowanie podgrafu z fixture: każdy wpis dostaje NOWY iid i NOWY uuid,
 * wszystkie referencje {__ref: staryIid} i pola uuid wewnątrz klona są
 * przepisywane na nowe. Referencje na zewnątrz klona (theme, mixiny)
 * zostają nietknięte.
 */
function cloneFixture(
  fixture: Fixture,
  overrides: { name: string; path?: string },
): { map: Record<string, Record<string, unknown>>; rootComponentIid: string; arenaIid?: string; arenaType?: string } {
  const idMap = new Map<string, string>();
  for (const oldIid of Object.keys(fixture.entries)) {
    idMap.set(oldIid, newIid());
  }
  const rewrite = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(rewrite);
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (typeof o.__ref === "string" && idMap.has(o.__ref as string)) {
        return { ...o, __ref: idMap.get(o.__ref as string) };
      }
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(o)) out[k] = rewrite(val);
      return out;
    }
    if (typeof v === "string" && idMap.has(v)) return idMap.get(v);
    return v;
  };
  const map: Record<string, Record<string, unknown>> = {};
  let rootComponentIid = "";
  let arenaIid: string | undefined;
  let arenaType: string | undefined;
  for (const [oldIid, raw] of Object.entries(fixture.entries)) {
    const cloned = rewrite(raw) as Record<string, unknown>;
    // Klucz mapy i pole uuid to osobne przestrzenie — oba muszą być unikalne.
    if (typeof cloned.uuid === "string") cloned.uuid = newIid();
    if (raw.__type === "Component") {
      rootComponentIid = idMap.get(oldIid)!;
      cloned.name = overrides.name;
      if (overrides.path !== undefined) delete cloned.pageMeta;
    }
    if (raw.__type === "PageArena" || raw.__type === "ComponentArena") {
      arenaIid = idMap.get(oldIid);
      arenaType = raw.__type as string;
    }
    map[idMap.get(oldIid)!] = cloned;
  }
  // PageMeta.path dla stron
  if (overrides.path !== undefined) {
    for (const entry of Object.values(map)) {
      if (entry.__type === "PageMeta") {
        entry.path = overrides.path;
      }
    }
    // Przywróć pageMeta komponentu (sklonowany __ref już przepisany przez rewrite)
    for (const [oldIid, raw] of Object.entries(fixture.entries)) {
      if (raw.__type === "Component" && raw.pageMeta) {
        map[idMap.get(oldIid)!]!.pageMeta = rewrite(raw.pageMeta);
      }
    }
  }
  return { map, rootComponentIid, arenaIid, arenaType };
}

function resolve(
  bundle: BundleDoc,
  ref: string,
): { entry: BundleEntry; iid: string } {
  const entries = Object.entries(bundle.map);
  const byIid = entries.find(([iid]) => iid === ref);
  if (byIid) {
    const raw = byIid[1] as Record<string, unknown>;
    return {
      entry: { iid: ref, type: String(raw.__type ?? "?"), name: String(raw.name ?? ref), raw },
      iid: ref,
    };
  }
  const byName = entries.filter(
    ([, v]) =>
      !!v && typeof v === "object" &&
      String((v as Record<string, unknown>).name ?? "").toLowerCase() === ref.toLowerCase(),
  );
  if (byName.length === 1) {
    const [iid, raw] = byName[0] as [string, Record<string, unknown>];
    return {
      entry: { iid, type: String(raw.__type ?? "?"), name: String(raw.name ?? iid), raw },
      iid,
    };
  }
  if (byName.length > 1) {
    throw new Error(
      `AMBIGUOUS "${ref}": ${byName.map(([i]) => i).join(", ")} — użyj stabilnego elementId`,
    );
  }
  throw new Error(`NOT_FOUND "${ref}" — użyj plasmic_list_* aby poznać elementId`);
}

function summarize(bundle: BundleDoc, client: PlasmicClient) {
  return {
    pages: client.listPages(bundle).map((e) => ({ id: e.iid, name: e.name })),
    components: client.listComponents(bundle).map((e) => ({
      id: e.iid,
      name: e.name,
      type: e.type,
    })),
    tokens: client.listStyleTokens(bundle).map((e) => ({ id: e.iid, name: e.name })),
  };
}

async function writeOp<T extends Record<string, unknown>>(
  ctx: PlasmicCtx,
  tool: string,
  projectId: string,
  target: string | undefined,
  before: string,
  fn: () => Promise<T & { revision: number }>,
): Promise<T> {
  return withProjectLock(ctx.stateDir + "/locks", projectId, async () => {
    const result = await fn();
    await auditLog(ctx.auditFile, {
      agent: ctx.agent,
      run: ctx.run,
      project: projectId,
      tool,
      target,
      beforeHash: sha256(before),
      afterHash: sha256(JSON.stringify(result).slice(0, 5000)),
      ok: true,
    });
    return result;
  });
}

const idKey = { idempotencyKey: z.string().optional().describe("Powtórka runa nie tworzy kopii") };
const dry = { dryRun: z.boolean().optional().describe("true = tylko diff, bez zapisu") };

// KOMAA-1001: adnotacje MCP (readOnlyHint/destructiveHint/idempotentHint).
// Platforma klasyfikuje narzędzia właśnie po nich — bez adnotacji insert
// i use_component (oba zapisują przez writeOp) były widziane jako read-only
// i omijały politykę zatwierdzania zmian. destructiveHint=true tylko tam,
// gdzie zapis może nadpisać istniejący wpis; idempotentHint=true tam, gdzie
// powtórka z tym samym kluczem nie tworzy drugiego efektu.
const A_READ = { readOnlyHint: true } as const;
const A_WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true } as const;
const A_OVERWRITE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true } as const;
const A_ADD = { readOnlyHint: false, destructiveHint: false, idempotentHint: false } as const;
const A_DELETE = { readOnlyHint: false, destructiveHint: true, idempotentHint: false } as const;

// KOMAA-1001: dryRun i live są semantycznie rozłączne. dryRun nigdy nie
// czyta ani nie zapełnia cache idempotencji — inaczej dryRun pod tym samym
// kluczem tłumiłby późniejszy live (replay bez zapisu). Live dostaje własną
// przestrzeń `live:` (unieważnia też zatrute wpisy sprzed fixa).
function idempotentLive<T>(
  dir: string,
  baseKey: string,
  dryRun: boolean | undefined,
  fn: () => Promise<T>,
): Promise<{ result: T; deduped: boolean }> {
  if (dryRun) return fn().then((result) => ({ result, deduped: false }));
  return idempotent(dir, `live:${baseKey}`, fn);
}

export function plasmicTools(ctx: PlasmicCtx): ToolDef[] {
  const c = ctx.client;
  return [
    {
      name: "plasmic_get_project",
      annotations: A_READ,
      description: "Meta projektu Plasmic + numer rewizji + liczniki stron/komponentów/tokenów.",
      schema: { projectId: z.string(), branchId: z.string().optional() },
      handler: async (a) => {
        const rev = await c.getProjectRev(a.projectId as string, a.branchId as string | undefined);
        const s = summarize(rev.bundle, c);
        return {
          project: rev.project,
          revision: rev.revision,
          pages: s.pages.length,
          components: s.components.length,
          tokens: s.tokens.length,
        };
      },
    },
    {
      name: "plasmic_list_pages",
      annotations: A_READ,
      description: "Strony projektu (stabilne id + nazwy).",
      schema: { projectId: z.string(), branchId: z.string().optional() },
      handler: async (a) => {
        const rev = await c.getProjectRev(a.projectId as string, a.branchId as string | undefined);
        return { revision: rev.revision, pages: summarize(rev.bundle, c).pages };
      },
    },
    {
      name: "plasmic_list_components",
      annotations: A_READ,
      description: "Komponenty projektu (stabilne id + nazwy + typy).",
      schema: { projectId: z.string(), branchId: z.string().optional() },
      handler: async (a) => {
        const rev = await c.getProjectRev(a.projectId as string, a.branchId as string | undefined);
        return { revision: rev.revision, components: summarize(rev.bundle, c).components };
      },
    },
    {
      name: "plasmic_list_tokens",
      annotations: A_READ,
      description: "Tokeny styli projektu.",
      schema: { projectId: z.string(), branchId: z.string().optional() },
      handler: async (a) => {
        const rev = await c.getProjectRev(a.projectId as string, a.branchId as string | undefined);
        return { revision: rev.revision, tokens: summarize(rev.bundle, c).tokens };
      },
    },
    {
      name: "plasmic_read_page",
      annotations: A_READ,
      description: "Pełny wpis strony po id lub nazwie.",
      schema: { projectId: z.string(), pageId: z.string(), branchId: z.string().optional() },
      handler: async (a) => {
        const rev = await c.getProjectRev(a.projectId as string, a.branchId as string | undefined);
        const { entry } = resolve(rev.bundle, a.pageId as string);
        return { revision: rev.revision, page: JSON.parse(cap(JSON.stringify(entry))) };
      },
    },
    {
      name: "plasmic_read_component",
      annotations: A_READ,
      description: "Pełny wpis komponentu po id lub nazwie.",
      schema: { projectId: z.string(), componentId: z.string(), branchId: z.string().optional() },
      handler: async (a) => {
        const rev = await c.getProjectRev(a.projectId as string, a.branchId as string | undefined);
        const { entry } = resolve(rev.bundle, a.componentId as string);
        return { revision: rev.revision, component: JSON.parse(cap(JSON.stringify(entry))) };
      },
    },
    {
      name: "plasmic_read_component_tree",
      annotations: A_READ,
      description: "Komponent + wpisy referencjonowane (depth 1-2).",
      schema: {
        projectId: z.string(),
        componentId: z.string(),
        depth: z.number().min(1).max(2).optional(),
        branchId: z.string().optional(),
      },
      handler: async (a) => {
        const rev = await c.getProjectRev(a.projectId as string, a.branchId as string | undefined);
        const { entry, iid } = resolve(rev.bundle, a.componentId as string);
        const depth = (a.depth as number | undefined) ?? 1;
        const seen = new Set([iid]);
        let frontier = [JSON.stringify(entry.raw)];
        const children: Record<string, unknown> = {};
        for (let d = 0; d < depth; d++) {
          const next: string[] = [];
          const text = frontier.join(" ");
          for (const key of Object.keys(rev.bundle.map)) {
            if (!seen.has(key) && text.includes(key)) {
              seen.add(key);
              children[key] = rev.bundle.map[key];
              next.push(JSON.stringify(rev.bundle.map[key]));
            }
          }
          frontier = next;
        }
        return {
          revision: rev.revision,
          root: JSON.parse(cap(JSON.stringify(entry))),
          children: JSON.parse(cap(JSON.stringify(children))),
        };
      },
    },
    {
      name: "plasmic_create_page",
      annotations: A_WRITE,
      description:
        "Nowa strona z fixture wygenerowanego kodem WAB (podgraf Component+Arena+tpl + patch Site).",
      schema: {
        projectId: z.string(),
        name: z.string(),
        path: z.string(),
        branchId: z.string().optional(),
        ...idKey,
        ...dry,
      },
      handler: async (a) => {
        const key = `create_page:${a.projectId}:${(a.idempotencyKey as string | undefined) ?? `${a.name}:${a.path}`}`;
        const { result } = await idempotentLive(ctx.stateDir + "/idempotency", key, a.dryRun as boolean | undefined, () =>
          writeOp(ctx, "plasmic_create_page", a.projectId as string, a.name as string,
            key,
            async () => {
              const fixture = loadFixture("page-template.json");
              const out = await c.mutate(
                a.projectId as string,
                a.branchId as string | undefined,
                (bundle) => {
                  const { map, rootComponentIid, arenaIid } = cloneFixture(fixture, {
                    name: a.name as string,
                    path: a.path as string,
                  });
                  // Dopnij do Site (tak jak TplMgr.addComponent).
                  const siteEntry = Object.entries(bundle.map).find(
                    ([, v]) => (v as Record<string, unknown>).__type === "Site",
                  );
                  if (!siteEntry) throw new Error("NO_SITE: bundle bez wpisu Site");
                  const [siteIid, siteRaw] = siteEntry as [string, Record<string, unknown>];
                  const pushRef = (field: string, iid: string) => {
                    const arr = Array.isArray(siteRaw[field]) ? [...(siteRaw[field] as unknown[])] : [];
                    arr.push({ __ref: iid });
                    return arr;
                  };
                  map[siteIid] = {
                    ...siteRaw,
                    components: pushRef("components", rootComponentIid),
                    ...(arenaIid ? { pageArenas: pushRef("pageArenas", arenaIid) } : {}),
                  };
                  return { map };
                },
                { dryRun: a.dryRun as boolean | undefined },
              );
              return out;
            }),
        );
        return result;
      },
    },
    {
      name: "plasmic_create_component",
      annotations: A_WRITE,
      description: "Nowy komponent z fixture wygenerowanego kodem WAB (podgraf + patch Site).",
      schema: {
        projectId: z.string(),
        name: z.string(),
        branchId: z.string().optional(),
        ...idKey,
        ...dry,
      },
      handler: async (a) => {
        const key = `create_component:${a.projectId}:${(a.idempotencyKey as string | undefined) ?? (a.name as string)}`;
        const { result } = await idempotentLive(ctx.stateDir + "/idempotency", key, a.dryRun as boolean | undefined, () =>
          writeOp(ctx, "plasmic_create_component", a.projectId as string, a.name as string,
            key,
            async () => {
              const fixture = loadFixture("comp-template.json");
              const out = await c.mutate(
                a.projectId as string,
                a.branchId as string | undefined,
                (bundle) => {
                  const { map, rootComponentIid, arenaIid, arenaType } = cloneFixture(fixture, {
                    name: a.name as string,
                  });
                  const siteEntry = Object.entries(bundle.map).find(
                    ([, v]) => (v as Record<string, unknown>).__type === "Site",
                  );
                  if (!siteEntry) throw new Error("NO_SITE: bundle bez wpisu Site");
                  const [siteIid, siteRaw] = siteEntry as [string, Record<string, unknown>];
                  const pushRef = (field: string, iid: string) => {
                    const arr = Array.isArray(siteRaw[field]) ? [...(siteRaw[field] as unknown[])] : [];
                    arr.push({ __ref: iid });
                    return arr;
                  };
                  map[siteIid] = {
                    ...siteRaw,
                    components: pushRef("components", rootComponentIid),
                    ...(arenaIid && arenaType
                      ? {
                        [arenaType === "PageArena" ? "pageArenas" : "componentArenas"]: pushRef(
                          arenaType === "PageArena" ? "pageArenas" : "componentArenas",
                          arenaIid,
                        ),
                      }
                      : {}),
                  };
                  return { map };
                },
                { dryRun: a.dryRun as boolean | undefined },
              );
              return { ...out, id: (out.changed[0] as string) ?? null };
            }),
        );
        return result;
      },
    },
    {
      name: "plasmic_insert",
      annotations: A_OVERWRITE,
      description:
        "Upsert surowych wpisów mapy bundle (tokeny, warianty, węzły). Wpięcie w rodzica przez plasmic_update. Wpisy są sprawdzane kontraktem WAB przed zapisem.",
      schema: {
        projectId: z.string(),
        entry: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("jeden wpis bundle (iid = elementId)"),
        entries: z
          .record(z.string(), z.record(z.string(), z.unknown()))
          .optional()
          .describe("wiele wpisów w jednej rewizji (klucz = iid)"),
        elementId: z.string().optional().describe("iid; domyślnie generowane"),
        branchId: z.string().optional(),
        ...idKey,
        ...dry,
      },
      handler: async (a) => {
        const single = a.entry as Record<string, unknown> | undefined;
        const batch = a.entries as Record<string, Record<string, unknown>> | undefined;
        if (!single && !batch) throw new Error("entry wymaga pola __type");
        if (single && batch) {
          throw new Error("podaj entry albo entries (nie oba naraz)");
        }
        // iid -> surowy wpis; klucz mapy i pole uuid to osobne przestrzenie.
        const rawEntries: Record<string, Record<string, unknown>> = {};
        let singleIid: string | undefined;
        if (single) {
          if (!single.__type) throw new Error("entry wymaga pola __type");
          singleIid =
            (a.elementId as string | undefined) ??
            (single.uuid as string) ??
            newIid();
          rawEntries[singleIid] = single;
        } else {
          for (const [iid, raw] of Object.entries(batch!)) {
            if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
              throw new Error(`CONTRACT_INVALID: ${iid}: wpis musi być obiektem`);
            }
            rawEntries[iid] = raw;
          }
        }
        const iids = Object.keys(rawEntries);
        const key = `insert:${a.projectId}:${(a.idempotencyKey as string | undefined) ?? iids.join(",")}`;
        const { result } = await idempotentLive(ctx.stateDir + "/idempotency", key, a.dryRun as boolean | undefined, () =>
          writeOp(ctx, "plasmic_insert", a.projectId as string, iids.join(","), key, () =>
            c.mutate(a.projectId as string, a.branchId as string | undefined, (bundle) => {
              // Kontrakt WAB: normalizacja + walidacja PRZED zapisem.
              // Wpis niezgodny z modelem WAB odrzuciłby cały patch 412
              // (BundleTypeError) — tutaj zostaje złapany przed POST-em.
              const checked = checkPatch(rawEntries, bundle.map);
              if (checked.problems.length) {
                throw new Error(`CONTRACT_INVALID: ${formatProblems(checked.problems)}`);
              }
              return { map: checked.map };
            }, { dryRun: a.dryRun as boolean | undefined }),
          ),
        );
        return singleIid
          ? { ...result, id: singleIid }
          : { ...result, ids: iids };
      },
    },
    {
      name: "plasmic_update",
      annotations: A_OVERWRITE,
      description: "Scal pola wpisu (merge). Target odczytywany ponownie przed zapisem.",
      schema: {
        projectId: z.string(),
        elementId: z.string(),
        patch: z.record(z.string(), z.unknown()),
        branchId: z.string().optional(),
        ...dry,
      },
      handler: async (a) =>
        writeOp(ctx, "plasmic_update", a.projectId as string, a.elementId as string,
          JSON.stringify(a.patch),
          () =>
            c.mutate(a.projectId as string, a.branchId as string | undefined, (bundle) => {
              const { iid, entry } = resolve(bundle, a.elementId as string);
              const merged = { ...entry.raw, ...(a.patch as object) };
              // Update nie może WPROWADZIĆ nowego naruszenia kontraktu WAB
              // (np. RuleSet.values zamienione na string selektora). Istniejące
              // naruszenia w dokumencie nie blokują edycji.
              const resolveType = (ref: string): string | undefined => {
                const target = ref === iid ? merged : bundle.map[ref];
                if (!target || typeof target !== "object") return undefined;
                return String((target as Record<string, unknown>).__type ?? "");
              };
              const before = new Set(
                entryProblems(iid, entry.raw, resolveType).map(problemKey),
              );
              const introduced = entryProblems(iid, merged, resolveType).filter(
                (p) => !before.has(problemKey(p)),
              );
              if (introduced.length) {
                throw new Error(`CONTRACT_INVALID: ${formatProblems(introduced)}`);
              }
              return { map: { [iid]: merged } };
            }, { dryRun: a.dryRun as boolean | undefined }),
        ),
    },
    {
      name: "plasmic_delete",
      annotations: A_DELETE,
      description: "Usuń wpis. Bez force odmawia przy wiszących referencjach.",
      schema: {
        projectId: z.string(),
        elementId: z.string(),
        force: z.boolean().optional(),
        branchId: z.string().optional(),
        ...dry,
      },
      handler: async (a) =>
        writeOp(ctx, "plasmic_delete", a.projectId as string, a.elementId as string,
          a.elementId as string,
          () =>
            c.mutate(a.projectId as string, a.branchId as string | undefined, (bundle) => {
              const { iid } = resolve(bundle, a.elementId as string);
              if (!a.force) {
                const refs = Object.entries(bundle.map)
                  .filter(([k, v]) => k !== iid && JSON.stringify(v).includes(iid))
                  .map(([k]) => k);
                if (refs.length) {
                  throw new Error(`DANGLING_REFS from ${refs.join(", ")} — użyj force:true`);
                }
              }
              return { toDeleteIids: [iid] };
            }, { dryRun: a.dryRun as boolean | undefined }),
        ),
    },
    {
      name: "plasmic_set_props",
      annotations: A_ADD,
      description: "Scal props wpisu.",
      schema: {
        projectId: z.string(),
        elementId: z.string(),
        props: z.record(z.string(), z.unknown()),
        branchId: z.string().optional(),
        ...dry,
      },
      handler: async (a) =>
        writeOp(ctx, "plasmic_set_props", a.projectId as string, a.elementId as string,
          JSON.stringify(a.props),
          () =>
            c.mutate(a.projectId as string, a.branchId as string | undefined, (bundle) => {
              const { iid, entry } = resolve(bundle, a.elementId as string);
              // Model WAB nie ma pola `props` — propsy TplTag żyją w VariantSetting.attrs.
              if (entry.type !== "TplTag") {
                throw new Error(
                  `MODEL_LIMIT: set_props wspiera tylko TplTag (attrs), a ${iid} to ${entry.type}. ` +
                  `Pola modelu ${entry.type} sprawdź przez read.`,
                );
              }
              const vsRef = (entry.raw.vsettings as Array<{ __ref: string }> | undefined)?.[0];
              if (!vsRef) throw new Error(`MODEL_LIMIT: ${iid} nie ma vsettings`);
              const vs = bundle.map[vsRef.__ref] as Record<string, unknown> | undefined;
              if (!vs || typeof vs !== "object") throw new Error(`MODEL_LIMIT: brak wpisu ${vsRef.__ref}`);
              // Wartości attrs to xrefy do osobnych wpisów Expr (nie inline).
              const prev = (vs.attrs as Record<string, unknown> | undefined) ?? {};
              const nextAttrs: Record<string, unknown> = { ...prev };
              const newEntries: Record<string, Record<string, unknown>> = {};
              for (const [k, v] of Object.entries(a.props as Record<string, unknown>)) {
                if (!["string", "number", "boolean"].includes(typeof v)) {
                  throw new Error(
                    `MODEL_LIMIT: set_props przyjmuje tylko string/number/boolean, a '${k}' to ${typeof v}.`,
                  );
                }
                const exprIid = newIid();
                newEntries[exprIid] = {
                  __type: "CustomCode",
                  code: JSON.stringify(v),
                  fallback: null,
                };
                nextAttrs[k] = { __ref: exprIid };
              }
              return {
                map: {
                  ...newEntries,
                  [vsRef.__ref]: { ...vs, attrs: nextAttrs },
                },
              };
            }, { dryRun: a.dryRun as boolean | undefined }),
        ),
    },
    {
      name: "plasmic_set_styles",
      annotations: A_WRITE,
      description: "Scal style CSS (RuleSet.values) przez base VariantSetting węzła Tpl.",
      schema: {
        projectId: z.string(),
        elementId: z.string(),
        styles: z.record(z.string(), z.unknown()),
        branchId: z.string().optional(),
        ...dry,
      },
      handler: async (a) =>
        writeOp(ctx, "plasmic_set_styles", a.projectId as string, a.elementId as string,
          JSON.stringify(a.styles),
          () =>
            c.mutate(a.projectId as string, a.branchId as string | undefined, (bundle) => {
              const { iid, entry } = resolve(bundle, a.elementId as string);
              // Style żyją w RuleSet.values wskazywanym przez VariantSetting.rs.
              if (entry.type !== "TplTag" && entry.type !== "TplComponent") {
                throw new Error(
                  `MODEL_LIMIT: set_styles wspiera TplTag/TplComponent, a ${iid} to ${entry.type}.`,
                );
              }
              const vsRef = (entry.raw.vsettings as Array<{ __ref: string }> | undefined)?.[0];
              if (!vsRef) throw new Error(`MODEL_LIMIT: ${iid} nie ma vsettings`);
              const vs = bundle.map[vsRef.__ref] as Record<string, unknown> | undefined;
              if (!vs || typeof vs !== "object") throw new Error(`MODEL_LIMIT: brak wpisu ${vsRef.__ref}`);
              const rs = vs.rs as { __ref: string } | Record<string, unknown> | undefined;
              if (!rs || typeof rs !== "object") throw new Error(`MODEL_LIMIT: ${vsRef.__ref} nie ma rs`);
              if (typeof (rs as { __ref?: string }).__ref === "string") {
                const rsIid = (rs as { __ref: string }).__ref;
                const rsEntry = bundle.map[rsIid] as Record<string, unknown> | undefined;
                if (!rsEntry) throw new Error(`MODEL_LIMIT: brak RuleSet ${rsIid}`);
                const prev = (rsEntry.values as Record<string, unknown> | undefined) ?? {};
                return {
                  map: {
                    [rsIid]: { ...rsEntry, values: { ...prev, ...(a.styles as object) } },
                  },
                };
              }
              const prev = ((rs as Record<string, unknown>).values as Record<string, unknown> | undefined) ?? {};
              return {
                map: {
                  [vsRef.__ref]: {
                    ...vs,
                    rs: { ...(rs as object), values: { ...prev, ...(a.styles as object) } },
                  },
                },
              };
            }, { dryRun: a.dryRun as boolean | undefined }),
        ),
    },
    {
      name: "plasmic_use_component",
      annotations: A_WRITE,
      description: "Wstaw instancję komponentu przez klon istniejącej instancji.",
      schema: {
        projectId: z.string(),
        componentId: z.string(),
        branchId: z.string().optional(),
        ...idKey,
        ...dry,
      },
      handler: async (a) => {
        const key = `use:${a.projectId}:${(a.idempotencyKey as string | undefined) ?? (a.componentId as string)}`;
        const { result } = await idempotentLive(ctx.stateDir + "/idempotency", key, a.dryRun as boolean | undefined, () =>
          writeOp(ctx, "plasmic_use_component", a.projectId as string, a.componentId as string,
            key,
            async () => {
              const out = await c.mutate(
                a.projectId as string,
                a.branchId as string | undefined,
                (bundle) => {
                  const { iid } = resolve(bundle, a.componentId as string);
                  const inst = Object.entries(bundle.map).find(
                    ([k, v]) => k !== iid && JSON.stringify(v).includes(iid),
                  );
                  if (!inst) {
                    throw new Error(
                      "NO_INSTANCE: brak instancji tego komponentu do sklonowania — wstaw pierwszą w Studio, potem klonuj przez MCP",
                    );
                  }
                  const newId = newIid();
                  const raw = JSON.parse(JSON.stringify(inst[1])) as Record<string, unknown>;
                  return { map: { [newId]: raw } };
                },
                { dryRun: a.dryRun as boolean | undefined },
              );
              return out;
            }),
        );
        return result;
      },
    },
    {
      name: "plasmic_validate",
      annotations: A_READ,
      description:
        "Lokalna walidacja bundle: parsowanie, __type, kontrakt WAB (wymagane pola, typy, graf referencji), dangling refs.",
      schema: { projectId: z.string(), branchId: z.string().optional() },
      handler: async (a) => {
        const rev = await c.getProjectRev(a.projectId as string, a.branchId as string | undefined);
        const problems: string[] = [];
        const keys = new Set(Object.keys(rev.bundle.map));
        for (const [iid, v] of Object.entries(rev.bundle.map)) {
          if (!v || typeof v !== "object") {
            problems.push(`${iid}: not an object`);
            continue;
          }
          if (!("__type" in (v as object))) problems.push(`${iid}: missing __type`);
        }
        // Kontrakt WAB (KOMAA-1084): wymagane pola, typy pól i graf referencji.
        // Ten sam kontrakt, którego wymaga serwer przy zapisie (412 BundleTypeError).
        const typeOf = (ref: string): string | undefined => {
          const target = rev.bundle.map[ref];
          if (!target || typeof target !== "object") return undefined;
          return String((target as Record<string, unknown>).__type ?? "");
        };
        const dangling = new Set<string>();
        for (const [iid, v] of Object.entries(rev.bundle.map)) {
          if (!v || typeof v !== "object") continue;
          for (const p of entryProblems(iid, v as Record<string, unknown>, typeOf)) {
            problems.push(`${p.code} ${p.iid}: ${p.detail}`);
          }
          for (const ref of danglingRefs(v as Record<string, unknown>, typeOf)) {
            dangling.add(ref);
          }
        }
        // Prosty skan wiszących referencji: wartości string równe iid, którego brak w mapie.
        const text = JSON.stringify(rev.bundle.map);
        const cands = new Set<string>();
        const re = /"([A-Za-z0-9_-]{10,})"/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
          const v = m[1]!;
          if (!keys.has(v) && /^[A-Z]/.test(v)) cands.add(v);
        }
        return {
          revision: rev.revision,
          entries: keys.size,
          hash: sha256(text),
          problems: problems.slice(0, 50),
          suspectRefs: [...cands].slice(0, 20),
          danglingRefs: [...dangling].slice(0, 20),
          valid: problems.length === 0,
        };
      },
    },
    {
      name: "plasmic_get_changes",
      // Tylko odczyt danych Plasmic — narzędzie cache'uje lokalny hash
      // ostatnio widzianej rewizji, nie zmienia projektu.
      annotations: A_READ,
      description: "Numer rewizji + hash vs ostatnio widziane (wykrywanie zmian).",
      schema: { projectId: z.string(), branchId: z.string().optional() },
      handler: async (a) => {
        const rev = await c.getProjectRev(a.projectId as string, a.branchId as string | undefined);
        const hash = sha256(JSON.stringify(rev.bundle.map));
        const { readFile, writeFile, mkdir } = await import("node:fs/promises");
        const { join } = await import("node:path");
        const dir = ctx.stateDir + "/seen";
        await mkdir(dir, { recursive: true });
        const f = join(dir, `${String(a.projectId).replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
        const prev = JSON.parse((await readFile(f, "utf8").catch(() => "null")) as string) as {
          revision: number;
          hash: string;
        } | null;
        await writeFile(f, JSON.stringify({ revision: rev.revision, hash }));
        return {
          revision: rev.revision,
          hash,
          lastSeen: prev,
          changed: !prev || prev.revision !== rev.revision || prev.hash !== hash,
        };
      },
    },
  ];
}
