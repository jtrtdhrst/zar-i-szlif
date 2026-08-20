// oauth.ts
// Owija istniejący handler MCP w OAuth 2.1 (Authorization Code + PKCE S256)
// z biblioteki @cloudflare/workers-oauth-provider.
//
// Worker pełni dwie role:
//   1. OAuth Server dla klientów MCP (ChatGPT) — endpointy /authorize, /token, /register,
//      metadata /.well-known/oauth-authorization-server i /.well-known/oauth-protected-resource.
//   2. OAuth Client względem Google — logowanie przez OpenID Connect (openid email profile).
//
// ChatGPT dostaje wyłącznie tokeny wydane przez ten Worker — Google token NIE jest
// tokenem MCP.

import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { createGoogleAuthHandler, type GoogleAuthHandlerEnv } from "./google-handler";

const CANONICAL_ORIGIN = "https://panel.kompaszbiorek.pl";
const CANONICAL_MCP_RESOURCE = `${CANONICAL_ORIGIN}/mcp`;

export function createKompasOAuthProvider(options: {
  apiHandler: {
    fetch(request: Request, env: GoogleAuthHandlerEnv, ctx: ExecutionContext): Promise<Response>;
  };
  widgetHtml: string;
}): OAuthProvider {
  return new OAuthProvider({
    apiRoute: "/mcp",
    apiHandler: options.apiHandler,
    defaultHandler: createGoogleAuthHandler({ widgetHtml: options.widgetHtml }),
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/token",
    clientRegistrationEndpoint: "/register",
    scopesSupported: ["kompas.read"],
    resourceMetadata: {
      resource: CANONICAL_MCP_RESOURCE,
      authorization_servers: [CANONICAL_ORIGIN],
      scopes_supported: ["kompas.read"],
      resource_name: "Kompas Zbiórek",
    },
  });
}
