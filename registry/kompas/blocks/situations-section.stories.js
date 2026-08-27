import { renderSituationsSection } from "./situations-section.js";

const viewports = {
  mobile: { name: "375 px", styles: { width: "375px" } },
  tablet: { name: "768 px", styles: { width: "768px" } },
  desktop: { name: "1024 px", styles: { width: "1024px" } },
  wide: { name: "1440 px", styles: { width: "1440px" } }
};

export default {
  title: "Kompas/Sections/Wyzwania (02)",
  tags: ["autodocs"],
  parameters: { viewport: { viewports } },
  argTypes: { activeIndex: { control: "select", options: [0, 1, 2] } },
  render: (args) => `<div class="kompas-site">${renderSituationsSection(args)}</div>`
};

export const Default = { args: { activeIndex: 0 } };
export const ActiveSecond = { args: { activeIndex: 1 } };
export const Mobile = { args: { activeIndex: 0 }, parameters: { viewport: { defaultViewport: "mobile" } } };
