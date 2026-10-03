import { describe, expect, it } from "vitest";
import { buildJsonReport, buildMarkdownTable } from "../../src/ui/share.ts";
import { createParserFor } from "../../src/core/parsers/index.ts";
import { parseTextSync } from "../../src/core/stream.ts";
import { computeMetricsSummary } from "../../src/core/metrics.ts";

const mapping = { valueColumn: "frame_ms", valueKind: "frametime_ms" as const };
const options = { kMultiplier: 2.5, windowRadius: 3, hitchThresholdMs: 25 };
function capture() {
  return parseTextSync("frame_ms\n16\ninvalid\n32\n-3\n", createParserFor("generic", mapping), "test.csv");
}

describe("inspectable web exports", () => {
  it("preserves skipped-row evidence, generic interpretation and applied settings", () => {
    const series = capture();
    const report = buildJsonReport(series, computeMetricsSummary(series, options), options, mapping);
    expect(report.schemaVersion).toBe(2);
    expect(report.source.frameCount).toBe(2);
    expect(report.source.skippedRows).toBe(2);
    expect(report.source.warnings).toHaveLength(2);
    expect(report.source.genericMapping).toEqual(mapping);
    expect(report.analysis.stutterOptions).toEqual(options);
    expect(report.metrics.stutter.hitchCount).toBe(1);
    expect(report.metrics.stutter.hitchThresholdMs).toBe(25);
    series.meta.warnings.push("later mutation");
    expect(report.source.warnings).toHaveLength(2);
  });

  it("counts omitted warning details without inventing individual diagnostics", () => {
    const series = parseTextSync(`frame_ms\n16\n${"bad\n".repeat(70)}`, createParserFor("generic", mapping), "bad.csv");
    const summary = computeMetricsSummary(series, options);
    expect(buildJsonReport(series, summary, options, mapping).source.omittedWarningDetails).toBe(20);
    expect(buildMarkdownTable(series, summary, options, mapping)).toContain("20 additional skipped rows have no retained warning detail");
  });

  it("retains the selected stream even for a single-process capture", () => {
    const series = capture();
    series.meta.selectedStream = "123:swapchain";
    series.meta.application = "game.exe";
    series.meta.streams = [{ id: "123:swapchain", application: "game.exe", processId: "123", swapChain: "swapchain", frameCount: 2 }];
    const summary = computeMetricsSummary(series, options);
    expect(buildJsonReport(series, summary, options).source.stream).toBe("123:swapchain");
    const markdown = buildMarkdownTable(series, summary, options);
    expect(markdown).toContain("Selected stream: 123:swapchain (game.exe)");
    expect(markdown).toContain("k = 2.5, window radius = 3, hitch threshold > 25 ms");
    expect(markdown).toContain("Skipped rows: 2");
  });

  it("renders source names and warnings as text instead of Markdown or HTML instructions", () => {
    const series = capture();
    series.meta.sourceFileName = "[click](https://example.com)|<img src=x>\nnext\u202e";
    series.meta.warnings = ["<script>alert(1)</script>|\n# title"];
    const markdown = buildMarkdownTable(series, computeMetricsSummary(series, options), options, mapping);
    expect(markdown).not.toContain("<img");
    expect(markdown).not.toContain("<script>");
    expect(markdown).not.toContain("\n# title");
    expect(markdown).not.toContain("\u202e");
    expect(markdown).toContain("\\[click\\]");
    expect(markdown).toContain("&lt;img src=x&gt;");
    expect(markdown).toContain("\\|");
  });
});
