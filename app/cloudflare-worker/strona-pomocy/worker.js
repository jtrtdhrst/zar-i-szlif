const POMOC_URL = "https://pomoc.kompaszbiorek.pl/";
const HOME_URL = "https://kompaszbiorek.pl/";
const POLITYKA_URL = "https://polityka.xn--prywatnoci-c8b.kompaszbiorek.pl/";
const WARUNKI_URL = "https://warunki.korzystania.kompaszbiorek.pl/";

const PAGE = `<!doctype html>
<html lang="pl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="theme-color" content="#162313">
  <title>Pomoc — Kompas Zbiórek</title>
  <meta name="application-name" content="Kompas Zbiórek">
  <meta name="description" content="Pomoc dla użytkowników Kompasu Zbiórek: najczęstsze problemy z logowaniem Google, Google Pickerem i dokumentami oraz kontakt wsparcia.">
  <meta name="robots" content="index,follow,max-image-preview:large">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Kompas Zbiórek">
  <meta property="og:title" content="Pomoc — Kompas Zbiórek">
  <meta property="og:description" content="Pomoc dla użytkowników Kompasu Zbiórek: najczęstsze problemy z logowaniem Google, Google Pickerem i dokumentami oraz kontakt wsparcia.">
  <meta property="og:url" content="${POMOC_URL}">
  <link rel="canonical" href="${POMOC_URL}">
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
      font-size:17px;
      line-height:26px;
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
    .document { padding:64px 0 84px; }
    .document-inner { width:min(860px,100%); }
    .eyebrow {
      margin:0 0 12px;
      color:var(--red);
      font-size:13px;
      font-weight:900;
      letter-spacing:.14em;
      text-transform:uppercase;
    }
    .document-head { margin-bottom:48px; }
    .document-head h1 {
      margin:0;
      color:var(--forest-950);
      font-size:clamp(34px,5.5vw,52px);
      line-height:1.06;
      letter-spacing:-.02em;
      font-weight:900;
    }
    .document-head .intro {
      max-width:720px;
      margin:18px 0 0;
      color:var(--muted);
      font-size:18px;
      line-height:29px;
    }
    section h2 {
      margin:0 0 24px;
      color:var(--forest-950);
      font-size:26px;
      line-height:1.15;
      letter-spacing:-.01em;
      font-weight:900;
    }
    section h2::before {
      content:"";
      display:inline-block;
      width:14px;
      height:14px;
      margin-right:10px;
      background:var(--gold);
      clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%);
    }
    .faq {
      border:1px solid var(--line);
      border-radius:8px;
      background:var(--paper-2);
      margin:0 0 12px;
    }
    .faq summary {
      display:flex;
      align-items:center;
      gap:16px;
      padding:20px 24px;
      cursor:pointer;
      color:var(--forest-900);
      font-size:17px;
      font-weight:800;
      line-height:24px;
      list-style:none;
      user-select:none;
    }
    .faq summary::-webkit-details-marker { display:none; }
    .faq summary::after {
      content:"";
      flex:0 0 12px;
      width:12px;
      height:12px;
      margin-left:auto;
      border-right:2px solid var(--red);
      border-bottom:2px solid var(--red);
      transform:rotate(-45deg) translateY(-2px);
      transition:transform .18s ease;
    }
    .faq[open] summary::after { transform:rotate(45deg) translateY(0); }
    .faq summary:focus-visible { outline:3px solid rgba(214,173,47,.36); outline-offset:-3px; border-radius:8px; }
    .faq-body { padding:0 24px 20px; }
    .faq-body p {
      margin:0;
      max-width:680px;
      color:var(--muted);
      font-size:16px;
      line-height:26px;
    }
    .contact {
      margin-top:56px;
      padding:36px 40px;
      border:1px solid var(--line-strong);
      border-left:4px solid var(--gold);
      border-radius:8px;
      background:var(--paper-2);
    }
    .contact p, .contact li { color:var(--muted); font-size:16px; line-height:26px; }
    .contact strong { color:var(--ink); }
    .contact-mail {
      display:inline-block;
      margin-top:4px;
      color:var(--red-dark);
      font-weight:800;
      font-size:18px;
      text-underline-offset:4px;
    }
    .note {
      margin:20px 0 28px;
      padding:14px 18px;
      border:1px solid rgba(190,48,42,.34);
      border-left:4px solid var(--red);
      border-radius:6px;
      background:rgba(190,48,42,.06);
      font-weight:700;
    }
    .btn {
      display:inline-flex;
      align-items:center;
      height:58px;
      padding:0 8px 0 0;
      border:1px solid rgba(147,34,30,.72);
      border-radius:999px;
      background:var(--red);
      color:var(--white);
      font-family:"Noto Sans",Arial,sans-serif;
      font-size:15px;
      font-weight:850;
      letter-spacing:.028em;
      text-transform:uppercase;
      text-decoration:none;
      white-space:nowrap;
      transition:transform .16s ease,box-shadow .16s ease;
    }
    .btn:hover { transform:translateY(-1px); }
    .btn:focus-visible { outline:3px solid rgba(214,173,47,.36); outline-offset:3px; }
    .btn-label { padding-left:32px; }
    .btn-cap {
      width:44px;
      height:44px;
      margin-left:20px;
      display:grid;
      place-items:center;
      border-radius:50%;
      background:var(--gold);
      color:var(--forest-950);
      flex:none;
    }
    .btn-cap svg { display:block; width:20px; height:20px; }
    .icon-arrow { fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
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
      .footer-inner, .footer-links { flex-direction:column; gap:10px; align-items:flex-start; }
      .document { padding:44px 0 60px; }
      .document-head h1 { font-size:32px; }
      .faq summary { padding:18px 20px; }
      .faq-body { padding:0 20px 18px; }
      .contact { padding:28px 24px; }
      .btn { height:56px; }
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
        <span class="brand-name">Pomoc</span>
      </span>
    </a>
    <div class="header-route" aria-hidden="true"></div>
  </div>
</header>
<main class="document" id="main">
<div class="shell document-inner">
<header class="document-head">
  <p class="eyebrow">POMOC APLIKACJI</p>
  <h1>Pomoc — Kompas Zbiórek</h1>
  <p class="intro">Masz problem z działaniem Kompasu Zbiórek, logowaniem Google lub dokumentami? Sprawdź podstawowe rozwiązania albo skontaktuj się bezpośrednio.</p>
</header>
<section id="problemy" aria-labelledby="problemy-heading">
  <h2 id="problemy-heading">Najczęstsze problemy</h2>
  <details class="faq">
    <summary>Nie mogę zalogować się przez Google</summary>
    <div class="faq-body"><p>Spróbuj ponownie połączyć konto Google. Upewnij się, że logujesz się na właściwe konto i zaakceptowałeś wymagane uprawnienia.</p></div>
  </details>
  <details class="faq">
    <summary>Google Picker nie pokazuje dokumentu</summary>
    <div class="faq-body"><p>Upewnij się, że dokument znajduje się na koncie Google, którym jesteś zalogowany, i że masz do niego odpowiednie uprawnienia.</p></div>
  </details>
  <details class="faq">
    <summary>Kompas nie może otworzyć wybranego dokumentu</summary>
    <div class="faq-body"><p>Sprawdź, czy dokument nadal istnieje i czy nie cofnięto aplikacji dostępu do niego.</p></div>
  </details>
  <details class="faq">
    <summary>Kompas nie otwiera się w ChatGPT</summary>
    <div class="faq-body"><p>Odśwież rozmowę, sprawdź połączenie aplikacji i spróbuj ponownie uruchomić Kompas Zbiórek.</p></div>
  </details>
  <details class="faq">
    <summary>Chcę odłączyć konto Google</summary>
    <div class="faq-body"><p>Dostęp Kompasu można cofnąć w ustawieniach bezpieczeństwa konta Google oraz przez ustawienia połączeń/aplikacji w ChatGPT.</p></div>
  </details>
</section>
<section class="contact" id="kontakt" aria-labelledby="kontakt-heading">
  <h2 id="kontakt-heading">Nadal potrzebujesz pomocy?</h2>
  <p>Napisz na:</p>
  <a class="contact-mail" href="mailto:milosz.spyrka@gmail.com">milosz.spyrka@gmail.com</a>
  <p style="margin-top:20px"><strong>W zgłoszeniu podaj:</strong></p>
  <ul style="margin:8px 0 0; padding-left:20px">
    <li>krótki opis problemu,</li>
    <li>co zrobiłeś przed wystąpieniem błędu,</li>
    <li>komunikat błędu, jeśli się pojawił,</li>
    <li>zrzut ekranu, jeśli pomaga wyjaśnić problem.</li>
  </ul>
  <p class="note">Nie przesyłaj haseł, tokenów OAuth, kodów logowania ani innych danych uwierzytelniających.</p>
  <a class="btn" href="mailto:milosz.spyrka@gmail.com">
    <span class="btn-label">Napisz wiadomość</span>
    <span class="btn-cap" aria-hidden="true">
      <svg class="icon-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
    </span>
  </a>
</section>
</div>
</main>
<footer class="site-footer">
  <div class="shell footer-inner">
    <a class="footer-brand" href="${HOME_URL}" aria-label="Kompas Zbiórek — strona główna">
      <img class="brand-logo" src="/logo.png" alt="" width="36" height="36" aria-hidden="true">
      <span class="brand-lockup">
        <span class="brand-kicker">KOMPAS ZBIÓREK</span>
        <span class="brand-name">Pomoc</span>
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
