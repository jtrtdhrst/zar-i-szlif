const POLITYKA_URL = "https://polityka.xn--prywatnoci-c8b.kompaszbiorek.pl/";
const WARUNKI_URL = "https://warunki.korzystania.kompaszbiorek.pl/";
const HOME_URL = "https://kompaszbiorek.pl/";

const PAGE = `<!doctype html>
<html lang="pl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="theme-color" content="#162313">
  <title>Warunki korzystania — Kompas Zbiórek</title>
  <meta name="application-name" content="Kompas Zbiórek">
  <meta name="description" content="Warunki korzystania z aplikacji Kompas Zbiórek, w tym zasady użycia ChatGPT, Google OAuth, Google Picker i Dokumentów Google.">
  <meta name="robots" content="index,follow,max-image-preview:large">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Kompas Zbiórek">
  <meta property="og:title" content="Warunki korzystania — Kompas Zbiórek">
  <meta property="og:description" content="Warunki korzystania z aplikacji Kompas Zbiórek, w tym zasady użycia ChatGPT, Google OAuth, Google Picker i Dokumentów Google.">
  <meta property="og:url" content="${WARUNKI_URL}">
  <link rel="canonical" href="${WARUNKI_URL}">
  <link rel="icon" href="/logo.png" type="image/png">
  <link rel="apple-touch-icon" href="/logo.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans:ital,wght@0,400;0,600;0,700;0,800;0,900;1,400&family=Noto+Sans+Display:wght@700;800;900&display=swap" rel="stylesheet">
  <style>
    :root {
      color-scheme: light;
      --forest-950:#162313;
      --forest-900:#1d2d19;
      --forest-800:#2a3d24;
      --paper:#f5f0df;
      --paper-2:#ece5d1;
      --ink:#20301e;
      --muted:#485347;
      --red:#be302a;
      --red-dark:#93221e;
      --gold:#d6ad2f;
      --gold-soft:#e4c557;
      --black:#070907;
      --white:#ffffff;
      --line:rgba(32,48,30,.18);
      --line-strong:rgba(32,48,30,.34);
      --shell:1280px;
    }
    * { box-sizing:border-box; }
    html { scroll-behavior:smooth; }
    body {
      margin:0;
      min-height:100vh;
      color:var(--ink);
      background:var(--paper);
      font-family:"Noto Sans",Arial,sans-serif;
      font-size:16px;
      line-height:24px;
    }
    h1,h2,h3,.brand-name,.eyebrow {
      font-family:"Noto Sans Display","Noto Sans",Arial,sans-serif;
    }
    a { color:inherit; text-underline-offset:3px; }
    a:focus-visible { outline:3px solid rgba(214,173,47,.36); outline-offset:3px; }
    .shell {
      width:min(var(--shell),calc(100% - 64px));
      margin-inline:auto;
    }
    .site-header {
      position:sticky;
      top:0;
      z-index:100;
      background:var(--forest-950);
      color:var(--white);
      border-bottom:1px solid rgba(214,173,47,.12);
    }
    .header-inner {
      height:72px;
      display:grid;
      grid-template-columns:max-content minmax(0,1fr);
      align-items:center;
      gap:24px;
    }
    .brand {
      display:inline-flex;
      align-items:center;
      gap:12px;
      min-width:230px;
      color:inherit;
      text-decoration:none;
    }
    .brand-logo {
      width:42px;
      height:42px;
      flex:0 0 42px;
      object-fit:contain;
      display:block;
    }
    .brand-lockup { display:grid; gap:1px; align-content:center; }
    .brand-kicker {
      color:var(--gold-soft);
      font-size:10px;
      line-height:12px;
      font-weight:850;
      letter-spacing:.14em;
      text-transform:uppercase;
    }
    .brand-name {
      color:var(--white);
      font-size:17px;
      line-height:20px;
      font-weight:900;
      letter-spacing:-.02em;
    }
    .header-route {
      justify-self:end;
      width:min(320px,100%);
      height:1px;
      position:relative;
      background:rgba(214,173,47,.28);
    }
    .header-route::before,
    .header-route::after {
      content:"";
      position:absolute;
      top:50%;
      width:7px;
      height:7px;
      border-radius:50%;
      background:var(--gold);
      transform:translateY(-50%);
    }
    .header-route::before { left:26%; }
    .header-route::after { right:18%; }
    .document { padding:56px 0 76px; }
    .document-inner { width:min(900px,100%); }
    .eyebrow {
      margin:0 0 12px;
      color:var(--red);
      font-size:13px;
      font-weight:900;
      letter-spacing:.14em;
      text-transform:uppercase;
    }
    .document-head { max-width:900px; margin-bottom:36px; }
    .document-head h1 {
      margin:0;
      color:var(--forest-950);
      font-size:clamp(36px,6vw,56px);
      line-height:1.04;
      letter-spacing:-.02em;
      font-weight:900;
    }
    .document-head .intro {
      max-width:780px;
      margin:16px 0 0;
      color:var(--muted);
      font-size:18px;
      line-height:28px;
    }
    .meta-row {
      display:flex;
      flex-wrap:wrap;
      gap:10px 24px;
      margin-top:18px;
      color:var(--muted);
      font-size:14px;
      font-weight:700;
    }
    .toc {
      max-width:900px;
      padding:22px 24px;
      border:1px solid var(--line);
      border-left:4px solid var(--gold);
      border-radius:6px;
      background:var(--paper-2);
    }
    .toc strong {
      display:block;
      margin-bottom:8px;
      color:var(--forest-900);
      font-family:"Noto Sans Display","Noto Sans",Arial,sans-serif;
      font-size:15px;
      letter-spacing:.02em;
    }
    .toc ol { margin:0; padding-left:20px; columns:2; column-gap:36px; }
    .toc li { margin:4px 0; color:var(--ink); }
    article { max-width:900px; }
    article h2 {
      margin:44px 0 14px;
      color:var(--forest-950);
      font-size:26px;
      line-height:1.15;
      letter-spacing:-.01em;
      font-weight:900;
    }
    article h2::before {
      content:"";
      display:inline-block;
      width:14px;
      height:14px;
      margin-right:10px;
      background:var(--gold);
      clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%);
    }
    article p, article li { color:var(--muted); font-size:16px; line-height:26px; }
    article strong { color:var(--ink); }
    article code {
      overflow-wrap:anywhere;
      color:var(--red-dark);
      font-size:14px;
      background:rgba(190,48,42,.08);
      padding:2px 6px;
      border-radius:4px;
    }
    .site-footer {
      background:var(--forest-950);
      color:var(--white);
      border-top:1px solid rgba(214,173,47,.12);
      font-size:14px;
    }
    .footer-inner {
      display:flex;
      justify-content:space-between;
      align-items:center;
      gap:24px;
      flex-wrap:wrap;
      padding:24px 0;
    }
    .footer-brand {
      display:inline-flex;
      align-items:center;
      gap:12px;
      color:inherit;
      text-decoration:none;
    }
    .footer-brand .brand-logo { width:36px; height:36px; flex-basis:36px; }
    .footer-brand .brand-name { font-size:15px; }
    .footer-links { display:flex; flex-wrap:wrap; gap:18px; }
    .footer-links a { text-decoration:none; color:rgba(245,240,223,.78); font-weight:700; }
    .footer-links a:hover { color:var(--gold-soft); }
    .footer-bottom {
      padding:14px 0 22px;
      border-top:1px solid rgba(214,173,47,.12);
      color:rgba(245,240,223,.55);
      font-size:13px;
    }
    .skip-link {
      position:absolute;
      left:-9999px;
      top:8px;
      padding:10px 14px;
      background:var(--gold);
      color:var(--forest-950);
      font-weight:800;
      z-index:10;
      border-radius:6px;
    }
    .skip-link:focus { left:8px; }
    @media (max-width:1199px) {
      .shell { width:min(1104px,calc(100% - 40px)); }
    }
    @media (max-width:959px) {
      .shell { width:calc(100% - 32px); }
      .header-route { display:none; }
      .header-inner { grid-template-columns:1fr auto; }
    }
    @media (max-width:599px) {
      .shell { width:calc(100% - 24px); }
      .header-inner { height:64px; }
      .brand { min-width:0; }
      .brand-logo { width:38px; height:38px; flex-basis:38px; }
      .brand-kicker { display:none; }
      .toc ol { columns:1; }
      .footer-inner, .footer-links { flex-direction:column; gap:10px; align-items:flex-start; }
      .document { padding:40px 0 56px; }
      .document-head h1 { font-size:34px; }
    }
  </style>
</head>
<body>
<a class="skip-link" href="#main">Przejdź do treści</a>
<header class="site-header">
  <div class="shell header-inner">
    <a class="brand" href="${HOME_URL}" aria-label="Kompas Zbiórek — strona główna">
      <img class="brand-logo" src="/logo.png" alt="" width="42" height="42" aria-hidden="true">
      <span class="brand-lockup">
        <span class="brand-kicker">KOMPAS ZBIÓREK</span>
        <span class="brand-name">Warunki korzystania</span>
      </span>
    </a>
    <div class="header-route" aria-hidden="true"></div>
  </div>
</header>
<main class="document" id="main">
<div class="shell document-inner">
<header class="document-head">
  <p class="eyebrow">DOKUMENT PRAWNY APLIKACJI</p>
  <h1>Warunki korzystania — Kompas Zbiórek</h1>
  <p class="intro">Warunki określają zasady korzystania z aplikacji Kompas Zbiórek, w tym funkcji opartych na ChatGPT, Google OAuth, Google Picker i Dokumentach Google.</p>
  <div class="meta-row"><span>Data wejścia w życie: 30 lipca 2026 r.</span><span>Ostatnia aktualizacja: 11 sierpnia 2026 r.</span></div>
</header>
<nav class="toc" aria-label="Spis treści"><strong>Spis treści</strong><ol>
<li><a href="#operator">Operator</a></li><li><a href="#purpose">Przeznaczenie</a></li><li><a href="#requirements">Wymagania</a></li><li><a href="#oauth">Google OAuth</a></li><li><a href="#user">Obowiązki użytkownika</a></li><li><a href="#ai">Treści AI</a></li><li><a href="#documents">Dokumenty i Google Picker</a></li><li><a href="#availability">Dostępność</a></li><li><a href="#prohibited">Niedozwolone użycie</a></li><li><a href="#liability">Odpowiedzialność</a></li><li><a href="#termination">Zakończenie</a></li><li><a href="#changes">Zmiany</a></li>
</ol></nav>
<article>
<h2 id="operator">1. Operator aplikacji</h2>
<p>Operatorem aplikacji <strong>Kompas Zbiórek</strong> jest Miłosz Spyrka. Kontakt: <a href="mailto:milosz.spyrka@gmail.com">milosz.spyrka@gmail.com</a>.</p>

<h2 id="purpose">2. Przeznaczenie aplikacji</h2>
<p>Kompas Zbiórek jest aplikacją działającą w ChatGPT dla instruktorów Royal Rangers. Pomaga analizować sytuacje w drużynie, przygotowywać plany zbiórek, eksperymenty i podsumowania oraz, po wyraźnym poleceniu użytkownika, tworzyć lub aktualizować treść w Dokumentach Google.</p>
<p>Aplikacja działa jako integracja z ChatGPT wykorzystująca serwer MCP.</p>
<p>Opis funkcjonalności aplikacji znajduje się na stronie <a href="https://kompaszbiorek.pl/">https://kompaszbiorek.pl/</a>.</p>

<h2 id="requirements">3. Wymagania korzystania</h2>
<p>Do korzystania z części funkcji Kompasu Zbiórek mogą być wymagane:</p>
<ul><li>konto ChatGPT,</li><li>konto Google,</li><li>zalogowanie przez Google OAuth,</li><li>udzielenie wymaganych uprawnień OAuth,</li><li>odpowiednie uprawnienia do konkretnego Dokumentu Google,</li><li>świadomy wybór dokumentu za pomocą Google Picker, jeżeli dana funkcja tego wymaga.</li></ul>

<h2 id="oauth">4. Google OAuth i zakres dostępu</h2>
<p>Kompas Zbiórek wykorzystuje Google OAuth i OpenID Connect do logowania użytkownika i identyfikacji jego konta.</p>
<p>W tym celu aplikacja może korzystać z zakresów:</p>
<ul>
<li><code>openid</code>,</li>
<li><code>email</code>,</li>
<li><code>profile</code>.</li>
</ul>
<p>Do obsługi Dokumentów Google aplikacja używa zakresu:</p>
<p><code>https://www.googleapis.com/auth/drive.file</code></p>
<p>Zakres <code>drive.file</code> umożliwia aplikacji pracę z konkretnymi plikami utworzonymi przez aplikację lub świadomie wybranymi przez użytkownika do użycia z Kompasem Zbiórek.</p>
<p>Zakres ten nie daje aplikacji ogólnego dostępu do całej zawartości Dysku Google.</p>
<p>Połączenie konta Google jest dobrowolne. Operacje dotyczące Dokumentów Google są wykonywane zgodnie z zakresem przyznanych uprawnień i funkcją uruchomioną przez użytkownika.</p>

<h2 id="user">5. Obowiązki użytkownika</h2>
<p>Użytkownik zobowiązuje się:</p>
<ul>
<li>korzystać z aplikacji zgodnie z prawem i niniejszymi warunkami,</li>
<li>przekazywać do aplikacji wyłącznie treści i dokumenty, do których ma odpowiednie prawa,</li>
<li>sprawdzić wygenerowaną treść przed jej wykorzystaniem,</li>
<li>chronić bezpieczeństwo własnych kont Google i ChatGPT,</li>
<li>nie podejmować prób obejścia zabezpieczeń aplikacji, Google ani OpenAI.</li>
</ul>

<h2 id="ai">6. Charakter treści generowanych przez AI</h2>
<p>Treści generowane przez aplikację mogą zawierać błędy, nieścisłości lub niepełne informacje.</p>
<p>Użytkownik powinien je zweryfikować przed publikacją, wdrożeniem lub wykorzystaniem, szczególnie gdy dotyczą dzieci, bezpieczeństwa uczestników, zdrowia, prawa lub decyzji organizacyjnych.</p>

<h2 id="documents">7. Dokumenty użytkownika i Google Picker</h2>
<p>W funkcjach wymagających wskazania dokumentu Kompas Zbiórek może korzystać z Google Picker.</p>
<p>W zależności od wybranej funkcji użytkownik może:</p>
<ul>
<li>wskazać udostępniony przez Kompas Zbiórek dokument lub szablon,</li>
<li>wybrać własny Dokument Google ze swojego Dysku Google.</li>
</ul>
<p>Wybór dokumentu następuje świadomie przez użytkownika.</p>
<p>Kompas Zbiórek może następnie korzystać z wybranego dokumentu w zakresie wymaganym do wykonania funkcji i dozwolonym przez przyznane uprawnienia OAuth.</p>
<p>Dokumenty są tworzone lub aktualizowane na koncie Google użytkownika. Użytkownik zachowuje kontrolę nad dokumentami na swoim Dysku Google i może je edytować, udostępniać lub usuwać.</p>

<h2 id="availability">8. Dostępność usługi</h2>
<p>Działanie Kompasu Zbiórek zależy od dostępności usług zewnętrznych, w tym OpenAI/ChatGPT, Google OAuth, Google Picker, Google Drive, Google Docs oraz infrastruktury Cloudflare.</p>
<p>Operator nie gwarantuje nieprzerwanego ani całkowicie bezbłędnego działania usługi ani usług zewnętrznych.</p>

<h2 id="prohibited">9. Niedozwolone użycie</h2>
<p>Zabronione jest używanie aplikacji do działań niezgodnych z prawem, naruszania praw innych osób, uzyskiwania nieuprawnionego dostępu do dokumentów, rozpowszechniania szkodliwego oprogramowania lub obchodzenia zabezpieczeń.</p>

<h2 id="liability">10. Ograniczenie odpowiedzialności</h2>
<p>W zakresie dozwolonym przez prawo operator nie odpowiada za szkody wynikające z wykorzystania niesprawdzonej treści AI, błędnych poleceń użytkownika, utraty dostępu do konta, zmian w usługach zewnętrznych ani usunięcia lub zmiany dokumentu przez użytkownika albo inną uprawnioną osobę.</p>

<h2 id="termination">11. Zakończenie korzystania i cofnięcie dostępu</h2>
<p>Użytkownik może w dowolnym momencie przestać korzystać z aplikacji, cofnąć dostęp Google OAuth i usunąć dokumenty ze swojego Dysku Google.</p>
<p>Operator może ograniczyć dostęp w przypadku naruszenia warunków, ryzyka bezpieczeństwa lub konieczności dostosowania aplikacji do wymagań Google albo OpenAI.</p>

<h2 id="privacy">12. Prywatność</h2>
<p>Zasady przetwarzania danych, w tym danych otrzymanych z Google API, opisuje Polityka prywatności Kompas Zbiórek:</p>
<p><a href="${POLITYKA_URL}">https://polityka.prywatnosci.kompaszbiorek.pl/</a></p>

<h2 id="changes">13. Zmiany warunków i prawo właściwe</h2>
<p>Warunki mogą być aktualizowane wraz ze zmianą funkcji aplikacji lub wymagań prawnych i technicznych.</p>
<p>Aktualna wersja jest zawsze dostępna pod adresem: <a href="${WARUNKI_URL}">https://warunki.korzystania.kompaszbiorek.pl/</a></p>
<p>Do niniejszych warunków stosuje się prawo polskie, z uwzględnieniem bezwzględnie obowiązujących praw konsumentów.</p>
</article>
</div>
</main>
<footer class="site-footer">
  <div class="shell footer-inner">
    <a class="footer-brand" href="${HOME_URL}" aria-label="Kompas Zbiórek — strona główna">
      <img class="brand-logo" src="/logo.png" alt="" width="36" height="36" aria-hidden="true">
      <span class="brand-lockup">
        <span class="brand-kicker">KOMPAS ZBIÓREK</span>
        <span class="brand-name">Warunki korzystania</span>
      </span>
    </a>
    <nav class="footer-links" aria-label="Nawigacja w stopce">
      <a href="${HOME_URL}">Strona główna</a>
      <a href="${POLITYKA_URL}">Polityka prywatności</a>
      <a href="${WARUNKI_URL}">Warunki korzystania</a>
    </nav>
  </div>
  <div class="shell footer-bottom">© 2026 Kompas Zbiórek</div>
</footer>
</body>
</html>`;

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/robots.txt") {
      return new Response(`User-agent: *\nAllow: /\n`, {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    return new Response(PAGE, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=3600",
      },
    });
  },
};
