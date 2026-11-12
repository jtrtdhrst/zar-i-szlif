import test from "node:test";
import assert from "node:assert/strict";
import { ConfigError, loadConfig } from "../src/config.ts";

const baseEnv: NodeJS.ProcessEnv = {
  SUPABASE_URL: "http://api-gw-r2gnunvpkqwmuew1tupbf7lx:8000",
  SUPABASE_ANON_KEY: "anon-key-for-tests",
  SUPABASE_JWT_SECRET: "jwt-secret-for-tests",
};

test("local runs may fall back to SUPABASE_URL for the advertised auth server", () => {
  const config = loadConfig({ ...baseEnv });
  assert.equal(config.supabaseUrl, "http://api-gw-r2gnunvpkqwmuew1tupbf7lx:8000");
  assert.equal(config.supabasePublicUrl, config.supabaseUrl);
  assert.equal(config.supabasePublicUrlSource, "fallback");
});

test("SUPABASE_PUBLIC_URL separates the client-visible origin from the server URL", () => {
  const config = loadConfig({
    ...baseEnv,
    SUPABASE_PUBLIC_URL: "https://supabase-staging.51.89.174.58.sslip.io/",
  });
  assert.equal(config.supabaseUrl, "http://api-gw-r2gnunvpkqwmuew1tupbf7lx:8000");
  assert.equal(config.supabasePublicUrl, "https://supabase-staging.51.89.174.58.sslip.io");
  assert.equal(config.supabasePublicUrlSource, "explicit");
});

test("API_EXTERNAL_URL is honoured for self-hosted Supabase stacks", () => {
  const config = loadConfig({ ...baseEnv, API_EXTERNAL_URL: "https://api.example.test/" });
  assert.equal(config.supabasePublicUrl, "https://api.example.test");
  assert.equal(config.supabasePublicUrlSource, "explicit");
});

test("SUPABASE_PUBLIC_URL wins over API_EXTERNAL_URL", () => {
  const config = loadConfig({
    ...baseEnv,
    SUPABASE_PUBLIC_URL: "https://public.example.test",
    API_EXTERNAL_URL: "https://gateway.example.test",
  });
  assert.equal(config.supabasePublicUrl, "https://public.example.test");
});

test("production refuses to start without a client-visible Supabase origin", () => {
  assert.throws(
    () => loadConfig({ ...baseEnv, NODE_ENV: "production" }),
    (error: unknown) =>
      error instanceof ConfigError && /SUPABASE_PUBLIC_URL|API_EXTERNAL_URL/.test(error.message),
  );
  const config = loadConfig({
    ...baseEnv,
    NODE_ENV: "production",
    SUPABASE_PUBLIC_URL: "https://supabase.example.test",
  });
  assert.equal(config.supabasePublicUrlSource, "explicit");
});

test("malformed origins are rejected instead of advertised", () => {
  assert.throws(
    () => loadConfig({ ...baseEnv, SUPABASE_PUBLIC_URL: "api-gw:8000" }),
    (error: unknown) => error instanceof ConfigError,
  );
  assert.throws(
    () => loadConfig({ ...baseEnv, SUPABASE_URL: "not a url" }),
    (error: unknown) => error instanceof ConfigError && /SUPABASE_URL/.test(error.message),
  );
});

test("required secrets fail closed", () => {
  for (const key of ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_JWT_SECRET"]) {
    const env: NodeJS.ProcessEnv = { ...baseEnv };
    delete env[key];
    assert.throws(
      () => loadConfig(env),
      (error: unknown) => error instanceof ConfigError && error.message.includes(key),
      key,
    );
  }
});

test("defaults are loopback-only and documented", () => {
  const config = loadConfig({ ...baseEnv });
  assert.equal(config.port, 8080);
  assert.equal(config.publicOrigin, "http://127.0.0.1:8080");
  assert.equal(config.logLevel, "info");
  assert.equal(config.jwtIssuer, undefined);
});
