// Runtime configuration. Every value comes from the environment so the same
// image can serve staging and production; nothing is baked into the build.

export const SERVICE_NAME = "zar-i-szlif-product-host-mcp";
export const SERVICE_VERSION = "0.1.0";

export type LogLevel = "debug" | "info" | "warn" | "error";

/** Where the client-visible Supabase origin came from. */
export type PublicSupabaseOriginSource = "explicit" | "fallback";

export interface Config {
  /** HTTP port. */
  port: number;
  /** Public origin of this service, without a trailing slash. */
  publicOrigin: string;
  /** Supabase project URL used for server-side PostgREST calls. */
  supabaseUrl: string;
  /**
   * Client-visible Supabase origin, used for the auth server advertised in the
   * RFC 9728 metadata. In self-hosted Supabase this is often NOT the internal
   * service URL (`http://api-gw-…:8000`), which no MCP client can resolve.
   */
  supabasePublicUrl: string;
  /** Whether `supabasePublicUrl` came from configuration or from a fallback. */
  supabasePublicUrlSource: PublicSupabaseOriginSource;
  /** Supabase anon (publishable) key. Never the service-role key. */
  supabaseAnonKey: string;
  /** HS256 secret Supabase signs user access tokens with. */
  jwtSecret: string;
  /** Optional expected `iss` claim. */
  jwtIssuer: string | undefined;
  /**
   * Deployment environment reported in every tool response (`staging`,
   * `production`, ...). Purely informational: it is never used for routing or
   * data access, so a wrong value cannot widen what a caller can read.
   */
  environment: string;
  logLevel: LogLevel;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

function required(env: NodeJS.ProcessEnv, key: string): string {
  const raw = env[key];
  const value = raw?.trim();
  if (!value) throw new ConfigError(`missing required environment variable ${key}`);
  return value;
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function parseHttpUrl(name: string, value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ConfigError(`${name} must be an absolute URL, got ${value}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ConfigError(`${name} must use http or https, got ${parsed.protocol}`);
  }
  return stripTrailingSlash(value);
}

function parsePort(env: NodeJS.ProcessEnv): number {
  const raw = env.PORT?.trim();
  if (!raw) return 8080;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError(`PORT must be an integer between 1 and 65535, got ${raw}`);
  }
  return port;
}

function parseLogLevel(env: NodeJS.ProcessEnv): LogLevel {
  const raw = env.LOG_LEVEL?.trim().toLowerCase();
  if (!raw) return "info";
  if (!LOG_LEVELS.includes(raw as LogLevel)) {
    throw new ConfigError(`LOG_LEVEL must be one of ${LOG_LEVELS.join(", ")}, got ${raw}`);
  }
  return raw as LogLevel;
}

/** Fallback reported when `MCP_ENVIRONMENT` is absent or blank. */
export const DEFAULT_ENVIRONMENT = "unknown";
/** Longest accepted `MCP_ENVIRONMENT` value. */
export const ENVIRONMENT_MAX_LENGTH = 64;

/**
 * Deployment environment echoed in tool responses, so a caller (or the release
 * canary) can tell whether it reached staging or production.
 *
 * Informational only — it selects no behaviour. A value that is too long is a
 * configuration error rather than a silent truncation, because callers compare
 * it for equality.
 */
function parseEnvironment(env: NodeJS.ProcessEnv): string {
  const raw = env.MCP_ENVIRONMENT?.trim();
  if (!raw) return DEFAULT_ENVIRONMENT;
  if (raw.length > ENVIRONMENT_MAX_LENGTH) {
    throw new ConfigError(
      `MCP_ENVIRONMENT must be at most ${ENVIRONMENT_MAX_LENGTH} characters, got ${raw.length}`,
    );
  }
  return raw;
}

/**
 * Resolve the client-visible Supabase origin.
 *
 * `SUPABASE_PUBLIC_URL` wins, then `API_EXTERNAL_URL` (the standard Supabase
 * self-hosted name for the public gateway). Falling back to `SUPABASE_URL` is a
 * local-development convenience only: in production the service must refuse to
 * start rather than advertise an internal host that no MCP client can resolve.
 */
function resolvePublicSupabaseUrl(
  env: NodeJS.ProcessEnv,
  supabaseUrl: string,
): { url: string; source: PublicSupabaseOriginSource } {
  const explicit = env.SUPABASE_PUBLIC_URL?.trim() || env.API_EXTERNAL_URL?.trim();
  if (explicit) {
    return {
      url: parseHttpUrl("SUPABASE_PUBLIC_URL", stripTrailingSlash(explicit)),
      source: "explicit",
    };
  }
  if (env.NODE_ENV === "production") {
    throw new ConfigError(
      "SUPABASE_PUBLIC_URL (or API_EXTERNAL_URL) is required in production: the RFC 9728 " +
        "metadata must advertise a Supabase origin that an MCP client can actually reach",
    );
  }
  return { url: supabaseUrl, source: "fallback" };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = parsePort(env);
  const publicOrigin = parseHttpUrl(
    "MCP_PUBLIC_ORIGIN",
    stripTrailingSlash(env.MCP_PUBLIC_ORIGIN?.trim() || `http://127.0.0.1:${port}`),
  );
  const supabaseUrl = parseHttpUrl("SUPABASE_URL", stripTrailingSlash(required(env, "SUPABASE_URL")));
  const jwtIssuer = env.SUPABASE_JWT_ISSUER?.trim() || undefined;
  const publicSupabase = resolvePublicSupabaseUrl(env, supabaseUrl);

  return {
    port,
    publicOrigin,
    supabaseUrl,
    supabasePublicUrl: publicSupabase.url,
    supabasePublicUrlSource: publicSupabase.source,
    supabaseAnonKey: required(env, "SUPABASE_ANON_KEY"),
    jwtSecret: required(env, "SUPABASE_JWT_SECRET"),
    jwtIssuer: jwtIssuer ? stripTrailingSlash(jwtIssuer) : undefined,
    environment: parseEnvironment(env),
    logLevel: parseLogLevel(env),
  };
}
