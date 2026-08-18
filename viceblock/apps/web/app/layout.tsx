import type { Metadata } from "next";
import { Figtree, Teko } from "next/font/google";
import "./globals.css";

const display = Teko({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "600", "700"],
});

const body = Figtree({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "600", "800"],
});

export const metadata: Metadata = {
  title: "VICEBLOCK — Nova City Southside",
  description: "Playable pixel crime slice. Guest in. Drive. Rob. Lose the cops. Wallet optional.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
