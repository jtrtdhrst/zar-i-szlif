import { renderKompasRail, renderKompasKicker } from "../ui/kompas-site.js";

const STEPS = [
  { num: "1", title: "Planowanie", body: "Nazwij główną trudność drużyny i zaprojektuj małą zmianę, która na nią odpowie." },
  { num: "2", title: "Realizacja", body: "Przeprowadź zbiórkę lub eksperyment, trzymając się jednego, jasnego celu." },
  { num: "3", title: "Analiza", body: "Zbierz obserwacje i oceń, co zadziałało, a co wymaga poprawy w kontekście grupy." },
  { num: "4", title: "Decyzja", body: "Wybierz kolejny eksperyment i zamknij pętlę, zapisując wniosek w pamięci drużyny." }
];

export function renderCycleSection({ activeStep = 0 } = {}) {
  const steps = STEPS.map((s, i) => `
    <div class="kompas-cycle__step${i === activeStep ? " kompas-cycle__step--active" : ""}">
      <div class="kompas-cycle__node-row">
        <span class="kompas-cycle__node">${s.num}</span>
      </div>
      <div class="kompas-cycle__step-copy">
        <h3 class="kompas-cycle__step-title">${s.title}</h3>
        <p class="kompas-cycle__step-body">${s.body}</p>
      </div>
    </div>`).join("");
  return `<section class="kompas-cycle" id="sciezka">
    <div class="kompas-topo" aria-hidden="true"></div>
    <div class="kompas-cycle__shell">
      ${renderKompasRail({ num: "03", name: "Pełny cykl" })}
      <div class="kompas-cycle__head">
        <div>
          ${renderKompasKicker("Pełny cykl doskonalenia")}
          <h2 class="kompas-cycle__title">Cztery etapy od problemu do gotowego planu</h2>
        </div>
        <p class="kompas-cycle__support">Każda zbiórka to okazja do małego eksperymentu. Przejdź cały cykl, by kolejna aktywność była lepsza od poprzedniej.</p>
      </div>
      <div class="kompas-cycle__route">
        <span class="kompas-cycle__track"></span>
        <div class="kompas-cycle__steps">${steps}</div>
      </div>
    </div>
  </section>`;
}
