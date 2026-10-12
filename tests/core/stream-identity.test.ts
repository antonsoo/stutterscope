import { describe, expect, it } from "vitest";
import { createParserFor, detectFormat } from "../../src/core/parsers/index.ts";
import { parseFileStreaming, parseTextSync } from "../../src/core/stream.ts";
import { analyzeCapture } from "../../src/core/analysis.ts";
import type { SourceFormat } from "../../src/core/types.ts";

for (const format of ["presentmon1", "presentmon2", "ocat", "capframex", "frameview"] satisfies SourceFormat[]) {
  const ft = format === "presentmon1" ? "msBetweenPresents" : format === "presentmon2" ? "FrameTime" : "MsBetweenPresents";
  const text = (identity: string, rows: string[]) => `${identity},${ft},CPUBusy,GPUBusy,Dropped,DisplayedTime\n${rows.join("\n")}\n`;
  const read = (csv: string, stream?: string) => parseTextSync(csv, createParserFor(format, undefined, { stream }), "synthetic.csv");
  describe(`${format} stream identity`, () => {
    it("keeps two applications at the same address separate when the PID column is absent", async () => {
      const csv = text("Application,SwapChainAddress", [
        "game.exe,0x1,10,2,3,0,10", "dwm.exe,0x1,40,4,5,1,NA",
        "game.exe,0x1,10,6,7,0,10", "dwm.exe,0x1,40,8,9,1,NA", "game.exe,0x1,10,10,11,0,10",
      ]);
      for (const series of [read(csv), await parseFileStreaming(new Blob([csv]), createParserFor(format), "synthetic.csv")]) {
        expect(series.meta.streams?.map(s => [s.application, s.frameCount])).toEqual([["game.exe", 3], ["dwm.exe", 2]]);
        expect([...series.frameTimeMs]).toEqual([10, 10, 10]);
        expect([...series.sourceLine!]).toEqual([2, 4, 6]);
        expect([...series.gapBefore!]).toEqual([0, 0, 0]);
        expect([...series.channels.dropped!]).toEqual([0, 0, 0]);
        if (format === "presentmon2") expect([...series.channels.cpuBusyMs!]).toEqual([2, 6, 10]);
        expect(analyzeCapture(series).summary).toMatchObject({ averageFps: 100, masdMs: 0, stutter: { stutterEventCount: 0 } });
      }
      const other = read(csv, "DWM.exe");
      expect([...other.sourceLine!]).toEqual([3, 5]);
      expect([...other.frameTimeMs]).toEqual([40, 40]);
      expect([...other.channels.dropped!]).toEqual([1, 1]);
      expect(read(csv, other.meta.selectedStream).meta.selectedStream).toBe(other.meta.selectedStream);
    });

    it("keeps separate swap chains for one application and excludes the compositor by default", () => {
      const csv = text("Application,SwapChainAddress", [
        "dwm.exe,0x1,40", "dwm.exe,0x1,40", "dwm.exe,0x1,40",
        "game.exe,0x1,10", "game.exe,0x2,80", "game.exe,0x1,10",
      ]);
      expect(read(csv).meta.application).toBe("game.exe");
      const id = read(csv).meta.streams!.find(s => s.swapChain === "0x2")!.id;
      const second = read(csv, id);
      expect([...second.frameTimeMs]).toEqual([80]);
      expect([...second.sourceLine!]).toEqual([6]);
    });

    it.each([
      ["overlay.exe,0x1,NA", 60],
      ["game.exe,0x2,NA", 60],
      ["game.exe,0x1,NA", NaN],
      [",0x1,10", NaN],
      ["game.exe,,10", NaN],
    ])("%s interrupts only the streams it could belong to", (middle, masd) => {
      const s = read(text("Application,SwapChainAddress", ["game.exe,0x1,60", middle, "game.exe,0x1,120"]));
      expect(s.frameCount).toBe(2);
      expect(s.meta.skippedRows).toBe(1);
      expect(analyzeCapture(s).summary.masdMs).toBe(masd);
    });

    it("does not switch to application fallback for blank cells in a declared PID column", () => {
      const s = read(text("Application,ProcessID,SwapChainAddress", [
        "game.exe,1,0x1,60", "overlay.exe,2,0x1,20", "game.exe,,0x1,10",
        "game.exe,1,0x1,120", "overlay.exe,2,0x1,30",
      ]));
      expect([...s.frameTimeMs]).toEqual([60, 120]);
      expect(s.meta.streams).toHaveLength(2);
      expect(s.meta.warnings).toEqual(["line 4: missing ProcessID; cannot assign frame to a present stream, row skipped"]);
      expect(analyzeCapture(s).summary.masdMs).toBeNaN();
      expect(analyzeCapture(read(text("Application,ProcessID,SwapChainAddress", [
        "game.exe,1,0x1,60", "overlay.exe,2,0x1,20", "game.exe,,0x1,10",
        "game.exe,1,0x1,120", "overlay.exe,2,0x1,30",
      ]), "2")).summary.masdMs).toBeNaN();
    });

    it("requires the application only when it supplies process identity", () => {
      expect(read(text("Application,ProcessID,SwapChainAddress", [",1,0x1,10"])).frameCount).toBe(1);
      expect(read(text("Application,SwapChainAddress", [",0x1,10"])).frameCount).toBe(0);
      expect(read(text("Application", [",10"])).frameCount).toBe(0);
      expect(read(text("SwapChainAddress", ["0x1,10"])).frameCount).toBe(1);
    });
  });
}

it("application fallback tuples cannot collide through delimiters or quoting", () => {
  const csv = 'Application,SwapChainAddress,FrameTime\n"a:b",c,10\na,"b:c",20\n"a,b","x""y",30\n';
  const read = (stream?: string) => parseTextSync(csv, createParserFor("presentmon2", undefined, { stream }), "quoted.csv");
  const streams = read().meta.streams!;
  expect(new Set(streams.map(s => s.id)).size).toBe(3);
  expect(streams.map(s => [...read(s.id).frameTimeMs])).toEqual([[10], [20], [30]]);
});

it("recognizes an edited PresentMon 1 export after its PID column is removed", () => {
  const csv = "Application,SwapChainAddress,msBetweenPresents,msInPresentAPI\ngame.exe,0x1,10,1\n";
  expect(detectFormat(csv).best.format).toBe("presentmon1");
});
