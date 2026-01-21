import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";

export const runtime = "edge";

const ARCHETYPE_COLORS: Record<string, { bg: string; accent: string }> = {
  "Iron Pillar": { bg: "#0a1628", accent: "#22d3ee" },
  "Profit Phantom": { bg: "#1a0a28", accent: "#a855f7" },
  "Exit Voyager": { bg: "#281a0a", accent: "#f59e0b" },
  "Diamond Hand": { bg: "#0a281a", accent: "#34d399" },
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const score = searchParams.get("score") || "0";
  const archetype = searchParams.get("archetype") || "Diamond Hand";
  const percentile = searchParams.get("percentile") || "50";
  const patienceTax = searchParams.get("patienceTax") || "0";
  const upsideCapture = searchParams.get("upsideCapture") || "0";
  const chain = searchParams.get("chain") || "solana";

  const colors = ARCHETYPE_COLORS[archetype] || ARCHETYPE_COLORS["Diamond Hand"];

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.bg,
          fontFamily: "monospace",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Grid Background */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundImage: `linear-gradient(${colors.accent}15 1px, transparent 1px), linear-gradient(90deg, ${colors.accent}15 1px, transparent 1px)`,
            backgroundSize: "40px 40px",
          }}
        />

        {/* Radial Glow */}
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: "600px",
            height: "600px",
            background: `radial-gradient(circle, ${colors.accent}20 0%, transparent 70%)`,
            borderRadius: "50%",
          }}
        />

        {/* Content Container */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "60px",
            position: "relative",
            zIndex: 10,
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginBottom: "20px",
            }}
          >
            <div
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                backgroundColor: colors.accent,
                boxShadow: `0 0 20px ${colors.accent}`,
              }}
            />
            <span
              style={{
                fontSize: "14px",
                color: "#a1a1aa",
                letterSpacing: "3px",
                textTransform: "uppercase",
              }}
            >
              Conviction Analysis • {chain.toUpperCase()}
            </span>
          </div>

          {/* Score */}
          <div
            style={{
              fontSize: "180px",
              fontWeight: "bold",
              color: "#ededed",
              lineHeight: 1,
              textShadow: `0 0 60px ${colors.accent}40`,
              marginBottom: "10px",
            }}
          >
            {score}
          </div>

          {/* Archetype Badge */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              padding: "12px 24px",
              backgroundColor: `${colors.accent}20`,
              borderRadius: "9999px",
              border: `1px solid ${colors.accent}40`,
              marginBottom: "40px",
            }}
          >
            <span
              style={{
                fontSize: "24px",
                fontWeight: "600",
                color: colors.accent,
                letterSpacing: "1px",
              }}
            >
              {archetype}
            </span>
            <span
              style={{
                fontSize: "16px",
                color: "#a1a1aa",
              }}
            >
              Top {percentile}%
            </span>
          </div>

          {/* Metrics Row */}
          <div
            style={{
              display: "flex",
              gap: "60px",
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
              }}
            >
              <span
                style={{
                  fontSize: "14px",
                  color: "#71717a",
                  letterSpacing: "2px",
                  textTransform: "uppercase",
                  marginBottom: "8px",
                }}
              >
                Patience Tax
              </span>
              <span
                style={{
                  fontSize: "32px",
                  fontWeight: "600",
                  color: "#fbbf24",
                }}
              >
                ${parseInt(patienceTax).toLocaleString()}
              </span>
            </div>

            <div
              style={{
                width: "1px",
                backgroundColor: "#27272a",
              }}
            />

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
              }}
            >
              <span
                style={{
                  fontSize: "14px",
                  color: "#71717a",
                  letterSpacing: "2px",
                  textTransform: "uppercase",
                  marginBottom: "8px",
                }}
              >
                Upside Capture
              </span>
              <span
                style={{
                  fontSize: "32px",
                  fontWeight: "600",
                  color: "#34d399",
                }}
              >
                {upsideCapture}%
              </span>
            </div>
          </div>

          {/* Footer */}
          <div
            style={{
              position: "absolute",
              bottom: "30px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <span
              style={{
                fontSize: "18px",
                fontWeight: "bold",
                color: "#ededed",
                letterSpacing: "1px",
              }}
            >
              EARLY
            </span>
            <span style={{ fontSize: "18px", color: "#52525b" }}>,</span>
            <span
              style={{
                fontSize: "18px",
                fontWeight: "bold",
                color: "#71717a",
                letterSpacing: "1px",
              }}
            >
              NOT WRONG
            </span>
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  );
}
