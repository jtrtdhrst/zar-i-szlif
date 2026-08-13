// google-handler.ts
// Handler logowania Google (OpenID Connect) dla serwera MCP Kompas Zbiórek.
// Wzorzec: cloudflare/ai — demos/remote-mcp-google-oauth (src/google-handler.ts).
//
// Google służy do logowania i identyfikacji użytkownika:
//   scopes: openid, email, profile, https://www.googleapis.com/auth/drive.file
// (bez access_type=offline, bez refresh tokena Google).
// Trwałym identyfikatorem użytkownika jest `sub` z Google.
// Do tokena MCP trafia wyłącznie minimalny kontekst identity:
//   { googleSub, email, emailVerified, name } oraz Google access token z drive.file
//   (accessToken + accessTokenExpiresAt), wykorzystywany przez Google Picker
//   wewnątrz widgetu (ui://kompas-zbiorek/workspace.html).
// Google access token nie jest nigdy tokenem MCP.

import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { AuthorizationError } from "@cloudflare/workers-oauth-provider";
import {
  addApprovedClient,
  bindStateToSession,
  createOAuthState,
  generateCSRFProtection,
  isClientApproved,
  OAuthError,
  renderApprovalDialog,
  sanitizeText,
  validateCSRFToken,
  validateOAuthState,
} from "./workers-oauth-utils";
import { getGoogleAppId, injectWidgetAuth } from "./widget-auth";

export interface AuthProps {
  googleSub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  accessToken?: string;
  accessTokenExpiresAt?: number;
}

export interface GoogleAuthHandlerEnv {
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  COOKIE_ENCRYPTION_KEY?: string;
  TEMPLATE_FILE_ID?: string;
  GOOGLE_CLOUD_PROJECT_NUMBER?: string;
  GOOGLE_PICKER_API_KEY?: string;
}

const GOOGLE_SCOPES = ["openid", "email", "profile", "https://www.googleapis.com/auth/drive.file"];
const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

const SERVER_INFO = {
  name: "Kompas Zbiórek",
  description: "Serwer MCP Kompasu Zbiórek. Logowanie przez konto Google — używane wyłącznie do identyfikacji użytkownika.",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function htmlPage(title: string, body: string): Response {
  return new Response(
    `<!doctype html><html lang="pl"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${sanitizeText(title)}</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;background:#f5f0df;color:#20301e;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center}.card{background:#fff;border-radius:12px;padding:2rem;max-width:480px;margin:1rem;box-shadow:0 8px 36px 8px rgba(0,0,0,.12)}h1{font-size:1.35rem;margin:0 0 .5rem}ul{margin:.5rem 0;padding-left:1.2rem}a{color:#1d2d19}.muted{color:#485347;font-size:.9rem;line-height:1.5}</style></head><body><div class="card"><h1>${sanitizeText(title)}</h1>${body}</div></body></html>`,
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    },
  );
}

function missingConfigPage(): Response {
  return htmlPage(
    "Logowanie Google nie jest jeszcze skonfigurowane",
    `<p class="muted">OAuth wymaga ustawienia sekretów <code>GOOGLE_CLIENT_ID</code> i <code>GOOGLE_CLIENT_SECRET</code> w Workderze <code>wtyczka-rr</code> (wrangler secret put). Do tego czasu logowanie przez Google jest niedostępne.</p>`,
  );
}

function getUpstreamAuthorizeUrl({
  clientId,
  redirectUri,
  state,
}: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const upstream = new URL(GOOGLE_AUTHORIZE_URL);
  upstream.searchParams.set("client_id", clientId);
  upstream.searchParams.set("redirect_uri", redirectUri);
  upstream.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
  upstream.searchParams.set("response_type", "code");
  upstream.searchParams.set("state", state);
  return upstream.href;
}

async function exchangeAuthorizationCode({
  code,
  redirectUri,
  env,
}: {
  code: string;
  redirectUri: string;
  env: GoogleAuthHandlerEnv;
}): Promise<{ accessToken: string; expiresIn: number }> {
  const resp = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID ?? "",
      client_secret: env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }).toString(),
  });
  if (!resp.ok) {
    const errBody = await resp.text();
    console.error("google token exchange failed:", resp.status, errBody.slice(0, 500));
    throw new OAuthError("server_error", "Google nie zaakceptowało kodu autoryzacyjnego", 502);
  }
  const body = (await resp.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) {
    console.error("google token exchange: brak access_token w odpowiedzi");
    throw new OAuthError("server_error", "Brak tokena dostępu w odpowiedzi Google", 502);
  }
  return { accessToken: body.access_token, expiresIn: body.expires_in ?? 3600 };
}

interface GoogleUserInfo {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
}

async function fetchGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const resp = await fetch(GOOGLE_USERINFO_URL, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) {
    throw new OAuthError("server_error", "Nie udało się pobrać danych użytkownika z Google", 502);
  }
  return (await resp.json()) as GoogleUserInfo;
}

function redirectToGoogle(
  request: Request,
  env: GoogleAuthHandlerEnv,
  stateToken: string,
  headers: Headers,
): Response {
  const clientId = env.GOOGLE_CLIENT_ID;
  if (!clientId || !env.GOOGLE_CLIENT_SECRET) {
    return missingConfigPage();
  }
  const redirectUri = new URL("/callback", request.url).href;
  const location = getUpstreamAuthorizeUrl({ clientId, redirectUri, state: stateToken });
  const responseHeaders = new Headers(headers);
  responseHeaders.set("location", location);
  return new Response(null, { status: 302, headers: responseHeaders });
}

export function createGoogleAuthHandler(options: { widgetHtml: string }): ExportedHandler<GoogleAuthHandlerEnv> {
  const { widgetHtml } = options;

  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      const { pathname } = url;
      console.log("route:", request.method, pathname);

      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "GET, POST, OPTIONS",
            "access-control-allow-headers": "content-type",
            "content-length": "0",
          },
        });
      }

      if (pathname === "/health") {
        return json({ ok: true, name: "Kompas Zbiórek" });
      }

      if (pathname === "/preview") {
        const previewHtml = injectWidgetAuth(widgetHtml, {
          authenticated: false,
          appId: getGoogleAppId(env),
          templateFileId: env.TEMPLATE_FILE_ID ?? null,
          developerKey: env.GOOGLE_PICKER_API_KEY ?? null,
        });
        return new Response(previewHtml, {
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
        });
      }

      if (pathname === "/") {
        return new Response("Kompas Zbiórek MCP. Użyj endpointu /mcp.", {
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
      }

      if (pathname === "/authorize" && request.method === "GET") {
        return handleAuthorizeGet(request, env);
      }

      if (pathname === "/authorize" && request.method === "POST") {
        return handleAuthorizePost(request, env);
      }

      if (pathname === "/callback" && request.method === "GET") {
        return handleCallback(request, env);
      }

      return new Response("Nie znaleziono.", { status: 404 });
    },
  };
}

async function handleAuthorizeGet(request: Request, env: GoogleAuthHandlerEnv): Promise<Response> {
  let oauthReqInfo: AuthRequest;
  try {
    oauthReqInfo = await env.OAUTH_PROVIDER.parseAuthRequest(request);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return new OAuthError(error.code, error.description, 400).toResponse();
    }
    if (error instanceof OAuthError) {
      return error.toResponse();
    }
    return json({ error: "server_error", error_description: "Wewnętrzny błąd serwera" }, 500);
  }
  const { clientId } = oauthReqInfo;
  if (!clientId) {
    return json({ error: "invalid_request", error_description: "Nieprawidłowe żądanie" }, 400);
  }

  const cookieKey = env.COOKIE_ENCRYPTION_KEY;
  if (!cookieKey) {
    return missingConfigPage();
  }

  if (await isClientApproved(request, clientId, cookieKey)) {
    const { stateToken } = await createOAuthState(oauthReqInfo, env.OAUTH_KV);
    const { setCookie: sessionBindingCookie } = await bindStateToSession(stateToken);
    const headers = new Headers();
    headers.append("Set-Cookie", sessionBindingCookie);
    return redirectToGoogle(request, env, stateToken, headers);
  }

  const { token: csrfToken, setCookie } = generateCSRFProtection();
  return renderApprovalDialog(request, {
    client: await env.OAUTH_PROVIDER.lookupClient(clientId),
    csrfToken,
    server: SERVER_INFO,
    setCookie,
    state: { oauthReqInfo },
  });
}

async function handleAuthorizePost(request: Request, env: GoogleAuthHandlerEnv): Promise<Response> {
  try {
    if (!env.COOKIE_ENCRYPTION_KEY) {
      return missingConfigPage();
    }

    const formData = await request.formData();
    validateCSRFToken(formData, request);

    const encodedState = formData.get("state");
    if (!encodedState || typeof encodedState !== "string") {
      return json({ error: "invalid_request", error_description: "Brak danych state w formularzu" }, 400);
    }

    let state: { oauthReqInfo?: AuthRequest };
    try {
      state = JSON.parse(atob(encodedState)) as { oauthReqInfo?: AuthRequest };
    } catch {
      return json({ error: "invalid_request", error_description: "Nieprawidłowe dane state" }, 400);
    }

    if (!state.oauthReqInfo?.clientId) {
      return json({ error: "invalid_request", error_description: "Nieprawidłowe żądanie" }, 400);
    }

    const approvedClientCookie = await addApprovedClient(
      request,
      state.oauthReqInfo.clientId,
      env.COOKIE_ENCRYPTION_KEY,
    );

    const { stateToken } = await createOAuthState(state.oauthReqInfo, env.OAUTH_KV);
    const { setCookie: sessionBindingCookie } = await bindStateToSession(stateToken);

    const headers = new Headers();
    headers.append("Set-Cookie", approvedClientCookie);
    headers.append("Set-Cookie", sessionBindingCookie);

    return redirectToGoogle(request, env, stateToken, headers);
  } catch (error) {
    if (error instanceof OAuthError) {
      return error.toResponse();
    }
    return json({ error: "server_error", error_description: "Wewnętrzny błąd serwera" }, 500);
  }
}

async function handleCallback(request: Request, env: GoogleAuthHandlerEnv): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const googleError = params.get("error");
  if (googleError) {
    console.error("callback: google zwrocil blad:", googleError, params.get("error_description") ?? "");
    return htmlPage(
      "Logowanie przez Google nie powiodło się",
      `<p>Google odrzuciło logowanie (${sanitizeText(googleError)}${params.get("error_description") ? " — " + sanitizeText(params.get("error_description") ?? "") : ""}).</p><p class="muted">Wróć do czatu i spróbuj połączyć się ponownie. Jeśli błąd się powtarza, sprawdź ustawienia aplikacji Google (konsola Google Cloud).</p>`,
    );
  }

  let oauthReqInfo: AuthRequest;
  let clearSessionCookie: string;

  try {
    const result = await validateOAuthState(request, env.OAUTH_KV);
    oauthReqInfo = result.oauthReqInfo;
    clearSessionCookie = result.clearCookie;
  } catch (error) {
    console.error("callback: walidacja state nie przeszla:", error instanceof Error ? error.message : String(error));
    if (error instanceof OAuthError) {
      return error.toResponse();
    }
    return json({ error: "server_error", error_description: "Wewnętrzny błąd serwera" }, 500);
  }

  if (!oauthReqInfo.clientId) {
    return json({ error: "invalid_request", error_description: "Nieprawidłowe dane żądania OAuth" }, 400);
  }

  const code = params.get("code");
  if (!code) {
    console.error("callback: brak parametru code, url:", request.url.slice(0, 200));
    return json({ error: "invalid_request", error_description: "Brak parametru code" }, 400);
  }

  try {
    const { accessToken, expiresIn } = await exchangeAuthorizationCode({
      code,
      redirectUri: new URL("/callback", request.url).href,
      env,
    });

    const userInfo = await fetchGoogleUserInfo(accessToken);

    if (!userInfo.sub) {
      return json({ error: "server_error", error_description: "Brak identyfikatora użytkownika z Google" }, 502);
    }

    const props: AuthProps = {
      googleSub: userInfo.sub,
      email: userInfo.email ?? "",
      emailVerified: userInfo.email_verified === true,
      name: userInfo.name ?? "",
      accessToken,
      accessTokenExpiresAt: Date.now() + expiresIn * 1000,
    };

    const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
      metadata: {
        label: props.name || props.email || props.googleSub,
      },
      props,
      request: oauthReqInfo,
      scope: oauthReqInfo.scope,
      userId: props.googleSub,
    });

    const headers = new Headers({ location: redirectTo });
    if (clearSessionCookie) {
      headers.append("Set-Cookie", clearSessionCookie);
    }

    return new Response(null, { status: 302, headers });
  } catch (error) {
    console.error("callback: blad zakonczenia logowania:", error instanceof Error ? error.message : String(error));
    if (error instanceof OAuthError) {
      return error.toResponse();
    }
    return json({ error: "server_error", error_description: "Nie udało się zakończyć logowania" }, 502);
  }
}
