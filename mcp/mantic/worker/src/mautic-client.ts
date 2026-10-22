/**
 * Klient Mautic API na fetchu (bez axiosa) — Worker nie ma Node HTTP stacka.
 * API kompatybilne z MauticApiClient: `client.v1.get(path, {params})` → `{ data }`.
 *
 * Dwa przepływy tokenu (w kolejności):
 * 1. `refresh_token` — token odzyskany w flow authorization_code (panel Mautica:
 *    OAuth 2 → Name + Redirect URL). Odświeżany w KV Workera.
 * 2. `client_credentials` — dla instancji, które ten grant obsługują.
 */
export interface MauticWorkerConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  tokenEndpoint: string;
  /** Istniejący refresh token (np. z KV). */
  refreshToken?: string;
  /** Zapis nowego refresh tokenu (KV Workera). */
  saveRefreshToken?: (token: string) => Promise<void>;
}

interface RequestOptions {
  params?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

export class MauticRequestError extends Error {
  response: { status: number; data: unknown };
  constructor(status: number, data: unknown, message: string) {
    super(message);
    this.name = "MauticRequestError";
    this.response = { status, data };
  }
}

export class MauticWorkerClient {
  private accessToken: { value: string; expiresAt: number } | null = null;

  constructor(private readonly cfg: MauticWorkerConfig) {}

  private async requestToken(body: URLSearchParams): Promise<Record<string, unknown> | null> {
    const res = await fetch(this.cfg.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  }

  private async token(): Promise<string> {
    if (this.accessToken && Date.now() < this.accessToken.expiresAt) return this.accessToken.value;

    if (this.cfg.refreshToken) {
      const data = await this.requestToken(
        new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: this.cfg.refreshToken,
          client_id: this.cfg.clientId,
          client_secret: this.cfg.clientSecret,
        }),
      );
      if (data?.access_token) {
        const refresh = typeof data.refresh_token === "string" ? data.refresh_token : undefined;
        if (refresh && this.cfg.saveRefreshToken) await this.cfg.saveRefreshToken(refresh);
        this.accessToken = {
          value: data.access_token as string,
          expiresAt: Date.now() + Number(data.expires_in ?? 300) * 1000 - 60_000,
        };
        return this.accessToken.value;
      }
    }

    const data = await this.requestToken(
      new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
      }),
    );
    if (!data?.access_token) {
      throw new MauticRequestError(
        401,
        null,
        "Mautic authentication failed (brak access_token; sprawdź refresh token / client credentials)",
      );
    }
    this.accessToken = {
      value: data.access_token as string,
      expiresAt: Date.now() + Number(data.expires_in ?? 300) * 1000 - 60_000,
    };
    return this.accessToken.value;
  }

  private async request(method: string, path: string, options: RequestOptions, v2: boolean): Promise<{ data: unknown }> {
    const base = v2
      ? this.cfg.baseUrl.replace(/\/?$/, "").replace(/\/api\/?$/, "") + "/api/v2/"
      : this.cfg.baseUrl.replace(/\/?$/, "") + "/";
    const url = new URL(base.replace(/\/?$/, "/") + path.replace(/^\//, ""));
    for (const [key, value] of Object.entries(options.params ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await this.token()}`,
      Accept: v2 ? "application/ld+json" : "application/json",
    };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(url.toString(), {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      const detail = (data as { errors?: { message?: string }[] } | null)?.errors?.[0]?.message ?? res.statusText;
      throw new MauticRequestError(res.status, data, `Mautic API ${res.status}: ${detail}`);
    }
    return { data };
  }

  private methods(v2: boolean) {
    return {
      get: (path: string, options: RequestOptions = {}) => this.request("GET", path, options, v2),
      post: (path: string, options: RequestOptions = {}) => this.request("POST", path, options, v2),
      put: (path: string, options: RequestOptions = {}) => this.request("PUT", path, options, v2),
      patch: (path: string, options: RequestOptions = {}) => this.request("PATCH", path, options, v2),
      delete: (path: string, options: RequestOptions = {}) => this.request("DELETE", path, options, v2),
    };
  }

  get v1() {
    return this.methods(false);
  }

  get v2() {
    return this.methods(true);
  }
}
