// Captures come from five different tools and from users' disks: truncated files, cells that
// aren't numbers, a header with a column missing. The fixtures are mutated line by line and
// parsed; the parser and the metrics either produce a summary or raise ParseError.
import { expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { detectFormat, createParserFor } from "../../src/core/parsers/index.ts";
import { parseTextSync } from "../../src/core/stream.ts";
import { computeMetricsSummary, summaryForJson } from "../../src/core/metrics.ts";
import { MAX_KEPT_WARNINGS } from "../../src/core/csv.ts";
import { ParseError, SOURCE_FORMATS } from "../../src/core/types.ts";

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s ^ (s >>> 15), s | 1) + 0x6d2b79f5) >>> 0) / 4294967296);
}
const CELLS = ["", "NA", "nan", "NaN", "inf", "-1", "0", "1e309", "-0.0", "abc", "1,5", '"', '"x,y"', " 16.6 ", "0x10", "999999999999999999999", "1e-320", " ", "dwm.exe", "0", "16.667", "—"];

function mutate(text: string, r: () => number): string {
  let lines = text.split(/\r?\n/);
  const ops = 1 + Math.floor(r() * 8);
  for (let k = 0; k < ops; k++) {
    const op = r();
    const i = Math.floor(r() * lines.length);
    if (op < 0.25) {
      const cells = (lines[i] ?? "").split(",");
      cells[Math.floor(r() * cells.length)] = CELLS[Math.floor(r() * CELLS.length)]!;
      lines[i] = cells.join(",");
    } else if (op < 0.4) lines.splice(i, 1 + Math.floor(r() * 5));
    else if (op < 0.5) lines = lines.slice(0, i);
    else if (op < 0.6) lines.splice(i, 0, lines[Math.floor(r() * lines.length)] ?? "");
    else if (op < 0.7) lines[i] = (lines[i] ?? "").slice(0, Math.floor(r() * 40));
    else if (op < 0.8) {
      const cells = (lines[0] ?? "").split(",");
      cells.splice(Math.floor(r() * cells.length), 1);
      lines[0] = cells.join(",");
    } else if (op < 0.9) lines[i] = (lines[i] ?? "") + ",extra,,";
    else lines = lines.map((l) => (r() < 0.3 ? l.replace(/,/g, ";") : l));
  }
  const ending = r();
  return lines.join(ending < 0.4 ? "\n" : ending < 0.8 ? "\r\n" : "\r");
}

it("fuzz: mutated captures only ever raise ParseError", { timeout: 300_000 }, () => {
  const root = new URL("../fixtures/", import.meta.url).pathname;
  const sources: string[] = [];
  for (const dir of readdirSync(root)) {
    if (dir === "oracle") continue;
    for (const f of readdirSync(join(root, dir))) if (f.endsWith(".csv")) sources.push(readFileSync(join(root, dir, f), "utf8"));
  }
  let parsed = 0, rejected = 0;
  const bad: string[] = [];
  for (let seed = 1; seed <= 1200 && bad.length < 8; seed++) {
    const r = rng(seed);
    const text = mutate(sources[seed % sources.length]!, r);
    try {
      const detected = detectFormat(text.slice(0, 65536)).best.format;
      const format = r() < 0.15 ? SOURCE_FORMATS[Math.floor(r() * SOURCE_FORMATS.length)]! : detected;
      const mapping = format === "generic" ? { valueColumn: (text.split(/\r\n|\n|\r/)[0] ?? "").split(",")[Math.floor(r() * 3)] ?? "x", valueKind: "frametime_ms" as const } : undefined;
      const series = parseTextSync(text, createParserFor(format, mapping, r() < 0.2 ? { stream: "dwm.exe" } : {}), "f.csv");
      const summary = computeMetricsSummary(series);
      JSON.stringify(summaryForJson(summary));
      // Whatever the cells said, time only runs forwards and the skipped rows stay a short list.
      let previous = 0;
      for (let i = 0; i < series.frameCount; i++) {
        if (!(series.frameTimeMs[i]! >= 0) || !(series.timeSec[i]! >= previous)) throw new Error(`frame ${i}: ${series.frameTimeMs[i]} ms at ${series.timeSec[i]} s`);
        previous = series.timeSec[i]!;
      }
      if (series.meta.warnings.length > MAX_KEPT_WARNINGS + 1) throw new Error(`${series.meta.warnings.length} warnings kept`);
      if (series.meta.skippedRows < series.meta.warnings.length - 1) throw new Error("fewer skipped rows than messages about them");
      const { stutterTimeFraction, hitchTimeFraction } = summary.stutter;
      if (!(stutterTimeFraction >= 0 && stutterTimeFraction <= 1 && hitchTimeFraction >= 0 && hitchTimeFraction <= 1)) throw new Error(`stutter ${stutterTimeFraction}, hitch ${hitchTimeFraction}`);
      parsed++;
    } catch (err) {
      if (err instanceof ParseError) rejected++;
      else bad.push(`seed ${seed}: ${(err as Error).stack?.split("\n").slice(0, 4).join(" | ")}`);
    }
  }
  expect(bad).toEqual([]);
  expect(parsed).toBeGreaterThan(500);
  expect(rejected).toBeGreaterThan(10);
});
