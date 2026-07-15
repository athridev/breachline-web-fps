import type { Metadata, Viewport } from "next";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Breachline — Dustline Protocol",
  description: "An original modern desert FPS with 5v5 demolition, 20-bot free for all, bunny hopping, and a karambit.",
  icons: { icon: "./favicon.png", shortcut: "./favicon.png" },
  openGraph: {
    title: "Breachline — Dustline Protocol",
    description: "Deploy into demolition or battle 20 bots in a complete browser-based desert FPS.",
    type: "website",
    images: [{ url: "./og.png", width: 1672, height: 941, alt: "Breachline tactical FPS key art" }],
  },
  twitter: { card: "summary_large_image", title: "Breachline: Dustline", description: "Demolition, 20-bot free for all, bunny hopping, and a karambit—inside your browser.", images: ["./og.png"] },
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
