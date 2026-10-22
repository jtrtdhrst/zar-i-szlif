import type { ReactNode } from "react";

export const metadata = {
  title: "Żar i Szlif MCP",
  description: "Strona opisująca działanie MCP.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pl">
      <body>{children}</body>
    </html>
  );
}
