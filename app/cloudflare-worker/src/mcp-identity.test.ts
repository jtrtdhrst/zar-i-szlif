// Guardy tożsamości i scope dla produkcyjnego MCP na Workеrze (KOMAA-446).
//
// Jeden plik, jeden powód: `identity.ts` jest JEDYNYM miejscem, w którym powstaje
// `userId` retrievalu, a `canonicalOrigin` jedynym miejscem, w którym powstaje
// identyfikator zasobu OAuth. Oba są fail-closed, więc negatywy są tu obowiązkowe
// (baseline bezpieczeństwa: brak sub / zły kształt / object-key allowlisty).

import { describe, it, expect } from "vitest";
import { canonicalUserId, canonicalWorkspaceIds, resolveCanonicalScope } from "./identity";
import { canonicalOrigin } from "./mcp";
import { parseDocumentHandle, documentHandle } from "../../plugin/knowledge/mcp-tools";
import { ALLOWED_SOURCES, assertAllowedSource } from "../../plugin/knowledge/pipeline";

describe("identity — fail-closed bez zweryfikowanego subjectu Google", () => {
  it("opiera się na stabilnym sub, nigdy na email", () => {
    expect(canonicalUserId({ googleSub: "1234567890", email: "a@b.pl" })).toBe("1234567890");
  });

  it("ten sam sub z innym emailem to ten sam scope (brak klucza opartego na email)", () => {
    const a = canonicalUserId({ googleSub: "sub-1", email: "a@b.pl" });
    const b = canonicalUserId({ googleSub: "sub-1", email: "imiennie.inny@b.pl" });
    expect(a).toBe(b);
  });

  it("GOŁY sub, bo tak indexed payload.user_id i tak go porównuje buildAuthFilter", () => {
    expect(canonicalUserId({ googleSub: "sub-1" })).not.toContain(":");
  });

  it("rzuca zamiast pustego scope: brak grantu / brak sub / zły typ / biały / niezweryfikowany email", () => {
    for (const grant of [
      null,
      undefined,
      {},
      { googleSub: "" },
      { googleSub: "   " },
      { googleSub: 42 },
      { googleSub: { sub: "x" } },
      { email: "a@b.pl", emailVerified: true },
    ]) {
      expect(() => canonicalUserId(grant)).toThrow(/fail-closed/);
    }
  });
});

describe("identity — workspace scope z grantu serwerowego", () => {
  it("przepuszcza tylko niepuste stringi i deduplikuje", () => {
    const granted = canonicalWorkspaceIds({
      workspaceIds: ["ws-1", "ws-1", "  ws-2  ", "constructor", "__proto__", 7, null, { id: "ws-3" }, "", "   "],
    });
    expect(granted).toEqual(["ws-1", "ws-2", "constructor", "__proto__"]);
  });

  it("resolveCanonicalScope nigdy nie przyjmuje scope z wejścia klienta", () => {
    const scope = resolveCanonicalScope({ googleSub: "sub-1", workspaceIds: ["ws-1"] });
    expect(scope).toEqual({ googleSub: "sub-1", workspaceIds: ["ws-1"] });
    expect(resolveCanonicalScope({ googleSub: "sub-1" }).workspaceIds).toEqual([]);
    expect(() => resolveCanonicalScope({})).toThrow();
  });
});

describe("canonicalOrigin — identyfikator zasobu OAuth 2.1", () => {
  it("akceptuje czysty origin https i obcina trailing slash", () => {
    expect(canonicalOrigin({ MCP_PUBLIC_ORIGIN: "https://mcp.kompaszbiorek.pl/" })).toBe("https://mcp.kompaszbiorek.pl");
  });

  it("odrzuca konfigurację, która rozsadziłaby `resource` w metadanych", () => {
    for (const origin of [
      undefined,
      "",
      "   ",
      "mcp.kompaszbiorek.pl",
      "http://mcp.kompaszbiorek.pl",
      "https://mcp.kompaszbiorek.pl/mcp",
      "https://mcp.kompaszbiorek.pl/?x=1",
      "https://u:p@mcp.kompaszbiorek.pl",
    ]) {
      expect(() => canonicalOrigin({ MCP_PUBLIC_ORIGIN: origin })).toThrow(/MCP_PUBLIC_ORIGIN/);
    }
  });
});

describe("uchwyt dokumentu — allowlista źródeł, nie allowlista z klienta", () => {
  it("parsuje poprawny uchwyt i składa go w ten sam handle", () => {
    expect(parseDocumentHandle("help-page/doc-1")).toEqual({ source_id: "help-page", document_id: "doc-1" });
    expect(documentHandle("help-page", "doc-1")).toBe("help-page/doc-1");
  });

  it("allowlista źródeł nie ma prototypu: klucze obiektowe nie są źródłami", () => {
    expect(Object.getPrototypeOf(ALLOWED_SOURCES)).toBe(null);
    expect(Object.keys(ALLOWED_SOURCES)).toEqual(expect.arrayContaining(["help-page", "legal"]));
    for (const key of ["__proto__", "constructor", "toString", "valueOf", "hasOwnProperty"]) {
      expect(ALLOWED_SOURCES[key]).toBeUndefined();
      expect(() => assertAllowedSource(key)).toThrow(/not allowed/);
    }
  });

  it("odrzuca object-keyi, źródła spoza allowlisty i uchywy bez separatora", () => {
    for (const id of [
      "__proto__/x",
      "constructor/x",
      "toString/x",
      "valueOf/x",
      "hasOwnProperty/x",
      "nieistniejace-src/doc-1",
      "doc-1",
      "/doc-1",
      "help-page/",
      "",
      "   ",
      null,
      42,
      { id: "help-page/doc-1" },
      `help-page/${"x".repeat(300)}`,
    ]) {
      expect(() => parseDocumentHandle(id)).toThrow();
    }
  });
});
