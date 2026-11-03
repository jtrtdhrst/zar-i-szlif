// oauth.ts
// Owija handler MCP w OAuth 2.1 (Authorization Code + PKCE S256) z biblioteki
// @cloudflare/workers-oauth-provider.
//
// Worker pełni dwie role:
//   1. OAuth Server dla klientów MCP (ChatGPT, MCP Inspector) — endpointy
//      /authorize, /token, /register, metadata /.well-known/oauth-authorization-server
//      oraz /.well-known/oauth-protected-resource.
//   2. OAuth Client względem Google — logowanie przez OpenID Connect (openid email profile).
//
// ChatGPT dostaje wyłącznie tokeny wydane przez ten Worker — Google token NIE jest
// tokenem MCP. Kanoniczny origin AS pochodzi z bindingu `MCP_PUBLIC_ORIGIN`
// (nie z literału w kodzie): to on trafia verbatim do `resource` w metadanych
// RFC 9728, więc jest twardo walidowany w `mcp.ts: canonicalOrigin()`.

import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { dcrRedirectUriError } from "./dcr";
import { createGoogleAuthHandler, type GoogleAuthHandlerEnv } from "./google-handler";
import { createKompasMcpHandler, type KompasMcpEnv } from "./mcp";

/** `offline_access` jest ogłaszane, żeby klient (ChatGPT) mógł odświeżać grant
 *  po wygaśnięciu tokenu; bez niego połączenie cicho traci dostęp. */
export const MCP_SCOPES = ["kompas.read", "offline_access"] as const;

export interface KompasOAuthEnv extends GoogleAuthHandlerEnv, KompasMcpEnv {}

export function createKompasOAuthProvider(options: {
  apiHandler: { fetch(request: Request, env: KompasOAuthEnv, ctx: ExecutionContext): Promise<Response> };
  widgetHtml: string;
  /** Kanoniczny origin AS, np. `https://mcp-kompas.kompaszbiorek.pl`. */
  canonicalOrigin: string;
  /** Allowlist `redirect_uri` dla DCR — patrz `dcr.ts`. Fail-closed. */
  allowedRedirectUris?: string;
}): OAuthProvider<KompasOAuthEnv> {
  const canonicalOrigin = options.canonicalOrigin.replace(/\/+$/, "");
  const allowedRedirectUris = options.allowedRedirectUris ?? "";
  return new OAuthProvider({
    apiRoute: "/mcp",
    apiHandler: options.apiHandler,
    defaultHandler: createGoogleAuthHandler({ widgetHtml: options.widgetHtml }),
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/token",
    clientRegistrationEndpoint: "/register",
    scopesSupported: [...MCP_SCOPES],
    // Hook nie dostaje `env`, więc allowlist przechodzi przez konstrukcję
    // providera (jak `canonicalOrigin`). Odrzucenie przed zapisem klienta.
    clientRegistrationCallback: ({ clientMetadata }) => {
      const error = dcrRedirectUriError(clientMetadata.redirect_uris, allowedRedirectUris);
      if (!error) return;
      return { code: "invalid_redirect_uri", description: error, httpStatus: 400 };
    },
    resourceMetadata: {
      resource: `${canonicalOrigin}/mcp`,
      authorization_servers: [canonicalOrigin],
      scopes_supported: [...MCP_SCOPES],
      resource_name: "Kompas Zbiórek",
    },
  });
}
