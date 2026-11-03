const POLITYKA_URL = "https://polityka.xn--prywatnoci-c8b.kompaszbiorek.pl/";
const WARUNKI_URL = "https://warunki.korzystania.kompaszbiorek.pl/";
const HOME_URL = "https://kompaszbiorek.pl/";

const PAGE = `<!doctype html>
<html lang="pl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="theme-color" content="#162313">
  <title>Polityka prywatności — Kompas Zbiórek</title>
  <meta name="application-name" content="Kompas Zbiórek">
  <meta name="description" content="Polityka prywatności aplikacji Kompas Zbiórek, w tym informacje o logowaniu przez Google, Google Picker, celu użycia, przechowywaniu, udostępnianiu i usuwaniu danych.">
  <meta name="robots" content="index,follow,max-image-preview:large">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Kompas Zbiórek">
  <meta property="og:title" content="Polityka prywatności — Kompas Zbiórek">
  <meta property="og:description" content="Polityka prywatności aplikacji Kompas Zbiórek, w tym informacje o logowaniu przez Google, Google Picker, celu użycia, przechowywaniu, udostępnianiu i usuwaniu danych.">
  <meta property="og:url" content="${POLITYKA_URL}">
  <link rel="canonical" href="${POLITYKA_URL}">
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
        <span class="brand-name">Polityka prywatności</span>
      </span>
    </a>
    <div class="header-route" aria-hidden="true"></div>
  </div>
</header>
<main class="document" id="main">
<div class="shell document-inner">
<header class="document-head">
  <p class="eyebrow">DOKUMENT PRAWNY APLIKACJI</p>
  <h1>Polityka prywatności — Kompas Zbiórek</h1>
  <p class="intro">Niniejsza polityka opisuje, jakie dane są przetwarzane przez Kompas Zbiórek, dlaczego aplikacja korzysta z Google OAuth, Google Drive i Google Picker oraz jakie prawa ma użytkownik.</p>
  <div class="meta-row"><span>Data wejścia w życie: 30 lipca 2026 r.</span><span>Ostatnia aktualizacja: 11 sierpnia 2026 r.</span></div>
</header>
<nav class="toc" aria-label="Spis treści"><strong>Spis treści</strong><ol>
<li><a href="#operator">Operator</a></li><li><a href="#aplikacja">Aplikacja</a></li><li><a href="#google-data">Dane Google</a></li><li><a href="#purpose">Cele użycia</a></li><li><a href="#storage">Przechowywanie</a></li><li><a href="#sharing">Udostępnianie</a></li><li><a href="#limited-use">Limited Use</a></li><li><a href="#security">Bezpieczeństwo</a></li><li><a href="#revocation">Cofnięcie dostępu</a></li><li><a href="#rights">Prawa użytkownika</a></li><li><a href="#changes">Zmiany</a></li>
</ol></nav>
<article>
<h2 id="operator">1. Operator aplikacji</h2>
<p>Operatorem aplikacji <strong>Kompas Zbiórek</strong> jest Miłosz Spyrka. Kontakt w sprawach dotyczących aplikacji, wsparcia i prywatności: <a href="mailto:milosz.spyrka@gmail.com">milosz.spyrka@gmail.com</a>.</p>

<h2 id="aplikacja">2. Czym jest Kompas Zbiórek</h2>
<p>Kompas Zbiórek jest aplikacją działającą w ChatGPT dla instruktorów Royal Rangers. Pomaga analizować sytuacje w drużynie, przygotowywać plany zbiórek i eksperymenty oraz, po wyraźnym poleceniu użytkownika, zapisywać lub aktualizować treść w Dokumentach Google.</p>
<p>Aplikacja działa jako integracja z ChatGPT wykorzystująca serwer MCP.</p>
<p>Publiczny opis celu i funkcji aplikacji znajduje się na stronie: <a href="https://kompaszbiorek.pl/">https://kompaszbiorek.pl/</a>.</p>

<h2 id="google-data">3. Dane uzyskiwane z Google</h2>
<p>Do logowania użytkownika aplikacja korzysta ze standardowych zakresów OpenID Connect:</p>
<ul>
  <li><code>openid</code>,</li>
  <li><code>email</code>,</li>
  <li><code>profile</code>.</li>
</ul>
<p>W ramach logowania aplikacja może otrzymywać:</p>
<ul>
  <li>identyfikator konta Google,</li>
  <li>adres e-mail,</li>
  <li>informację o weryfikacji adresu e-mail,</li>
  <li>podstawowe dane profilu, takie jak nazwa użytkownika.</li>
</ul>
<p>Do obsługi plików aplikacja używa zakresu OAuth:</p>
<p><code>https://www.googleapis.com/auth/drive.file</code></p>
<p>Zakres <code>drive.file</code> umożliwia dostęp tylko do konkretnych plików Google Drive używanych z aplikacją, w szczególności plików utworzonych przez aplikację lub wybranych do użycia z aplikacją zgodnie z mechanizmami Google.</p>
<p>W określonych funkcjach aplikacja może korzystać z Google Picker, dzięki któremu użytkownik sam wskazuje Dokument Google, który chce wykorzystać z Kompasem Zbiórek.</p>
<p>W zależności od operacji zleconej przez użytkownika aplikacja może przetwarzać:</p>
<ul>
  <li>identyfikator i tytuł konkretnego Dokumentu Google,</li>
  <li>typ wybranego pliku,</li>
  <li>strukturę dokumentu, nazwy kart oraz treść potrzebną do wykonania polecenia,</li>
  <li>informacje techniczne niezbędne do autoryzacji OAuth i wykonania żądania,</li>
  <li>status operacji, komunikaty błędów i link do utworzonego lub zaktualizowanego dokumentu.</li>
</ul>
<p>Aplikacja nie uzyskuje hasła użytkownika do konta Google i nie otrzymuje ogólnego dostępu do wszystkich plików na Dysku.</p>

<h2 id="purpose">4. Cel wykorzystania danych Google</h2>
<p>Dane Google są używane wyłącznie do wykonania funkcji uruchomionej przez użytkownika, takich jak:</p>
<ul>
  <li>zalogowanie i identyfikacja użytkownika,</li>
  <li>wybór konkretnego dokumentu za pomocą Google Picker,</li>
  <li>utworzenie nowego Dokumentu Google,</li>
  <li>dodanie lub aktualizacja treści w konkretnym dokumencie,</li>
  <li>odczyt danych dokumentu koniecznych do przygotowania odpowiedzi lub wykonania zmiany,</li>
  <li>zwrócenie użytkownikowi wyniku operacji i linku do dokumentu.</li>
</ul>
<p>Kompas Zbiórek nie skanuje Dysku Google, nie wykonuje działań w tle i nie używa danych Google do reklam, profilowania, sprzedaży danych ani trenowania własnych modeli AI przez operatora.</p>

<h2 id="storage">5. Przechowywanie i okres przetwarzania</h2>
<p>Treść Dokumentów Google pozostaje na Dysku Google użytkownika. Operator nie prowadzi odrębnego repozytorium pełnych kopii dokumentów użytkownika.</p>
<p>Identyfikator dokumentu lub inne dane potrzebne do powiązania dokumentu z Kompasem Zbiórek mogą być przechowywane przez okres korzystania przez użytkownika z danej konfiguracji lub funkcji.</p>
<p>Minimalne dane techniczne, takie jak identyfikator dokumentu, identyfikator karty, status operacji lub informacje o błędzie, mogą być przetwarzane w zakresie potrzebnym do wykonania funkcji, diagnostyki i zapewnienia bezpieczeństwa. Dane te są przechowywane tylko tak długo, jak jest to niezbędne do tych celów lub wymagane przez prawo.</p>
<p>Tokeny OAuth oraz dane niezbędne do utrzymania autoryzacji są używane do obsługi połączenia z usługami Google. Użytkownik może unieważnić dostęp zgodnie z punktem 9.</p>

<h2 id="sharing">6. Udostępnianie i podmioty przetwarzające</h2>
<p>Dane nie są sprzedawane ani udostępniane reklamodawcom.</p>
<p>W zakresie koniecznym do działania aplikacji dane mogą być technicznie przetwarzane przez:</p>
<ul>
  <li><strong>Google</strong> — jako dostawcę Google OAuth, Google Picker, Google Drive i Google Docs,</li>
  <li><strong>OpenAI</strong> — jako dostawcę ChatGPT i infrastruktury umożliwiającej korzystanie z Kompasu Zbiórek poprzez integrację MCP,</li>
  <li><strong>Cloudflare</strong> — jako dostawcę infrastruktury technicznej wykorzystywanej do działania serwera MCP, obsługi uwierzytelniania i realizacji żądań aplikacji.</li>
</ul>
<p>Dane są przekazywane tylko w zakresie niezbędnym do wykonania funkcji uruchomionej przez użytkownika, zapewnienia bezpieczeństwa lub spełnienia obowiązku prawnego.</p>

<h2 id="limited-use">7. Google API Services User Data Policy i Limited Use</h2>
<p><strong>Wykorzystanie i przekazywanie przez Kompas Zbiórek informacji otrzymanych z interfejsów Google API będzie zgodne z Google API Services User Data Policy, w tym z wymaganiami Limited Use.</strong></p>
<p lang="en"><strong>Kompas Zbiórek's use and transfer to any other app of information received from Google APIs will adhere to the Google API Services User Data Policy, including the Limited Use requirements.</strong></p>

<h2 id="security">8. Bezpieczeństwo</h2>
<p>Dostęp do Google odbywa się przez OAuth 2.0 i OpenID Connect. Każdy użytkownik autoryzuje własne konto, a operacje są ograniczone zakresem przyznanych uprawnień.</p>
<p>Aplikacja nie może wykonać operacji, której nie zezwalają uprawnienia użytkownika lub zakres OAuth.</p>

<h2 id="revocation">9. Cofnięcie dostępu i usunięcie danych</h2>
<p>Użytkownik może w każdej chwili cofnąć dostęp aplikacji w ustawieniach bezpieczeństwa swojego konta Google.</p>
<p>Cofnięcie dostępu blokuje dalsze operacje wykorzystujące konto Google, ale nie usuwa dokumentów wcześniej utworzonych na Dysku Google użytkownika.</p>
<p>Użytkownik może usunąć dokumenty bezpośrednio w Google Drive. Żądanie usunięcia danych technicznych przechowywanych przez operatora można wysłać na adres <a href="mailto:milosz.spyrka@gmail.com">milosz.spyrka@gmail.com</a>. Operator może poprosić o informacje potrzebne do identyfikacji właściwych danych.</p>

<h2 id="rights">10. Prawa użytkownika</h2>
<p>Użytkownik może zażądać informacji o przetwarzaniu danych, ich sprostowania lub usunięcia, ograniczenia przetwarzania, a także zgłosić problem dotyczący prywatności. Uprawnienia te mogą podlegać ograniczeniom wynikającym z obowiązującego prawa.</p>

<h2 id="changes">11. Zmiany polityki</h2>
<p>Polityka może być aktualizowana w przypadku zmiany funkcji aplikacji, zakresów OAuth, sposobu przetwarzania danych lub wymagań prawnych.</p>
<p>Aktualna wersja polityki jest dostępna pod adresem: <a href="https://polityka.prywatnosci.kompaszbiorek.pl/">https://polityka.prywatnosci.kompaszbiorek.pl/</a>.</p>
</article>
</div>
</main>
<footer class="site-footer">
  <div class="shell footer-inner">
    <a class="footer-brand" href="${HOME_URL}" aria-label="Kompas Zbiórek — strona główna">
      <img class="brand-logo" src="/logo.png" alt="" width="36" height="36" aria-hidden="true">
      <span class="brand-lockup">
        <span class="brand-kicker">KOMPAS ZBIÓREK</span>
        <span class="brand-name">Polityka prywatności</span>
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
