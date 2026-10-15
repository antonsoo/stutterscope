import { FrameContinuity } from "../continuity.ts";
import { cumulativeSeconds } from "../streams.ts";
/**
 * MangoHud CSV log (github.com/flightlessmango/MangoHud, `output_folder` /
 * `Shift_L+F2` logging, not the separate one-line-per-run summary CSV).
 *
 * Verified against the actual logging code, `src/logging.cpp`:
 *  - With `log_versioning`, the file starts with a 3-line marker
 *    (`v1`, the MangoHud version string, a `---SYSTEM INFO---`-style rule),
 *    then a one-row `os,cpu,gpu,ram,kernel,driver,cpuscheduler` table, then
 *    another rule line, then the frame-metrics header and rows.
 *  - Without it, the system-info table remains; version and rule lines are omitted.
 *  - Only log_interval=0 logs every frame. Periodic snapshots cannot reconstruct
 *    missing frames, and the CSV does not record the configured interval.
 *
 * Frame-metrics header (both cases):
 *   fps,frametime,cpu_load,cpu_power,gpu_load,cpu_temp,gpu_temp,
 *   gpu_core_clock,gpu_mem_clock,gpu_vram_used,gpu_power,ram_used,
 *   swap_used,process_rss,cpu_mhz,elapsed
 *
 * `frametime` is milliseconds (`src/overlay.cpp`: `frametime = frametime_ms`,
 * `fps = 1000 / frametime_ms`) and `elapsed` is nanoseconds since the log
 * started. `cpu_load`/`gpu_load` are utilization percentages, not busy-time,
 * so — unlike PresentMon 2.x's `CPUBusy`/`GPUBusy` — we don't treat them as
 * the CPU/GPU-bound-share channels; MangoHud captures simply don't carry
 * that metric.
 */
import { Float64Builder } from "../buffer.ts";
import { extraFieldsReason, indexHeader, LINE_BREAK, parseFloatOrNull, parseFrameTimeOrNull, parseWarnings, SkippedRows, splitCsvLine } from "../csv.ts";
import { ParseError, type FrameSeries, type SniffResult, type StreamingParser } from "../types.ts";
import { parseTextSync } from "../stream.ts";

const FRAME_HEADER_MARKERS = ["fps", "frametime", "cpu_load"];

function looksLikeFrameHeader(fields: string[]): boolean {
  return FRAME_HEADER_MARKERS.every((name, i) => fields[i]?.trim() === name);
}

export function sniff(sampleText: string): SniffResult {
  const lines = sampleText.split(LINE_BREAK, 10);
  for (const line of lines) {
    try {
      if (looksLikeFrameHeader(splitCsvLine(line))) {
        return { format: "mangohud", confidence: 0.95, reason: "found fps,frametime,cpu_load,... header" };
      }
    } catch (error) {
      // Samples can end mid-field; other formats' metadata need not be CSV.
      // The chosen parser validates complete records, with their line numbers.
      if (!(error instanceof ParseError)) throw error;
    }
  }
  return { format: "mangohud", confidence: 0, reason: "no MangoHud frame-metrics header found" };
}

class MangoHudParser implements StreamingParser {
  private header: Map<string, number> | null = null;
  private readonly continuity = new FrameContinuity();
  private readonly skipped = new SkippedRows();
  private readonly frameTimeMs = new Float64Builder(4096);
  private readonly sourceLine = new Float64Builder(4096);
  private columns: string[] = [];
  private previousElapsed: number | null = null;
  private observedSpanSec = 0;
  private recordedFrameSpanSec = 0;
  private comparedIntervals = 0;
  private missingElapsed = 0;
  private reversedElapsed = false;

  pushLine(line: string, lineIndex: number): void {
    let fields: string[];
    try {
      fields = splitCsvLine(line, lineIndex + 1);
    } catch (error) {
      if (this.header === null && error instanceof ParseError) return; // preamble is not frame data
      throw error;
    }
    if (this.header === null) {
      if (!looksLikeFrameHeader(fields)) return; // skip version/system-info preamble
      this.header = indexHeader(fields, lineIndex + 1);
      this.columns = fields.map((f) => f.trim());
      return;
    }
    const widthProblem = extraFieldsReason(fields, this.columns);
    if (widthProblem) {
      this.continuity.skip();
      this.previousElapsed = null;
      this.skipped.add(lineIndex, widthProblem);
      return;
    }
    const idx = this.header.get("frametime");
    const ft = idx === undefined ? null : parseFrameTimeOrNull(fields[idx]);
    if (ft === null) {
      this.continuity.skip();
      this.skipped.add(lineIndex, "missing/invalid frametime");
      this.previousElapsed = null;
      return;
    }
    const elapsedIndex = this.header.get("elapsed");
    const elapsed = elapsedIndex === undefined ? null : parseFloatOrNull(fields[elapsedIndex]);
    if (elapsed === null || elapsed < 0) {
      this.missingElapsed++;
      this.previousElapsed = null;
    } else {
      if (this.previousElapsed !== null) {
        const interval = (elapsed - this.previousElapsed) / 1e9;
        if (interval < 0) this.reversedElapsed = true;
        else {
          this.observedSpanSec += interval;
          this.recordedFrameSpanSec += ft / 1000;
          this.comparedIntervals++;
        }
      }
      this.previousElapsed = elapsed;
    }
    this.frameTimeMs.push(ft);
    this.continuity.keep();
    this.sourceLine.push(lineIndex + 1);
  }

  finish(sourceFileName: string): FrameSeries {
    const frameTimeMs = this.frameTimeMs.toArray();
    const timeSec = cumulativeSeconds(frameTimeMs);
    const evidence = this.clockEvidence();
    return {
      meta: {
        format: "mangohud",
        sourceFileName,
        warnings: parseWarnings(this.skipped, frameTimeMs.length),
        skippedRows: this.skipped.count,
        columns: this.columns,
        timingEvidence: evidence,
      },
      frameCount: frameTimeMs.length,
      frameTimeMs,
      sourceLine: this.sourceLine.toArray(),
      gapBefore: this.continuity.toArray(),
      timeSec,
      channels: {},
    };
  }

  private clockEvidence(): NonNullable<FrameSeries["meta"]["timingEvidence"]> {
    const assumption = "MangoHud frame metrics require log_interval=0. The CSV does not record this setting; matching clock spans do not prove every frame was logged.";
    if (this.reversedElapsed) throw new ParseError("MangoHud elapsed time goes backwards. Split concatenated logging sessions before analyzing their frames.");
    const observed = this.observedSpanSec;
    const recorded = this.recordedFrameSpanSec;
    // Independent clocks and logging overhead can differ over short excerpts.
    // Only reject a large contradiction; compatibility is deliberately not a
    // certification of per-frame capture or a way to infer missing frames.
    const enough = this.comparedIntervals >= 3;
    if (enough && Math.abs(observed - recorded) > 0.01 && (observed > recorded * 2 || recorded > observed * 2)) {
      throw new ParseError(`MangoHud logging intervals do not match frame durations: ${observed.toFixed(6)} s of elapsed intervals versus ${recorded.toFixed(6)} s of frame durations across ${this.comparedIntervals} adjacent records. This may be periodic logging or missing frames. Recapture with log_interval=0; snapshots cannot reconstruct a per-frame stutter report.`);
    }
    const compatible = enough && observed > 0 && recorded > 0 && this.missingElapsed === 0 && this.skipped.count === 0;
    return {
      kind: "mangohud-elapsed", status: compatible ? "compatible" : "unverified",
      comparedIntervals: this.comparedIntervals,
      observedSpanSec: this.comparedIntervals > 0 ? observed : null,
      recordedFrameSpanSec: this.comparedIntervals > 0 ? recorded : null,
      note: `${compatible ? "No large elapsed/frame-duration contradiction found. " : "Clock coverage is missing, too short, or interrupted; per-frame coverage is unverified. "}${assumption}`,
    };
  }
}

export function createParser(): StreamingParser {
  return new MangoHudParser();
}

export function parse(text: string, fileName = "capture.csv"): FrameSeries {
  return parseTextSync(text, createParser(), fileName);
}
