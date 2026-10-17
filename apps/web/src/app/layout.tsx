import type { Metadata } from "next";
import type { ReactNode } from "react";
import { THEME_INIT_SCRIPT } from "@sessionhub/core/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "SessionHub",
  description: "Save, search and safely restore your browser windows. Local-first, with opt-in sync.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The init script sets data-theme from the stored choice before the first paint, so the
    // attribute can differ from this render (docs/UI_UX_DESIGN.md 4.1).
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-canvas text-fg antialiased">{children}</body>
    </html>
  );
}
