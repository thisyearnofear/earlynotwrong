import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Conviction Discovery | Early, Not Wrong",
  description:
    "High-conviction wallets and token heatmaps from analyzed ledgers — Ethos-gated discovery alongside the live autonomous agent.",
  openGraph: {
    title: "Conviction Discovery | Early, Not Wrong",
    description:
      "Reputation-weighted wallet discovery from behavioral conviction scans.",
    url: "https://earlynotwrong.vercel.app/discovery",
  },
};

export default function DiscoveryLayout({ children }: { children: React.ReactNode }) {
  return children;
}
