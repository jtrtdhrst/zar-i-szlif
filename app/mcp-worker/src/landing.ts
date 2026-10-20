/** Public, credential-free onboarding pages for the dedicated product MCP host.
 * Keep this separate from /mcp, OAuth, /.well-known/* and every non-GET request.
 * This is a production-safe fallback until the separate Plasmic MCP Connect site is deployed.
 */
const style = `
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#21332c;background:#f8f8f1;font-synthesis:none}
*{box-sizing:border-box}body{margin:0}a{color:inherit}header,main,footer{max-width:1120px;margin:auto;padding-left:28px;padding-right:28px}
header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-top:26px;padding-bottom:26px}
.brand{display:flex;align-items:center;gap:12px;font-weight:750;text-decoration:none;letter-spacing:-.03em}
.symbol{display:grid;place-items:center;width:40px;height:40px;background:#d9ebd1;border-radius:13px;font-size:24px}
nav{display:flex;gap:23px;flex-wrap:wrap}nav a{text-decoration:none;color:#4b6458;font-size:14px}nav a:hover{text-decoration:underline}
.hero{display:grid;grid-template-columns:1.25fr 0.9fr;gap:54px;align-items:center;padding-top:76px;padding-bottom:65px}
.eyebrow{display:inline-flex;align-items:center;gap:8px;background:#e9f0de;color:#336342;padding:9px 14px;border-radius:999px;font-weight:650;font-size:13px}
h1{font-size:clamp(40px,5.5vw,70px);line-height:1.06;letter-spacing:-.052em;margin:25px 0 19px}
.lede{font-size:18px;line-height:1.7;color:#597065;max-width:610px}
.actions{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-top:30px}
.button{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:12px 21px;text-decoration:none;border-radius:13px;font-weight:700;font-size:14px}
.primary{background:#287449;color:white}.secondary{background:white;border:1px solid #d9e1d9;color:#325a41}
.terminal{background:#203d31;color:#f5f8f1;padding:30px;border-radius:24px;box-shadow:0 24px 70px #173d2920;overflow:hidden}
.term-top{display:flex;gap:7px;margin-bottom:32px}.dot{height:10px;width:10px;border-radius:50%;background:#6b967b}
.term-label{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#acc1b4;margin-bottom:16px}
.endpoint{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:16px;overflow-wrap:anywhere;color:#d7f6ca}
.term-note{margin-top:22px;color:#acc1b4;font-size:13px;line-height:1.6}
.section{padding-top:38px;padding-bottom:75px}h2{letter-spacing:-.035em;font-size:32px;margin:0 0 12px}
.muted{color:#5b7167;line-height:1.7}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;margin-top:28px}
.card{border:1px solid #dfe8de;background:white;border-radius:19px;padding:26px}
.num{font-weight:800;color:#287449;font-size:14px}.card h3{font-size:19px;letter-spacing:-.03em;margin:14px 0 9px}.card p{font-size:14px;line-height:1.65;color:#5e7167}
.docs{margin-bottom:70px;padding:32px;border-radius:20px;border:1px solid #dfe8de;background:#fff}
.docs code{display:block;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;padding:17px;background:#edf3ec;border-radius:10px;overflow-wrap:anywhere;font-size:14px}
.docs li{line-height:1.85;margin-bottom:12px}.docs a{color:#287449}
footer{border-top:1px solid #dfe8de;padding-top:24px;padding-bottom:34px;color:#708379;font-size:13px}
@media(max-width:760px){header{align-items:flex-start;flex-direction:column}nav{gap:17px}.hero{grid-template-columns:1fr;gap:28px;padding-top:38px}.grid{grid-template-columns:1fr}.terminal{padding:24px}h1{font-size:43px}.section{padding-bottom:42px}.docs{padding:22px}}
`;

function renderPage(origin: string, documentation: boolean): string {
  const endpoint = origin + "/mcp";
  return `<!doctype html>
<html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${documentation ? "Jak podłączyć MCP" : "Żar i Szlif MCP — połącz swojego asystenta"}</title>
<meta name="description" content="Podłącz Żar i Szlif do klienta MCP, zaloguj się bezpiecznie i korzystaj z wiedzy systemu.">
<link rel="canonical" href="${origin}${documentation ? "/docs" : "/"}"><style>${style}</style></head><body>
<header><a class="brand" href="/"><span class="symbol" aria-hidden="true">✦</span>Żar i Szlif <span style="font-weight:500;color:#658276">/ MCP</span></a>
<nav aria-label="Nawigacja"><a href="https://zariszlif.pl">O systemie</a><a href="/docs">Instrukcja MCP</a><a href="https://panel.zariszlif.pl">Panel</a></nav></header>
<main>
<section class="hero" aria-labelledby="main-heading"><div>
<span class="eyebrow">✦ Integracja przez Model Context Protocol</span>
<h1 id="main-heading">Twój asystent.<br>Twoje obozowisko.</h1>
<p class="lede">Połącz asystenta AI z wiedzą Żar i Szlif. Wyszukuj informacje o systemie i otrzymuj odpowiedzi na podstawie źródeł, do których masz dostęp.</p>
<div class="actions"><a class="button primary" href="/docs">Jak podłączyć MCP ↗</a><a class="button secondary" href="https://zariszlif.pl">Poznaj Żar i Szlif</a></div>
</div>
<div class="terminal" aria-label="Adres serwera MCP">
<div class="term-top" aria-hidden="true"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
<div class="term-label">Adres połączenia · HTTPS</div><div class="endpoint">${endpoint}</div>
<p class="term-note">To adres zdalnego serwera MCP, nie zwykła strona internetowa. Przy podłączaniu klient może poprosić o zalogowanie i zgodę na dostęp.</p>
</div></section>
<section class="section"><h2>Połączenie w trzech krokach</h2><p class="muted">Bez kopiowania haseł i bez udostępniania tokenów.</p>
<div class="grid"><article class="card"><span class="num">01 / ADRES</span><h3>Dodaj serwer MCP</h3><p>W kliencie obsługującym zdalne MCP dodaj nowe połączenie i wklej adres serwera podany wyżej.</p></article>
<article class="card"><span class="num">02 / DOSTĘP</span><h3>Zaloguj się bezpiecznie</h3><p>Jeśli klient uruchomi autoryzację OAuth, zaloguj się przez oferowaną stronę i zapoznaj z zakresem uprawnień.</p></article>
<article class="card"><span class="num">03 / WIEDZA</span><h3>Korzystaj z narzędzi</h3><p>Po połączeniu zapytaj o Żar i Szlif. Dostęp do informacji zależy od rzeczywiście przyznanych uprawnień.</p></article></div></section>
${documentation ? `<section class="docs" aria-labelledby="docs-heading"><h2 id="docs-heading">Instrukcja podłączenia</h2>
<ol><li>Otwórz ustawienia integracji lub konektorów w swoim kliencie AI (np. ChatGPT, jeśli Twoje konto obsługuje własne zdalne MCP).</li>
<li>Wybierz dodanie niestandardowego serwera MCP typu zdalnego/HTTP.</li>
<li>W polu adresu serwera podaj:</li></ol>
<code>${endpoint}</code>
<ol start="4"><li>Rozpocznij połączenie i ukończ logowanie OAuth, jeśli klient o nie poprosi.</li>
<li>Sprawdź przyznane uprawnienia i dostępność narzędzi wyszukiwania wiedzy.</li></ol>
<p class="muted">Nie wpisuj w formularzach połączenia kluczy administracyjnych ani haseł do infrastruktury. Adres <strong>/mcp</strong> obsługuje protokół, dlatego bezpośrednie otwarcie go w przeglądarce nie musi wyświetlić strony WWW. Metadane autoryzacji oraz endpointy OAuth pozostają niezależne od tej instrukcji.</p></section>` : ""}
</main><footer>© Żar i Szlif · <a href="/docs">Pomoc MCP</a> · <a href="https://panel.zariszlif.pl">Panel produktu</a></footer>
</body></html>`;
}

/** Only credential-free HTML GET routes; return null for all MCP/OAuth traffic. */
export function mcpLandingResponse(request: Request, origin: string): Response | null {
  if (request.method !== "GET") return null;
  const pathname = new URL(request.url).pathname;
  if (pathname !== "/" && pathname !== "/docs") return null;
  return new Response(renderPage(origin, pathname === "/docs"), {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
      "referrer-policy": "strict-origin-when-cross-origin",
      "x-content-type-options": "nosniff",
    },
  });
}
