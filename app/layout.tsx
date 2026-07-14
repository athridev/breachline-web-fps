import type { Metadata, Viewport } from "next";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Breachline — Demolition Protocol",
  description: "An original modern tactical FPS playable instantly in your browser.",
  icons: { icon: "./favicon.png", shortcut: "./favicon.png" },
  openGraph: {
    title: "Breachline — Demolition Protocol",
    description: "Deploy into a complete browser-based 3D demolition match.",
    type: "website",
    images: [{ url: "./og.png", width: 1672, height: 941, alt: "Breachline tactical FPS key art" }],
  },
  twitter: { card: "summary_large_image", title: "Breachline", description: "An original modern tactical FPS for the browser.", images: ["./og.png"] },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#111719",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
