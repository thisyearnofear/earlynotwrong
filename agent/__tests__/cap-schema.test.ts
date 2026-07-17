import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  CROO_STORE_DELIVERABLE_SCHEMA,
  getCapDeliverableSchemaJson,
} from "../src/cap/signals-schema.js";

describe("CAP deliverable schema", () => {
  it("Store listing schema is valid JSON with four required sections", () => {
    const parsed = JSON.parse(CROO_STORE_DELIVERABLE_SCHEMA) as {
      required: string[];
    };
    expect(parsed.required.sort()).toEqual(
      ["freshness", "guidance", "provenance", "signals"].sort(),
    );
  });

  it("public JSON Schema file exists for docs and MCP", async () => {
    const raw = await getCapDeliverableSchemaJson();
    const parsed = JSON.parse(raw) as { title?: string };
    expect(parsed.title).toBe("signals-live/v1.1");
  });

  it("loads from repo public schema when present", () => {
    const path = join(process.cwd(), "../public/schemas/signals-live-v1.1.schema.json");
    expect(existsSync(path)).toBe(true);
    const disk = JSON.parse(readFileSync(path, "utf-8")) as { title: string };
    expect(disk.title).toBe("signals-live/v1.1");
  });
});
