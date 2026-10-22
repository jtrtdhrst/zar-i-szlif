// KOMAA-1001: kontrakt wdrożenia MCP — tag obrazu jest WYMAGANY (fail-closed),
// oba serwery MCP startują z tego samego obrazu CI i żaden nie buduje obrazu
// lokalnie z katalogu bez remote (ten build utrzymywał manifest 18 narzędzi).
//
// Test nie uruchamia dockera: czyta plik compose i rozwiązuje zmienną obrazu
// zgodnie z semantyką `docker compose` — `${VAR:?msg}` przerywa deploy, gdy VAR
// jest nieustawiona albo pusta, zamiast wybrać wartość domyślną.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DESIGN_STACK_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const COMPOSE_PATH = join(DESIGN_STACK_ROOT, "docker-compose.mcp.yml");
const ENV_EXAMPLE_PATH = join(DESIGN_STACK_ROOT, ".env.example");

const compose = readFileSync(COMPOSE_PATH, "utf8");

/** Interpolacja wymaganej zmiennej w formacie compose: `${VAR:?msg}`. */
const REQUIRED_VAR = /\$\{([A-Z_][A-Z0-9_]*):\?([^}]*)\}/;

/** Wartość obrazu z linii `image:` — repo (bez dwukropka) i tag. */
function imageEntries(): { repo: string; tag: string }[] {
  return compose
    .split("\n")
    .filter((line) => /^\s+image:\s+\S/.test(line))
    .map((line) => {
      const value = line.trim().slice("image:".length).trim();
      const separator = value.indexOf(":");
      return { repo: value.slice(0, separator), tag: value.slice(separator + 1) };
    });
}

/** Rozwiązanie tagu jak w compose: brak zmiennej albo pusta wartość = błąd. */
function resolveRequiredTag(
  tag: string,
  env: Record<string, string | undefined>,
): string {
  const match = REQUIRED_VAR.exec(tag);
  if (!match) {
    throw new Error(`tag obrazu musi użyć wymaganej zmiennej \${VAR:?msg}, jest: ${tag}`);
  }
  const [, name, message] = match;
  const value = env[name];
  if (value === undefined || value === "") throw new Error(message);
  return value;
}

describe("docker-compose.mcp.yml — kontrakt wdrożenia", () => {
  it("każdy serwis MCP ma wymagany (fail-closed) tag obrazu", () => {
    const entries = imageEntries();
    assert.equal(entries.length, 2, "expected plasmic-mcp and opendesign-bridge-mcp");
    for (const { tag } of entries) {
      assert.ok(
        !tag.includes(":-"),
        `tag obrazu nie może mieć wartości domyślnej (pływającej), jest: ${tag}`,
      );
      assert.match(tag, REQUIRED_VAR, `tag obrazu musi być wymagany, jest: ${tag}`);
    }
  });

  it("brak lub pusta IMAGE_TAG przerywa deploy zamiast wybrać tag domyślny", () => {
    for (const { tag } of imageEntries()) {
      assert.throws(() => resolveRequiredTag(tag, {}), /IMAGE_TAG required/);
      assert.throws(() => resolveRequiredTag(tag, { IMAGE_TAG: "" }), /IMAGE_TAG required/);
      assert.equal(
        resolveRequiredTag(tag, { IMAGE_TAG: "abc123" }),
        "abc123",
      );
    }
  });

  it("oba serwery MCP startują z tego samego obrazu CI i tego samego tagu", () => {
    const [first, second] = imageEntries();
    assert.equal(first.repo, second.repo);
    assert.equal(first.repo, "ghcr.io/miloszspyrka-code/kompas-zbiorek-opendesign-mcp");
    assert.equal(
      REQUIRED_VAR.exec(first.tag)?.[1],
      REQUIRED_VAR.exec(second.tag)?.[1],
      "oba serwery muszą używać tej samej zmiennej tagu",
    );
  });

  it("żaden serwis nie buduje obrazu lokalnie", () => {
    assert.ok(
      !/^\s+build:/m.test(compose),
      "obrazu nie wolno budować z katalogu poza kontrolą wersji repo",
    );
  });

  it(".env.example nie dostarcza działającej wartości domyślnej IMAGE_TAG", () => {
    const line = readFileSync(ENV_EXAMPLE_PATH, "utf8")
      .split("\n")
      .find((row) => row.startsWith("IMAGE_TAG="));
    assert.ok(line, "IMAGE_TAG musi być w .env.example");
    assert.equal(line.trim(), "IMAGE_TAG=", "IMAGE_TAG musi być pusty (fail-closed)");
  });
});
