/**
 * Validates observability asset files parse and contain expected structure.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const obsRoot = join(repoRoot, "docs/observability");

describe("observability assets", () => {
  it("dashboard JSON has widgets and layout", () => {
    const dash = JSON.parse(
      readFileSync(join(obsRoot, "dashboards/agent-trading-operations.json"), "utf8"),
    );
    expect(dash.title).toContain("Early Not Wrong");
    expect(Array.isArray(dash.widgets)).toBe(true);
    expect(dash.widgets.length).toBeGreaterThanOrEqual(8);
    expect(Array.isArray(dash.layout)).toBe(true);
  });

  it("alert rules are valid v2alpha1 threshold rules", () => {
    const files = readdirSync(join(obsRoot, "alerts")).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThanOrEqual(4);

    for (const file of files) {
      const rule = JSON.parse(readFileSync(join(obsRoot, "alerts", file), "utf8"));
      expect(rule.schemaVersion).toBe("v2alpha1");
      expect(rule.ruleType).toBe("threshold_rule");
      expect(rule.condition?.selectedQueryName).toBe("A");
      expect(rule.evaluation?.rolling?.spec?.evalWindow).toBeTruthy();
    }
  });
});
