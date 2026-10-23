import "../components/plasmic/panel_uzytkownika/plasmic.css"; // plasmic-import: uSQPKY9PsZvrZSxJGSdBbi/projectcss
import type { ReactNode } from "react";
export const metadata = {
  title: "Żar i Szlif"
};
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pl">
      <body>{children}</body>
    </html>
  );
}
