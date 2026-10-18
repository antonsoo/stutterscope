import type { PresentClockEvidence, PresentClockWitness } from "./types.ts";

interface Clock { ms: number; errorMs: number }
interface Anchor extends Clock { sourceLine: number | undefined; frame: Clock | undefined }
interface ClockOptions {
  /** CPU-start clocks lead FrameTime; TimeInMs ends MsBetweenPresents. */
  clockColumn?: PresentClockEvidence["clockColumn"];
  frameTimeColumn?: PresentClockEvidence["frameTimeColumn"];
}
export const MAX_CLOCK_WITNESSES = 5;
const DECIMAL_READING = /^[+-]?(?:\d+(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/;

/** Rounding uncertainty from the decimal precision actually written to CSV.
 * Whole-second/coarse clocks deliberately cannot establish small gaps. */
function reading(raw: string | undefined, scale: number): Clock | undefined {
  if (raw === undefined) return;
  const match = DECIMAL_READING.exec(raw.trim());
  if (!match) return;
  const ms = Number(match[0]) * scale;
  if (!Number.isFinite(ms) || ms < 0) return;
  const decimals = (match[1] ?? match[2] ?? "").length;
  const resolution = 10 ** (Number(match[3] ?? 0) - decimals);
  return { ms, errorMs: resolution * scale / 2 };
}

/** The native present clock can expose intentionally filtered/lost records.
 * Compare within one present stream; never estimate missing frames/durations. */
export class PresentClock {
  private readonly previous = new Map<number, Anchor>();
  private readonly gaps = new Map<number, number>();
  private readonly witnesses = new Map<number, PresentClockWitness[]>();
  private readonly options: ClockOptions;

  constructor(options: ClockOptions = {}) { this.options = options; }

  keep(stream: number, rawTime: string | undefined, rawFrameMs: string | undefined, sourceLine?: number): boolean {
    const clock = reading(rawTime, this.options.clockColumn ? 1 : 1000);
    const currentFrame = reading(rawFrameMs, 1);
    const previous = this.previous.get(stream);
    // PresentMon 1.x measures back from the current present. In 2.x,
    // FrameTime runs forward from CPUStartTime to the next CPU start.
    const forward = this.options.clockColumn !== undefined && this.options.clockColumn !== "TimeInMs";
    const frame = forward ? previous?.frame : currentFrame;
    const line = sourceLine !== undefined && Number.isSafeInteger(sourceLine) && sourceLine > 0 ? sourceLine : undefined;
    if (clock) this.previous.set(stream, { ...clock, sourceLine: line, frame: currentFrame });
    else this.previous.delete(stream);
    if (!clock || !frame || !previous) return false;
    const elapsed = clock.ms - previous.ms;
    const clockTolerance = previous.errorMs + clock.errorMs
      + 8 * Number.EPSILON * (Math.abs(previous.ms) + Math.abs(clock.ms));
    const durationTolerance = clockTolerance + frame.errorMs + 8 * Number.EPSILON * Math.abs(frame.ms);
    // A longer interval than the corresponding native frame duration cannot be
    // attributed to this one retained present. Reversed clocks also cannot
    // establish adjacency. Shorter positive intervals are not a missing-row claim.
    const reversed = elapsed < -clockTolerance;
    const gap = elapsed > frame.ms + durationTolerance || reversed;
    if (gap) {
      this.gaps.set(stream, (this.gaps.get(stream) ?? 0) + 1);
      const witnesses = this.witnesses.get(stream) ?? [];
      if (witnesses.length < MAX_CLOCK_WITNESSES && previous.sourceLine !== undefined && line !== undefined) {
        witnesses.push({ fromSourceLine: previous.sourceLine, toSourceLine: line, elapsedMs: elapsed,
          frameTimeMs: frame.ms, allowanceMs: reversed ? clockTolerance : durationTolerance,
          kind: reversed ? "reversed_clock" : "unaccounted_interval" });
        this.witnesses.set(stream, witnesses);
      }
    }
    return gap;
  }

  count(stream: number): number { return this.gaps.get(stream) ?? 0; }

  evidence(stream: number): PresentClockEvidence | undefined {
    const count = this.count(stream);
    if (!count) return;
    const witnesses = this.witnesses.get(stream) ?? [];
    return { witnesses: witnesses.map(w => ({ ...w })), omittedWitnesses: count - witnesses.length,
      ...(this.options.clockColumn ? { clockColumn: this.options.clockColumn,
        frameTimeReference: this.options.clockColumn === "TimeInMs" ? "toSourceLine" as const : "fromSourceLine" as const } : {}),
      ...(this.options.frameTimeColumn ? { frameTimeColumn: this.options.frameTimeColumn } : {}) };
  }
}
