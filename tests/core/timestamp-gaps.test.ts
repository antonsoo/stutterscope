import { describe, expect, it } from "vitest";
import { parse, parseStreaming } from "../../src/core/parsers/generic.ts";

describe("consecutive timestamp evidence", () => {
  for (const valueKind of ["timestamp_ms_cumulative", "timestamp_s_cumulative"] as const) {
    it.each(["", "NA", "invalid", "Infinity", "1e999"])(`${valueKind}: %s breaks adjacency`, async (bad) => {
      const scale = valueKind === "timestamp_s_cumulative" ? 0.001 : 1;
      const text = `frame,time,dropped\r\n1,0,0\r\n2,${16 * scale},0\r\n3,${bad},1\r\n4,${48 * scale},1\r\n5,${64 * scale},0\r\n`;
      const mapping = { valueColumn: "time", valueKind, droppedColumn: "dropped" };
      for (const result of [parse(text, mapping), await parseStreaming(new Blob([text]), mapping, "gap.csv")]) {
        expect([...result.frameTimeMs]).toEqual([16, 16]);
        expect([...result.sourceLine!]).toEqual([3, 6]);
        expect([...result.channels.dropped!]).toEqual([0, 0]);
        expect(result.meta.skippedRows).toBe(2);
        expect(result.meta.warnings[1]).toContain("line 5: cannot derive frame time after missing/invalid time");
      }
    });
  }

  it("accounts for leading, consecutive and trailing gaps without inventing frames", () => {
    const result = parse("frame,time\n1,NA\n2,0\n3,10\n4,NA\n5,NA\n6,40\n7,50\n8,NA\n", {
      valueColumn: "time", valueKind: "timestamp_ms_cumulative",
    });
    expect([...result.frameTimeMs]).toEqual([10, 10]);
    expect([...result.sourceLine!]).toEqual([4, 8]);
    expect(result.meta.skippedRows).toBe(6);
  });

  it("retains measured hitches, zero intervals, and clock restarts", () => {
    const result = parse("t\n0\n0\n100\n5\n21\n", { valueColumn: "t", valueKind: "timestamp_ms_cumulative" });
    expect([...result.frameTimeMs]).toEqual([0, 100, 16]);
    expect(result.meta.skippedRows).toBe(1);
  });

  it("does not discard the next independently measured frame time", () => {
    const result = parse("t\n16\nNA\n16\n", { valueColumn: "t", valueKind: "frametime_ms" });
    expect([...result.frameTimeMs]).toEqual([16, 16]);
    expect(result.meta.skippedRows).toBe(1);
  });
});
