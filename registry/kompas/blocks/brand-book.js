import { renderKompasKicker } from "../ui/kompas-site.js";

const COLORS = [
  { name: "Forest 950", hex: "#162313", fg: "#fff" },
  { name: "Forest 900", hex: "#1d2d19", fg: "#fff" },
  { name: "Paper", hex: "#f5f0df", fg: "#20301e" },
  { name: "Ink", hex: "#20301e", fg: "#fff" },
  { name: "Red", hex: "#be302a", fg: "#fff" },
  { name: "Gold", hex: "#d6ad2f", fg: "#162313" },
  { name: "Muted", hex: "#485347", fg: "#fff" },
  { name: "Paper 2", hex: "#ece5d1", fg: "#20301e" }
];

const TYPE = [
  { label: "Display H1", sample: "Gotowy plan zbiórki", size: "52px / 54px", weight: "900" },
  { label: "Display H2", sample: "Pełny cykl doskonalenia", size: "32px / 36px", weight: "900" },
  { label: "Lead", sample: "Planuj mądrze, oszczędzaj czas.", size: "20px / 28px", weight: "760" },
  { label: "Body", sample: "Tekst roboczy karty zbiórki.", size: "16px / 24px", weight: "400" },
  { label: "Caption", sample: "Etykieta sekcji", size: "12px / 16px", weight: "850" }
];

const VOICE = [
  { h: "Konkret", p: "Mówimy o krokach i efektach, nie o ogólnikach. Każda wskazówka prowadzi do działania." },
  { h: "Wspierający", p: "Ton instruktora, który zna drużynę. Bez oceny, z przestrzenią na błąd i eksperyment." },
  { h: "Cykliczny", p: "Wszystko wraca do pętli: zobacz — nazwij — zmień — wyciągnij wniosek." },
  { h: "Wizualny", p: "Kompas, kontury terenu i złoty akcent L to nasz język rozpoznawczy, nie dekoracja." }
];

export function renderBrandBook() {
  const swatches = COLORS.map((c) => `
    <div class="kompas-swatch">
      <div class="kompas-swatch__chip" style="background:${c.hex};color:${c.fg}"></div>
      <div class="kompas-swatch__meta">
        <div class="kompas-swatch__name">${c.name}</div>
        <div class="kompas-swatch__hex">${c.hex}</div>
      </div>
    </div>`).join("");
  const typeRows = TYPE.map((t) => `
    <div class="kompas-type-row">
      <div class="kompas-type-row__label">${t.label}<br>${t.size} · ${t.weight}</div>
      <div class="kompas-type-row__sample" style="font-size:${t.size.split(" / ")[0]};font-weight:${t.weight};line-height:1.1">${t.sample}</div>
    </div>`).join("");
  const voice = VOICE.map((v) => `
    <div class="kompas-voice__card">
      <h4>${v.h}</h4>
      <p>${v.p}</p>
    </div>`).join("");
  return `<section class="kompas-brandbook">
    <div class="kompas-shell kompas-brandbook__grid">
      <div></div>
      <div>
        <div class="kompas-brandbook__head">
          ${renderKompasKicker("Brand book Kompasu")}
          <h1 class="kompas-brandbook__title">Język wizualny Kompas Zbiórek</h1>
          <p class="kompas-brandbook__lead">Jedna spójna marka: olive / ecru, czerwień, złoto i kompas. Poniżej kolory, typografia, logo i ton komunikacji — źródło prawdy dla wszystkich sekcji WWW.</p>
        </div>

        <div class="kompas-brandbook__section">
          <div class="kompas-brandbook__h">Kolory</div>
          <div class="kompas-swatches">${swatches}</div>
        </div>

        <div class="kompas-brandbook__section">
          <div class="kompas-brandbook__h">Typografia</div>
          <div style="margin-top:16px">${typeRows}</div>
        </div>

        <div class="kompas-brandbook__section">
          <div class="kompas-brandbook__h">Logo i lockup</div>
          <div class="kompas-logo-lockup" style="margin-top:16px">
            <img src="/logo.png" alt="Logo Kompas Zbiórek"/>
            <span class="kompas-logo-lockup__name">Kompas Zbiórek</span>
          </div>
        </div>

        <div class="kompas-brandbook__section">
          <div class="kompas-brandbook__h">Ton i głos</div>
          <div class="kompas-voice">${voice}</div>
        </div>
      </div>
    </div>
  </section>`;
}
