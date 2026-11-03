import { renderKompasRail, renderKompasKicker, renderKompasCard, renderKompasSiteButton, renderKompasTopo } from "../ui/kompas-site.js";

const CHALLENGES = [
  { index: "01", title: "Brak czasu na przygotowanie", body: "Planowanie zbiórki zabiera wieczory, a gotowe scenariusze nie pasują do twojej grupy.", takeaway: "Azymut skraca drogę od pomysłu do planu." },
  { index: "02", title: "Trudności bez nazwy", body: "Czujesz, że w drużynie dzieje się coś ważnego, ale brakuje ci języka, by to opisać i zmierzyć.", takeaway: "Wspólna struktura obserwacji i sprawności." },
  { index: "03", title: "Powtarzalne błędy", body: "Te same problemy wracają co kilka zbiórek, bo wnioski z poprzednich nie są zapamiętane.", takeaway: "Pamięć drużyny zamyka pętlę doskonalenia." }
];

export function renderSituationsSection({ activeIndex = 0 } = {}) {
  const cards = CHALLENGES.map((c, i) =>
    renderKompasCard({ ...c, active: i === activeIndex, dark: true })
  ).join("");
  return `<section class="kompas-situations" id="sytuacje">
    ${renderKompasTopo()}
    <div class="kompas-shell kompas-situations__inner">
      ${renderKompasRail({ num: "02", name: "Wyzwania" })}
      <div class="kompas-sit-intro">
        ${renderKompasKicker("Wyzwania drużyny", true)}
        <h2>Najpierw zobacz, co naprawdę dzieje się w grupie</h2>
        <p>Zanim zaplanujesz zbiórkę, nazwij trudność. To pierwszy krok cyklu doskonalenia.</p>
        <div class="intro-direction" style="margin-top:20px;padding-top:12px;border-top:1px solid rgba(214,173,47,.30);color:var(--gold);font-size:10px;line-height:12px;font-weight:850;letter-spacing:.16em">KIERUNEK →</div>
      </div>
      <div class="kompas-cards">${cards}</div>
      <div class="kompas-cta kompas-accent">
        <div>
          <div class="kompas-cta__eyebrow">Następny krok</div>
          <div class="kompas-cta__title">Przejdź do pełnego cyklu doskonalenia</div>
          <p class="kompas-cta__copy">Cztery etapy: Planowanie, Realizacja, Analiza i Decyzja prowadzą cię od problemu do gotowego planu.</p>
        </div>
        ${renderKompasSiteButton({ label: "Zobacz pełny cykl", action: "open-cycle", kind: "section2" })}
      </div>
    </div>
  </section>`;
}
