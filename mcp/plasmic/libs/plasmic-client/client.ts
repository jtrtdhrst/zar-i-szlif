import { isDeepStrictEqual } from "node:util";

// Cienki klient WAB REST (zweryfikowane w AppServer.ts self-hosta):
// POST /api/v1/auth/login, GET/POST /api/v1/projects,
// GET /api/v1/projects/:projectBranchId (pełny bundle),
// POST /api/v1/projects/:projectBranchId/revisions/:rev (zapis, także incremental).
export interface PlasmicClientOptions {
  baseUrl: string; // np. http://plasmic-wab:3004
  email?: string;
  password?: string;
  /** Rotowalny team API token (nagłówek x-plasmic-team-token). Alternatywa dla sesji. */
  teamToken?: string;
  fetchImpl?: typeof fetch;
}

interface ApiProject {
  id: string;
  name: string;
  [k: string]: unknown;
}

export interface ProjectRev {
  revision: number;
  revId: string;
  bundle: BundleDoc;
  project: ApiProject;
  modelVersion?: number;
  hostlessDataVersion?: number;
}

export interface BundleDoc {
  map: Record<string, Record<string, unknown>>;
  [k: string]: unknown;
}

export interface BundleEntry {
  iid: string;
  type: string;
  name: string;
  raw: Record<string, unknown>;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

// Heurystyka typów bundle (Plasmic map: iid -> {__type, ...}).
// Dokładne markery weryfikuje test integracyjny na żywym WAB.
function entryType(raw: Record<string, unknown>): string {
  return String(raw.__type ?? raw.type ?? "unknown");
}

function entryName(raw: Record<string, unknown>, iid: string): string {
  return String(raw.name ?? raw.uuid ?? iid);
}

// Hash schematu modelu WAB (src/wab/shared/model/classes-metas.ts).
// Weryfikowany w ensureSchemaIsUpToDate przy każdym save; przy upgrade
// Plasmic odczytaj ponownie: node -r esbuild-register gen-hash.ts w kontenerze wab.
const MODEL_SCHEMA_HASH = Number(process.env.PLASMIC_MODEL_SCHEMA_HASH ?? 639587200);

export class PlasmicClient {
  private base: string;
  private cookies: string[] = [];
  private fetchImpl: typeof fetch;
  private loggedIn = false;
  private opts: PlasmicClientOptions;

  constructor(opts: PlasmicClientOptions) {
    this.opts = opts;
    this.base = opts.baseUrl.replace(/\/$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private csrf?: string;

  private storeCookies(res: Response): void {
    // Zachowaj wszystkie ciasteczka (sesja + CSRF), nie tylko pierwsze.
    const getSetCookie = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
    const all: string[] = typeof getSetCookie === "function"
      ? getSetCookie.call(res.headers)
      : (res.headers.get("set-cookie")?.split(/,(?=[^;,]+=[^;,]*;)/) ?? []);
    for (const c of all) {
      const pair = c.split(";")[0]!.trim();
      if (!pair) continue;
      const name = pair.split("=")[0];
      this.cookies = [...this.cookies.filter((x) => !x.startsWith(name + "=")), pair];
    }
  }
  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.fetchImpl(this.base + path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(this.cookies.length ? { Cookie: this.cookies.join("; ") } : {}),
        ...(this.csrf ? { "X-CSRF-Token": this.csrf } : {}),
        ...(this.opts.teamToken
          ? { "x-plasmic-team-token": this.opts.teamToken }
          : {}),
        ...(init?.headers ?? {}),
      },
    });
    this.storeCookies(res);
    if (!res.ok) {
      throw new Error(
        `Plasmic ${res.status} ${path}: ${(await res.text()).slice(0, 300)}`,
      );
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  async login(): Promise<void> {
    const { email, password } = this.opts;
    if (!email || !password) {
      throw new Error("PLASMIC_EMAIL/PLASMIC_PASSWORD not configured (read-only mode)");
    }
    // WAB wymaga tokenu CSRF: najpierw pobierz (ustawia też ciasteczka).
    const csrf = await this.req<{ csrf: string }>("/api/v1/auth/csrf");
    this.csrf = csrf.csrf;
    await this.req("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    // Serwer rotuje token po zalogowaniu — odśwież.
    this.csrf = (await this.req<{ csrf: string }>("/api/v1/auth/csrf")).csrf;
    this.loggedIn = true;
  }

  async ensureAuth(): Promise<void> {
    if (!this.loggedIn && this.opts.email && this.opts.password) {
      await this.login();
    }
  }

  async listProjects(): Promise<ApiProject[]> {
    await this.ensureAuth();
    const res = await this.req<{ projects: ApiProject[] }>("/api/v1/projects");
    return res.projects;
  }

  async createProject(name: string, workspaceId?: string): Promise<ApiProject> {
    await this.ensureAuth();
    const res = await this.req<{ project: ApiProject }>(`/api/v1/projects`, {
      method: "POST",
      body: JSON.stringify(workspaceId ? { name, workspaceId } : { name }),
    });
    return res.project;
  }


  /** Studio WAB REST: GET /api/v1/projects/:projectId/branches. */
  async listBranches(projectId: string): Promise<{ branches: Array<{
    id: string; name: string; status?: string; hostUrl?: string;
  }> }> {
    await this.ensureAuth();
    return this.req(`/api/v1/projects/${encodeURIComponent(projectId)}/branches`);
  }

  /** Create a Plasmic *design* branch, not a GitHub source branch. */
  async createBranch(
    projectId: string,
    name: string,
    opts: { sourceBranchId?: string; base?: "new" | "latest" } = {},
  ): Promise<{ branch: { id: string; name: string; status?: string } }> {
    if (!name.trim() || name.trim() !== name) {
      throw new Error("INVALID_BRANCH_NAME: supply a nonempty trimmed name");
    }
    if (opts.sourceBranchId && opts.base) {
      throw new Error("INVALID_BRANCH_BASE: sourceBranchId and base are exclusive");
    }
    await this.ensureAuth();
    const existing = await this.listBranches(projectId);
    if (existing.branches.some((b) => b.name === name)) {
      throw new Error(`BRANCH_EXISTS: ${name}`);
    }
    const created = await this.req<{ branch: { id: string; name: string; status?: string } }>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/branches`,
      { method: "POST", body: JSON.stringify({ name, ...opts }) },
    );
    // Treat an unverified write as an error; avoid blindly retrying POST.
    const after = await this.listBranches(projectId);
    if (!created.branch?.id || !after.branches.some((b) => b.id === created.branch.id)) {
      throw new Error("BRANCH_CREATE_UNVERIFIED: check Studio before retrying");
    }
    return created;
  }

  /** Plasmic server performs the merge computation, but never commits. */
  async previewMerge(
    projectId: string,
    fromBranchId: string,
    toBranchId: string,
  ): Promise<unknown> {
    if (!fromBranchId || !toBranchId || fromBranchId === toBranchId ||
        (fromBranchId === "main" && toBranchId === "main")) {
      throw new Error("INVALID_MERGE_BRANCHES");
    }
    await this.ensureAuth();
    return this.req(`/api/v1/projects/${encodeURIComponent(projectId)}/merge`, {
      method: "POST",
      body: JSON.stringify({
        subject: { fromBranchId, toBranchId },
        pretend: true,
        autoCommitOnToBranch: false,
      }),
    });
  }

  async getProjectRev(
    projectId: string,
    branchId?: string,
  ): Promise<ProjectRev> {
    await this.ensureAuth();
    const spec = branchId ? `${projectId}.${branchId}` : projectId;
    const res = await this.req<{
      rev: { id: string; revision: number; data: string };
      project: ApiProject;
      modelVersion?: number;
      hostlessDataVersion?: number;
    }>(`/api/v1/projects/${encodeURIComponent(spec)}`);
    let bundle: BundleDoc;
    try {
      bundle = JSON.parse(res.rev.data) as BundleDoc;
    } catch {
      throw new Error("Plasmic: cannot parse revision bundle JSON");
    }
    if (!isObj(bundle.map)) {
      throw new Error("Plasmic: bundle has no map");
    }
    return {
      revision: res.rev.revision,
      revId: res.rev.id,
      bundle,
      project: res.project,
      modelVersion: res.modelVersion,
      hostlessDataVersion: res.hostlessDataVersion,
    };
  }

  /** Wszystkie wpisy z nazwą i typem (bazowo do listowania). */
  listEntries(bundle: BundleDoc): BundleEntry[] {
    return Object.entries(bundle.map)
      .filter(([, v]) => isObj(v) && "__type" in (v as object) && "name" in (v as object))
      .map(([iid, raw]) => ({
        iid,
        type: entryType(raw as Record<string, unknown>),
        name: entryName(raw as Record<string, unknown>, iid),
        raw: raw as Record<string, unknown>,
      }));
  }

  /** Strony = komponenty z pageMeta-obiektem; reszta z nazwą = komponenty. */
  listPages(bundle: BundleDoc): BundleEntry[] {
    return this.listEntries(bundle).filter(
      (e) => isObj(e.raw.pageMeta) && e.type.toLowerCase().includes("component"),
    );
  }

  listComponents(bundle: BundleDoc): BundleEntry[] {
    return this.listEntries(bundle).filter(
      (e) => !isObj(e.raw.pageMeta) && e.type.toLowerCase().includes("component"),
    );
  }

  listStyleTokens(bundle: BundleDoc): BundleEntry[] {
    return Object.entries(bundle.map)
      .filter(([, v]) => isObj(v) && entryType(v).toLowerCase().includes("token"))
      .map(([iid, raw]) => ({
        iid,
        type: entryType(raw),
        name: entryName(raw, iid),
        raw,
      }));
  }

  /**
   * Zapis inkrementalny (Etap 1): patch mapy + usuwane iids.
   * Serwer odrzuca niezgodny numer rewizji (ochrona przed konfliktami).
   */
  async saveIncremental(
    projectId: string,
    nextRevision: number,
    patch: {
      map?: Record<string, Record<string, unknown>>;
      toDeleteIids?: string[];
    },
    branchId?: string,
    meta?: {
      modelVersion?: number;
      hostlessDataVersion?: number;
      bundleVersion?: string;
      bundleRoot?: string;
      bundleDeps?: unknown[];
    },
  ): Promise<unknown> {
    await this.ensureAuth();
    const spec = branchId ? `${projectId}.${branchId}` : projectId;
    return this.req(
      `/api/v1/projects/${encodeURIComponent(spec)}/revisions/${nextRevision}`,
      {
        method: "POST",
        // Kształt jak Studio (bundleChanges/fastBundle): data to częściowy
        // Bundle {version, map} jako string; pełne wpisy w map.
        body: JSON.stringify({
          incremental: true,
          modelSchemaHash: MODEL_SCHEMA_HASH,
          modelVersion: meta?.modelVersion,
          hostlessDataVersion: meta?.hostlessDataVersion,
          data: JSON.stringify({
            version: meta?.bundleVersion,
            root: meta?.bundleRoot,
            deps: meta?.bundleDeps ?? [],
            map: patch.map ?? {},
          }),
          toDeleteIids: patch.toDeleteIids ?? [],
        }),
      },
    );
  }

  /**
   * Zapis pełnego bundle (non-incremental). Używane, gdy zmiana dotyka
   * struktury (np. nowa strona z Arena/tpl wygenerowana przez model WAB).
   * Serwer waliduje bundle (checkBundleFields/checkRefsInBundle).
   */
  async saveFull(
    projectId: string,
    nextRevision: number,
    bundle: BundleDoc,
    branchId?: string,
    meta?: { modelVersion?: number; hostlessDataVersion?: number },
  ): Promise<unknown> {
    await this.ensureAuth();
    const spec = branchId ? `${projectId}.${branchId}` : projectId;
    return this.req(
      `/api/v1/projects/${encodeURIComponent(spec)}/revisions/${nextRevision}`,
      {
        method: "POST",
        // Kształt jak Studio (SharedApi.saveProjectRevChanges): bundle jako STRING w polu data.
        body: JSON.stringify({
          modelSchemaHash: MODEL_SCHEMA_HASH,
          modelVersion: meta?.modelVersion,
          hostlessDataVersion: meta?.hostlessDataVersion,
          data: JSON.stringify(bundle),
        }),
      },
    );
  }

  /**
   * Read-modify-write z ponownym odczytem (Etap 1: resolution + re-read).
   * mutate dostaje świeży bundle i zwraca patch albo null (brak zmian).
   */
  async mutate(
    projectId: string,
    branchId: string | undefined,
    mutate: (bundle: BundleDoc) => {
      map?: Record<string, Record<string, unknown>>;
      toDeleteIids?: string[];
    } | null,
    opts?: { dryRun?: boolean },
  ): Promise<{ revision: number; dryRun: boolean; changed: string[] }> {
    const rev = await this.getProjectRev(projectId, branchId);
    const patch = mutate(rev.bundle);
    const changed = [
      ...Object.keys(patch?.map ?? {}),
      ...(patch?.toDeleteIids ?? []).map((i) => `-${i}`),
    ];
    if (!patch || changed.length === 0) {
      return { revision: rev.revision, dryRun: true, changed: [] };
    }
    if (opts?.dryRun) {
      return { revision: rev.revision, dryRun: true, changed };
    }
    const intendedRevision = rev.revision + 1;
    await this.saveIncremental(projectId, intendedRevision, patch, branchId, {
      modelVersion: rev.modelVersion,
      hostlessDataVersion: rev.hostlessDataVersion,
      bundleVersion: (rev.bundle as Record<string, unknown>).version as string | undefined,
      bundleRoot: (rev.bundle as Record<string, unknown>).root as string | undefined,
      bundleDeps: (rev.bundle as Record<string, unknown>).deps as unknown[] | undefined,
    });
    const after = await this.getProjectRev(projectId, branchId);
    const missingWrites = Object.entries(patch.map ?? {}).filter(([id, expected]) => {
      const actual = after.bundle.map[id];
      return !actual || Object.entries(expected).some(([field, value]) =>
        !isDeepStrictEqual(actual[field], value),
      );
    }).map(([id]) => id);
    const failedDeletes = (patch.toDeleteIids ?? []).filter((id) => !!after.bundle.map[id]);
    if (after.revision < intendedRevision || missingWrites.length || failedDeletes.length) {
      throw new Error(
        `WRITE_READBACK_UNVERIFIED (may have committed): expected revision ${intendedRevision}, got ${after.revision}; missing=${missingWrites.join(",")}; notDeleted=${failedDeletes.join(",")}. Inspect before retrying.`,
      );
    }
    return { revision: after.revision, dryRun: false, changed };
  }
}
