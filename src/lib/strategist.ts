import { ConvictionMetrics } from "@/lib/market";

export const THESIS_TEMPLATES = {
  breakout: "Expecting a breakout on {ticker} based on 4H support flip at {price}.",
  reversion: "Mean reversion trade for {ticker}; RSI oversold, expecting bounce from {price}.",
  macro: "Macro-driven entry on {ticker} due to {event}, targeting exit at {price}.",
  custom: "",
};

export const generateThesis = (metrics: ConvictionMetrics, positions: { tokenSymbol: string }[] = [], type: keyof typeof THESIS_TEMPLATES) => {
  const ticker = positions.length > 0 ? positions[0].tokenSymbol : "$ASSET";
  const price = "0.00";
  
  if (type === "custom") return "";
  
  return THESIS_TEMPLATES[type]
    .replace("{ticker}", ticker)
    .replace("{price}", price)
    .replace("{event}", "market sentiment shift");
};

/**
 * Service to suggest thesis via AI inference
 */
export async function getAIThesisSuggestion(intent: string, metrics: ConvictionMetrics): Promise<string> {
  const response = await fetch("/api/ai/thesis", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ intent, metrics }),
  });
  
  if (!response.ok) throw new Error("Failed to generate thesis");
  const data = await response.json();
  return data.thesis;
}
