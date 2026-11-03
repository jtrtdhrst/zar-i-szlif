import { renderKompasSiteButton, renderKompasRail } from "../ui/kompas-site.js";

export function renderSiteHeader({ active = "hero", open = false } = {}) {
  const links = [
    { id: "jak-dziala", label: "Jak to działa" },
    { id: "sytuacje", label: "Wyzwania" },
    { id: "sciezka", label: "Pełny cykl" },
    { id: "pamiec", label: "Pamięć drużyny" }
  ];
  const nav = links.map((l) =>
    `<a class="kompas-nav__link${l.id === active ? " is-active" : ""}" href="#${l.id}" data-view="${l.id}">${l.label}</a>`
  ).join("");
  return `<header class="kompas-header">
    <div class="kompas-shell kompas-header__inner">
      <a class="kompas-brand" href="#" data-view="home" aria-label="Kompas Zbiórek — strona główna">
        <img class="kompas-brand__logo" src="/logo.png" alt=""/>
        <span class="kompas-brand__name">Kompas Zbiórek</span>
      </a>
      <nav class="kompas-nav${open ? " is-open" : ""}" aria-label="Nawigacja główna">${nav}</nav>
      <div class="kompas-header__actions">
        ${renderKompasSiteButton({ label: "Dodaj do Chatu GPT", action: "add-to-gpt", kind: "primary", small: true })}
        ${renderKompasSiteButton({ label: "Zobacz poradnik", action: "open-guide", kind: "guide", icon: "play", small: true })}
      </div>
      <button class="kompas-menu-toggle" type="button" aria-label="Menu" data-action="toggle-menu"><span></span></button>
    </div>
  </header>`;
}
