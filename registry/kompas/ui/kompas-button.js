export function renderKompasButton(label, action, kind = "primary", attrs = "") {
  return `<button type="button" class="btn ${kind}" data-action="${action}" ${attrs}><span class="btn-label">${label}</span><span class="btn-cap" aria-hidden="true"><svg viewBox="0 0 24 24"><path class="icon-arrow" d="M5 12h13M13 7l5 5-5 5"/></svg></span></button>`;
}
