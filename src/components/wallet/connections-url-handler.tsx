"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAppStore } from "@/lib/store";
import { parseConnectionChain } from "@/lib/connections";

/**
 * Opens Connections when the URL includes ?connect=evm|solana|aleo|casper
 * (aliases: base, sol, cspr). Strips the param after handling.
 */
export function ConnectionsUrlHandler() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const openConnections = useAppStore((s) => s.openConnections);
  const handled = useRef<string | null>(null);

  useEffect(() => {
    const raw = searchParams.get("connect");
    const focus = parseConnectionChain(raw);
    if (!focus) return;

    const key = `${pathname}?connect=${raw}`;
    if (handled.current === key) return;
    handled.current = key;

    openConnections(focus);

    const next = new URLSearchParams(searchParams.toString());
    next.delete("connect");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [searchParams, pathname, router, openConnections]);

  return null;
}
