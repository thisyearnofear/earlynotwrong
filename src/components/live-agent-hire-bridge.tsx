"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { HireSignalsCta } from "@/components/hire-signals-cta";
import type { SignalsLiveTeaser } from "@/lib/signals-teaser-types";
import { GUIDANCE_LABELS } from "@/lib/signals-teaser-types";

interface LiveAgentHireBridgeProps {
  walletScore?: number;
  walletArchetype?: string;
}

/** After wallet analysis — compare to live agent guidance and route to hire. */
export function LiveAgentHireBridge({
  walletScore,
  walletArchetype,
}: LiveAgentHireBridgeProps) {
  const [teaser, setTeaser] = useState<SignalsLiveTeaser | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/agent/proxy?endpoint=signals/teaser")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setTeaser(data as SignalsLiveTeaser);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const action = teaser?.guidance.recommendedAction;
  const headline =
    walletScore != null && action
      ? `Your wallet scores ${walletScore}${
          walletArchetype ? ` (${walletArchetype})` : ""
        }. This cycle the live agent says ${GUIDANCE_LABELS[action].toLowerCase()}${
          teaser.guidance.topCandidate ? ` — watching ${teaser.guidance.topCandidate}` : ""
        }.`
      : undefined;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="col-span-1 md:col-span-6 lg:col-span-12"
    >
      <HireSignalsCta teaser={teaser} headline={headline} />
    </motion.div>
  );
}
