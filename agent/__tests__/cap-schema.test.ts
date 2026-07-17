import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getCapDeliverableSchemaJson } from "../src/cap/signals-schema.js";

describe("getCapDeliverableSchemaJson", () => {
  it("returns parseable JSON object text, not a bare URL", async () => {
    const raw = await getCapDeliverableSchemaJson();
    expect(raw.startsWith("http")).toBe(false);
    const parsed = JSON.parse(raw) as { type?: string; title?: string };
    expect(parsed.type).toBe("object");
    expect(parsed.title).toBe("signals-live/v1.1");
  });

  it("loads from repo public schema when present", () => {
    const path = join(process.cwd(), "../public/schemas/signals-live-v1.1.schema.json");
    expect(existsSync(path)).toBe(true);
    const disk = JSON.parse(readFileSync(path, "utf-8")) as { title: string };
    expect(disk.title).toBe("signals-live/v1.1");
  });
});
