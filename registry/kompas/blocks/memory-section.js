import { renderKompasRail, renderKompasKicker, renderKompasSiteButton } from "../ui/kompas-site.js";

const MEMORY_CARDS = [
  { index: "01", title: "Obserwacje drużyny", copy: "Co zauważyłeś podczas zbiórki — fakty, nie oceny. Podstawa do dalszej pracy." },
  { index: "02", title: "Sprawności", copy: "Lista umiejętności do rozwoju i tych już opanowanych przez grupę." },
  { index: "03", title: "Wnioski i decyzje", copy: "Co sprawdziło się w eksperymencie i jaki jest kolejny krok doskonalenia." }
];

function renderDocWindow() {
  return `<div class="kompas-doc">
    <div class="kompas-doc__topbar">
      <div class="kompas-doc__brand">
        <span class="kompas-doc__icon"></span>
        <span class="kompas-doc__name">Pamięć drużyny — 14.10.2026</span>
      </div>
      <span class="kompas-doc__share">Udostępnij</span>
    </div>
    <div class="kompas-doc__menu"><span>Podgląd</span><span>Edytuj</span><span>Historia</span></div>
    <div class="kompas-doc__workspace">
      <div class="kompas-doc__page">
        <p class="kompas-doc__label">Karta zbiórki</p>
        <h3 class="kompas-doc__title">Eksperyment: cisza na otwarcie</h3>
        <p class="kompas-doc__intro">Zbiórka 14.10.2026 · cel: lepsze skupienie na początku</p>
        <div class="kompas-doc__block">
          <p class="kompas-doc__block-label">Obserwacja</p>
          <p>Grupa uspokoiła się w 40 sekund — o minutę szybciej niż tydzień temu.</p>
        </div>
        <div class="kompas-doc__block kompas-doc__block--red">
          <p class="kompas-doc__block-label">Decyzja</p>
          <p>Zostawiamy ciszę jako stały punkt otwarcia; następny cel: przejście do kręgu.</p>
        </div>
      </div>
    </div>
  </div>`;
}

export function renderMemorySection({ activeCard = 0 } = {}) {
  const cards = MEMORY_CARDS.map((c, i) => `
    <article class="kompas-memory__card${i === activeCard ? " is-active" : ""}">
      <div class="kompas-memory__card-index">${c.index}</div>
      <div>
        <h4 class="kompas-memory__card-title">${c.title}</h4>
        <p class="kompas-memory__card-copy">${c.copy}</p>
      </div>
    </article>`).join("");
  return `<section class="kompas-memory" id="pamiec">
    <div class="kompas-topo" aria-hidden="true"></div>
    <div class="kompas-memory__shell">
      ${renderKompasRail({ num: "04", name: "Pamięć drużyny" })}
      <div class="kompas-memory__copy">
        ${renderKompasKicker("Pamięć drużyny", true)}
        <h2 class="kompas-memory__title">Nic nie ginie między zbiórkami</h2>
        <p class="kompas-memory__lead">Obserwacje, sprawności i decyzje zapisują się w jednym miejscu, więc każda kolejna aktywność nawiązuje do poprzedniej.</p>
        <div class="kompas-memory__actions">
          ${renderKompasSiteButton({ label: "Dodaj do Chatu GPT", action: "add-to-gpt", kind: "primary" })}
          ${renderKompasSiteButton({ label: "Zobacz poradnik", action: "open-guide", kind: "guide", icon: "play" })}
        </div>
        <div class="kompas-memory__cards">${cards}</div>
      </div>
      <div class="kompas-memory__preview">${renderDocWindow()}</div>
    </div>
  </section>`;
}
