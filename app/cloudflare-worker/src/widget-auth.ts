// widget-auth.ts
// Wstrzykiwanie konfiguracji Google (token dostępu, numer projektu, szablon)
// do HTML widgetu Kompasu Zbiórek (ui://kompas-zbiorek/workspace.html).
//
// Widget czyta `window.__KOMPAS_OAUTH__` dopiero w momencie kliknięcia
// „Otwórz Google Picker", więc wstrzyknięcie skryptu następuje przy serwowaniu
// HTML (resources/read dla zalogowanego użytkownika, /preview bez tokena).

export interface WidgetAuthConfig {
  authenticated: boolean;
  accessToken?: string;
  expiresAt?: number;
  appId?: string | null;
  templateFileId?: string | null;
  sheetsTemplateFileId?: string | null;
  developerKey?: string | null;
  // Tożsamość zalogowanego użytkownika (Google OAuth) — przekazywana do
  // widgetu, by mógł wysłać odpowiedzi onboardingowe pod właściwym użytkownikiem.
  email?: string | null;
  googleSub?: string | null;
  panel?: boolean;
}

export function injectWidgetAuth(html: string, config: WidgetAuthConfig): string {
  const script = `<script>window.__KOMPAS_OAUTH__=${JSON.stringify(config)};</script>`;
  return html.replace("</body>", script + "</body>");
}

export function getGoogleAppId(env: {
  GOOGLE_CLOUD_PROJECT_NUMBER?: string;
  GOOGLE_CLIENT_ID?: string;
}): string | null {
  if (env.GOOGLE_CLOUD_PROJECT_NUMBER) {
    return env.GOOGLE_CLOUD_PROJECT_NUMBER;
  }
  const match = /^(\d+)-/.exec(env.GOOGLE_CLIENT_ID ?? "");
  return match ? match[1] : null;
}
