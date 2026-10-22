// Testy integracyjne (Etap 20). Uruchomienie: INTEG=1 npm test.
// Wymagają sekretów operatora; bez nich testy są pomijane (skip), nie failują.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PlasmicClient } from "../libs/plasmic-client/client.ts";

const INTEG = process.env.INTEG === "1";
const PL = {
  base: process.env.PLASMIC_BASE_URL ?? "",
  email: process.env.PLASMIC_EMAIL,
  password: process.env.PLASMIC_PASSWORD,
  teamToken: process.env.PLASMIC_TEAM_TOKEN,
};

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
