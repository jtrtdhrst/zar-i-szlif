// Guardy tożsamości i scope dla produkcyjnego MCP na Workеrze (KOMAA-446).
//
// Jeden plik, jeden powód: `identity.ts` jest JEDYNYM miejscem, w którym powstaje
// `userId` retrievalu, a `canonicalOrigin` jedynym miejscem, w którym powstaje
// identyfikator zasobu OAuth. Oba są fail-closed, więc negatywy są tu obowiązkowe
// (baseline bezpieczeństwa: brak sub / zły kształt / object-key allowlisty).

import { describe, it, expect } from "vitest";
import { canonicalUserId, canonicalWorkspaceIds, resolveCanonicalScope } from "./identity";
import { canonicalOrigin } from "./mcp";
import { dcrRedirectUriError, parseAllowedRedirectUris } from "./dcr";
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

// DCR (RFC 7591) na produkcyjnym authorization serverze: bez allowlisty
// `redirect_uri` atakujący rejestruje klienta ze swoim redirect_uri i przejmuje
// kod autoryzacji. Potwierdzone na produkcji przed fixem (evil.example.com -> 201).
describe("dcr — allowlist redirect_uri jest fail-closed", () => {
  const ALLOWLIST =
    "https://chatgpt.com/connector/oauth/,https://chatgpt.com/connector_platform_oauth_redirect";

  it("dopuszcza callback ChatGPT: prefiks /connector/oauth/{callback_id} i legacy stabilny redirect", () => {
    expect(dcrRedirectUriError(["https://chatgpt.com/connector/oauth/abc123"], ALLOWLIST)).toBeNull();
    expect(dcrRedirectUriError(["https://chatgpt.com/connector_platform_oauth_redirect"], ALLOWLIST)).toBeNull();
  });

  it("dopuszcza wszystkie redirect_uris w jednej rejestracji, gdy każdy jest na allowliście", () => {
    expect(
      dcrRedirectUriError(
        ["https://chatgpt.com/connector/oauth/abc", "https://chatgpt.com/connector_platform_oauth_redirect"],
        ALLOWLIST,
      ),
    ).toBeNull();
  });

  it("odrzuca obcy host — dokładnie reprodukcja findingsu z produkcji", () => {
    expect(dcrRedirectUriError(["https://evil.example.com/cb"], ALLOWLIST)).toMatch(/not on the server allowlist/);
  });

  it("origin porównywany jest dokladnie: podszycie na chatgpt.com NIE przechodzi", () => {
    for (const spoof of [
      "https://chatgpt.com.evil.example/connector/oauth/abc",
      "https://evil.example/https://chatgpt.com/connector/oauth/",
      "https://notchatgpt.com/connector/oauth/abc",
      "https://chatgpt.com:8443/connector/oauth/abc",
      "http://chatgpt.com/connector/oauth/abc",
    ]) {
      expect(dcrRedirectUriError([spoof], ALLOWLIST), spoof).toMatch(/allowlist|must be https/);
    }
  });

  it("wpis bez ukośnika to exact match sciezki, wiec podobna nazwa nie przechodzi", () => {
    expect(dcrRedirectUriError(["https://chatgpt.com/connector_platform_oauth_redirect_extra"], ALLOWLIST)).toMatch(
      /allowlist/,
    );
  });

  it("pusta/nieustawiona allowlist przepuszcza wylacznie loopback (fail-closed)", () => {
    expect(dcrRedirectUriError(["https://chatgpt.com/connector/oauth/abc"], "")).toMatch(/allowlist/);
    expect(dcrRedirectUriError(["http://localhost:6274/oauth/callback"], "")).toBeNull();
    expect(dcrRedirectUriError(["http://127.0.0.1:6274/oauth/callback"], "")).toBeNull();
  });

  it("MCP Inspector (loopback) dziala na http; https loopback NIE jest automatycznie dopuszczone", () => {
    expect(dcrRedirectUriError(["http://localhost:6274/oauth/callback"], ALLOWLIST)).toBeNull();
    // Świadomie nie udzielamy loopback przywileju na https — trzeba go
    // wypisać wprost w MCP_ALLOWED_REDIRECT_URIS.
    expect(dcrRedirectUriError(["https://localhost:6274/oauth/callback"], ALLOWLIST)).toMatch(/allowlist/);
    expect(
      dcrRedirectUriError(["https://localhost:6274/oauth/callback"], "https://localhost:6274/oauth/callback"),
    ).toBeNull();
  });

  it("non-loopback http odrzucone (nie https, nie loopback)", () => {
    for (const uri of ["http://evil.example.com/cb", "http://127.0.0.1.evil.example/cb", "ftp://chatgpt.com/x"]) {
      expect(dcrRedirectUriError([uri], ALLOWLIST), uri).toMatch(/allowlist|must be https/);
    }
  });

  it("zly ksztalt redirect_uris odrzucony zamiast przejsc jako pusty", () => {
    for (const bad of [undefined, null, [], "", "https://chatgpt.com/connector/oauth/a", [42], [null], [{}]]) {
      expect(dcrRedirectUriError(bad, ALLOWLIST), JSON.stringify(bad)).toBeTruthy();
    }
  });

  it("wzgledny URL i smieci w allowliscie niczego nie rozszerzaja", () => {
    const dirty = "not-a-url, /relative, ,https://chatgpt.com/connector/oauth/";
    expect(dcrRedirectUriError(["https://chatgpt.com/connector/oauth/a"], dirty)).toBeNull();
    expect(dcrRedirectUriError(["https://evil.example.com/cb"], dirty)).toMatch(/allowlist/);
    expect(parseAllowedRedirectUris(dirty)).toEqual(["https://chatgpt.com/connector/oauth/"]);
  });

  it("komunikat odmowy wskazuje nazwe zmiennej, zeby operator wiedzial gdzie dodac hosta", () => {
    expect(dcrRedirectUriError(["https://evil.example.com/cb"], ALLOWLIST)).toMatch(/MCP_ALLOWED_REDIRECT_URIS/);
  });
});
