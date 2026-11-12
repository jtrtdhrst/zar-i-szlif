// Process entry point. Fails closed on missing configuration: the service never
// starts without a Supabase URL, anon key and JWT secret.

import { ConfigError, loadConfig } from "./config.ts";
import { createLogger, type Logger } from "./logger.ts";
import { createAuthenticator } from "./auth.ts";
import { createSprawnoscRepository } from "./supabase.ts";
import { createApp } from "./http.ts";

function start(): void {
  const config = (() => {
    try {
      return loadConfig();
    } catch (error) {
      const message = error instanceof ConfigError ? error.message : "invalid configuration";
      console.error(`[fatal] ${message}`);
      process.exit(1);
    }
  })();

  const logger: Logger = createLogger(config.logLevel);
  if (!process.env.MCP_PUBLIC_ORIGIN) {
    logger.warn("MCP_PUBLIC_ORIGIN is unset; using a loopback default that is wrong in production", {
      fallback: config.publicOrigin,
    });
  }

  const repository = createSprawnoscRepository({
    config: { url: config.supabaseUrl, anonKey: config.supabaseAnonKey },
  });
  const authenticate = createAuthenticator({
    secret: config.jwtSecret,
    issuer: config.jwtIssuer,
  });
  const app = createApp({ config, logger, authenticate, repository });

  app.listen(config.port, () => {
    logger.info("product host mcp listening", { port: config.port, origin: config.publicOrigin });
  });

  const shutdown = (signal: string) => {
    logger.info("shutting down", { signal });
    app.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

start();
