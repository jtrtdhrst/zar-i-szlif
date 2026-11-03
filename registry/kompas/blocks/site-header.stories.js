import { renderSiteHeader } from "./site-header.js";

const viewports = {
  mobile: { name: "375 px", styles: { width: "375px" } },
  tablet: { name: "768 px", styles: { width: "768px" } },
  desktop: { name: "1024 px", styles: { width: "1024px" } },
  wide: { name: "1440 px", styles: { width: "1440px" } }
};

export default {
  title: "Kompas/Sections/Nagłówek",
  tags: ["autodocs"],
  parameters: { viewport: { viewports } },
  render: (args) => `<div class="kompas-site">${renderSiteHeader(args)}</div>`
};

export const Default = { args: { active: "hero", open: false } };
export const MobileMenuOpen = { args: { active: "sytuacje", open: true }, parameters: { viewport: { defaultViewport: "mobile" } } };
