export function renderKompasTabs({ tabs = ["Planowanie", "Podsumowanie", "Problemy"], active = 0 } = {}) {
  return `<nav class="activity-tabs" style="max-width:720px">${tabs.map((label, i) => `<button type="button" class="${i === active ? "active" : ""}">${label}</button>`).join("")}</nav>`;
}
