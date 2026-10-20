/** Brand i zakresy Google dla produktowego MCP „Żar i Szlif”.
 *
 *  Osobny moduł, bo `src/index.ts` jest wejściem Workera (ciężkie importy),
 *  a test kontraktu zgody musi je ominąć.
 */
export const PRODUCT_SERVER_INFO = {
  name: "Żar i Szlif",
  description: "Serwer MCP Żar i Szlif. Logowanie przez konto Google — używane wyłącznie do identyfikacji użytkownika.",
};

/** Minimalny zestaw zakresów: identyfikacja użytkownika. Bez Drive i Calendar. */
export const PRODUCT_GOOGLE_SCOPES = ["openid", "email", "profile"];
