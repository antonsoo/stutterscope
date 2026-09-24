/**
 * PresentMon 1.x CSV (legacy `Intel-PresentMon`/`GameTechDev/PresentMon`
 * console app, `--v1_metrics`, and the identical schema written by
 * PresentMon's own pre-2.0 releases).
 *
 * Column set verified against the actual CSV-writing code and a real
 * captured sample in the upstream repo (see `docs/formats.md` for exact
 * citations): `PresentMon/CsvOutput.cpp` and `Tests/Gold/test_case_0_v1.csv`
 * at github.com/GameTechDev/PresentMon (tag v1.10.0 / main).
 *
 * Header (base, no optional tracking flags):
 *   Application,ProcessID,SwapChainAddress,Runtime,SyncInterval,PresentFlags,
 *   Dropped,TimeInSeconds,msInPresentAPI,msBetweenPresents,AllowsTearing,
 *   PresentMode,msUntilRenderComplete,msUntilDisplayed,msBetweenDisplayChange,
 *   msFlipDelay,msUntilRenderStart,msGPUActive,msGPUVideoActive,msSinceInput,
 *   QPCTime
 *
 * The lower-case `msBetweenPresents` / `msInPresentAPI` spelling is the
 * signal that distinguishes this format from OCAT/CapFrameX/FrameView, which
 * all capitalize the `Ms` prefix.
 */
import { Float64Builder, Uint8Builder } from "../buffer.ts";
import { indexHeader, parseFloatOrNull, splitCsvLine } from "../csv.ts";
import type { FrameSeries, SniffResult, StreamingParser } from "../types.ts";
import { parseTextSync } from "../stream.ts";

export function sniff(sampleText: string): SniffResult {
  const firstLine = sampleText.split(/\r?\n/, 1)[0] ?? "";
  const hasV1Markers =
    firstLine.includes("msBetweenPresents") && firstLine.includes("msInPresentAPI");
  const hasApplication = firstLine.includes("Application") && firstLine.includes("ProcessID");
  if (hasV1Markers && hasApplication) {
    return { format: "presentmon1", confidence: 0.98, reason: "header has msBetweenPresents/msInPresentAPI" };
  }
  return { format: "presentmon1", confidence: 0, reason: "header does not match PresentMon 1.x" };
}

class PresentMon1Parser implements StreamingParser {
  private header: Map<string, number> | null = null;
  private application: string | undefined;
  private readonly warnings: string[] = [];
  private readonly frameTimeMs = new Float64Builder(4096);
  private readonly dropped = new Uint8Builder(4096);
  private readonly gpuBusyMs = new Float64Builder(4096);
  private hasGpuColumn = false;
  private columns: string[] = [];

  pushLine(line: string, lineIndex: number): void {
    const fields = splitCsvLine(line);
    if (this.header === null) {
      this.header = indexHeader(fields);
      this.columns = fields.map((f) => f.trim());
      this.hasGpuColumn = this.header.has("msGPUActive");
      return;
    }
    const h = this.header;
    const get = (name: string): string | undefined => {
      const idx = h.get(name);
      return idx === undefined ? undefined : fields[idx];
    };
    const ft = parseFloatOrNull(get("msBetweenPresents"));
    if (ft === null) {
      this.warnings.push(`line ${lineIndex + 1}: missing/invalid msBetweenPresents, row skipped`);
      return;
    }
    this.frameTimeMs.push(ft);
    this.dropped.push(parseFloatOrNull(get("Dropped")) === 1 ? 1 : 0);
    if (this.hasGpuColumn) {
      this.gpuBusyMs.push(parseFloatOrNull(get("msGPUActive")) ?? NaN);
    }
    if (this.application === undefined) {
      this.application = get("Application");
    }
  }

  finish(sourceFileName: string): FrameSeries {
    const frameTimeMs = this.frameTimeMs.toArray();
    const timeSec = new Float64Array(frameTimeMs.length);
    let acc = 0;
    for (let i = 0; i < frameTimeMs.length; i++) {
      acc += frameTimeMs[i]! / 1000;
      timeSec[i] = acc;
    }
    if (frameTimeMs.length === 0) {
      this.warnings.push("no data rows parsed");
    }
    return {
      meta: {
        format: "presentmon1",
        sourceFileName,
        application: this.application,
        warnings: this.warnings,
        columns: this.columns,
      },
      frameCount: frameTimeMs.length,
      frameTimeMs,
      timeSec,
      channels: {
        dropped: this.dropped.toArray(),
        gpuBusyMs: this.hasGpuColumn ? this.gpuBusyMs.toArray() : undefined,
      },
    };
  }
}

export function createParser(): StreamingParser {
  return new PresentMon1Parser();
}

export function parse(text: string, fileName = "capture.csv"): FrameSeries {
  return parseTextSync(text, createParser(), fileName);
}
