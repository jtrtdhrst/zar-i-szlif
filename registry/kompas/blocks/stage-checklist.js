export function renderKompasStageChecklist(tab, active, runtime) {
  const { state, realizationLocked, canOpenStage, gateMessage, esc } = runtime || {
    state: S,
    realizationLocked,
    canOpenStage,
    gateMessage,
    esc
  };
  const items = state.dod[tab] || [];
  const done = items.length && items.every((item) => item.done);
  const timeLocked = tab === "summary" && realizationLocked();
  const gateLocked = !canOpenStage(tab);
  const locked = timeLocked || gateLocked;
  const stage = { planning: "02 Planowanie", summary: "03 Realizacja", insights: "04 Analiza", decision: "Decyzja" }[tab] || tab;
  const gateNote = gateLocked ? gateMessage(tab) : "";
  return `<div class="dod-compact dod-compact-readonly ${done ? "is-done" : ""} ${locked ? "is-locked" : ""}" ${active ? 'data-active=""' : ""}><div class="dod-compact-head"><b>${stage}</b>${timeLocked ? "<span>Zablokowany do startu</span>" : gateLocked ? "<span>Zablokowany — ukończ poprzedni etap</span>" : active ? "<span>Aktualny etap</span>" : done ? "<span>zamknięty</span>" : ""}</div>${timeLocked ? `<p class="dod-locked-note">Etap realizacji odblokuje się o ${esc(String(state.team.defaultStart || "17:00"))}.</p>` : ""}${gateLocked ? `<p class="dod-locked-note">${esc(gateNote)}</p>` : ""}<ul class="dod-compact-list">${items.map((item, index) => `<li class="dod-compact-item ${item.done ? "is-done" : ""} ${gateLocked ? "is-gated" : ""}"><span class="checkmark" aria-hidden="true">${item.done ? "✓" : ""}</span><button type="button" class="dod-compact-action" data-action="open-nearest-stage" data-dod-stage="${tab}" data-dod-index="${index}" ${gateLocked ? 'aria-disabled="true"' : ""}>${esc(item.label || "")}<span aria-hidden="true">→</span></button></li>`).join("")}</ul></div>`;
}
