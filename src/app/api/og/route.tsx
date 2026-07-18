import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import { SITE } from "@/lib/site-metadata";
import { ARCHETYPE_COLORS, loadOgFonts, OG } from "./og-theme";

export const runtime = "edge";

function BrandOgCard() {
  return (
    <div
      style={{
        height: "100%",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        backgroundColor: OG.background,
        fontFamily: "Geist Mono",
        position: "relative",
        overflow: "hidden",
        padding: "56px 64px",
      }}
    >
      {/* Grid */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `linear-gradient(${OG.signalGlow} 1px, transparent 1px), linear-gradient(90deg, ${OG.signalGlow} 1px, transparent 1px)`,
          backgroundSize: "48px 48px",
        }}
      />
      {/* Radial glow */}
      <div
        style={{
          position: "absolute",
          top: "20%",
          left: "55%",
          transform: "translate(-50%, -50%)",
          width: "720px",
          height: "720px",
          background: `radial-gradient(circle, ${OG.signalGlow} 0%, transparent 68%)`,
          borderRadius: "50%",
        }}
      />
      {/* Top rule */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          position: "relative",
          zIndex: 2,
        }}
      >
        <div
          style={{
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            backgroundColor: OG.signal,
            boxShadow: `0 0 16px ${OG.signal}`,
          }}
        />
        <span
          style={{
            fontSize: "13px",
            color: OG.muted,
            letterSpacing: "4px",
            textTransform: "uppercase",
          }}
        >
          {SITE.category}
        </span>
      </div>

      {/* Wordmark + tagline */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "20px",
          position: "relative",
          zIndex: 2,
          flex: 1,
          justifyContent: "center",
          paddingTop: "12px",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
          <span
            style={{
              fontSize: "72px",
              fontWeight: 700,
              color: OG.foreground,
              letterSpacing: "-2px",
              lineHeight: 1,
            }}
          >
            EARLY
          </span>
          <span style={{ fontSize: "72px", color: OG.dim, lineHeight: 1 }}>,</span>
          <span
            style={{
              fontSize: "72px",
              fontWeight: 700,
              color: OG.muted,
              letterSpacing: "-2px",
              lineHeight: 1,
            }}
          >
            NOT WRONG
          </span>
        </div>
        <p
          style={{
            fontSize: "22px",
            color: OG.muted,
            margin: 0,
            maxWidth: "780px",
            lineHeight: 1.45,
          }}
        >
          {SITE.description}
        </p>
        <div style={{ display: "flex", gap: "12px", marginTop: "8px" }}>
          {["Analyzer", "Agent", "On-chain proof"].map((label) => (
            <div
              key={label}
              style={{
                display: "flex",
                padding: "8px 16px",
                borderRadius: "9999px",
                border: `1px solid ${OG.border}`,
                backgroundColor: OG.surface,
                fontSize: "13px",
                color: OG.muted,
                letterSpacing: "1px",
                textTransform: "uppercase",
              }}
            >
              {label}
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          position: "relative",
          zIndex: 2,
          borderTop: `1px solid ${OG.border}`,
          paddingTop: "24px",
        }}
      >
        <span style={{ fontSize: "16px", color: OG.dim, letterSpacing: "2px" }}>
          {SITE.tagline}
        </span>
        <span style={{ fontSize: "14px", color: OG.signal, letterSpacing: "2px" }}>
          earlynotwrong.com
        </span>
      </div>
    </div>
  );
}

function ShareOgCard({
  score,
  archetype,
  percentile,
  patienceTax,
  upsideCapture,
  chain,
}: {
  score: string;
  archetype: string;
  percentile: string | null;
  patienceTax: string;
  upsideCapture: string;
  chain: string;
}) {
  const colors = ARCHETYPE_COLORS[archetype] || ARCHETYPE_COLORS["Diamond Hand"];

  return (
    <div
      style={{
        height: "100%",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.bg,
        fontFamily: "Geist Mono",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `linear-gradient(${colors.accent}18 1px, transparent 1px), linear-gradient(90deg, ${colors.accent}18 1px, transparent 1px)`,
          backgroundSize: "40px 40px",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: "45%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "560px",
          height: "560px",
          background: `radial-gradient(circle, ${colors.accent}22 0%, transparent 70%)`,
          borderRadius: "50%",
        }}
      />

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "48px 56px",
          position: "relative",
          zIndex: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
          <div
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              backgroundColor: colors.accent,
              boxShadow: `0 0 16px ${colors.accent}`,
            }}
          />
          <span
            style={{
              fontSize: "13px",
              color: OG.muted,
              letterSpacing: "3px",
              textTransform: "uppercase",
            }}
          >
            Conviction analysis · {chain.toUpperCase()}
          </span>
        </div>

        <div
          style={{
            fontSize: "140px",
            fontWeight: 700,
            color: OG.foreground,
            lineHeight: 1,
            textShadow: `0 0 48px ${colors.accent}35`,
            marginBottom: "8px",
          }}
        >
          {score}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            padding: "10px 22px",
            backgroundColor: `${colors.accent}18`,
            borderRadius: "9999px",
            border: `1px solid ${colors.accent}40`,
            marginBottom: "32px",
          }}
        >
          <span
            style={{
              fontSize: "22px",
              fontWeight: 700,
              color: colors.accent,
              letterSpacing: "1px",
            }}
          >
            {archetype}
          </span>
          {percentile ? (
            <span style={{ fontSize: "15px", color: OG.muted }}>Top {percentile}%</span>
          ) : null}
        </div>

        <div style={{ display: "flex", gap: "48px" }}>
          <Metric label="Patience tax" value={`$${parseInt(patienceTax, 10).toLocaleString()}`} color={OG.impatience} />
          <div style={{ width: "1px", backgroundColor: OG.border }} />
          <Metric label="Upside capture" value={`${upsideCapture}%`} color={OG.patience} />
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          bottom: "28px",
          display: "flex",
          alignItems: "center",
          gap: "6px",
        }}
      >
        <span style={{ fontSize: "16px", fontWeight: 700, color: OG.foreground }}>EARLY</span>
        <span style={{ fontSize: "16px", color: OG.dim }}>,</span>
        <span style={{ fontSize: "16px", fontWeight: 700, color: OG.muted }}>NOT WRONG</span>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <span
        style={{
          fontSize: "12px",
          color: OG.dim,
          letterSpacing: "2px",
          textTransform: "uppercase",
          marginBottom: "6px",
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: "28px", fontWeight: 700, color }}>{value}</span>
    </div>
  );
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const variant = searchParams.get("variant");
  const scoreParam = searchParams.get("score");

  const isShare = variant === "share" || (scoreParam != null && variant !== "brand");

  const fonts = await loadOgFonts();

  if (isShare) {
    return new ImageResponse(
      (
        <ShareOgCard
          score={scoreParam || "0"}
          archetype={searchParams.get("archetype") || "Diamond Hand"}
          percentile={searchParams.get("percentile")}
          patienceTax={searchParams.get("patienceTax") || "0"}
          upsideCapture={searchParams.get("upsideCapture") || "0"}
          chain={searchParams.get("chain") || "base"}
        />
      ),
      {
        width: OG.width,
        height: OG.height,
        fonts,
      },
    );
  }

  return new ImageResponse(<BrandOgCard />, {
    width: OG.width,
    height: OG.height,
    fonts,
  });
}
