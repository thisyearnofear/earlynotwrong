"use client";

import * as React from "react";
import { MessageSquare, Users, Link as LinkIcon, Star } from "lucide-react";
import { cn } from "@/lib/utils";

interface SocialProofBadgeProps {
  type: "reviews" | "vouches" | "connections" | "mutuals";
  count: number;
  className?: string;
}

export function SocialProofBadge({ type, count, className }: SocialProofBadgeProps) {
  const configs = {
    reviews: {
      icon: MessageSquare,
      label: "Reviews",
      color: "text-signal",
      bgColor: "bg-signal/10",
      borderColor: "border-signal/20",
    },
    vouches: {
      icon: Star,
      label: "Vouches",
      color: "text-patience",
      bgColor: "bg-patience/10",
      borderColor: "border-patience/20",
    },
    connections: {
      icon: Users,
      label: "Connections",
      color: "text-ethos",
      bgColor: "bg-ethos/10",
      borderColor: "border-ethos/20",
    },
    mutuals: {
      icon: LinkIcon,
      label: "Mutuals",
      color: "text-foreground",
      bgColor: "bg-surface",
      borderColor: "border-border",
    },
  };

  const config = configs[type];
  const Icon = config.icon;

  if (count === 0 && type === "mutuals") return null;

  return (
    <div className={cn(
      "flex items-center gap-1.5 px-2 py-1 rounded border text-[10px] font-mono transition-all hover:opacity-80 cursor-default",
      config.bgColor,
      config.color,
      config.borderColor,
      className
    )}>
      <Icon className="h-3 w-3" />
      <span className="font-bold">{count}</span>
      <span className="opacity-70 uppercase tracking-tighter hidden sm:inline">{config.label}</span>
    </div>
  );
}