// Kanoniczny kontrakt UI resource (MCP Apps) dla Wtyczki / MCP Kompasu Zbiórek.
//
// `_meta.ui.resourceUri` jest kanonem; aliasy OpenAI (`openai/*`) istnieją
// tylko kompatybilnościowo. Przy breaking change UI wydaj nowe wersjonowane
// URI (np. .../v2/...) zamiast zmieniać znaczenie v1.

export const UI_RESOURCE_URI_V1 = "ui://kompas-zbiorek/v1/workspace.html";
// Compat alias: the second publisher in this repo (app/cloudflare-worker)
// still serves ui://kompas-zbiorek/workspace.html. Keep resolving it here
// (deprecated) so clients on either side resolve; remove after worker migrates.
export const UI_RESOURCE_URI_LEGACY = "ui://kompas-zbiorek/workspace.html";
export const UI_MIME_TYPE = "text/html;profile=mcp-app";

// Real embedding allowlist, enforced as CSP header on GET /.
// Public demo bundle: same-origin only; no remote script/style/object sources.
export const UI_CSP = {
  frameAncestors: ["'self'"],
  connectDomains: ["'self'"],
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'", "'unsafe-inline'"],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
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
  return [
    `default-src ${UI_CSP.defaultSrc.join(" ")}`,
    `script-src ${UI_CSP.scriptSrc.join(" ")}`,
    `style-src ${UI_CSP.styleSrc.join(" ")}`,
    `object-src ${UI_CSP.objectSrc.join(" ")}`,
    `base-uri ${UI_CSP.baseUri.join(" ")}`,
    `frame-ancestors ${UI_CSP.frameAncestors.join(" ")}`,
    `connect-src ${UI_CSP.connectDomains.join(" ")}`,
  ].join("; ");
}
