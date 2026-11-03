export function renderKompasInput({ label = "Pole tekstowe", placeholder = "Wpisz wartość", value = "", type = "text", disabled = false, error = "" } = {}) {
  const err = error ? `<small style="color:var(--red);font-size:12px;line-height:16px">${error}</small>` : "";
  return `<label class="field" style="max-width:480px"><span>${label}</span><input type="${type}" value="${value}" placeholder="${placeholder}" ${disabled ? "disabled" : ""} aria-invalid="${error ? "true" : "false"}" />${err}</label>`;
}
export function renderKompasTextarea({ label = "Opis", placeholder = "Opisz…", value = "", disabled = false } = {}) {
  return `<label class="field" style="max-width:480px"><span>${label}</span><textarea placeholder="${placeholder}" ${disabled ? "disabled" : ""}>${value}</textarea></label>`;
}
export function renderKompasSelect({ label = "Wybierz", options = ["Opcja 1", "Opcja 2", "Opcja 3"], value = "", disabled = false } = {}) {
  return `<label class="field" style="max-width:480px"><span>${label}</span><select ${disabled ? "disabled" : ""}>${options.map((o) => `<option ${o === value ? "selected" : ""}>${o}</option>`).join("")}</select></label>`;
}
