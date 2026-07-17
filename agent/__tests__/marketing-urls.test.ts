import { describe, expect, it } from "vitest";
import { crooStoreUrl, dashboardHireUrl, integrationGuideUrl, withUtm } from "../lib/marketing-urls.js";

describe("marketing-urls", () => {
  it("adds UTM params to CROO Store URL", () => {
    const url = crooStoreUrl("telegram", "guidance-broadcast");
    expect(url).toContain("utm_source=telegram");
    expect(url).toContain("utm_medium=telegram");
    expect(url).toContain("utm_campaign=signals-live");
    expect(url).toContain("utm_content=guidance-broadcast");
    expect(url).toContain("agent.croo.network");
  });

  it("preserves dashboard hire hash with query params", () => {
    const url = dashboardHireUrl("telegram");
    expect(url).toMatch(/#hire$/);
    expect(url).toContain("utm_source=telegram");
  });

  it("tags integration guide URL for telegram", () => {
    const url = integrationGuideUrl("telegram", "guidance-broadcast");
    expect(url).toContain("MCP_INTEGRATION.md");
    expect(url).toContain("utm_source=telegram");
    expect(url).toContain("utm_content=guidance-broadcast");
  });

  it("withUtm leaves unknown hash intact", () => {
    const url = withUtm("https://example.com/path#anchor", {
      source: "dashboard",
      medium: "web",
      campaign: "test",
    });
    expect(url).toBe(
      "https://example.com/path?utm_source=dashboard&utm_medium=web&utm_campaign=test#anchor",
    );
  });
});
