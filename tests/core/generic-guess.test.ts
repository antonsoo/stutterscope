// A CSV that no capture tool's parser recognizes still usually says, in its header, which
// column holds the frame timing. These are headers as tools and people write them.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { generic } from "../../src/core/parsers/index.ts";
import type { GenericValueKind } from "../../src/core/parsers/generic.ts";

const here = dirname(fileURLToPath(import.meta.url));

/** A CSV with the given header and one row per frame time (ms), each cell made by `row`. */
function csv(header: string, row: (ms: number, i: number, clockMs: number) => string, eol = "\n"): string {
  const frameTimes = Array.from({ length: 120 }, (_, i) => (i % 40 === 39 ? 48 : 16 + (i % 5) * 0.3));
  let clock = 0;
  const lines = frameTimes.map((ms, i) => {
    const line = row(ms, i, clock);
    clock += ms;
    return line;
  });
  return [header, ...lines].join(eol) + eol;
}

function guess(text: string): [string, GenericValueKind] | null {
  const found = generic.guessMapping(text);
  return found ? [found.mapping.valueColumn, found.mapping.valueKind] : null;
}

describe("guessing the column of a generic CSV", () => {
  it("takes a frame-time column over a clock and a frame rate (the bundled sample)", () => {
    const text = readFileSync(join(here, "..", "..", "examples", "samples", "generic-synthetic-demo.csv"), "utf-8");
    expect(generic.readHeader(text)).toEqual(["frame_index", "timestamp_seconds", "frame_time_ms", "fps"]);
    expect(guess(text)).toEqual(["frame_time_ms", "frametime_ms"]);
  });

  it("reads a FRAPS frametimes.csv: a frame number and a running clock in milliseconds", () => {
    const text = csv("Frame, Time (ms)", (_ms, i, clock) => `${String(i + 1).padStart(5)}, ${clock.toFixed(3).padStart(9)}`, "\r\n");
    expect(guess(text)).toEqual(["Time (ms)", "timestamp_ms_cumulative"]);
    const mapping = generic.guessMapping(text)!.mapping;
    const series = generic.parse(text, mapping);
    expect(series.frameCount).toBe(119); // 120 timestamps, 119 intervals
    expect(series.frameTimeMs[0]).toBeCloseTo(16, 6);
    expect(series.frameTimeMs[39]).toBeCloseTo(48, 6);
  });

  it("reads a game's own benchmark table: a clock, the frame time beside it, and a trailing space in the header", () => {
    // Shadow of the Tomb Raider's benchmark writes this header; the first row has no frame before it.
    const text = csv("Frame, Time (ms), Delta (ms) , Memory (mb)", (ms, i, clock) =>
      i === 0 ? "    1, 0.000, 0.000,2691" : `${String(i + 1).padStart(5)},${clock.toFixed(3)},${ms.toFixed(3)},5480`,
    );
    expect(guess(text)).toEqual(["Delta (ms)", "frametime_ms"]);
    const series = generic.parse(text, generic.guessMapping(text)!.mapping);
    expect(series.frameCount).toBe(120);
    expect(series.frameTimeMs[39]).toBeCloseTo(48, 6);
  });

  it("reads an engine's profile: FrameTime among other timings, unit from the values", () => {
    const text = csv("EVENTS,FrameTime,GameThreadTime,RenderThreadTime,GPUTime", (ms) =>
      ["", ms.toFixed(4), (ms * 0.5).toFixed(4), (ms * 0.4).toFixed(4), (ms * 0.8).toFixed(4)].join(","),
    );
    expect(guess(text)).toEqual(["FrameTime", "frametime_ms"]);
    expect(generic.guessMapping(text)!.reason).toContain("values around 16");
  });

  it.each([
    ["deltaTime", 1 / 1000, "frametime_s"],
    ["dt", 1 / 1000, "frametime_s"],
    ["frametime", 1, "frametime_ms"],
    ["Frametime", 1000, "frametime_us"],
    ["frame time [us]", 1000, "frametime_us"],
    ["FrameTimeMs", 1, "frametime_ms"],
    ["ms_per_frame", 1, "frametime_ms"],
    ["Frame Time (seconds)", 1 / 1000, "frametime_s"],
  ] as const)("a lone %s column", (name, scale, kind) => {
    const text = csv(`n,${name}`, (ms, i) => `${i},${ms * scale}`);
    expect(guess(text)).toEqual([name, kind]);
  });

  it("the stated unit wins over what the values look like", () => {
    // 0.2 ms frames (5,000 fps, a menu): the values alone would read as seconds.
    const text = csv("frame_time_ms", (ms) => String(ms / 80));
    expect(guess(text)).toEqual(["frame_time_ms", "frametime_ms"]);
  });

  it("falls back to a clock, then to a frame rate", () => {
    expect(guess(csv("frame,time_s,fps", (ms, i, clock) => `${i},${clock / 1000},${1000 / ms}`))).toEqual([
      "time_s",
      "timestamp_s_cumulative",
    ]);
    expect(guess(csv("elapsed,note", (_ms, _i, clock) => `${clock / 1000},x`))).toEqual(["elapsed", "timestamp_s_cumulative"]);
    expect(guess(csv("Time,FPS", (ms, i) => `21:14:${String(i % 60).padStart(2, "0")},${(1000 / ms).toFixed(1)}`))).toEqual([
      "FPS",
      "fps",
    ]);
  });

  it("a column named like a clock that doesn't count up is not one", () => {
    const text = csv("time,fps", (ms, i) => `${i % 7},${1000 / ms}`);
    expect(guess(text)).toEqual(["fps", "fps"]);
  });

  it("does not guess between two columns that are equally good, or among none", () => {
    expect(guess(csv("frametime_cpu_ms,frametime_gpu_ms", (ms) => `${ms},${ms * 0.9}`))).toBeNull();
    expect(guess(csv("a,b,c", (ms) => `${ms},1,2`))).toBeNull();
    expect(guess(csv("frame,value", (ms, i) => `${i},${ms}`))).toBeNull(); // "frame" is an index
    expect(guess("")).toBeNull();
    expect(guess("frametime\n")).toBeNull(); // a header and no rows
  });

  it("a main frame-time column beats ones that only mention frame time", () => {
    const text = csv("gpu_frametime_ms,frametime_ms,cpu_frametime_ms", (ms) => `${ms * 0.8},${ms},${ms * 0.5}`);
    expect(guess(text)).toEqual(["frametime_ms", "frametime_ms"]);
  });

  it("ignores a column of text even when its name fits", () => {
    const text = csv("frametime,fps", (ms) => `n/a,${1000 / ms}`);
    expect(guess(text)).toEqual(["fps", "fps"]);
  });

  it("guessKind() works out the unit of a column the user named", () => {
    const text = csv("frametime_cpu_ms,frametime_gpu_ms,load", (ms) => `${ms},${ms * 0.9},50`);
    expect(generic.guessKind(text, "frametime_gpu_ms")?.mapping).toEqual({
      valueColumn: "frametime_gpu_ms",
      valueKind: "frametime_ms",
    });
    expect(generic.guessKind(text, "load")).toBeNull();
    expect(generic.guessKind(text, "missing")).toBeNull();
  });

  it("reads a running clock in milliseconds", () => {
    const text = csv("timestamp_ms", (_ms, _i, clock) => clock.toFixed(2));
    const mapping = generic.guessMapping(text)!.mapping;
    expect(mapping.valueKind).toBe("timestamp_ms_cumulative");
    const series = generic.parse(text, mapping);
    expect(series.frameCount).toBe(119);
    expect(series.frameTimeMs[39]).toBeCloseTo(48, 6); // the 40th interval is the long frame
    const total = Array.from(series.frameTimeMs).reduce((a, b) => a + b, 0);
    expect(series.timeSec[series.frameCount - 1]).toBeCloseTo(total / 1000, 9);
  });
});
