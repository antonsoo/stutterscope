import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as presentmon1 from "../../src/core/parsers/presentmon1.ts";
import * as presentmon2 from "../../src/core/parsers/presentmon2.ts";
import * as ocat from "../../src/core/parsers/ocat.ts";
import * as capframex from "../../src/core/parsers/capframex.ts";
import * as frameview from "../../src/core/parsers/frameview.ts";
import { describeStream, defaultStream, matchStream } from "../../src/core/streams.ts";
import { ParseError, type PresentStream } from "../../src/core/types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (...parts: string[]) => readFileSync(join(here, "..", "fixtures", ...parts), "utf-8");

// multi-process.csv interleaves the 5-frame demo.exe sample with dwm.exe (9 rows, one with an
// NA FrameTime, so 8 frames) and overlay.exe (2 frames) in time order.
const MULTI = fixture("presentmon2", "multi-process.csv");

describe("present streams in a multi-process capture", () => {
  it("analyses the busiest stream that isn't the compositor, even when dwm.exe presented more", () => {
    const series = presentmon2.parse(MULTI, "multi.csv");
    expect(series.meta.streams!.map((s) => [s.application, s.frameCount])).toEqual([
      ["dwm.exe", 8],
      ["demo.exe", 5],
      ["overlay.exe", 2],
    ]);
    expect(series.meta.selectedStream).toBe("1000:0x1");
    expect(series.meta.application).toBe("demo.exe");
    // Identical to parsing demo.exe on its own: frame times, time axis, and every channel.
    const alone = presentmon2.parse(fixture("presentmon2", "sample.csv"), "sample.csv");
    expect(Array.from(series.frameTimeMs)).toEqual(Array.from(alone.frameTimeMs));
    expect(Array.from(series.timeSec)).toEqual(Array.from(alone.timeSec));
    expect(Array.from(series.channels.dropped!)).toEqual([0, 0, 1, 0, 0]);
    expect(Array.from(series.channels.cpuBusyMs!)).toEqual([6, 3, 6, 6, 3]);
    expect(Array.from(series.channels.gpuBusyMs!)).toEqual([4, 8, 4, 4, 8]);
    expect(Array.from(series.channels.displayLatencyMs!)).toEqual(Array.from(alone.channels.displayLatencyMs!));
    expect(series.meta.warnings).toHaveLength(1); // the dwm.exe row with FrameTime=NA
  });

  it("selects another stream by application name, process id, or pid:swapchain", () => {
    const dwm = presentmon2.parse(MULTI, "multi.csv", { stream: "DWM.exe" });
    expect(dwm.frameCount).toBe(8);
    expect(new Set(dwm.frameTimeMs)).toEqual(new Set([6.944]));
    expect(dwm.timeSec[dwm.timeSec.length - 1]).toBeCloseTo((8 * 6.944) / 1000, 12);
    expect(dwm.meta.selectedStream).toBe("88:0x9");
    expect(presentmon2.parse(MULTI, "multi.csv", { stream: "2000" }).frameCount).toBe(2);
    expect(presentmon2.parse(MULTI, "multi.csv", { stream: "2000:0x2" }).meta.application).toBe("overlay.exe");
  });

  it("throws a ParseError naming the streams when a selector matches none", () => {
    expect(() => presentmon2.parse(MULTI, "multi.csv", { stream: "game.exe" })).toThrow(ParseError);
    expect(() => presentmon2.parse(MULTI, "multi.csv", { stream: "game.exe" })).toThrow(/demo\.exe \(pid 1000/);
  });

  it("leaves a single-stream capture untouched and still reports its one stream", () => {
    const series = presentmon2.parse(fixture("presentmon2", "sample.csv"), "sample.csv");
    expect(series.frameCount).toBe(5);
    expect(series.meta.streams).toEqual([
      { id: "1000:0x1", application: "demo.exe", processId: "1000", swapChain: "0x1", frameCount: 5 },
    ]);
    expect(series.meta.selectedStream).toBe("1000:0x1");
  });

  it("works the same way for PresentMon 1.x, OCAT, CapFrameX and FrameView", () => {
    // Take each format's single-stream fixture and splice in a busier dwm.exe stream.
    const withDwm = (text: string, dataStart: number): string => {
      const lines = text.trimEnd().split("\n");
      const first = lines[dataStart]!;
      const cols = lines[dataStart - 1]!.split(",");
      const dwmRow = first
        .split(",")
        .map((v, i) => (cols[i] === "Application" ? "dwm.exe" : cols[i] === "ProcessID" ? "88" : v))
        .join(",");
      const out = lines.slice(0, dataStart);
      for (const line of lines.slice(dataStart)) out.push(dwmRow, line, dwmRow);
      return out.join("\n") + "\n";
    };
    const cases: Array<[string, (t: string, f: string) => { frameCount: number; meta: { application?: string } }, string, number]> = [
      ["presentmon1", presentmon1.parse, fixture("presentmon1", "sample.csv"), 1],
      ["ocat", ocat.parse, fixture("ocat", "sample.csv"), 1],
      ["frameview", frameview.parse, fixture("frameview", "sample.csv"), 1],
    ];
    const cfx = fixture("capframex", "sample_with_header.csv");
    const cfxDataStart = cfx.split("\n").findIndex((l) => !l.startsWith("//")) + 1;
    cases.push(["capframex", capframex.parse, cfx, cfxDataStart]);
    for (const [name, parse, text, dataStart] of cases) {
      const alone = parse(text, "x.csv");
      const mixed = parse(withDwm(text, dataStart), "x.csv");
      expect(mixed.frameCount, name).toBe(alone.frameCount);
      expect(mixed.meta.application, name).toBe(alone.meta.application);
    }
  });
});

describe("stream selection helpers", () => {
  const stream = (application: string, processId: string, swapChain: string, frameCount: number): PresentStream => ({
    id: `${processId}:${swapChain}`,
    application,
    processId,
    swapChain,
    frameCount,
  });
  const busiestFirst = [stream("dwm.exe", "88", "0x9", 900), stream("game.exe", "7", "0xA", 500), stream("game.exe", "7", "0xB", 20)];

  it("falls back to the compositor only when nothing else presented", () => {
    expect(defaultStream(busiestFirst)!.id).toBe("7:0xA");
    expect(defaultStream([busiestFirst[0]!])!.id).toBe("88:0x9");
    expect(defaultStream([])).toBeUndefined();
  });

  it("prefers the busiest of several matching streams", () => {
    expect(matchStream(busiestFirst, "game.exe")!.id).toBe("7:0xA");
    expect(matchStream(busiestFirst, "7:0xB")!.frameCount).toBe(20);
    expect(matchStream(busiestFirst, "8")).toBeUndefined();
  });

  it("describes a stream in one line", () => {
    expect(describeStream(busiestFirst[1]!)).toBe("game.exe (pid 7, swap chain 0xA): 500 frames");
    expect(describeStream({ id: "x", application: "", processId: "", swapChain: "", frameCount: 1234 })).toBe(
      "unnamed: 1,234 frames",
    );
  });
});
