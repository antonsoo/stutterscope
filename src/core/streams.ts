/**
 * Present streams. PresentMon (both generations), OCAT, CapFrameX and
 * FrameView all write one row per present, and a capture started without a
 * process filter records every process that presents: the game, but also
 * the desktop compositor (dwm.exe), overlays, a browser on the second
 * monitor. Their rows are interleaved in time order. Each row's frame time
 * is already per swap chain, so concatenating them doesn't just add noise:
 * it double-counts wall time, alternates between unrelated frame rates, and
 * turns every metric into nonsense. So rows are grouped by (process, swap
 * chain) and exactly one stream is analysed.
 */
import { Uint32Builder } from "./buffer.ts";
import { ParseError, type OptionalChannels, type PresentStream } from "./types.ts";

/** Presents that are never the thing being measured, so they lose the default pick even when busier. */
const COMPOSITORS = new Set(["dwm.exe"]);

export interface SeriesColumns {
  frameTimeMs: Float64Array;
  channels: OptionalChannels;
}

export interface StreamSelection extends SeriesColumns {
  /** Every stream seen, busiest first; empty when the format has no stream columns. */
  streams: PresentStream[];
  /** The analysed stream, when the capture records streams. */
  selected?: PresentStream;
}

export class StreamTracker {
  private appIdx = -1;
  private pidIdx = -1;
  private swapIdx = -1;
  private readonly indexById = new Map<string, number>();
  private readonly list: PresentStream[] = [];
  private readonly rowStream = new Uint32Builder(4096);
  // The previous row's raw key fields: consecutive rows usually share a stream,
  // and comparing two strings is cheaper than building and hashing a key.
  private lastIndex = -1;
  private lastApp: string | undefined;
  private lastPid: string | undefined;
  private lastSwap: string | undefined;

  /** Reads the header once; formats without these columns simply aren't tracked. */
  setHeader(header: Map<string, number>): void {
    this.appIdx = header.get("Application") ?? -1;
    this.pidIdx = header.get("ProcessID") ?? -1;
    this.swapIdx = header.get("SwapChainAddress") ?? -1;
  }

  private get enabled(): boolean {
    return this.pidIdx >= 0 || this.swapIdx >= 0 || this.appIdx >= 0;
  }

  /** Records which stream a kept row belongs to. Call once per row the parser keeps, never for a skipped one. */
  track(fields: string[]): void {
    if (!this.enabled) return;
    const app = this.appIdx >= 0 ? fields[this.appIdx] : undefined;
    const pid = this.pidIdx >= 0 ? fields[this.pidIdx] : undefined;
    const swap = this.swapIdx >= 0 ? fields[this.swapIdx] : undefined;
    let index = this.lastIndex;
    if (index < 0 || pid !== this.lastPid || swap !== this.lastSwap || app !== this.lastApp) {
      const application = (app ?? "").trim();
      const processId = (pid ?? "").trim();
      const swapChain = (swap ?? "").trim();
      // Without a process id the application name is the best identity there is.
      const id = this.pidIdx >= 0 || this.swapIdx >= 0 ? `${processId}:${swapChain}` : application;
      const known = this.indexById.get(id);
      if (known === undefined) {
        index = this.list.length;
        this.indexById.set(id, index);
        this.list.push({ id, application, processId, swapChain, frameCount: 0 });
      } else {
        index = known;
      }
      this.lastIndex = index;
      this.lastApp = app;
      this.lastPid = pid;
      this.lastSwap = swap;
    }
    this.list[index]!.frameCount++;
    this.rowStream.push(index);
  }

  /**
   * Keeps one stream's rows. With no selector that's the busiest stream that
   * isn't the compositor; a selector is matched by `matchStream`.
   */
  select(columns: SeriesColumns, selector?: string): StreamSelection {
    const streams = [...this.list].sort((a, b) => b.frameCount - a.frameCount);
    if (streams.length === 0) return { ...columns, streams };
    const selected = selector === undefined ? defaultStream(streams) : matchStream(streams, selector);
    if (!selected) {
      throw new ParseError(
        `no stream in this capture matches "${selector}". Streams: ${streams.map(describeStream).join("; ")}`,
      );
    }
    if (streams.length === 1) return { ...columns, streams, selected };
    const keep = this.indexById.get(selected.id)!;
    return { ...filterRows(columns, this.rowStream.toArray(), keep), streams, selected };
  }
}

/** The busiest stream, skipping the compositor unless nothing else presented. */
export function defaultStream(streamsBusiestFirst: PresentStream[]): PresentStream | undefined {
  return (
    streamsBusiestFirst.find((s) => !COMPOSITORS.has(s.application.toLowerCase())) ?? streamsBusiestFirst[0]
  );
}

/**
 * Finds a stream by its id (`processId:swapChain`), by process id, or by
 * application name (case-insensitive). When several match (one process with
 * two swap chains), the busiest wins.
 */
export function matchStream(streamsBusiestFirst: PresentStream[], selector: string): PresentStream | undefined {
  const s = selector.trim();
  const lower = s.toLowerCase();
  return (
    streamsBusiestFirst.find((x) => x.id === s) ??
    streamsBusiestFirst.find((x) => x.processId !== "" && x.processId === s) ??
    streamsBusiestFirst.find((x) => x.application.toLowerCase() === lower)
  );
}

/** `game.exe (pid 4242, swap chain 0x1): 7,969 frames` */
export function describeStream(stream: PresentStream): string {
  const parts: string[] = [];
  if (stream.processId) parts.push(`pid ${stream.processId}`);
  if (stream.swapChain) parts.push(`swap chain ${stream.swapChain}`);
  const where = parts.length > 0 ? ` (${parts.join(", ")})` : "";
  return `${stream.application || "unnamed"}${where}: ${stream.frameCount.toLocaleString("en-US")} frames`;
}

function filterRows(columns: SeriesColumns, rowStream: Uint32Array, keep: number): SeriesColumns {
  let count = 0;
  for (let i = 0; i < rowStream.length; i++) if (rowStream[i] === keep) count++;
  const pick = <T extends Float64Array | Uint8Array>(source: T | undefined, make: (n: number) => T): T | undefined => {
    if (!source) return undefined;
    const out = make(count);
    let j = 0;
    for (let i = 0; i < rowStream.length; i++) if (rowStream[i] === keep) out[j++] = source[i]!;
    return out;
  };
  const f64 = (n: number) => new Float64Array(n);
  const u8 = (n: number) => new Uint8Array(n);
  const c = columns.channels;
  return {
    frameTimeMs: pick(columns.frameTimeMs, f64)!,
    channels: {
      dropped: pick(c.dropped, u8),
      cpuBusyMs: pick(c.cpuBusyMs, f64),
      gpuBusyMs: pick(c.gpuBusyMs, f64),
      displayLatencyMs: pick(c.displayLatencyMs, f64),
    },
  };
}

/** `timeSec[i]`: capture time up to and including frame `i`, as a running sum of frame times. */
export function cumulativeSeconds(frameTimeMs: Float64Array): Float64Array {
  const timeSec = new Float64Array(frameTimeMs.length);
  let acc = 0;
  for (let i = 0; i < frameTimeMs.length; i++) {
    acc += frameTimeMs[i]! / 1000;
    timeSec[i] = acc;
  }
  return timeSec;
}
