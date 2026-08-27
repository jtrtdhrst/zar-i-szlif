import { renderCycleSection } from "./cycle-section.js";

const viewports = {
  mobile: { name: "375 px", styles: { width: "375px" } },
  tablet: { name: "768 px", styles: { width: "768px" } },
  desktop: { name: "1024 px", styles: { width: "1024px" } },
  wide: { name: "1440 px", styles: { width: "1440px" } }
};

export default {
  title: "Kompas/Sections/Pełny cykl (03)",
  tags: ["autodocs"],
  parameters: { viewport: { viewports } },
  argTypes: { activeStep: { control: "select", options: [0, 1, 2, 3] } },
  render: (args) => `<div class="kompas-site" style="background:var(--paper)">${renderCycleSection(args)}</div>`
};

export const Default = { args: { activeStep: 0 } };
export const ActiveDecision = { args: { activeStep: 3 } };
export const Mobile = { args: { activeStep: 0 }, parameters: { viewport: { defaultViewport: "mobile" } } };
