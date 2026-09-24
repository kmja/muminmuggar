import type { Metadata, Viewport } from "next";
import Providers from "./providers";
import "@fontsource/jost/300.css";
import "@fontsource/jost/400.css";
import "@fontsource/jost/500.css";
import "@fontsource/jost/600.css";
import "@fontsource/jost/700.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Moomin Mug Collection",
  description: "Photograph your Moomin mugs, auto-identify them, track your collection, and get notified when wishlisted mugs appear for sale.",
  manifest: "/manifest.json",
  applicationName: "Moomin Mugs",
  appleWebApp: { capable: true, title: "Moomin Mugs", statusBarStyle: "default" },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Let the on-screen keyboard overlay the page instead of resizing it, so the
  // add-mug bottom sheet keeps its height and the search field stays put.
  interactiveWidget: "overlays-content",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
