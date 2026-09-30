// dcr.ts
// Allowlist `redirect_uri` dla dynamic client registration (RFC 7591).
//
// Otwarte DCR na produkcyjnym authorization serverze to wyciek kodu
// autoryzacji: atakujący POSTuje /register ze swoim `redirect_uri`, przeprowadza
// /authorize za użytkownika, a kod ląduje u niego zamiast u klienta.
// `@cloudflare/workers-oauth-provider` 0.10.3 nie waliduje `redirect_uri` przy
// rejestracji, a ten Worker jest produkcyjnym AS-em — potwierdzone na
// produkcji: POST /register z `redirect_uri: https://evil.example.com/cb`
// zwracał 201. Dlatego walidacja jest tu, w jednym miejscu, przed zapisem
// klienta (hook `clientRegistrationCallback`).
//
// Dozwolone są TYLKO wartości z `MCP_ALLOWED_REDIRECT_URIS` plus loopback
// (MCP Inspector rejestruje się z `http://localhost:6274/oauth/callback`).
// ChatGPT rejestruje się przez DCR z `https://chatgpt.com/connector/oauth/{callback_id}`,
// więc dopuszczamy PREFIX ścieżki, nie pełną listę: biblioteka nie implementuje
// RFC 9207 (`authorization_response_iss_parameter_supported`), bez którego OpenAI
// użyłby stabilnego `https://chatgpt.com/connector_platform_oauth_redirect`.
// Prefiks ścieżki to jedyna pozycja kompromisu — ogranicza do hostów OpenAI.
//
// Format allowlisty: przecinki lub nowe linie; wpis BEZ ukośnika na końcu = exact
// match ścieżki, wpis Z ukośnikiem = prefiks. `https://host/` = cały origin.

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function isLoopback(uri: URL): boolean {
  return uri.protocol === "http:" && LOOPBACK_HOSTNAMES.has(uri.hostname);
}

/** Dopasowanie origin jest dokładne — `startsWith` na surowym stringu przyjąłby
 *  `https://chatgpt.com.evil.example` dla wpisu `https://chatgpt.com`. */
function matchesAllowlist(uri: URL, entry: string): boolean {
  let target: URL;
  try {
    target = new URL(entry);
  } catch {
    return false; // wadliwy wpis w konfiguracji niczego nie dopuszcza (fail-closed)
  }
  if (uri.origin !== target.origin) return false;
  return entry.endsWith("/") ? uri.pathname.startsWith(target.pathname) : uri.pathname === target.pathname;
}

/** Wpisy, które da się sparsować jako absolutny URL. Wadliwe są pomijane —
 *  nigdy nie rozszerzają allowlisty, a komunikat błędu poniżej wskazuje zmienną. */
export function parseAllowedRedirectUris(allowlist: string): string[] {
  return (allowlist ?? "")
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter((entry) => {
      if (!entry) return false;
      try {
        return Boolean(new URL(entry));
      } catch {
        return false;
      }
    });
}

/** `null` = rejestracja dozwolona; string = powód odrzucenia. Fail-closed:
 *  pusta/nieustawiona allowlist dopuszcza wyłącznie loopback. */
export function dcrRedirectUriError(redirectUris: unknown, allowlist: string): string | null {
  if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
    return "redirect_uris is required and must be a non-empty array (RFC 7591 §2).";
  }
  const allowed = parseAllowedRedirectUris(allowlist);
  for (const raw of redirectUris) {
    if (typeof raw !== "string") return "redirect_uris must contain only strings.";
    let uri: URL;
    try {
      uri = new URL(raw);
    } catch {
      return `redirect_uri must be an absolute URL: ${JSON.stringify(raw)}`;
    }
    if (isLoopback(uri)) continue;
    if (uri.protocol !== "https:") {
      return `redirect_uri must be https, or loopback http for local tooling: ${JSON.stringify(raw)}`;
    }
    if (!allowed.some((entry) => matchesAllowlist(uri, entry))) {
      return (
        `redirect_uri is not on the server allowlist: ${JSON.stringify(raw)}. ` +
        `Add it to MCP_ALLOWED_REDIRECT_URIS on the authorization server.`
      );
    }
  }
  return null;
}
