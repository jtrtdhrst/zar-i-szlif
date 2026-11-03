export function renderKompasStatCard({ label = "Etykieta", value = "0", delta = "", tone = "neutral" } = {}) {
  const tones = { up: "var(--red)", down: "var(--muted)", neutral: "var(--gold)" };
  const bar = tones[tone] ?? tones.neutral;
  return `<article class="dashboard-card" style="padding:24px;border-radius:var(--radius-card);border-top:3px solid ${bar}"><p class="dashboard-kicker">${label}</p><p style="margin:12px 0 4px;font-family:var(--font-display);font-size:32px;line-height:36px;font-weight:900;letter-spacing:-.02em">${value}</p>${delta ? `<p style="margin:0;color:var(--muted);font-size:14px;line-height:22px">${delta}</p>` : ""}</article>`;
}
