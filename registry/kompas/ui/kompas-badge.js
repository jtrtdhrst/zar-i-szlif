export function renderKompasBadge(label = "AKTYWNY", variant = "red") {
  const map = { red: "var(--red)", gold: "var(--gold)", forest: "var(--forest-800)", muted: "var(--muted)" };
  const bg = variant === "red" ? "rgba(190,48,42,.10)" : variant === "gold" ? "rgba(214,173,47,.16)" : variant === "forest" ? "rgba(42,61,36,.12)" : "var(--paper-2)";
  return `<span style="display:inline-flex;align-items:center;min-height:26px;padding:0 10px;border-radius:999px;border:1px solid ${map[variant] || map.red};background:${bg};color:${map[variant] || map.red};font-size:11px;font-weight:900;letter-spacing:.06em;text-transform:uppercase">${label}</span>`;
}
export function renderKompasChip(label = "Chip", active = false) {
  return `<span class="chip ${active ? "chip-ok" : "chip-off"}" style="display:inline-flex">${label}</span>`;
}
