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
  [k: string]: unknown;
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

  listDesignSystems(): Promise<{ designSystems: DsSummary[] }> {
    return this.req("/api/design-systems");
  }

  getDesignSystem(id: string): Promise<DsSummary> {
    return this.req(`/api/design-systems/${encodeURIComponent(id)}`);
  }

  listFiles(id: string): Promise<{ files: Array<{ path: string }> }> {
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
    // Daemon zwraca {file: {content: string, kind, ...}}; Buffer serializuje
    // się jako {type:'Buffer',data:[...]} — content jest zawsze tańszy.
    const json = (await res.json()) as {
      file?: { content?: unknown; bytes?: { data?: number[] } };
    };
    const content = json.file?.content;
    if (typeof content === "string") return content;
    const data = json.file?.bytes?.data;
    if (Array.isArray(data)) return Buffer.from(data).toString("utf8");
    throw new Error(`OD: nieznany format odpowiedzi file ${path}`);
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
        // Format A: lista komponentów ({components: [{id|name}]})
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
        // Format B: manifest OD (groups: [{id, label}])
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
      project: { id, name: String(meta.name ?? meta.id ?? id) },
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
    // Twardy limit rozmiaru (Etap 4).
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
