// panel-handler.ts
// Minimalna implementacja panelu (KOMAA-104): udostępnia interfejs widgetu
// pod ścieżką /panel oraz funkcję rozwiązywania sesji panelu.
//
// Uwaga: to jest uproszczona wersja wystarczająca do zbudowania workera i
// uruchomienia ścieżki onboardingowej. Trwała sesja panelu (cookies/KV)
// może zostać rozbudowana w dedykowanym issue — tutaj resolvePanelSession
// zwraca null, a tożsamość użytkownika dla /api/onboarding/answers
// pochodzi z payloadu (email/googleSub) przesyłanego przez widget po zalogowaniu.

import { injectWidgetAuth, getGoogleAppId } from "./widget-auth";

export interface PanelSession {
  session: {
    accessToken?: string;
    accessTokenExpiresAt?: number;
    googleSub: string;
    email: string;
    name: string;
  };
}

export function resolvePanelSession(_request: Request, _env: unknown): PanelSession | null {
  return null;
}

export function createPanelHandler(options: { widgetHtml: string }) {
  const { widgetHtml } = options;
  return {
    async handle(request: Request, env: unknown): Promise<Response> {
      const envRecord = (env ?? {}) as Record<string, unknown>;
      if (request.method !== "GET") {
        return new Response("Method Not Allowed", {
          status: 405,
          headers: { Allow: "GET" },
        });
      }
      const html = injectWidgetAuth(widgetHtml, {
        authenticated: false,
        appId: getGoogleAppId(envRecord as { GOOGLE_CLIENT_ID?: string; GOOGLE_CLOUD_PROJECT_NUMBER?: string }),
        templateFileId: (envRecord.TEMPLATE_FILE_ID as string) ?? null,
        developerKey: (envRecord.GOOGLE_PICKER_API_KEY as string) ?? null,
      });
      return new Response(html, {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
    },
  };
}
