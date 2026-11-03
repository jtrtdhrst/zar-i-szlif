import { renderKompasRail, renderKompasKicker, renderKompasSiteButton, renderKompasAccent, renderKompasMountains } from "../ui/kompas-site.js";

export function renderHeroSection({ productSrc = "https://kompaszbiorek.pl/og-image.png" } = {}) {
  const copy = `<div class="kompas-hero__copy">
    ${renderKompasKicker("Azymut — asystent AI dla instruktorów RR")}
    <h1>Od problemu w drużynie do gotowego planu zbiórki</h1>
    <p class="kompas-lead">Planuj mądrze, oszczędzaj czas i testuj pomysły dopasowane do kontekstu twojej drużyny.</p>
    <p class="kompas-copy">Przejdź krok po kroku cały cykl doskonalenia: nazwij główną trudność, wprowadź małą zmianę, która na nią odpowie, i wyciągnij wnioski z praktycznego działania.</p>
    <div class="kompas-hero__actions">
      ${renderKompasSiteButton({ label: "Dodaj do Chatu GPT", action: "add-to-gpt", kind: "primary" })}
      ${renderKompasSiteButton({ label: "Zobacz poradnik", action: "open-guide", kind: "guide", icon: "play" })}
    </div>
  </div>`;
  const product = `<div class="kompas-hero__product">
    ${renderKompasAccent(`<img src="${productSrc}" alt="Podgląd asystenta Azymut w ChatGPT"/>`, true)}
    <div class="kompas-product-challenge">Wyzwanie drużyny</div>
  </div>`;
  return `<section class="kompas-hero" id="jak-dziala">
    <div class="kompas-topo" aria-hidden="true"></div>
    <div class="kompas-shell kompas-hero__inner">
      ${renderKompasRail({ num: "01", name: "Azymut" })}
      <div class="kompas-hero__grid">
        ${copy}
        ${product}
      </div>
    </div>
    ${renderKompasMountains()}
  </section>`;
}
