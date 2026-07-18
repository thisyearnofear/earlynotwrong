import { Metadata } from "next";
import { buildPageMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = buildPageMetadata("discovery");

export default function DiscoveryLayout({ children }: { children: React.ReactNode }) {
  return children;
}
