import { createHash } from "node:crypto";
import {
  type DesignContext,
  makeDesignContext,
} from "@design-stack/contracts/design-context";
import { sha256 } from "@design-stack/contracts/sync";

export interface OdClientOptions {
  baseUrl: string; // np. http://127.0.0.1:7456
  token: string; // OD_API_TOKEN
  fetchImpl?: typeof fetch;
  maxContextBytes?: number;
}

interface DsSummary {
  id: string;
  name?: string;
  title?: string;
  isEditable?: boolean;
  source?: string;
  [k: string]: unknown;
}

export interface BrandSnapshot {
  brand: DsSummary;
  files: Array<{ path: string; [k: string]: unknown }>;
  designMd: string;
  tokensCss: string | null;
  manifest: unknown | null;
  usageMd: string | null;
  componentsManifest: unknown | null;
  assetPaths: string[];
  hashes: {
    designMdSha256: string;
    tokensCssSha256: string | null;
  };
}

export interface BrandWriteResult {
  brandId: string;
  designMdSha256: string;
  tokensCssSha256: string | null;
  tokensChanged?: boolean;
}

const BRAND_ASSET_EXTENSIONS = new Set([
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".avif",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
]);

function rawSha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeAssetPath(input: string): string {
  let value = input.trim().replace(/\\/g, "/");
  if (value.startsWith("assets/")) value = value.slice("assets/".length);
  if (!value || value.startsWith("/") || value.includes("\0")) {
    throw new Error("INVALID_ASSET_PATH");
  }
  const parts = value.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error("INVALID_ASSET_PATH");
  }
  const leaf = parts.at(-1) ?? "";
  const dot = leaf.lastIndexOf(".");
  const ext = dot >= 0 ? leaf.slice(dot).toLowerCase() : "";
  if (!BRAND_ASSET_EXTENSIONS.has(ext)) {
    throw new Error(`UNSUPPORTED_ASSET_EXTENSION ${ext || "(none)"}`);
  }
  return `assets/${parts.join("/")}`;
}

function decodeBase64Strict(content: string): Buffer {
  const normalized = content.replace(/\s+/g, "");
  if (!normalized || normalized.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    throw new Error("INVALID_BASE64");
  }
  const bytes = Buffer.from(normalized, "base64");
  const roundTrip = bytes.toString("base64");
  if (roundTrip !== normalized) throw new Error("INVALID_BASE64");
  return bytes;
}

export class OdClient {
  private base: string;
  private token: string;
  private fetchImpl: typeof fetch;
  readonly maxContextBytes: number;

  constructor(opts: OdClientOptions) {
    this.base = opts.baseUrl.replace(/\/$/, "");
    this.token = opts.token;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.maxContextBytes = opts.maxContextBytes ?? 48_000;
  }

  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.fetchImpl(this.base + path, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      throw new Error(`OD ${res.status} ${path}: ${(await res.text()).slice(0, 300)}`);
    }
    return (await res.json()) as T;
  }

  private async json<T>(path: string, method: "POST" | "PATCH", body: unknown): Promise<T> {
    return this.req<T>(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
  }

  listDesignSystems(): Promise<{ designSystems: DsSummary[] }> {
    return this.req("/api/design-systems");
  }

  getDesignSystem(id: string): Promise<DsSummary> {
    return this.req(`/api/design-systems/${encodeURIComponent(id)}`);
  }

  listFiles(id: string): Promise<{ files: Array<{ path: string; [k: string]: unknown }> }> {
    return this.req(`/api/design-systems/${encodeURIComponent(id)}/files`);
  }

  async readFile(id: string, path: string): Promise<string> {
    const res = await this.fetchImpl(
      `${this.base}/api/design-systems/${encodeURIComponent(id)}/file?path=${encodeURIComponent(path)}`,
      { headers: { Authorization: `Bearer ${this.token}` } },
    );
    if (!res.ok) {
      throw new Error(`OD ${res.status} file ${path}: ${(await res.text()).slice(0, 200)}`);
    }
    const json = (await res.json()) as {
      file?: { content?: unknown; bytes?: { data?: number[] } };
    };
    const content = json.file?.content;
    if (typeof content === "string") return content;
    const data = json.file?.bytes?.data;
    if (Array.isArray(data)) return Buffer.from(data).toString("utf8");
    throw new Error(`OD: nieznany format odpowiedzi file ${path}`);
  }

  private async readOptionalFile(id: string, path: string): Promise<string | null> {
    try {
      return await this.readFile(id, path);
    } catch {
      return null;
    }
  }

  private async readStaticBytes(id: string, path: string): Promise<Buffer> {
    const url = `${this.base}/api/design-systems/${encodeURIComponent(id)}/static?path=${encodeURIComponent(path)}`;
    const res = await this.fetchImpl(url, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!res.ok) {
      throw new Error(`OD ${res.status} static ${path}: ${(await res.text()).slice(0, 200)}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  private ensureEditableBrand(id: string, meta?: DsSummary): void {
    if (!id.startsWith("user:")) {
      throw new Error("BRAND_NOT_EDITABLE only user:* design systems can be mutated");
    }
    if (meta?.isEditable === false) {
      throw new Error("BRAND_NOT_EDITABLE");
    }
  }

  async getBrand(id: string): Promise<BrandSnapshot> {
    const [brand, files, designMd, tokensCss, manifestRaw, usageMd, componentsRaw] = await Promise.all([
      this.getDesignSystem(id),
      this.listFiles(id),
      this.readFile(id, "DESIGN.md"),
      this.readOptionalFile(id, "tokens.css"),
      this.readOptionalFile(id, "manifest.json"),
      this.readOptionalFile(id, "USAGE.md"),
      this.readOptionalFile(id, "components.manifest.json"),
    ]);
    const parseOptionalJson = (raw: string | null): unknown | null => {
      if (raw === null) return null;
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        return raw;
      }
    };
    return {
      brand,
      files: files.files,
      designMd,
      tokensCss,
      manifest: parseOptionalJson(manifestRaw),
      usageMd,
      componentsManifest: parseOptionalJson(componentsRaw),
      assetPaths: files.files
        .map((f) => f.path)
        .filter((p) => p.startsWith("assets/")),
      hashes: {
        designMdSha256: rawSha256(designMd),
        tokensCssSha256: tokensCss === null ? null : rawSha256(tokensCss),
      },
    };
  }

  async updateDesignMd(
    id: string,
    designMd: string,
    expectedSha256: string,
  ): Promise<BrandWriteResult> {
    const meta = await this.getDesignSystem(id);
    this.ensureEditableBrand(id, meta);
    if (!designMd.trim()) throw new Error("EMPTY_DESIGN_MD");
    const before = await this.readFile(id, "DESIGN.md");
    const beforeHash = rawSha256(before);
    if (beforeHash !== expectedSha256) {
      throw new Error(`CONFLICT DESIGN.md expected=${expectedSha256} actual=${beforeHash}`);
    }
    await this.json(`/api/design-systems/${encodeURIComponent(id)}`, "PATCH", { body: designMd });
    const after = await this.readFile(id, "DESIGN.md");
    const tokens = await this.readOptionalFile(id, "tokens.css");
    return {
      brandId: id,
      designMdSha256: rawSha256(after),
      tokensCssSha256: tokens === null ? null : rawSha256(tokens),
    };
  }

  async updateTokens(
    id: string,
    designMd: string,
    expectedDesignMdSha256: string,
    expectedTokensSha256: string | null,
  ): Promise<BrandWriteResult> {
    const meta = await this.getDesignSystem(id);
    this.ensureEditableBrand(id, meta);
    if (!designMd.trim()) throw new Error("EMPTY_DESIGN_MD");
    const [beforeDesignMd, beforeTokens] = await Promise.all([
      this.readFile(id, "DESIGN.md"),
      this.readOptionalFile(id, "tokens.css"),
    ]);
    const beforeDesignHash = rawSha256(beforeDesignMd);
    const beforeTokensHash = beforeTokens === null ? null : rawSha256(beforeTokens);
    if (beforeDesignHash !== expectedDesignMdSha256) {
      throw new Error(
        `CONFLICT DESIGN.md expected=${expectedDesignMdSha256} actual=${beforeDesignHash}`,
      );
    }
    if (beforeTokensHash !== expectedTokensSha256) {
      throw new Error(
        `CONFLICT tokens.css expected=${expectedTokensSha256 ?? "null"} actual=${beforeTokensHash ?? "null"}`,
      );
    }

    await this.json(`/api/design-systems/${encodeURIComponent(id)}`, "PATCH", { body: designMd });
    const [afterDesignMd, afterTokens] = await Promise.all([
      this.readFile(id, "DESIGN.md"),
      this.readOptionalFile(id, "tokens.css"),
    ]);
    const afterTokensHash = afterTokens === null ? null : rawSha256(afterTokens);

    if (afterTokensHash === beforeTokensHash) {
      // update_tokens must be atomic from the caller's point of view. If the
      // supplied DESIGN.md did not produce a token change, restore the previous
      // canonical body instead of leaving half an update behind.
      await this.json(`/api/design-systems/${encodeURIComponent(id)}`, "PATCH", {
        body: beforeDesignMd,
      });
      const restored = await this.readFile(id, "DESIGN.md");
      if (rawSha256(restored) !== beforeDesignHash) {
        throw new Error("TOKENS_UNCHANGED_ROLLBACK_FAILED");
      }
      throw new Error(
        "TOKENS_UNCHANGED rolled back; change the token contract in DESIGN.md so OpenDesign regenerates tokens.css",
      );
    }

    return {
      brandId: id,
      designMdSha256: rawSha256(afterDesignMd),
      tokensCssSha256: afterTokensHash,
      tokensChanged: true,
    };
  }

  private async ensureDesignSystemWorkspace(id: string): Promise<string> {
    const out = await this.json<{
      project?: { id?: string };
      id?: string;
    }>(`/api/design-systems/${encodeURIComponent(id)}/workspace`, "POST", {});
    const projectId = out.project?.id ?? out.id;
    if (!projectId) throw new Error("OD workspace response missing project.id");
    return String(projectId);
  }

  private async writeProjectFile(
    projectId: string,
    path: string,
    content: string,
    encoding: "utf8" | "base64",
  ): Promise<void> {
    await this.json(`/api/projects/${encodeURIComponent(projectId)}/files`, "POST", {
      name: path,
      content,
      encoding,
    });
  }

  async uploadBrandAsset(
    id: string,
    path: string,
    contentBase64: string,
    options: { overwrite?: boolean; maxBytes?: number } = {},
  ): Promise<{ brandId: string; path: string; sha256: string; bytes: number; synced: string[] }> {
    const meta = await this.getDesignSystem(id);
    this.ensureEditableBrand(id, meta);
    const canonicalPath = normalizeAssetPath(path);
    const bytes = decodeBase64Strict(contentBase64);
    const maxBytes = options.maxBytes ?? 5_000_000;
    if (bytes.length > maxBytes) {
      throw new Error(`ASSET_TOO_LARGE ${bytes.length} > ${maxBytes}`);
    }
    const before = await this.listFiles(id);
    const exists = before.files.some((f) => f.path === canonicalPath);
    if (exists && options.overwrite !== true) {
      throw new Error(`ASSET_EXISTS ${canonicalPath}; pass overwrite=true intentionally`);
    }

    const projectId = await this.ensureDesignSystemWorkspace(id);
    await this.writeProjectFile(projectId, canonicalPath, contentBase64, "base64");
    const sync = await this.json<{ synced?: string[] }>(
      `/api/design-systems/${encodeURIComponent(id)}/sync-assets`,
      "POST",
      {},
    );

    const canonicalBytes = await this.readStaticBytes(id, canonicalPath);
    const expectedHash = rawSha256(bytes);
    const actualHash = rawSha256(canonicalBytes);
    if (actualHash !== expectedHash) {
      throw new Error(`ASSET_VERIFY_FAILED expected=${expectedHash} actual=${actualHash}`);
    }
    return {
      brandId: id,
      path: canonicalPath,
      sha256: actualHash,
      bytes: canonicalBytes.length,
      synced: Array.isArray(sync.synced) ? sync.synced : [],
    };
  }

  private tryParse(s: string): unknown {
    try {
      return JSON.parse(s);
    } catch {
      return s;
    }
  }

  async getTokens(id: string): Promise<Record<string, unknown>> {
    for (const p of ["design-tokens.json", "tokens.json", "tokens.css"]) {
      try {
        const raw = await this.readFile(id, p);
        const parsed = this.tryParse(raw);
        if (parsed && typeof parsed === "object") {
          return parsed as Record<string, unknown>;
        }
        return { css: String(parsed).slice(0, 20_000) };
      } catch {
        /* próbuj kolejnej ścieżki */
      }
    }
    return {};
  }

  async getComponents(id: string): Promise<Array<{ id: string; name: string }>> {
    for (const p of ["components.manifest.json", "manifest.json"]) {
      try {
        const parsed = this.tryParse(await this.readFile(id, p));
        if (!parsed || typeof parsed !== "object") continue;
        const o = parsed as Record<string, unknown>;
        const arr = Array.isArray(parsed)
          ? parsed
          : Array.isArray(o.components)
            ? (o.components as unknown[])
            : null;
        if (arr) {
          return arr
            .filter((c) => c && typeof c === "object")
            .map((c) => {
              const e = c as Record<string, unknown>;
              const name = String(e.name ?? e.id ?? "unknown");
              return { id: String(e.id ?? name), name };
            });
        }
        if (Array.isArray(o.groups)) {
          return (o.groups as Array<Record<string, unknown>>)
            .filter((g) => g && (g.id || g.label))
            .map((g) => ({ id: String(g.id ?? g.label), name: String(g.label ?? g.id) }));
        }
      } catch {
        /* dalej */
      }
    }
    return [];
  }

  /** design_get_context: zwarty, limitowany rozmiarowo kontekst dla agenta. */
  async getContext(id: string): Promise<DesignContext> {
    const [meta, tokens, components] = await Promise.all([
      this.getDesignSystem(id),
      this.getTokens(id),
      this.getComponents(id),
    ]);
    const ctx = makeDesignContext({
      project: { id, name: String(meta.name ?? meta.title ?? meta.id ?? id) },
      tokens,
      components: components.map((c) => ({ ...c, source: "opendesign" as const })),
      constraints: [
        "OpenDesign is canonical for tokens/typography/colors/spacing.",
        "Do not invent new primitives — reuse listed tokens and components.",
      ],
      sourceRefs: [
        { source: "opendesign", id, hash: sha256({ tokens, components }) },
      ],
    });
    let s = JSON.stringify(ctx);
    if (s.length > this.maxContextBytes) {
      ctx.tokens = { _truncated: true, hash: sha256(ctx.tokens) };
      s = JSON.stringify(ctx);
    }
    if (s.length > this.maxContextBytes) {
      ctx.components = ctx.components.slice(0, 50);
    }
    return ctx;
  }
}
