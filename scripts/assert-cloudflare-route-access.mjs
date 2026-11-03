// Zone-routes access guard for the production Worker release (KOMAA-466).
//
// production-preflight proves that CLOUDFLARE_API_TOKEN exists and that the
// account is reachable (`wrangler whoami`). Neither proves the zone-scoped
// Workers Routes permission the deploy actually needs: wrangler lists
// /zones/{zone}/workers/routes before publishing any trigger, so a token
// without that scope fails there *after* the worker script was already
// uploaded. Assert the read up front so a scope regression fails closed before
// any production mutation.

const API = "https://api.cloudflare.com/client/v4";

function authHeaders(token) {
  return { Authorization: `Bearer ${token}`, Accept: "application/json" };
}

/**
 * Returns a list of violations; empty means the token can list worker routes
 * for the production zone.
 */
export async function collectRouteAccessViolations({
  fetchImpl = fetch,
  accountId,
  token,
  zoneName,
}) {
  const missing = [];
  if (!accountId) missing.push("Missing CLOUDFLARE_ACCOUNT_ID");
  if (!token) missing.push("Missing CLOUDFLARE_API_TOKEN");
  if (!zoneName) missing.push("Missing CLOUDFLARE_ZONE_NAME");
  if (missing.length) return missing;

  const headers = authHeaders(token);

  const zones = await fetchImpl(
    `${API}/zones?name=${encodeURIComponent(zoneName)}&account.id=${encodeURIComponent(accountId)}`,
    { headers },
  ).then((r) => r.json());

  const zone = zones?.result?.[0];
  if (!zone) {
    return [`Zone "${zoneName}" is not visible in account ${accountId}.`];
  }

  const routes = await fetchImpl(`${API}/zones/${zone.id}/workers/routes`, { headers }).then((r) =>
    r.json(),
  );

  if (!routes?.success) {
    return [
      `Token cannot read Workers Routes for zone ${zone.id} (${zoneName}): ` +
        `${routes?.errors?.[0]?.message ?? "unknown error"}. ` +
        `Grant Zone > Workers Routes > Read and Write on this zone.`,
    ];
  }

  return [];
}

async function main() {
  const violations = await collectRouteAccessViolations({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    token: process.env.CLOUDFLARE_API_TOKEN,
    zoneName: process.env.CLOUDFLARE_ZONE_NAME,
  });

  if (!violations.length) {
    console.log(`OK: token can read Workers Routes for ${process.env.CLOUDFLARE_ZONE_NAME}.`);
    return;
  }

  for (const violation of violations) {
    console.log(`::error::${violation}`);
  }
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}