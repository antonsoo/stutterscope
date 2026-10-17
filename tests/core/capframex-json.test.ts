import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parse, createParser, requireNativeJsonSize, MAX_NATIVE_JSON_BYTES } from "../../src/core/parsers/capframex-json.ts";
import { detectFormat, createParserFor } from "../../src/core/parsers/index.ts";
import { parseFileStreaming, parseTextSync } from "../../src/core/stream.ts";
import { analyzeCapture } from "../../src/core/analysis.ts";
import { buildJsonReport } from "../../src/core/report.ts";
import { DEFAULT_STUTTER_OPTIONS } from "../../src/core/metrics.ts";
import { buildMarkdownTable } from "../../src/ui/share.ts";

const fixture = readFileSync(new URL("../fixtures/capframex-json/session.json", import.meta.url), "utf8");
const session = (data: unknown) => JSON.stringify({ Info: { ProcessName: "scene.exe" }, Runs: [{ CaptureData: data }] });

describe("native CapFrameX saved sessions", () => {
  it("reads the exact BOM-marked output of the pinned upstream C# session serializer", () => {
    const text = readFileSync(new URL("../fixtures/capframex-json/native-writer.json", import.meta.url), "utf8");
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const first = parse(text);
    expect([...first.frameTimeMs]).toEqual([10, 100, 100, 100, 10]);
    expect([...first.sourceSample!]).toEqual([0, 1, 3, 4, 5]);
    expect([...first.channels.cpuBusyMs!]).toEqual([2, 3, NaN, 6, 7]);
    expect(first.meta.nativeCapture?.appVersion).toBe("1.9.1.5");
    const second = parse(text, "native-writer.json", { captureRun: 2 });
    expect(second.frameCount).toBe(4);
    expect(second.channels.cpuBusyMs).toBeUndefined();
    expect(second.channels.gpuBusyMs).toBeUndefined();
  });

  it("keeps one recording, original array indices, aligned telemetry and a gap at the rejected sample", () => {
    expect(detectFormat(fixture).best.format).toBe("capframex-json");
    const series = parse(fixture);
    expect([...series.frameTimeMs]).toEqual([10, 100, 100, 100, 10]);
    expect([...series.sourceSample!]).toEqual([0, 1, 3, 4, 5]);
    expect(series.sourceLine).toBeUndefined();
    expect([...series.gapBefore!]).toEqual([0, 0, 1, 0, 0]);
    expect([...series.channels.dropped!]).toEqual([0, 1, 2, 0, 2]);
    expect([...series.channels.cpuBusyMs!]).toEqual([2, 3, NaN, 8, 4]);
    expect([...series.channels.gpuBusyMs!]).toEqual([4, 5, 7, 4, 6]);
    expect([...series.channels.displayLatencyMs!]).toEqual([8, 0, NaN, 15, 9]);
    expect(series.meta.nativeCapture).toMatchObject({ selectedRun: 1, runs: [{ run: 1, sampleCount: 6 }, { run: 2, sampleCount: 4 }], frameTimePath: "Runs[0].CaptureData.MsBetweenPresents" });
    expect(series.meta.warnings[0]).toContain("MsBetweenPresents[2]");
    const a = analyzeCapture(series);
    expect(a.summary.pacingCoverage).toEqual({ observedPairs: 3, gapBoundaries: 1 });
    const report = buildJsonReport(a.series, a.summary, DEFAULT_STUTTER_OPTIONS, undefined, a.selection);
    expect(report.analysis.continuity.gaps).toEqual([{ beforeFrame: 3, sourceLine: null, sourceSample: 3 }]);
    expect(report.episodes.map(e => [e.firstSourceSample, e.lastSourceSample])).toEqual([[1, 1], [3, 4]]);
  });

  it("retains native provenance through interval selection, JSON and Markdown exports", () => {
    const a = analyzeCapture(parse(fixture), undefined, { startSec: 0.11, endSec: 0.31 });
    expect([...a.series.sourceSample!]).toEqual([3, 4]);
    expect(a.summary.frameCount).toBe(2);
    expect(a.summary.telemetryCoverage.dropped).toEqual({ observedFrames: 1, unknownFrames: 1 });
    const report = buildJsonReport(a.series, a.summary, DEFAULT_STUTTER_OPTIONS, undefined, a.selection);
    expect(report.episodes[0]).toMatchObject({ firstFrame: 3, lastFrame: 4, firstSourceSample: 3, lastSourceSample: 4 });
    expect(report.source.nativeCapture?.frameTimePath).toBe("Runs[0].CaptureData.MsBetweenPresents");
    const md = buildMarkdownTable(a.series, a.summary, DEFAULT_STUTTER_OPTIONS, undefined, a.selection);
    expect(md).toContain("Native recording: 1 of 2");
    expect(md).toContain("indices are zero-based");
  });

  it("selects the other recording without inheriting telemetry or concatenating times", () => {
    const series = parse(fixture, "session.json", { captureRun: 2 });
    expect([...series.frameTimeMs]).toEqual([20, 20, 20, 20]);
    expect([...series.timeSec]).toEqual([0.02, 0.04, 0.06, 0.08]);
    expect([...series.sourceSample!]).toEqual([0, 1, 2, 3]);
    expect(series.channels.dropped).toBeUndefined();
    expect(series.channels.cpuBusyMs).toBeUndefined();
    expect(analyzeCapture(series).summary.averageFps).toBe(50);
  });

  it("does not coerce numbers, nulls or string flags into recorded observations", () => {
    const series = parse(session({ MsBetweenPresents: [true, null, "16", -1, Number.POSITIVE_INFINITY, 0, 16], Dropped: [false, false, false, false, false, 1, true] }));
    expect([...series.frameTimeMs]).toEqual([0, 16]);
    expect([...series.sourceSample!]).toEqual([5, 6]);
    expect([...series.channels.dropped!]).toEqual([2, 1]);
    expect(series.meta.skippedRows).toBe(5);
  });

  for (const name of ["Dropped", "CpuActive", "GpuActive", "MsUntilDisplayed", "TimeInSeconds"]) it(`refuses a misaligned ${name} array before assigning values`, () => {
    expect(() => parse(session({ MsBetweenPresents: [16, 17], [name]: [1] }))).toThrow(/Cannot align frame evidence/);
    expect(() => parse(session({ MsBetweenPresents: [16, 17], [name]: "0,1" }))).toThrow(/must be an array/);
  });

  it("rejects ambiguous duplicate members, including escaped keys and metadata objects", () => {
    for (const text of [
      '{"Info":{},"Runs":[],"R\\u0075ns":[{"CaptureData":{"MsBetweenPresents":[16]}}]}',
      '{"Info":{"ProcessName":"A","ProcessName":"B"},"Runs":[]}',
      '{"Info":{},"Runs":[{"CaptureData":{"MsBetweenPresents":[16],"MsBetweenPresents":[17]}}]}',
    ]) expect(() => parse(text)).toThrow(/duplicate JSON member/);
    expect(parse(session({ MsBetweenPresents: [16], Note: 'A quote: " and a slash: \\; { "Runs": ' })).frameCount).toBe(1);
  });

  it("rejects unsupported documents, truncated JSON, invalid selection and absent frame evidence", () => {
    for (const text of ["[]", "{}", '{"Info":{},"Runs":[]}', fixture.slice(0, -5), session({ MsBetweenPresents: [null, "NaN"] }), session({ MsBetweenPresents: [] })]) expect(() => parse(text)).toThrow();
    for (const captureRun of [0, 1.5, 3, NaN]) expect(() => parse(fixture, "x.json", { captureRun })).toThrow(/--capture-run/);
    expect(() => parse(fixture, "x.json", { stream: "1" })).toThrow(/not present-stream/);
    expect(() => createParserFor("presentmon2", undefined, { captureRun: 1 })).toThrow(/only to native/);
  });

  it("accepts complete minified native documents over the CSV line limit, with exact text/chunk parity", async () => {
    const text = session({ MsBetweenPresents: [16, 30, 17], Note: "é🛰".repeat(350_000) });
    const direct = parseTextSync(text, createParser(), "large.json");
    const streamed = await parseFileStreaming(new Blob([text]), createParser(), "large.json");
    expect(streamed).toEqual(direct);
    expect(streamed.frameCount).toBe(3);
    expect(() => requireNativeJsonSize(MAX_NATIVE_JSON_BYTES)).not.toThrow();
    expect(() => requireNativeJsonSize(MAX_NATIVE_JSON_BYTES + 1)).toThrow(/64 MiB/);
  });

  it("supports UTF-16 native files through the shared decoder without treating them as CSV", async () => {
    const text = fixture.replace("synthetic-scene.exe", "场景.exe");
    const bytes = new Uint8Array(2 + text.length * 2);
    const view = new DataView(bytes.buffer); view.setUint16(0, 0xfeff, true);
    for (let i = 0; i < text.length; i++) view.setUint16(2 + i * 2, text.charCodeAt(i), true);
    const series = await parseFileStreaming(new Blob([bytes]), createParser(), "native-utf16.json");
    expect(series.meta.application).toBe("场景.exe");
    expect([...series.sourceSample!]).toEqual([0, 1, 3, 4, 5]);
  });
});
