import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { ThemeManager } from "@/components/layout/theme-manager";
import { Toast } from "@/components/ui/toast";
import { buildRootMetadata, getSiteUrl, SITE } from "@/lib/site-metadata";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const APP_URL = getSiteUrl();
const rootMetadata = buildRootMetadata(APP_URL);

export const metadata: Metadata = {
  ...rootMetadata,
  icons: {
    icon: [
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
  },
  manifest: "/manifest.json",
  other: {
    "fc:miniapp": JSON.stringify({
      version: "1",
      imageUrl: `${APP_URL}/embed-image.png`,
      button: {
        title: "Analyze Conviction",
        action: {
          type: "launch_frame",
          name: SITE.name,
          url: APP_URL,
          splashImageUrl: `${APP_URL}/splash-200.png`,
          splashBackgroundColor: "#050505",
        },
      },
    }),
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

const themeInitScript = `(function(){try{var t=localStorage.getItem("enw_theme");if(t!=="light"&&t!=="dark"){t=window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";}if(t==="dark"){document.documentElement.classList.add("dark");}}catch(e){document.documentElement.classList.add("dark");}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeManager />
        <Toast />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
