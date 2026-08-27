import { renderBrandBook } from "./brand-book.js";

const viewports = {
  mobile: { name: "375 px", styles: { width: "375px" } },
  tablet: { name: "768 px", styles: { width: "768px" } },
  desktop: { name: "1024 px", styles: { width: "1024px" } },
  wide: { name: "1440 px", styles: { width: "1440px" } }
};

export default {
  title: "Kompas/Brand Book/Kompas",
  tags: ["autodocs"],
  parameters: { viewport: { viewports } },
  render: () => `<div class="kompas-site">${renderBrandBook()}</div>`
};

export const Default = {};
export const Mobile = { parameters: { viewport: { defaultViewport: "mobile" } } };
