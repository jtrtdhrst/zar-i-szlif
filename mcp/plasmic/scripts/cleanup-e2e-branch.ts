import { PlasmicClient } from "@design-stack/plasmic-client";

const projectId = process.env.PLASMIC_E2E_PROJECT_ID;
const branchId = process.argv[2];

if (process.env.PLASMIC_ALLOW_E2E_BRANCH_DELETE !== "true" || !projectId || !branchId) {
  throw new Error("Set PLASMIC_ALLOW_E2E_BRANCH_DELETE=true, PLASMIC_E2E_PROJECT_ID, and pass a branch id");
}

const client = new PlasmicClient({
  baseUrl: process.env.PLASMIC_BASE_URL ??
    `http://${process.env.PLASMIC_HOST ?? "plasmic-wab"}:${process.env.PLASMIC_PORT ?? "3004"}`,
  email: process.env.PLASMIC_EMAIL,
  password: process.env.PLASMIC_PASSWORD,
  teamToken: process.env.PLASMIC_TEAM_TOKEN,
});
const { branches } = await client.listBranches(projectId);
const target = branches.find((branch) => branch.id === branchId);
if (!target || !target.name.startsWith("mcp-e2e-")) {
  throw new Error("Refusing cleanup: branch must exist and have the mcp-e2e- prefix");
}
await client.deleteBranch(projectId, branchId);
console.log(`Deleted and verified disposable branch ${target.name} (${branchId})`);
