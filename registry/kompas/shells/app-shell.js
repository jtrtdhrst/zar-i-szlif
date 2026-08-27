export function renderKompasAppShell() {
  syncDodProgress();
  root.innerHTML = `<main class="app"><header>${brand()}${sidebar()}</header><div class="app-body"><main class="content">${content()}</main></div>${S.skillPicker.open ? skillPickerPopup() : ""}${activityPickerPopup()}${planDescriptionPopup()}${S.toast ? `<div class="toast" role="status">${S.toast}</div>` : ""}</main>`;
  if (S.view === "activity" && S.activityCard === "summary") document.querySelector(".activity-tabs")?.insertAdjacentHTML("afterend", activitySummarySkills());
  enhanceAnnualInterface();
  repairAnnualActivityMeta();
  enhanceAnnualCalendarDrag();
  normalizeBrandCase();
  requestAnimationFrame(fitSkillNames);
  saveDraft();
  if (S.view === "finder" && S.apiData) showResults();
}
