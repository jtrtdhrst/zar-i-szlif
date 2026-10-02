// Smoke OAuth 2.1 produkcyjnego serwera MCP na Cloudflare (KOMAA-446).
// Uruchom: node scripts/mcp-oauth-smoke.mjs [origin]
// Domyślnie sprawdza kanoniczny origin MCP_PUBLIC_ORIGIN; origin można nadpisać
// argv[2] albo MCP_SMOKE_ORIGIN (np. https://panel.kompaszbiorek.pl przed powstaniem
// domeny). Skrypt nie ma sekretów — sprawdza wyłącznie kontrakt publiczny i
// fail-closed DCR. Kod 0 = wszystkie asercje PASS, 1 = kontrakt złamany,
// 2 = brak originu (gate z czytelną instrukcją).
//
// Pokrywa kryteria 4 (dostępność), 5 (challenge 401 + WWW-Authenticate),
// 9 (Discovery MCP Inspector) oraz regresję bezpieczeństwa z 8526d682:
// redirect_uri spoza MCP_ALLOWED_REDIRECT_URIS nie może zarejestrować klienta.

const arg = process.argv[2] ?? process.env.MCP_SMOKE_ORIGIN ?? "https://mcp-kompas.kompaszbiorek.pl";
let origin;
try {
  origin = new URL(arg).origin;
} catch {
  console.error(`[mcp-oauth-smoke] ZŁY ORIGIN: ${JSON.stringify(arg)}. Oczekiwano np. https://mcp-kompas.kompaszbiorek.pl`);
  process.exit(2);
}

const results = [];
async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
  } catch (err) {
    results.push({ name, ok: false, detail: String(err?.message ?? err) });
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const asJson = async (path) => {
  const res = await fetch(origin + path);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${path} zwrocil ${res.status} bez JSON: ${text.slice(0, 120)}`);
  }
  return { status: res.status, json };
};

// Kanoniczny origin serwer reklamuje w metadanych (MCP_PUBLIC_ORIGIN) i jest
// niezależny od hosta, pod którym go odpytujemy — panel.* to ten sam worker co
// mcp-kompas.*. Klient MCP idzie za metadanymi, nie za wpisanym URL, więc
// asercje sprawdzają SPÓJNOŚĆ reklamowanego origin, a nie zgodność z argv.
let canonical = null;

await check("protected-resource metadata (RFC 9728)", async () => {
  const { status, json } = await asJson("/.well-known/oauth-protected-resource/mcp");
  assert(status === 200, `status ${status}`);
  assert(typeof json.resource === "string" && json.resource.endsWith("/mcp"), `resource=${json.resource}`);
  canonical = json.resource.slice(0, -"/mcp".length);
  assert(
    Array.isArray(json.authorization_servers) && json.authorization_servers.length === 1 && json.authorization_servers[0] === canonical,
    `authorization_servers=${JSON.stringify(json.authorization_servers)} != [${canonical}]`,
  );
  assert(
    Array.isArray(json.bearer_methods_supported) && json.bearer_methods_supported.includes("header"),
    `bearer_methods_supported=${JSON.stringify(json.bearer_methods_supported)}`,
  );
  return `resource=${json.resource} scopes=${(json.scopes_supported ?? []).join(",")} (odpytano ${origin})`;
});

await check("authorization server metadata (RFC 8414)", async () => {
  assert(canonical, "brak kanonicznego origin z metadanych zasobu");
  const { status, json } = await asJson("/.well-known/oauth-authorization-server");
  assert(status === 200, `status ${status}`);
  // Na kanonicznym originie issuer MUSI być równy resource. Na hoście
  // podglądowym (panel.*) issuer z definicji jest tym hostem, a zasób
  // reklamuje origin kanoniczny — to świadomy split-brain zachowany dla
  // istniejących klientów (docs/production-release.md), więc jest raportowany,
  // nie uznawany za złamanie kontraktu.
  const expectedIssuer = origin === canonical ? canonical : origin;
  assert(json.issuer === expectedIssuer, `issuer=${json.issuer} != ${expectedIssuer}`);
  const split = json.issuer === canonical ? "" : ` | UWAGA: podglądowy host — klient z ${origin} jest kierowany do AS ${canonical} (bez DNS do czasu utworzenia domeny)`;
  for (const [field, path] of [["authorization_endpoint", "/authorize"], ["token_endpoint", "/token"], ["registration_endpoint", "/register"]]) {
    assert(json[field] === `${json.issuer}${path}`, `${field}=${json[field]}`);
  }
  assert(json.code_challenge_methods_supported?.includes("S256"), "brak PKCE S256");
  assert(json.grant_types_supported?.includes("authorization_code"), "brak authorization_code");
  assert(json.grant_types_supported?.includes("refresh_token"), "brak refresh_token");
  return `issuer=${json.issuer} PKCE=S256 grant=authorization_code,refresh_token${split}`;
});

await check("private /mcp bez tokenu -> 401 + WWW-Authenticate", async () => {
  const res = await fetch(origin + "/mcp", { redirect: "manual" });
  assert(res.status === 401, `status ${res.status} (oczekiwano 401)`);
  const www = res.headers.get("www-authenticate") ?? "";
  assert(/^Bearer/i.test(www), `brak Bearer challenge: ${JSON.stringify(www)}`);
  const resourceMetadata = /resource_metadata="([^"]+)"/.exec(www)?.[1];
  assert(resourceMetadata, `brak resource_metadata w challenge: ${JSON.stringify(www)}`);
  const meta2 = await fetch(resourceMetadata);
  assert(meta2.status === 200, `resource_metadata ${resourceMetadata} -> ${meta2.status}`);
  return `WWW-Authenticate: Bearer realm="OAuth", resource_metadata=${resourceMetadata}`;
});

await check("DCR fail-closed: redirect_uri poza allowlist", async () => {
  const res = await fetch(origin + "/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      redirect_uris: ["https://evil.example.com/cb"],
      client_name: "mcp-oauth-smoke-negative",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  const text = await res.text();
  assert(res.status >= 400, `rejestracja hostilego redirect_uri przeszla (status ${res.status}) — MCP_ALLOWED_REDIRECT_URIS nie jest egzekwowane`);
  return `status=${res.status} ${text.slice(0, 100)}`;
});

await check("DCR loopback -> 201, resource param ścisle wiązany", async () => {
  const res = await fetch(origin + "/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      redirect_uris: ["http://127.0.0.1:9999/cb"],
      client_name: "mcp-oauth-smoke-positive",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  assert(res.status === 201, `status ${res.status} (oczekiwano 201)`);
  const client = await res.json();
  assert(client.client_id, "brak client_id w odpowiedzi DCR");

  const qs = new URLSearchParams({
    client_id: client.client_id,
    response_type: "code",
    redirect_uri: "http://127.0.0.1:9999/cb",
    code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    code_challenge_method: "S256",
    state: "smoke",
    resource: "https://smoke.invalid/mcp",
  });
  const bad = await fetch(`${origin}/authorize?${qs}`, { redirect: "manual" });
  assert(bad.status === 400, `resource param nie jest zwalidowany (status ${bad.status})`);

  qs.set("resource", `${canonical}/mcp`);
  const good = await fetch(`${origin}/authorize?${qs}`, { redirect: "manual" });
  assert(good.status === 200, `poprawny resource odrzucony (status ${good.status})`);
  return `client_id=${client.client_id} 201, resource rozny:400 reklamowany:200`;
});

// Ostatni łącznik: bindingi, których nie da się zobaczyć w metadanych.
// DCR + dialog zgody + CSRF + 302 do accounts.google.com dowodzi, że w
// produkcyjnym Workerze są realnie ustawione OAUTH_KV (lookupClient), oraz
// COOKIE_ENCRYPTION_KEY, GOOGLE_CLIENT_ID i GOOGLE_CLIENT_SECRET — inaczej
// handler zwraca stronę "nie jest jeszcze skonfigurowane" zamiast przekierowania.
// Same metadane tego NIE dowodzą, a bez tego asercji produkcja może mieć
// kompletny kontrakt OAuth 2.1 i jednocześnie martwe logowanie Google.
// Nie drukuje wartości sekretów — tylko ich obecność i redirect_uri, który
// Google musi mieć na liście "Authorized redirect URIs".
await check(" lancuch Google: OAUTH_KV + COOKIE_ENCRYPTION_KEY + GOOGLE_CLIENT_* -> 302 do IdP", async () => {
  const jar = new Map();
  const absorb = (res) => {
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(";");
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq).trim();
      if (/Max-Age=0/i.test(raw)) jar.delete(name);
      else jar.set(name, pair.slice(eq + 1).trim());
    }
  };

  const redirectUri = "http://127.0.0.1:9999/cb";
  const reg = await fetch(`${origin}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      redirect_uris: [redirectUri],
      client_name: "mcp-oauth-smoke-google-chain",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  absorb(reg);
  assert(reg.status === 201, `DCR ${reg.status} (oczekiwano 201)`);
  const client = await reg.json();
  assert(client.client_id, "brak client_id");

  const qs = new URLSearchParams({
    client_id: client.client_id,
    response_type: "code",
    redirect_uri: redirectUri,
    code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    code_challenge_method: "S256",
    state: "smoke",
    resource: `${canonical}/mcp`,
  });
  const authz = await fetch(`${origin}/authorize?${qs}`, { redirect: "manual" });
  absorb(authz);
  const html = await authz.text();
  assert(authz.status === 200, `GET /authorize ${authz.status}`);
  assert(!/nie jest jeszcze skonfigurowane/i.test(html), "brak OAUTH_KV lub COOKIE_ENCRYPTION_KEY — worker zwrócił stronę 'nie jest jeszcze skonfigurowane'");
  const csrf = /name="csrf_token" value="([^"]+)"/.exec(html)?.[1];
  const state = /name="state" value="([^"]+)"/.exec(html)?.[1];
  assert(csrf && state, "brak formularza zgody (csrf_token/state) mimo 200");

  const approve = await fetch(`${origin}/authorize`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
    },
    body: new URLSearchParams({ state, csrf_token: csrf }),
  });
  const location = approve.headers.get("location") ?? "";
  if (approve.status !== 302 || !location) {
    const body = await approve.text();
    assert(!/nie jest jeszcze skonfigurowane/i.test(body), "brak GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET — worker zwrócił stronę 'nie jest jeszcze skonfigurowane'");
  }
  assert(approve.status === 302 && location.startsWith("https://accounts.google.com/"), `brak przekierowania do Google IdP: status=${approve.status} location=${location.slice(0, 80)}`);
  const upstream = new URL(location);
  const upstreamRedirect = upstream.searchParams.get("redirect_uri") ?? "";
  assert(upstreamRedirect, "brak redirect_uri w zapytaniu do Google");
  return `OAUTH_KV+COOKIE_ENCRYPTION_KEY+GOOGLE_CLIENT_* obecne; IdP=${upstream.hostname}; Google redirect_uri=${upstreamRedirect}; client_id fingerprint=${(upstream.searchParams.get("client_id") ?? "").slice(0, 4)}...`;
});

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}\n      ${r.detail}`);
console.log(`\n[mcp-oauth-smoke] ${results.length - failed.length}/${results.length} PASS @ ${origin}`);
process.exit(failed.length ? 1 : 0);