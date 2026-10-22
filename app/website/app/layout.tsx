import "../components/plasmic/strona_internetowa/plasmic.css"; // plasmic-import: dE4b3DdZMeQM5wj8QqR9Ny/projectcss
import type { ReactNode } from "react";
export const metadata = {
  title: "Żar i Szlif",
  description: "Strona Żar i Szlif."
};
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pl">
      <body>{children}</body>
    </html>
  );
}
