/**
 * PresentMon 2.x CSV (the current `GameTechDev/PresentMon` console app and
 * service, default metrics set).
 *
 * Column set verified against `Tests/Gold/test_case_0_v2.csv` and
 * `README-ConsoleApplication.md` (tag v2.3.0) at
 * github.com/GameTechDev/PresentMon; see `docs/formats.md`.
 *
 * Header (default columns):
 *   Application,ProcessID,SwapChainAddress,PresentRuntime,SyncInterval,
 *   PresentFlags,AllowsTearing,PresentMode,FrameType,CPUStartQPC,FrameTime,
 *   CPUBusy,CPUWait,GPULatency,GPUTime,GPUBusy,GPUWait,VideoBusy,
 *   DisplayLatency,DisplayedTime,AnimationError,AnimationTime,MsFlipDelay,
 *   AllInputToPhotonLatency,ClickToPhotonLatency,InstrumentedLatency
 *
 * `CPUStartQPC` is renamed to `CPUStartTime`/`CPUStartQPCTime`/
 * `CPUStartDateTime` depending on command-line flags; we don't depend on it.
 * There is no `Dropped` column in 2.x — instead we treat a frame whose
 * `DisplayedTime` is `NA` (not displayed) as the 2.x equivalent, which is
 * called out explicitly in `docs/metrics.md` since it isn't the same
 * definition PresentMon 1.x uses for `Dropped`.
 */
import { Float64Builder, Uint8Builder } from "../buffer.ts";
import { indexHeader, parseFloatOrNull, splitCsvLine } from "../csv.ts";
import type { FrameSeries, SniffResult, StreamingParser } from "../types.ts";
import { parseTextSync } from "../stream.ts";

export function sniff(sampleText: string): SniffResult {
  const firstLine = sampleText.split(/\r?\n/, 1)[0] ?? "";
  const hasV2Markers =
    firstLine.includes("FrameTime") && firstLine.includes("CPUBusy") && firstLine.includes("GPUBusy");
  if (hasV2Markers) {
    return { format: "presentmon2", confidence: 0.98, reason: "header has FrameTime/CPUBusy/GPUBusy" };
  }
  return { format: "presentmon2", confidence: 0, reason: "header does not match PresentMon 2.x" };
}

class PresentMon2Parser implements StreamingParser {
  private header: Map<string, number> | null = null;
  private application: string | undefined;
  private readonly warnings: string[] = [];
  private readonly frameTimeMs = new Float64Builder(4096);
  private readonly dropped = new Uint8Builder(4096);
  private readonly cpuBusyMs = new Float64Builder(4096);
  private readonly gpuBusyMs = new Float64Builder(4096);
  private readonly displayLatencyMs = new Float64Builder(4096);
  private hasCpuBusy = false;
  private hasGpuBusy = false;
  private hasDisplayLatency = false;
  private hasDisplayedTime = false;
  private columns: string[] = [];

  pushLine(line: string, lineIndex: number): void {
    const fields = splitCsvLine(line);
    if (this.header === null) {
      this.header = indexHeader(fields);
      this.columns = fields.map((f) => f.trim());
      this.hasCpuBusy = this.header.has("CPUBusy");
      this.hasGpuBusy = this.header.has("GPUBusy");
      this.hasDisplayLatency = this.header.has("DisplayLatency");
      this.hasDisplayedTime = this.header.has("DisplayedTime");
      return;
    }
    const h = this.header;
    const get = (name: string): string | undefined => {
      const idx = h.get(name);
      return idx === undefined ? undefined : fields[idx];
    };
    const ft = parseFloatOrNull(get("FrameTime"));
    if (ft === null) {
      this.warnings.push(`line ${lineIndex + 1}: missing/invalid FrameTime, row skipped`);
      return;
    }
    this.frameTimeMs.push(ft);
    if (this.hasDisplayedTime) {
      this.dropped.push(parseFloatOrNull(get("DisplayedTime")) === null ? 1 : 0);
    }
    if (this.hasCpuBusy) this.cpuBusyMs.push(parseFloatOrNull(get("CPUBusy")) ?? NaN);
    if (this.hasGpuBusy) this.gpuBusyMs.push(parseFloatOrNull(get("GPUBusy")) ?? NaN);
    if (this.hasDisplayLatency) {
      this.displayLatencyMs.push(parseFloatOrNull(get("DisplayLatency")) ?? NaN);
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
    if (frameTimeMs.length === 0) this.warnings.push("no data rows parsed");
    return {
      meta: {
        format: "presentmon2",
        sourceFileName,
        application: this.application,
        warnings: this.warnings,
        columns: this.columns,
      },
      frameCount: frameTimeMs.length,
      frameTimeMs,
      timeSec,
      channels: {
        dropped: this.hasDisplayedTime ? this.dropped.toArray() : undefined,
        cpuBusyMs: this.hasCpuBusy ? this.cpuBusyMs.toArray() : undefined,
        gpuBusyMs: this.hasGpuBusy ? this.gpuBusyMs.toArray() : undefined,
        displayLatencyMs: this.hasDisplayLatency ? this.displayLatencyMs.toArray() : undefined,
      },
    };
  }
}

export function createParser(): StreamingParser {
  return new PresentMon2Parser();
}

export function parse(text: string, fileName = "capture.csv"): FrameSeries {
  return parseTextSync(text, createParser(), fileName);
}
