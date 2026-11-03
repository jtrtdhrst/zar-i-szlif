import { renderMemorySection } from "./memory-section.js";

const viewports = {
  mobile: { name: "375 px", styles: { width: "375px" } },
  tablet: { name: "768 px", styles: { width: "768px" } },
  desktop: { name: "1024 px", styles: { width: "1024px" } },
  wide: { name: "1440 px", styles: { width: "1440px" } }
};

export default {
  title: "Kompas/Sections/Pamięć drużyny (04)",
  tags: ["autodocs"],
  parameters: { viewport: { viewports } },
  argTypes: { activeCard: { control: "select", options: [0, 1, 2] } },
  render: (args) => `<div class="kompas-site">${renderMemorySection(args)}</div>`
};

export const Default = { args: { activeCard: 0 } };
export const Mobile = { args: { activeCard: 0 }, parameters: { viewport: { defaultViewport: "mobile" } } };
