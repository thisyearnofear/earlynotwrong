"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { cn } from "@/lib/utils";

interface ElectricBorderProps {
  children: ReactNode;
  className?: string;
  /** CSS color — defaults to var(--signal) */
  color?: string;
  /** Stronger glow + faster animation */
  active?: boolean;
  /** Idle shimmer so users know the surface is interactive */
  hint?: boolean;
  borderRadius?: number;
  as?: "div" | "button";
  onClick?: () => void;
  type?: "button";
  "aria-expanded"?: boolean;
  "aria-label"?: string;
  title?: string;
}

class ElectricBorderCanvas {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private animationId: number | null = null;
  private time = 0;
  private lastFrameTime = 0;
  private running = false;

  constructor(
    canvas: HTMLCanvasElement,
    private options: {
      color: string;
      borderRadius: number;
      active: boolean;
      borderOffset: number;
    },
  ) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable");
    this.ctx = ctx;
  }

  setOptions(options: Partial<typeof this.options>) {
    this.options = { ...this.options, ...options };
  }

  resize(width: number, height: number) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = width;
    this.height = height;
    this.canvas.width = Math.ceil(width * dpr);
    this.canvas.height = Math.ceil(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private random(x: number) {
    return (Math.sin(x * 12.9898) * 43758.5453) % 1;
  }

  private noise2D(x: number, y: number) {
    const i = Math.floor(x);
    const j = Math.floor(y);
    const fx = x - i;
    const fy = y - j;
    const a = this.random(i + j * 57);
    const b = this.random(i + 1 + j * 57);
    const c = this.random(i + (j + 1) * 57);
    const d = this.random(i + 1 + (j + 1) * 57);
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    return (
      a * (1 - ux) * (1 - uy) +
      b * ux * (1 - uy) +
      c * (1 - ux) * uy +
      d * ux * uy
    );
  }

  private octavedNoise(
    x: number,
    octaves: number,
    lacunarity: number,
    gain: number,
    amplitude: number,
    frequency: number,
    time: number,
    seed: number,
  ) {
    let y = 0;
    let amp = amplitude;
    let freq = frequency;
    for (let i = 0; i < octaves; i++) {
      y += amp * this.noise2D(freq * x + seed * 100, time * freq * 0.3);
      freq *= lacunarity;
      amp *= gain;
    }
    return y;
  }

  private getCornerPoint(
    cx: number,
    cy: number,
    radius: number,
    startAngle: number,
    arcLength: number,
    progress: number,
  ) {
    const angle = startAngle + progress * arcLength;
    return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
  }

  private getRoundedRectPoint(
    t: number,
    left: number,
    top: number,
    width: number,
    height: number,
    radius: number,
  ) {
    const straightWidth = width - 2 * radius;
    const straightHeight = height - 2 * radius;
    const cornerArc = (Math.PI * radius) / 2;
    const totalPerimeter =
      2 * straightWidth + 2 * straightHeight + 4 * cornerArc;
    const distance = t * totalPerimeter;
    let accumulated = 0;

    if (distance <= accumulated + straightWidth) {
      const progress = (distance - accumulated) / straightWidth;
      return { x: left + radius + progress * straightWidth, y: top };
    }
    accumulated += straightWidth;

    if (distance <= accumulated + cornerArc) {
      const progress = (distance - accumulated) / cornerArc;
      return this.getCornerPoint(
        left + width - radius,
        top + radius,
        radius,
        -Math.PI / 2,
        Math.PI / 2,
        progress,
      );
    }
    accumulated += cornerArc;

    if (distance <= accumulated + straightHeight) {
      const progress = (distance - accumulated) / straightHeight;
      return { x: left + width, y: top + radius + progress * straightHeight };
    }
    accumulated += straightHeight;

    if (distance <= accumulated + cornerArc) {
      const progress = (distance - accumulated) / cornerArc;
      return this.getCornerPoint(
        left + width - radius,
        top + height - radius,
        radius,
        0,
        Math.PI / 2,
        progress,
      );
    }
    accumulated += cornerArc;

    if (distance <= accumulated + straightWidth) {
      const progress = (distance - accumulated) / straightWidth;
      return {
        x: left + width - radius - progress * straightWidth,
        y: top + height,
      };
    }
    accumulated += straightWidth;

    if (distance <= accumulated + cornerArc) {
      const progress = (distance - accumulated) / cornerArc;
      return this.getCornerPoint(
        left + radius,
        top + height - radius,
        radius,
        Math.PI / 2,
        Math.PI / 2,
        progress,
      );
    }
    accumulated += cornerArc;

    if (distance <= accumulated + straightHeight) {
      const progress = (distance - accumulated) / straightHeight;
      return { x: left, y: top + height - radius - progress * straightHeight };
    }
    accumulated += straightHeight;

    const progress = (distance - accumulated) / cornerArc;
    return this.getCornerPoint(
      left + radius,
      top + radius,
      radius,
      Math.PI,
      Math.PI / 2,
      progress,
    );
  }

  private draw(currentTime: number) {
    if (!this.running) return;

    const delta = (currentTime - this.lastFrameTime) / 1000;
    this.time += delta * (this.options.active ? 2.2 : 1.2);
    this.lastFrameTime = currentTime;

    const { color, borderRadius, borderOffset, active } = this.options;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    const left = borderOffset;
    const top = borderOffset;
    const borderWidth = this.width - 2 * borderOffset;
    const borderHeight = this.height - 2 * borderOffset;
    const maxRadius = Math.min(borderWidth, borderHeight) / 2;
    const radius = Math.min(borderRadius, maxRadius);
    const displacement = active ? 28 : 18;
    const amplitude = active ? 0.09 : 0.055;
    const approximatePerimeter =
      2 * (borderWidth + borderHeight) + 2 * Math.PI * radius;
    const sampleCount = Math.floor(approximatePerimeter / 2);

    ctx.strokeStyle = color;
    ctx.lineWidth = active ? 1.25 : 1;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalAlpha = active ? 0.95 : 0.55;
    ctx.beginPath();

    for (let i = 0; i <= sampleCount; i++) {
      const progress = i / sampleCount;
      const point = this.getRoundedRectPoint(
        progress,
        left,
        top,
        borderWidth,
        borderHeight,
        radius,
      );
      const xNoise = this.octavedNoise(
        progress * 8,
        8,
        1.6,
        0.65,
        amplitude,
        10,
        this.time,
        0,
      );
      const yNoise = this.octavedNoise(
        progress * 8,
        8,
        1.6,
        0.65,
        amplitude,
        10,
        this.time,
        1,
      );
      const x = point.x + xNoise * displacement;
      const y = point.y + yNoise * displacement;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }

    ctx.closePath();
    ctx.stroke();
    ctx.globalAlpha = 1;

    this.animationId = requestAnimationFrame((t) => this.draw(t));
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastFrameTime = performance.now();
    this.animationId = requestAnimationFrame((t) => this.draw(t));
  }

  stop() {
    this.running = false;
    if (this.animationId != null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    this.ctx.clearRect(0, 0, this.width, this.height);
  }
}

/**
 * Animated signal border — subtle idle hint, stronger when active/hovered.
 * Falls back to static glow when prefers-reduced-motion.
 */
export function ElectricBorder({
  children,
  className,
  color = "var(--signal)",
  active = false,
  hint = false,
  borderRadius = 12,
  as = "div",
  onClick,
  type,
  ...rest
}: ElectricBorderProps) {
  const shellRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<ElectricBorderCanvas | null>(null);
  const [hovered, setHovered] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [resolvedColor, setResolvedColor] = useState("#22d3ee");

  const shouldAnimate = hint || active || hovered;

  const resolveColor = useCallback(() => {
    const shell = shellRef.current;
    if (!shell) return;
    if (color.startsWith("var(")) {
      const prop = color.slice(4, -1).trim();
      const value = getComputedStyle(shell).getPropertyValue(prop).trim();
      if (value) setResolvedColor(value);
    } else {
      setResolvedColor(color);
    }
  }, [color]);

  const syncSize = useCallback(() => {
    const shell = shellRef.current;
    const canvas = canvasRef.current;
    if (!shell || !canvas) return;
    resolveColor();
    const rect = shell.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    if (!engineRef.current) {
      engineRef.current = new ElectricBorderCanvas(canvas, {
        color: resolvedColor,
        borderRadius,
        active,
        borderOffset: 4,
      });
    }
    engineRef.current.setOptions({
      color: resolvedColor,
      borderRadius,
      active: active || hovered,
    });
    engineRef.current.resize(rect.width, rect.height);
  }, [resolveColor, resolvedColor, borderRadius, active, hovered]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (reducedMotion || !shouldAnimate) {
      engineRef.current?.stop();
      return;
    }
    syncSize();
    engineRef.current?.start();
    return () => engineRef.current?.stop();
  }, [reducedMotion, shouldAnimate, syncSize]);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const ro = new ResizeObserver(() => syncSize());
    ro.observe(shell);
    return () => ro.disconnect();
  }, [syncSize]);

  const Tag = as;

  return (
    <Tag
      ref={shellRef as RefObject<HTMLDivElement & HTMLButtonElement>}
      type={type}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      className={cn(
        "electric-border-shell relative overflow-hidden",
        (hint || onClick) && "cursor-pointer",
        active && "electric-border-shell--active",
        className,
      )}
      {...rest}
    >
      <span aria-hidden className="electric-border-glow electric-border-glow-1" />
      <span aria-hidden className="electric-border-glow electric-border-glow-2" />
      <span aria-hidden className="electric-border-bg-glow" />

      {!reducedMotion && shouldAnimate && (
        <canvas
          ref={canvasRef}
          className="electric-border-canvas pointer-events-none"
          aria-hidden
        />
      )}

      <div className="relative z-[1] w-full h-full">{children}</div>
    </Tag>
  );
}
