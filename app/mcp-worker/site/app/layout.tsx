import "../components/plasmic/strona_o_mcp/plasmic.css"; // plasmic-import: tb1j8aEH6vjGoVtS6rGrv7/projectcss
import type { ReactNode } from "react";
export const metadata = {
  title: "Żar i Szlif MCP",
  description: "Strona opisująca działanie MCP."
};
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pl">
      <body>{children}</body>
    </html>
  );
}
