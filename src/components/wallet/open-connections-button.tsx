"use client";

import type { ComponentProps } from "react";
import { useAppStore } from "@/lib/store";
import type { ConnectionChain } from "@/lib/connections";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type OpenConnectionsButtonProps = Omit<ComponentProps<typeof Button>, "onClick"> & {
  focus?: ConnectionChain;
  variant?: ComponentProps<typeof Button>["variant"] | "link";
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
};

/** Opens the Connections panel, optionally scrolled to a chain section. */
export function OpenConnectionsButton({
  focus,
  variant = "default",
  className,
  children,
  onClick,
  ...props
}: OpenConnectionsButtonProps) {
  const openConnections = useAppStore((s) => s.openConnections);

  if (variant === "link") {
    return (
      <button
        type="button"
        className={cn("text-signal hover:underline font-inherit", className)}
        onClick={(e) => {
          onClick?.(e);
          openConnections(focus);
        }}
        {...(props as ComponentProps<"button">)}
      >
        {children}
      </button>
    );
  }

  return (
    <Button
      type="button"
      variant={variant}
      className={className}
      onClick={(e) => {
        onClick?.(e);
        openConnections(focus);
      }}
      {...props}
    >
      {children}
    </Button>
  );
}
