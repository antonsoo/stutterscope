import type { CaptureAnalysis } from "./analysis.ts";

/** Consecutive observed frames flagged as a stutter, a hitch, or both, split at source gaps. */
export interface SlowEpisode {
  /** One-based frame numbers in the source's selected present stream. */
  firstFrame: number;
  lastFrame: number;
  startSec: number;
  endSec: number;
  frameCount: number;
  stutterFrames: number;
  hitchFrames: number;
  totalTimeMs: number;
  longestFrameMs: number;
  longestFrame: number;
  /** Zero-based native array indices, when the source is CapFrameX JSON. */
  firstSourceSample?: number;
  lastSourceSample?: number;
  firstSourceLine: number | null;
  lastSourceLine: number | null;
  /** Whether the selected interval cut a possible continuation; not an inferred episode boundary. */
  touchesSelectionStart: boolean;
  touchesSelectionEnd: boolean;
  startsAfterGap: boolean;
  endsBeforeGap: boolean;
}

export function slowEpisodes({ series, summary, selection }: CaptureAnalysis): SlowEpisode[] {
  const result: SlowEpisode[] = [];
  let active: SlowEpisode | undefined;
  for (let i = 0; i < series.frameCount; i++) {
    if (series.gapBefore?.[i] === 1) active = undefined;
    const ms = series.frameTimeMs[i]!;
    const stutter = summary.stutter.isStutter[i] === 1;
    const hitch = ms > summary.stutter.hitchThresholdMs;
    if (!stutter && !hitch) { active = undefined; continue; }
    const frame = selection.firstFrameIndex + i + 1;
    if (!active) {
      active = {
        firstFrame: frame, lastFrame: frame,
        startSec: i > 0 ? series.timeSec[i - 1]! : selection.startSec,
        endSec: series.timeSec[i]!, frameCount: 0, stutterFrames: 0, hitchFrames: 0,
        totalTimeMs: 0, longestFrameMs: ms, longestFrame: frame,
        firstSourceLine: series.sourceLine?.[i] ?? null, lastSourceLine: null,
        ...(series.sourceSample ? { firstSourceSample: series.sourceSample[i]!, lastSourceSample: series.sourceSample[i]! } : {}),
        touchesSelectionStart: i === 0 && selection.excludedBefore > 0, touchesSelectionEnd: false,
        startsAfterGap: series.gapBefore?.[i] === 1, endsBeforeGap: false,
      };
      result.push(active);
    }
    active.lastFrame = frame;
    active.endSec = series.timeSec[i]!;
    active.frameCount++;
    active.stutterFrames += Number(stutter);
    active.hitchFrames += Number(hitch);
    active.totalTimeMs += ms;
    if (ms > active.longestFrameMs) { active.longestFrameMs = ms; active.longestFrame = frame; }
    active.lastSourceLine = series.sourceLine?.[i] ?? null;
    if (series.sourceSample) active.lastSourceSample = series.sourceSample[i]!;
    active.touchesSelectionEnd = i === series.frameCount - 1 && selection.excludedAfter > 0;
    active.endsBeforeGap = series.gapBefore?.[i + 1] === 1;
  }
  return result;
}
