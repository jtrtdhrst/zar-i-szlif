// Wspólne helpery renderujące dla sekcji WWW Kompasu (kompaszbiorek.pl).
// Wszystkie klasy odpowiadają kompas-site.css — jeden zunifikowany język wizualny.

export function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

const ARROW = '<svg viewBox="0 0 24 24"><path class="icon-arrow" d="M5 12h13M13 7l5 5-5 5"/></svg>';
const PLAY = '<svg viewBox="0 0 24 24"><path class="icon-play" d="M8 5v14l11-7z"/></svg>';

export function renderKompasSiteButton({ label, action = "", kind = "primary", icon = "arrow", block = false, small = false } = {}) {
  const iconSvg = icon === "play" ? PLAY : ARROW;
  const cls = [
    "kompas-btn",
    `kompas-btn--${kind}`,
    block ? "kompas-btn--block" : "",
    small ? "kompas-btn--sm" : ""
  ].filter(Boolean).join(" ");
  const tag = action ? "button" : "a";
  const attr = action ? `type="button" data-action="${esc(action)}"` : `href="#" data-action="${esc(action)}"`;
  return `<${tag} class="${cls}" ${attr}><span class="kompas-btn__label">${esc(label)}</span><span class="kompas-btn__cap" aria-hidden="true">${iconSvg}</span></${tag}>`;
}

export function renderKompasRail({ num, name }) {
  return `<div class="kompas-rail">
    <div class="kompas-rail__num">${esc(num)}</div>
    <div class="kompas-rail__name">${esc(name)}</div>
    <span class="kompas-rail__line"></span>
    <span class="kompas-rail__dot" style="top:148px"></span>
    <span class="kompas-rail__dot" style="top:244px"></span>
    <span class="kompas-rail__arrow"></span>
  </div>`;
}

export function renderKompasKicker(text, gold = false) {
  return `<div class="kompas-kicker${gold ? " kompas-kicker--gold" : ""}">${esc(text)}</div>`;
}

export function renderKompasCard({ index, title, body, takeaway, active = false, dark = false } = {}) {
  const cls = [
    "kompas-card",
    active ? "kompas-card--active" : "",
    dark ? "kompas-card--dark" : ""
  ].filter(Boolean).join(" ");
  return `<article class="${cls}">
    <div class="kompas-card__index">${esc(index)}</div>
    <h3 class="kompas-card__title">${esc(title)}</h3>
    <p class="kompas-card__body">${esc(body)}</p>
    ${takeaway ? `<div class="kompas-card__takeaway">${esc(takeaway)}</div>` : ""}
  </article>`;
}

export function renderKompasAccent(innerHtml, product = false) {
  return `<div class="kompas-accent${product ? " kompas-accent--product" : ""}">${innerHtml}</div>`;
}

export function renderKompasMountains(color = "#2a3d24") {
  return `<div class="kompas-mountains" aria-hidden="true"><svg viewBox="0 0 1200 176" preserveAspectRatio="none">
    <path d="M0 176 L160 70 L300 140 L470 40 L640 150 L820 60 L1000 150 L1200 70 L1200 176 Z" fill="${color}"/>
  </svg></div>`;
}

export function renderKompasTopo() {
  return `<div class="kompas-topo" aria-hidden="true"></div>`;
}
