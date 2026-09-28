// Kanoniczny kontrakt UI resource (MCP Apps) dla Wtyczki / MCP Kompasu Zbiórek.
//
// `_meta.ui.resourceUri` jest kanonem; aliasy OpenAI (`openai/*`) istnieją
// tylko kompatybilnościowo. Przy breaking change UI wydaj nowe wersjonowane
// URI (np. .../v2/...) zamiast zmieniać znaczenie v1.

export const UI_RESOURCE_URI_V1 = "ui://kompas-zbiorek/v1/workspace.html";
export const UI_MIME_TYPE = "text/html;profile=mcp-app";

// Zadeklarowana polityka osadzania bundla UI. Egzekwowana nagłówkiem CSP
// przy serwowaniu HTML (GET /); MCP Apps host stosuje własny sandbox.
export const UI_CSP = {
  frameAncestors: ["'self'"],
  connectDomains: ["'self'"],
} as const;

// Kontrakt domenowy: przestrzeń nazw resource + wersja.
export const UI_DOMAIN_CONTRACT = {
  appId: "kompas-zbiorek",
  resourceNamespace: "ui://kompas-zbiorek/",
  version: "v1",
} as const;

export function uiResourceMeta() {
  return {
    ui: {
      resourceUri: UI_RESOURCE_URI_V1,
      prefersBorder: false,
      csp: { ...UI_CSP },
      domain: { ...UI_DOMAIN_CONTRACT },
    },
  };
}

export function uiCspHeader(): string {
  return `frame-ancestors ${UI_CSP.frameAncestors[0]}; connect-src ${UI_CSP.connectDomains[0]}`;
}
