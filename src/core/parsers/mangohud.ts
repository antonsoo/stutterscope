/**
 * MangoHud CSV log (github.com/flightlessmango/MangoHud, `output_folder` /
 * `Shift_L+F2` logging, not the separate one-line-per-run summary CSV).
 *
 * Verified against the actual logging code, `src/logging.cpp`:
 *  - With `log_versioning`, the file starts with a 3-line marker
 *    (`v1`, the MangoHud version string, a `---SYSTEM INFO---`-style rule),
 *    then a one-row `os,cpu,gpu,ram,kernel,driver,cpuscheduler` table, then
 *    another rule line, then the frame-metrics header and rows.
 *  - Without it, the file is just the frame-metrics header and rows.
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
import { indexHeader, parseFloatOrNull, splitCsvLine } from "../csv.ts";
import type { FrameSeries, SniffResult, StreamingParser } from "../types.ts";
import { parseTextSync } from "../stream.ts";

const FRAME_HEADER_MARKERS = ["fps", "frametime", "cpu_load"];

function looksLikeFrameHeader(fields: string[]): boolean {
  return FRAME_HEADER_MARKERS.every((name, i) => fields[i]?.trim() === name);
}

export function sniff(sampleText: string): SniffResult {
  const lines = sampleText.split(/\r?\n/).slice(0, 10);
  for (const line of lines) {
    if (looksLikeFrameHeader(splitCsvLine(line))) {
      return { format: "mangohud", confidence: 0.95, reason: "found fps,frametime,cpu_load,... header" };
    }
  }
  return { format: "mangohud", confidence: 0, reason: "no MangoHud frame-metrics header found" };
}

class MangoHudParser implements StreamingParser {
  private header: Map<string, number> | null = null;
  private readonly warnings: string[] = [];
  private readonly frameTimeMs = new Float64Builder(4096);
  private columns: string[] = [];

  pushLine(line: string, lineIndex: number): void {
    const fields = splitCsvLine(line);
    if (this.header === null) {
      if (!looksLikeFrameHeader(fields)) return; // skip version/system-info preamble
      this.header = indexHeader(fields);
      this.columns = fields.map((f) => f.trim());
      return;
    }
    const idx = this.header.get("frametime");
    const ft = idx === undefined ? null : parseFloatOrNull(fields[idx]);
    if (ft === null) {
      this.warnings.push(`line ${lineIndex + 1}: missing/invalid frametime, row skipped`);
      return;
    }
    this.frameTimeMs.push(ft);
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
        format: "mangohud",
        sourceFileName,
        warnings: this.warnings,
        columns: this.columns,
      },
      frameCount: frameTimeMs.length,
      frameTimeMs,
      timeSec,
      channels: {},
    };
  }
}

export function createParser(): StreamingParser {
  return new MangoHudParser();
}

export function parse(text: string, fileName = "capture.csv"): FrameSeries {
  return parseTextSync(text, createParser(), fileName);
}
