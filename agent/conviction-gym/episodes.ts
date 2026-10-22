/**
 * Conviction Gym — episode loading & slicing.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { EpisodeSpec } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function loadEpisodes(path?: string): EpisodeSpec[] {
  const file = path ?? resolve(__dirname, "../data/episodes.json");
  return JSON.parse(readFileSync(file, "utf8")) as EpisodeSpec[];
}

/** Extract a contiguous [startDay, endDay) window as a new episode. */
export function sliceEpisode(
  spec: EpisodeSpec,
  startDay: number,
  endDay: number,
  id?: string,
): EpisodeSpec {
  const days = spec.days.slice(startDay, endDay);
  if (days.length === 0) throw new Error(`empty slice [${startDay}, ${endDay}) of ${spec.id}`);
  return {
    ...spec,
    id: id ?? `${spec.id}[${startDay}:${endDay})`,
    days,
  };
}

/** Split an episode into contiguous windows of `windowDays`, tail dropped. */
export function windowEpisodes(
  spec: EpisodeSpec,
  windowDays: number,
  opts: { evalWindows?: number } = {},
): EpisodeSpec[] {
  const out: EpisodeSpec[] = [];
  const n = Math.floor(spec.days.length / windowDays);
  const evalWindows = opts.evalWindows ?? 1;
  for (let i = 0; i < n; i++) {
    out.push(sliceEpisode(
      spec,
      i * windowDays,
      (i + 1) * windowDays,
      `${spec.id}-w${i}`,
    ));
    out[out.length - 1].split = i >= n - evalWindows ? "eval" : "train";
  }
  return out;
}
