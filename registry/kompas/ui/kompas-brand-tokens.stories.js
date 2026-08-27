import "./kompas-brand-tokens.css";

const colors = ["--forest-950", "--forest-900", "--forest-800", "--paper", "--paper-2", "--ink", "--muted", "--red", "--red-dark", "--gold", "--gold-soft", "--black", "--white"];

function swatch(token) {
  return `<article style="display:grid;gap:8px"><span style="height:72px;border:1px solid var(--border-subtle);border-radius:var(--radius-card);background:var(${token})"></span><code>${token}</code></article>`;
}

function renderTokens() {
  return `<section style="display:grid;gap:24px;padding:24px;background:var(--surface-canvas);color:var(--text-primary);font-family:var(--font-body)">
  <h1 style="margin:0;font-family:var(--font-display);font-size:clamp(28px,3vw,40px);font-weight:900;letter-spacing:-.032em">Tokeny Kompasu — kaskada v48</h1>
  <div style="display:grid;gap:12px">
    <p style="margin:0;font-family:var(--font-body);font-weight:850;font-size:12px;letter-spacing:.105em;text-transform:uppercase;color:var(--red)">Kolory</p>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px">${colors.map(swatch).join("")}</div>
  </div>
  <div style="display:grid;gap:8px">
    <p style="margin:0;font-family:var(--font-body);font-weight:850;font-size:12px;letter-spacing:.105em;text-transform:uppercase;color:var(--red)">Typografia</p>
    <h2 style="margin:0;font-family:var(--font-display);font-weight:900;font-size:var(--size-28);letter-spacing:-.032em">Display — Noto Sans Display</h2>
    <p style="margin:0;font-family:var(--font-body);font-size:16px;line-height:25px;color:var(--muted);max-width:560px">Body — Noto Sans, 16/25, kolor muted, maksymalna szerokość 560 px.</p>
    <p style="margin:0;font-family:var(--font-body);font-weight:850;font-size:12px;line-height:16px;letter-spacing:.105em;text-transform:uppercase">Kicker — 12/16, 850, uppercase</p>
  </div>
  <div style="display:flex;flex-wrap:wrap;gap:12px">
    <span style="display:inline-flex;align-items:center;height:52px;padding-left:20px;border-radius:999px;background:var(--red);color:var(--white);font-size:13px;font-weight:850;letter-spacing:.028em;text-transform:uppercase">Pill 999px</span>
    <span style="display:inline-grid;place-items:center;width:38px;height:38px;border-radius:50%;background:var(--gold);color:var(--forest-950);font-weight:900">→</span>
    <span style="display:inline-grid;place-items:center;width:64px;height:32px;border-radius:8px;border:1px solid var(--border-strong);background:var(--surface-subtle);font-size:11px;font-weight:850">Card 8px</span>
  </div>
</section>`;
}

export default {
  title: "Kompas/Foundations/Tokeny marki",
  tags: ["autodocs"],
  render: renderTokens,
};

export const Default = {};
