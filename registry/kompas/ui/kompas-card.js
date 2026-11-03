export function renderKompasCard({ eyebrow = "Karta", title = "Tytuł karty", body = "Treść karty z opisem. Używaj dla grupowania powiązanych informacji.", action = "" } = {}) {
  return `<article class="dashboard-card" style="padding:24px;border-radius:var(--radius-card);border-top:3px solid var(--gold)"><p class="dashboard-kicker">${eyebrow}</p><h3 style="margin:12px 0 8px;font-family:var(--font-display);font-size:20px;line-height:24px;font-weight:900;letter-spacing:-.02em">${title}</h3><p style="margin:0;color:var(--muted);font-size:14px;line-height:22px">${body}</p>${action ? `<button type="button" class="dashboard-link" style="margin-top:16px;color:var(--red)">${action} <span>→</span></button>` : ""}</article>`;
}
export function renderKompasWorkSection({ label = "Sekcja robocza", title = "Nagłówek sekcji", body = "Zawartość sekcji roboczej z górną linią akcentu." } = {}) {
  return `<section class="work-section" style="padding:24px"><div class="section-label">${label}</div><h2 style="margin:12px 0 8px">${title}</h2><p style="margin:0;color:var(--muted);font-size:14px;line-height:22px">${body}</p></section>`;
}
