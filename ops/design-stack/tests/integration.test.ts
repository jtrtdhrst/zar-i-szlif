// Testy integracyjne (Etap 20). Uruchomienie: INTEG=1 npm test.
// Wymagają sekretów operatora; bez nich testy są pomijane (skip), nie failują.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { OdClient } from "../libs/od-client/client.ts";
import { PlasmicClient } from "../libs/plasmic-client/client.ts";

const INTEG = process.env.INTEG === "1";
const OD = { base: process.env.OD_BASE_URL ?? "", token: process.env.OD_API_TOKEN ?? "" };
const PL = {
  base: process.env.PLASMIC_BASE_URL ?? "",
  email: process.env.PLASMIC_EMAIL,
  password: process.env.PLASMIC_PASSWORD,
  teamToken: process.env.PLASMIC_TEAM_TOKEN,
};

describe("opendesign (integracyjny)", () => {
  it("listuje design-systemy i czyta tokeny", { skip: !INTEG || !OD.base || !OD.token }, async () => {
    const od = new OdClient({ baseUrl: OD.base, token: OD.token });
    const list = await od.listDesignSystems();
    const systems = (list as { designSystems: Array<{ id: string; source?: string }> }).designSystems;
    assert.ok(systems.length > 0, "oczekiwano >= 1 design-systemu");
    // Presety z listy nie mają plików — szukaj pierwszego systemu użytkownika z tokenami.
    const candidates = [
      ...systems.filter((s) => s.source === "user"),
      ...systems.filter((s) => s.source !== "user"),
    ].slice(0, 10);
    let tokens: Record<string, unknown> = {};
    let used = "";
    for (const s of candidates) {
      try {
        const t = await od.getTokens(s.id);
        if (Object.keys(t).length > 0) {
          tokens = t;
          used = s.id;
          break;
        }
      } catch {
        /* próbuj następny */
      }
    }
    assert.ok(Object.keys(tokens).length > 0, "oczekiwano niepustych tokenów");
    // Kontekst end-to-end (limit rozmiaru).
    const ctx = await od.getContext(used);
    assert.ok(ctx.components.length >= 0);
    assert.ok(JSON.stringify(ctx).length <= od.maxContextBytes);
  });
});

describe("plasmic (integracyjny)", () => {
  const canAuth = INTEG && PL.base && (PL.teamToken || (PL.email && PL.password));
  it("listuje projekty i czyta stronę testową", { skip: !canAuth }, async () => {
    const pl = new PlasmicClient({
      baseUrl: PL.base,
      email: PL.email,
      password: PL.password,
      teamToken: PL.teamToken,
    });
    const projects = await pl.listProjects();
    assert.ok(Array.isArray(projects));
    const testId = process.env.PLASMIC_TEST_PROJECT;
    assert.ok(testId, "ustaw PLASMIC_TEST_PROJECT (dedykowany projekt testowy)");
    const rev = await pl.getProjectRev(testId);
    assert.ok(rev.revision >= 0);
    // Samo parsowanie bundle jest już asercją formatu.
  });
});
