import { renderHeroSection } from "./hero-section.js";

const viewports = {
  mobile: { name: "375 px", styles: { width: "375px" } },
  tablet: { name: "768 px", styles: { width: "768px" } },
  desktop: { name: "1024 px", styles: { width: "1024px" } },
  wide: { name: "1440 px", styles: { width: "1440px" } }
};

export default {
  title: "Kompas/Sections/Hero (01)",
  tags: ["autodocs"],
  parameters: { viewport: { viewports } },
  argTypes: { productSrc: { control: "text" } },
  render: (args) => `<div class="kompas-site" style="background:var(--paper)">${renderHeroSection(args)}</div>`
};

export const Default = { args: {} };
export const Mobile = { args: {}, parameters: { viewport: { defaultViewport: "mobile" } } };
