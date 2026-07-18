import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = buildPageMetadata("analyzer");

export default function AnalyzerLayout({ children }: { children: React.ReactNode }) {
  return children;
}
