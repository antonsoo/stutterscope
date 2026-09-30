/**
 * OCAT (Open Capture and Analytics Tool, github.com/GPUOpen-Tools/ocat) CSV.
 *
 * Column set verified against a real OCAT capture shipped as a CapFrameX
 * test fixture (`OCAT-MetroExodus.exe-2019-02-20T101522.csv` and
 * `ShortFile.csv` at github.com/CXWorld/CapFrameX,
 * `source/CapFrameX.Test/TestRecordFiles/`); see `docs/formats.md`.
 *
 * Header:
 *   Application,ProcessID,SwapChainAddress,Runtime,SyncInterval,PresentFlags,
 *   AllowsTearing,PresentMode,[WasBatched,DwmNotified,]Dropped,TimeInSeconds,
 *   MsBetweenPresents,MsBetweenDisplayChange,MsInPresentAPI,
 *   MsUntilRenderComplete,MsUntilDisplayed[,Motherboard,OS,Processor,...]
 *
 * Two OCAT quirks this parser handles: the capitalized `Ms...` prefix (vs.
 * PresentMon 1.x's lowercase `ms...`), and a ragged first data row that
 * appends static hardware-info fields (motherboard, OS, GPU clocks, ...)
 * which only appear once and are ignored here.
 */
import { Float64Builder, Uint8Builder } from "../buffer.ts";
import { indexHeader, parseFloatOrNull, splitCsvLine } from "../csv.ts";
import type { FrameSeries, ParserOptions, SniffResult, StreamingParser } from "../types.ts";
import { parseTextSync } from "../stream.ts";
import { cumulativeSeconds, StreamTracker } from "../streams.ts";

export function sniff(sampleText: string): SniffResult {
  const firstLine = sampleText.split(/\r?\n/, 1)[0] ?? "";
  const isPresentFamily = firstLine.includes("MsBetweenPresents") && firstLine.includes("Application");
  const looksLikeFrameView = firstLine.includes("GPU0Util") || firstLine.includes("CPUUtil(%)");
  if (isPresentFamily && !looksLikeFrameView) {
    return { format: "ocat", confidence: 0.55, reason: "header has capitalized MsBetweenPresents family" };
  }
  return { format: "ocat", confidence: 0, reason: "header does not match OCAT" };
}

/** Shared by ocat.ts and capframex.ts, which write the same data-row schema. */
export class PresentFamilyParser implements StreamingParser {
  protected header: Map<string, number> | null = null;
  protected application: string | undefined;
  protected readonly warnings: string[] = [];
  protected readonly frameTimeMs = new Float64Builder(4096);
  protected readonly dropped = new Uint8Builder(4096);
  protected columns: string[] = [];
  private readonly format: "ocat" | "capframex";
  private readonly streams = new StreamTracker();
  private readonly options: ParserOptions;

  constructor(format: "ocat" | "capframex", options: ParserOptions = {}) {
    this.format = format;
    this.options = options;
  }

  pushLine(line: string, lineIndex: number): void {
    const fields = splitCsvLine(line);
    if (this.header === null) {
      this.header = indexHeader(fields);
      this.columns = fields.map((f) => f.trim());
      this.streams.setHeader(this.header);
      return;
    }
    const h = this.header;
    const get = (name: string): string | undefined => {
      const idx = h.get(name);
      return idx === undefined ? undefined : fields[idx];
    };
    const ft = parseFloatOrNull(get("MsBetweenPresents"));
    if (ft === null) {
      this.warnings.push(`line ${lineIndex + 1}: missing/invalid MsBetweenPresents, row skipped`);
      return;
    }
    this.frameTimeMs.push(ft);
    this.dropped.push(parseFloatOrNull(get("Dropped")) === 1 ? 1 : 0);
    this.streams.track(fields);
    if (this.application === undefined) this.application = get("Application");
  }

  finish(sourceFileName: string): FrameSeries {
    const { frameTimeMs, channels, streams, selected } = this.streams.select(
      { frameTimeMs: this.frameTimeMs.toArray(), channels: { dropped: this.dropped.toArray() } },
      this.options.stream,
    );
    if (frameTimeMs.length === 0) this.warnings.push("no data rows parsed");
    return {
      meta: {
        format: this.format,
        sourceFileName,
        application: selected?.application ?? this.application,
        warnings: this.warnings,
        columns: this.columns,
        streams,
        selectedStream: selected?.id,
      },
      frameCount: frameTimeMs.length,
      frameTimeMs,
      timeSec: cumulativeSeconds(frameTimeMs),
      channels,
    };
  }
}

export function createParser(options: ParserOptions = {}): StreamingParser {
  return new PresentFamilyParser("ocat", options);
}

export function parse(text: string, fileName = "capture.csv", options: ParserOptions = {}): FrameSeries {
  return parseTextSync(text, createParser(options), fileName);
}
