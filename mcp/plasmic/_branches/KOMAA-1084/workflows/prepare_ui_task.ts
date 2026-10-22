// prepare_ui_task (Etap 11): jeden punkt wejścia dla typowego zadania UI.
// Wejście JSON: {task, repo?, route?, plasmicPage?, openDesignProject?}
// Wyjście: tokeny, komponenty, struktura Plasmic, pliki repo, constraints,
// rekomendowany cel implementacji (routing z Etapu 12).
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { OdClient } from "@design-stack/od-client";
import { PlasmicClient } from "@design-stack/plasmic-client";

const env = (k: string, d?: string) => process.env[k] ?? d;

interface Input {
  task: string;
  repo?: string;
  route?: string;
  plasmicPage?: string;
  plasmicProjectId?: string;
  openDesignProject?: string;
}

function recommend(i: Input): string {
  const t = i.task.toLowerCase();
  if (/(schema|migra|sql|tabela|rls|backend|server action|api)/.test(t)) {
    return "OpenCode/repo -> Supabase (Plasmic NIE dotyka DB/backendu)";
  }
  if (/(token|typograph|kolor|color|spacing|radius|shadow|design system)/.test(t)) {
    return "OpenDesign -> komponent repo -> rejestracja w Plasmic";
  }
  if (/(layout|treść|tekst|sekcja|strona|content)/.test(t) && i.plasmicPage) {
    return "Plasmic (zmiana layoutu/contentu istniejącej strony)";
  }
  if (/(logik|business|hook|fetch|mutation|formularz.*logik)/.test(t)) {
    return "OpenCode/repo (business logic)";
  }
  return "OpenCode -> GitHub (implementacja frontendowa, PR + review)";
}

async function repoFiles(repo: string | undefined, route: string | undefined): Promise<string[]> {
  if (!repo) return [];
  const out: string[] = [];
  async function walk(dir: string, depth: number) {
    if (depth > 4 || out.length > 40) return;
    let entries: string[] = [];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.startsWith(".") || e === "node_modules") continue;
      const p = join(dir, e);
      if (route && !p.includes(route) && depth > 1 && !/\.(tsx?|css)$/.test(e)) {
        // luźny filtr: przy podanym route preferuj pasujące ścieżki
      }
      if (/\.(tsx?|jsx|css|json)$/.test(e)) {
        out.push(p);
        if (out.length >= 40) return;
      } else if (!e.includes(".")) {
        await walk(p, depth + 1);
      }
    }
  }
  await walk(repo, 0);
  return out.slice(0, 40);
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
const raw = process.argv[2] ?? "{}";
const input = JSON.parse(raw) as Input;
if (!input.task) {
  console.error('użycie: prepare_ui_task.ts \'{"task":"...","repo":"...","route":"...","plasmicPage":"...","openDesignProject":"..."}\'');
  process.exit(2);
}

const result: Record<string, unknown> = {
  task: input.task,
  recommendation: recommend(input),
  constraints: [
    "GitHub = prawda o kodzie. OpenDesign = prawda o tokenach. Plasmic = tylko kompozycja.",
    "Każdy trwały rezultat implementacji ląduje w GitHub przez PR.",
    "Plasmic NIE: logika, schema Supabase, server actions, backend, infra, deployment.",
  ],
};

if (input.openDesignProject && env("OD_API_TOKEN")) {
  try {
    const od = new OdClient({ baseUrl: process.env.OD_BASE_URL ?? OD_BASE, token: env("OD_API_TOKEN")! });
    result.designContext = await od.getContext(input.openDesignProject);
  } catch (e) {
    result.designContext = { error: String(e).slice(0, 300) };
  }
} else {
  result.designContext = { note: "brak openDesignProject lub OD_API_TOKEN" };
}

if ((input.plasmicPage || input.plasmicProjectId) && (process.env.PLASMIC_BASE_URL || process.env.PLASMIC_HOST)) {
  try {
    const pl = new PlasmicClient({
      baseUrl: process.env.PLASMIC_BASE_URL ?? PLASMIC_BASE,
      email: env("PLASMIC_EMAIL"),
      password: env("PLASMIC_PASSWORD"),
      teamToken: env("PLASMIC_TEAM_TOKEN"),
    });
    const pid = input.plasmicProjectId ?? "";
    if (pid) {
      const rev = await pl.getProjectRev(pid);
      result.plasmic = {
        revision: rev.revision,
        pages: pl.listPages(rev.bundle).map((p) => ({ id: p.iid, name: p.name })),
        components: pl.listComponents(rev.bundle).slice(0, 30).map((x) => ({ id: x.iid, name: x.name })),
      };
    } else {
      result.plasmic = { note: "podaj plasmicProjectId aby odczytać strukturę" };
    }
  } catch (e) {
    result.plasmic = { error: String(e).slice(0, 300) };
  }
} else {
  result.plasmic = { note: "brak plasmicProjectId lub PLASMIC_BASE_URL" };
}

result.repoFiles = await repoFiles(input.repo, input.route);

console.log(JSON.stringify(result, null, 2));
