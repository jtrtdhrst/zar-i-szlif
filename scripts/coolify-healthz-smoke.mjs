// Runtime regression for the self-hosted Coolify static image (KOMAA-1558).
//
// The config-text test in tests/coolify-healthz.test.mjs can pass while the
// shipped image still misbehaves (wrong include, wrong root, nginx drift).
// This script proves the contract over real HTTP against the built container:
//
//   node scripts/coolify-healthz-smoke.mjs http://127.0.0.1:18080
//
// It fails closed on any missing route, wrong content type, redirect drift or
// SPA-fallback regression, so the readiness probe cannot silently degrade to
// the HTML shell.

const baseUrl = (process.argv[2] || process.env.COOLIFY_SMOKE_BASE_URL || "").replace(/\/+$/, "");
if (!baseUrl) {
  console.error("[coolify-smoke] usage: node scripts/coolify-healthz-smoke.mjs <base-url>");
  process.exit(2);
}

const READY_TIMEOUT_MS = 30_000;
const SPA_MARKER = '<div id="root"></div>';
const PANEL_HOST = "https://panel.kompaszbiorek.pl";

function get(path) {
  return fetch(`${baseUrl}${path}`, {
    redirect: "manual",
    signal: AbortSignal.timeout(5_000),
  });
}

async function waitForSite() {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let lastError = "no response";
  while (Date.now() < deadline) {
    try {
      const res = await get("/");
      if (res.status === 200) return res;
      lastError = `GET / returned ${res.status}`;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`site did not become ready within ${READY_TIMEOUT_MS}ms: ${lastError}`);
}

const failures = [];
function check(name, condition, detail) {
  if (condition) {
    console.log(`[coolify-smoke] PASS ${name}`);
  } else {
    failures.push(`${name} — ${detail}`);
    console.error(`[coolify-smoke] FAIL ${name} — ${detail}`);
  }
}

const contentType = (res) => res.headers.get("content-type") ?? "";
const isPlainText = (res) => /^text\/plain\b/i.test(contentType(res));
const isHtml = (res) => /^text\/html\b/i.test(contentType(res));

try {
  const root = await waitForSite();
  const rootBody = await root.text();
  check("/ is a healthy HTML app shell", isHtml(root) && rootBody.includes(SPA_MARKER), `${root.status} ${contentType(root)}`);

  const healthz = await get("/healthz");
  const healthzBody = await healthz.text();
  check("/healthz is 200 text/plain", healthz.status === 200 && isPlainText(healthz), `${healthz.status} ${contentType(healthz)}`);
  check('/healthz body is the literal "ok\\n"', healthzBody === "ok\n", JSON.stringify(healthzBody));

  const health = await get("/health");
  const healthBody = await health.text();
  check(
    "/health stays a distinct HTML SPA fallback",
    health.status === 200 && isHtml(health) && healthBody.includes(SPA_MARKER),
    `${health.status} ${contentType(health)}`,
  );

  const extra = await get("/healthz/extra");
  const extraBody = await extra.text();
  check(
    "/healthz/extra does not match the exact readiness route",
    extra.status === 200 && isHtml(extra) && extraBody.includes(SPA_MARKER),
    `${extra.status} ${contentType(extra)}`,
  );

  const panel = await get("/panel");
  check(
    "/panel redirects to the panel host",
    panel.status === 302 && panel.headers.get("location") === `${PANEL_HOST}/panel`,
    `${panel.status} ${panel.headers.get("location")}`,
  );

  const panelUsers = await get("/panel/users");
  check(
    "/panel/users redirect preserves the original path",
    panelUsers.status === 302 && panelUsers.headers.get("location") === `${PANEL_HOST}/panel/users`,
    `${panelUsers.status} ${panelUsers.headers.get("location")}`,
  );
} catch (error) {
  failures.push(`smoke run aborted — ${error.message}`);
  console.error(`[coolify-smoke] FAIL ${error.message}`);
}

if (failures.length > 0) {
  console.error(`[coolify-smoke] FAIL (${failures.length} violation(s))`);
  process.exit(1);
}

console.log("[coolify-smoke] PASS");
