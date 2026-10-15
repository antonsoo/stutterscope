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
import { extraFieldsReason, indexHeader, LINE_BREAK, parseDroppedOrUnknown, parseFrameTimeOrNull, parseWarnings, SkippedRows, splitCsvLine } from "../csv.ts";
import type { FrameSeries, ParserOptions, SniffResult, StreamingParser } from "../types.ts";
import { parseTextSync } from "../stream.ts";
import { cumulativeSeconds, StreamTracker } from "../streams.ts";

export function sniff(sampleText: string): SniffResult {
  const firstLine = sampleText.split(LINE_BREAK, 1)[0] ?? "";
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
  protected readonly skipped = new SkippedRows();
  protected readonly frameTimeMs = new Float64Builder(4096);
  protected readonly sourceLine = new Float64Builder(4096);
  protected readonly dropped = new Uint8Builder(4096);
  private hasDropped = false;
  protected columns: string[] = [];
  private readonly format: "ocat" | "capframex";
  private readonly streams = new StreamTracker();
  private readonly options: ParserOptions;

  constructor(format: "ocat" | "capframex", options: ParserOptions = {}) {
    this.format = format;
    this.options = options;
  }

  pushLine(line: string, lineIndex: number): void {
    const fields = splitCsvLine(line, lineIndex + 1);
    if (this.header === null) {
      this.header = indexHeader(fields, lineIndex + 1);
      this.columns = fields.map((f) => f.trim());
      this.hasDropped = this.header.has("Dropped");
      this.streams.setHeader(this.header);
      return;
    }
    const widthProblem = extraFieldsReason(fields, this.columns);
    if (widthProblem) {
      this.streams.skipUnidentified();
      this.skipped.add(lineIndex, widthProblem);
      return;
    }
    const h = this.header;
    const get = (name: string): string | undefined => {
      const idx = h.get(name);
      return idx === undefined ? undefined : fields[idx];
    };
    const ft = parseFrameTimeOrNull(get("MsBetweenPresents"));
    if (ft === null) {
      this.streams.skip(fields);
      this.skipped.add(lineIndex, "missing/invalid MsBetweenPresents");
      return;
    }
    const identityProblem = this.streams.track(fields);
    if (identityProblem) {
      this.skipped.add(lineIndex, identityProblem);
      return;
    }
    this.frameTimeMs.push(ft);
    this.sourceLine.push(lineIndex + 1);
    if (this.hasDropped) this.dropped.push(parseDroppedOrUnknown(get("Dropped")));
    if (this.application === undefined) this.application = get("Application");
  }

  finish(sourceFileName: string): FrameSeries {
    const { frameTimeMs, sourceLine, gapBefore, channels, streams, selected } = this.streams.select(
      { frameTimeMs: this.frameTimeMs.toArray(), sourceLine: this.sourceLine.toArray(), channels: { dropped: this.hasDropped ? this.dropped.toArray() : undefined } },
      this.options.stream,
    );
    return {
      meta: {
        format: this.format,
        sourceFileName,
        application: selected?.application ?? this.application,
        warnings: parseWarnings(this.skipped, frameTimeMs.length),
        skippedRows: this.skipped.count,
        columns: this.columns,
        streams,
        selectedStream: selected?.id,
      },
      frameCount: frameTimeMs.length,
      frameTimeMs,
      sourceLine,
      gapBefore,
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
