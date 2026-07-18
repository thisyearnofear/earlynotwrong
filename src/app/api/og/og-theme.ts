/** Design tokens aligned with globals.css (dark / void palette). */
export const OG = {
  width: 1200,
  height: 630,
  background: "#050505",
  surface: "#0a0a0a",
  border: "#1f1f1f",
  foreground: "#ededed",
  muted: "#a1a1aa",
  dim: "#52525b",
  signal: "#22d3ee",
  signalGlow: "rgba(34, 211, 238, 0.15)",
  patience: "#34d399",
  impatience: "#fbbf24",
} as const;

const GEIST_MONO_400 =
  "https://cdn.jsdelivr.net/fontsource/fonts/geist-mono@latest/latin-400-normal.woff";
const GEIST_MONO_700 =
  "https://cdn.jsdelivr.net/fontsource/fonts/geist-mono@latest/latin-700-normal.woff";

export async function loadOgFonts() {
  const [regular, bold] = await Promise.all([
    fetch(GEIST_MONO_400).then((r) => r.arrayBuffer()),
    fetch(GEIST_MONO_700).then((r) => r.arrayBuffer()),
  ]);

  return [
    {
      name: "Geist Mono",
      data: regular,
      weight: 400 as const,
      style: "normal" as const,
    },
    {
      name: "Geist Mono",
      data: bold,
      weight: 700 as const,
      style: "normal" as const,
    },
  ];
}

export const ARCHETYPE_COLORS: Record<string, { bg: string; accent: string }> = {
  "Iron Pillar": { bg: "#050505", accent: "#22d3ee" },
  "Profit Phantom": { bg: "#0a0514", accent: "#a855f7" },
  "Exit Voyager": { bg: "#140a05", accent: "#fbbf24" },
  "Diamond Hand": { bg: "#050f0a", accent: "#34d399" },
};
