// design_sync_{status,plan,apply} (Etap 5 + 13).
// Kierunek TYLKO OpenDesign -> Plasmic. plan generuje diff przed zapisem,
// apply wymaga czystego planu i sprawdza konflikt (source/target/lastSync).
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { OdClient } from "@design-stack/od-client";
import { PlasmicClient } from "@design-stack/plasmic-client";
import { checkSyncConflict } from "@design-stack/contracts/sync";
import { sha256 } from "@design-stack/contracts/sync";
import { withProjectLock } from "@design-stack/contracts/locks";
import { auditLog } from "@design-stack/contracts/audit";

const env = (k: string, d?: string) => process.env[k] ?? d;
const req = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`missing env ${k}`);
  return v;
};

function getPath(obj: unknown, path: string): unknown {
  // Składnia: "a.b.c" (klucze) oraz "tokens.<name>" (szukanie w tablicy tokenów OD po name).
  const parts = path.split(".");
  if (parts[0] === "tokens" && parts.length === 2) {
    const root = obj as Record<string, unknown>;
    const arr = Array.isArray(root.tokens) ? root.tokens : Array.isArray(obj) ? obj : [];
    const found = (arr as Array<Record<string, unknown>>).find((t) => t.name === parts[1]);
    return found?.value;
  }
  return parts.reduce<unknown>(
    (o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined),
    obj,
  );
}

interface TokenMap {
  plasmicProjectId: string;
  openDesignSystemId: string;
  mappings: Record<string, { openDesign: string; plasmic: string }>;
}

async function loadJson<T>(p: string): Promise<T> {
  return JSON.parse(await readFile(p, "utf8")) as T;
}

async function computePlan(mapFile: string) {
  const map = await loadJson<TokenMap>(mapFile);
  const od = new OdClient({ baseUrl: process.env.OD_BASE_URL ?? OD_BASE, token: req("OD_API_TOKEN") });
  const pl = new PlasmicClient({
    baseUrl: process.env.PLASMIC_BASE_URL ?? PLASMIC_BASE,
    email: env("PLASMIC_EMAIL"),
    password: env("PLASMIC_PASSWORD"),
    teamToken: env("PLASMIC_TEAM_TOKEN"),
  });
  const tokens = await od.getTokens(map.openDesignSystemId);
  const rev = await pl.getProjectRev(map.plasmicProjectId);
  const plasmicTokens = pl.listStyleTokens(rev.bundle);

  const diffs = [];
  for (const [logical, m] of Object.entries(map.mappings)) {
    if (m.plasmic === "TO_FILL" || m.openDesign === "TO_FILL") {
      diffs.push({ logical, status: "unmapped" });
      continue;
    }
    const sourceVal = getPath(tokens, m.openDesign);
    const target = plasmicTokens.find((t) => t.iid === m.plasmic || t.name === m.plasmic);
    if (!target) {
      diffs.push({ logical, status: "missing-target", sourceVal });
      continue;
    }
    const targetVal = (target.raw as Record<string, unknown>).value;
    diffs.push({
      logical,
      status: JSON.stringify(sourceVal) === JSON.stringify(targetVal) ? "in-sync" : "drift",
      sourceVal,
      targetVal,
      targetId: target.iid,
    });
  }
  // Hash odporny na metadane regenerowane w tle (generatedAt, summary):
  // liczy się tylko kontrakto-wa zawartość tokenów.
  const tokensDoc = tokens as Record<string, unknown>;
  const sourceCore = {
    format: tokensDoc.format,
    schemaVersion: tokensDoc.schemaVersion,
    tokens: tokensDoc.tokens ?? tokens,
  };
  const sourceHash = sha256({ tokens: sourceCore });
  const targetHash = sha256(JSON.stringify(rev.bundle.map));
  return { map, diffs, sourceHash, targetHash, revision: rev.revision };
}

function stateFile(): string {
  return `${env("SYNC_STATE_DIR", "./var/design-sync")}/state.json`;
}

async function readState(): Promise<Record<string, { lastSync: string | null }>> {
  try {
    return JSON.parse(await readFile(stateFile(), "utf8")) as Record<string, { lastSync: string | null }>;
  } catch {
    return {};
  }
}


function resolveBase(hostKey: string, portKey: string, urlKey: string, defHost: string, defPort: string): string {
  const direct = process.env[urlKey];
  if (direct) return direct.replace(/\/$/, "");
  const host = process.env[hostKey] ?? defHost;
  const port = process.env[portKey] ?? defPort;
  return `http://${host}:${port}`;
}

const OD_BASE = resolveBase("OD_HOST", "OD_PORT", "OD_BASE_URL", "open-design", "7456");
const PLASMIC_BASE = resolveBase("PLASMIC_HOST", "PLASMIC_PORT", "PLASMIC_BASE_URL", "plasmic-wab", "3004");
const cmd = process.argv[2];
try { await main(); } catch (e) {
  console.error(JSON.stringify({ ok: false, error: String(e).slice(0, 500) }));
  process.exit(1);
}
async function main() {
const mapFile = process.argv.slice(3).find((a) => !a.startsWith("--")) ?? new URL("token-map.json", import.meta.url).pathname;

if (cmd === "design_sync_status" || cmd === "design_sync_plan") {
  const plan = await computePlan(mapFile);
  const state = await readState();
  const lastSync = state[mapFile]?.lastSync ?? null;
  const conflict = checkSyncConflict({
    source: plan.sourceHash,
    target: plan.targetHash,
    lastSync,
  });
  console.log(JSON.stringify({
    ok: conflict.status === "ok",
    conflict: conflict.status === "conflict" ? conflict : undefined,
    revision: plan.revision,
    sourceHash: plan.sourceHash,
    targetHash: plan.targetHash,
    lastSync,
    diffs: plan.diffs,
  }, null, 2));
  if (conflict.status === "conflict") process.exit(3);
} else if (cmd === "design_sync_apply") {
  const dryRun = process.argv.includes("--dry-run");
  const plan = await computePlan(mapFile);
  const state = await readState();
  const lastSync = state[mapFile]?.lastSync ?? null;
  const conflict = checkSyncConflict({
    source: plan.sourceHash,
    target: plan.targetHash,
    lastSync,
  });
  if (conflict.status === "conflict") {
    console.error(JSON.stringify({ ok: false, error: conflict.diff }));
    process.exit(3);
  }
  const ops = plan.diffs.filter(
    (d) => (d.status === "drift" || d.status === "missing-target") && d.sourceVal !== undefined,
  );
  if (!ops.length) {
    // Brak driftu = stan zsynchronizowany: odśwież lastSync na bieżące hashe.
    if (!dryRun) {
      state[mapFile] = { lastSync: plan.targetHash };
      await mkdir(new URL(".", "file://" + stateFile()).pathname, { recursive: true }).catch(() => {});
      await writeFile(stateFile(), JSON.stringify(state, null, 2));
    }
    console.log(JSON.stringify({ ok: true, applied: 0 }));
    process.exit(0);
  }
  const pl = new PlasmicClient({
    baseUrl: process.env.PLASMIC_BASE_URL ?? PLASMIC_BASE,
    email: env("PLASMIC_EMAIL"),
    password: env("PLASMIC_PASSWORD"),
    teamToken: env("PLASMIC_TEAM_TOKEN"),
  });
  await withProjectLock(env("SYNC_STATE_DIR", "./var/design-sync") + "/locks", plan.map.plasmicProjectId, async () => {
    const out = await pl.mutate(
      plan.map.plasmicProjectId,
      undefined,
      (bundle) => {
        const patch: Record<string, Record<string, unknown>> = {};
        for (const op of ops) {
          if (op.status !== "drift" || !op.targetId) continue;
          const cur = bundle.map[op.targetId];
          if (!cur || typeof cur !== "object") continue;
          patch[op.targetId] = { ...(cur as object), value: op.sourceVal };
        }
        return Object.keys(patch).length ? { map: patch } : null;
      },
      { dryRun },
    );
    if (!dryRun) {
      // lastSync = stan PO synchronizacji: świeży odczyt targetu.
      const fresh = await pl.getProjectRev(plan.map.plasmicProjectId);
      const freshTargetHash = sha256(JSON.stringify(fresh.bundle.map));
      state[mapFile] = { lastSync: freshTargetHash };
      await mkdir(new URL(".", "file://" + stateFile()).pathname, { recursive: true }).catch(() => {});
      await writeFile(stateFile(), JSON.stringify(state, null, 2));
      await auditLog(`${env("SYNC_STATE_DIR", "./var/design-sync")}/audit.jsonl`, {
        project: plan.map.plasmicProjectId,
        tool: "design_sync_apply",
        beforeHash: plan.targetHash,
        afterHash: freshTargetHash,
        ok: true,
      });
    }
    console.log(JSON.stringify({ ...out, ok: true, dryRun, applied: ops.length }, null, 2));
  });
} else {
  console.error("użycie: cli.ts design_sync_status|design_sync_plan|design_sync_apply [token-map.json] [--dry-run]");
  process.exit(2);
}
}
