import * as React from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "outline" | "ghost" | "link" | "danger";
  size?: "default" | "sm" | "lg" | "icon";
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => {
    const variants = {
      default:
        "bg-signal text-black font-semibold hover:opacity-90 shadow-sm hover:shadow-[0_0_20px_-5px_var(--signal)] transition-all duration-300",
      outline:
        "border border-border bg-transparent hover:bg-surface-hover text-foreground hover:border-foreground-muted",
      ghost: "hover:bg-surface-hover text-foreground",
      link: "text-signal underline-offset-4 hover:underline",
      danger:
        "bg-impatience text-black font-semibold hover:opacity-90 hover:shadow-[0_0_20px_-5px_var(--impatience)]",
    };

    const sizes = {
      default: "h-10 px-4 py-2",
      sm: "h-8 rounded-md px-3 text-xs",
      lg: "h-12 rounded-md px-8 text-base",
      icon: "h-10 w-10",
    };

    return (
      <button
        className={cn(
          "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
          variants[variant],
          sizes[size],
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button };
