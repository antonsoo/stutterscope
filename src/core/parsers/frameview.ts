/**
 * NVIDIA FrameView CSV. FrameView is closed-source, and NVIDIA's published
 * user guides (e.g. `frameview-1-8-user-guide-web-version.pdf`) describe the
 * tool but do not print a column-by-column CSV schema we could quote, so
 * this parser is verified against a real captured FrameView log instead: a
 * Witcher 3 run redistributed as sample data in
 * github.com/Pavelioso/Frameviewer (`assets/witcher_3.csv`) — see
 * `docs/formats.md` for the full citation and caveats.
 *
 * FrameView builds on PresentMon's capitalized `Ms...` column family
 * (`MsBetweenPresents`, `Dropped`, `TimeInSeconds`, ...) and appends a long,
 * version-dependent tail of GPU/CPU telemetry columns
 * (`GPU0Util(%)`, `GPU0Clk(MHz)`, `CPUUtil(%)`, `CPU Package Power(W)`,
 * `MsPCLatency`, per-core `CPUCoreUtil%[N]`, battery columns, ...). We only
 * read the columns needed for frame-time metrics plus `MsPCLatency` (an
 * end-to-end "PC latency" estimate, used here as the display-latency
 * channel); the telemetry columns are ignored.
 */
import { Float64Builder, Uint8Builder } from "../buffer.ts";
import { indexHeader, LINE_BREAK, parseFloatOrNull, parseFrameTimeOrNull, parseWarnings, SkippedRows, splitCsvLine } from "../csv.ts";
import type { FrameSeries, ParserOptions, SniffResult, StreamingParser } from "../types.ts";
import { parseTextSync } from "../stream.ts";
import { cumulativeSeconds, StreamTracker } from "../streams.ts";

export function sniff(sampleText: string): SniffResult {
  const firstLine = sampleText.split(LINE_BREAK, 1)[0] ?? "";
  const hasFrameViewMarkers =
    firstLine.includes("MsBetweenPresents") &&
    (firstLine.includes("GPU0Util(%)") || firstLine.includes("GPU0Clk(MHz)") || firstLine.includes("CPUUtil(%)"));
  if (hasFrameViewMarkers) {
    return { format: "frameview", confidence: 0.97, reason: "header has GPU0Util(%)/CPUUtil(%) telemetry columns" };
  }
  return { format: "frameview", confidence: 0, reason: "header does not match FrameView" };
}

class FrameViewParser implements StreamingParser {
  private header: Map<string, number> | null = null;
  private application: string | undefined;
  private readonly skipped = new SkippedRows();
  private readonly frameTimeMs = new Float64Builder(4096);
  private readonly dropped = new Uint8Builder(4096);
  private readonly displayLatencyMs = new Float64Builder(4096);
  private hasLatency = false;
  private columns: string[] = [];
  private readonly streams = new StreamTracker();
  private readonly options: ParserOptions;

  constructor(options: ParserOptions = {}) {
    this.options = options;
  }

  pushLine(line: string, lineIndex: number): void {
    const fields = splitCsvLine(line);
    if (this.header === null) {
      this.header = indexHeader(fields);
      this.columns = fields.map((f) => f.trim());
      this.hasLatency = this.header.has("MsPCLatency");
      this.streams.setHeader(this.header);
      return;
    }
    const h = this.header;
    const get = (name: string): string | undefined => {
      const idx = h.get(name);
      return idx === undefined ? undefined : fields[idx];
    };
    const ft = parseFrameTimeOrNull(get("MsBetweenPresents"));
    if (ft === null) {
      this.skipped.add(lineIndex, "missing/invalid MsBetweenPresents");
      return;
    }
    this.frameTimeMs.push(ft);
    this.dropped.push(parseFloatOrNull(get("Dropped")) === 1 ? 1 : 0);
    if (this.hasLatency) this.displayLatencyMs.push(parseFloatOrNull(get("MsPCLatency")) ?? NaN);
    this.streams.track(fields);
    if (this.application === undefined) this.application = get("Application");
  }

  finish(sourceFileName: string): FrameSeries {
    const { frameTimeMs, channels, streams, selected } = this.streams.select(
      {
        frameTimeMs: this.frameTimeMs.toArray(),
        channels: {
          dropped: this.dropped.toArray(),
          displayLatencyMs: this.hasLatency ? this.displayLatencyMs.toArray() : undefined,
        },
      },
      this.options.stream,
    );
    return {
      meta: {
        format: "frameview",
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
      timeSec: cumulativeSeconds(frameTimeMs),
      channels,
    };
  }
}

export function createParser(options: ParserOptions = {}): StreamingParser {
  return new FrameViewParser(options);
}

export function parse(text: string, fileName = "capture.csv", options: ParserOptions = {}): FrameSeries {
  return parseTextSync(text, createParser(options), fileName);
}
