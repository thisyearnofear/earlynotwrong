import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { ThemeManager } from "@/components/layout/theme-manager";
import { Toast } from "@/components/ui/toast";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://earlynotwrong.com";

export const metadata: Metadata = {
  title: "Early, Not Wrong",
  description: "An agentic on-chain behavioral analysis app",
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
  openGraph: {
    title: "Early, Not Wrong",
    description: "On-chain behavioral analysis to prove conviction",
    url: APP_URL,
    siteName: "Early, Not Wrong",
    images: [
      {
        url: `${APP_URL}/api/og`,
        width: 1200,
        height: 630,
        alt: "Early, Not Wrong - On-chain Conviction Analysis",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Early, Not Wrong",
    description: "On-chain behavioral analysis to prove conviction",
    images: [`${APP_URL}/api/og`],
    creator: "@earlynotwrong",
  },
  other: {
    // Farcaster Mini App embed meta tag (fc:miniapp for new apps)
    "fc:miniapp": JSON.stringify({
      version: "1",
      imageUrl: `${APP_URL}/api/og`,
      button: {
        title: "Analyze Conviction",
        action: {
          type: "launch_frame",
          name: "Early, Not Wrong",
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
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
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
