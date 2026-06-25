import { describe, it, expect } from "vitest";
import { valueHoldings, type OnchainHolding } from "../lib/onchain-portfolio.js";

const holdings: OnchainHolding[] = [
  { symbol: "FET", contract: "0xfet", balance: 95.46 },
  { symbol: "RAVE", contract: "0xrave", balance: 9.0 },
  { symbol: "OBSCURE", contract: "0xobscure", balance: 100 },
  { symbol: "GHOST", contract: "0xghost", balance: 5 },
];

describe("valueHoldings — layered pricing fallback", () => {
  it("prefers CMC, then CoinGecko, then DexScreener", () => {
    const cmc = new Map([["FET", 0.166]]);
    const cg = new Map([["0xrave", 0.22]]);
    const dex = new Map([["0xobscure", 1.5]]);

    const { positions } = valueHoldings(holdings, cmc, cg, dex);
    const bySym = Object.fromEntries(positions.map((p) => [p.symbol, p]));

    expect(bySym.FET.priceSource).toBe("cmc");
    expect(bySym.FET.valueUsd).toBeCloseTo(95.46 * 0.166, 4);
    expect(bySym.RAVE.priceSource).toBe("coingecko");
    expect(bySym.OBSCURE.priceSource).toBe("dexscreener");
    expect(bySym.OBSCURE.valueUsd).toBeCloseTo(150, 4);
  });

  it("marks unpriceable tokens as $0 (source 'none') rather than guessing", () => {
    const { positions, totalUsd } = valueHoldings(holdings, new Map(), new Map(), new Map());
    expect(positions.every((p) => p.valueUsd === 0 && p.priceSource === "none")).toBe(true);
    expect(totalUsd).toBe(0);
  });

  it("sums total value across all priced positions", () => {
    const cmc = new Map([["FET", 1], ["RAVE", 2], ["OBSCURE", 0.5], ["GHOST", 4]]);
    const { totalUsd } = valueHoldings(holdings, cmc);
    expect(totalUsd).toBeCloseTo(95.46 * 1 + 9 * 2 + 100 * 0.5 + 5 * 4, 4);
  });

  it("treats zero/negative prices as unpriced and continues to the next source", () => {
    const cmc = new Map([["FET", 0]]);
    const cg = new Map([["0xfet", 0.166]]);
    const { positions } = valueHoldings([holdings[0]], cmc, cg);
    expect(positions[0].priceSource).toBe("coingecko");
    expect(positions[0].priceUsd).toBeCloseTo(0.166, 4);
  });
});
