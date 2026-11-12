// Runtime configuration. Every value comes from the environment so the same
// image can serve staging and production; nothing is baked into the build.

export const SERVICE_NAME = "zar-i-szlif-product-host-mcp";
export const SERVICE_VERSION = "0.1.0";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Config {
  /** HTTP port. */
  port: number;
  /** Public origin of this service, without a trailing slash. */
  publicOrigin: string;
  /** Supabase project URL, without a trailing slash. */
  supabaseUrl: string;
  /** Supabase anon (publishable) key. Never the service-role key. */
  supabaseAnonKey: string;
  /** HS256 secret Supabase signs user access tokens with. */
  jwtSecret: string;
  /** Optional expected `iss` claim. */
  jwtIssuer: string | undefined;
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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = parsePort(env);
  const publicOrigin = stripTrailingSlash(
    env.MCP_PUBLIC_ORIGIN?.trim() || `http://127.0.0.1:${port}`,
  );
  const supabaseUrl = stripTrailingSlash(required(env, "SUPABASE_URL"));
  const jwtIssuer = env.SUPABASE_JWT_ISSUER?.trim() || undefined;

  return {
    port,
    publicOrigin,
    supabaseUrl,
    supabaseAnonKey: required(env, "SUPABASE_ANON_KEY"),
    jwtSecret: required(env, "SUPABASE_JWT_SECRET"),
    jwtIssuer: jwtIssuer ? stripTrailingSlash(jwtIssuer) : undefined,
    logLevel: parseLogLevel(env),
  };
}
