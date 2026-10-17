/** Native Windows CapFrameX Session/SessionRun/SessionCaptureData, not its CSV export.
 * Source and recorded-file verification: docs/formats.md and studies/native-json/.
 * JSON is buffered in the parser worker, bounded to 64 MiB; CSV remains streamed.
 */
import { Float64Builder, Uint8Builder } from "../buffer.ts";
import { FrameContinuity } from "../continuity.ts";
import { cumulativeSeconds } from "../streams.ts";
import { ParseError, type FrameSeries, type ParserOptions, type SniffResult, type StreamingParser } from "../types.ts";

export const MAX_NATIVE_JSON_BYTES = 64 * 1024 * 1024;

export function requireNativeJsonSize(bytes: number): void {
  if (bytes > MAX_NATIVE_JSON_BYTES) throw new ParseError("native CapFrameX JSON is limited to 64 MiB; export a smaller recording as CSV for streaming import");
}

export function sniff(sample: string): SniffResult {
  const first = sample.trimStart()[0];
  const json = first === "{" || first === "[";
  return { format: "capframex-json", confidence: json ? 1 : 0,
    reason: json ? "JSON document; validate the native CapFrameX session before analysis" : "not a JSON document" };
}

type ObjectValue = Record<string, unknown>;
function object(value: unknown, path: string): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ParseError(`${path} must be an object in a native CapFrameX session`);
  return value as ObjectValue;
}

/** JSON.parse validates syntax, but silently discards duplicate members. Inspect
 * the validated text too, including escaped aliases, before accepting any data.
 * No numeric arrays or string values are materialized a second time.
 */
function requireUniqueMembers(text: string): void {
  const stack: Array<Set<string> | null> = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") {
      if (stack.length >= 128) throw new ParseError("native JSON nesting exceeds 128 levels");
      stack.push(new Set());
    } else if (ch === "[") {
      if (stack.length >= 128) throw new ParseError("native JSON nesting exceeds 128 levels");
      stack.push(null);
    } else if (ch === "}" || ch === "]") stack.pop();
    else if (ch === '"') {
      const start = i++;
      while (i < text.length && text[i] !== '"') { if (text[i] === "\\") i++; i++; }
      let next = i + 1;
      while (/\s/.test(text[next] ?? "x")) next++;
      if (text[next] === ":") {
        const members = stack[stack.length - 1];
        const key = JSON.parse(text.slice(start, i + 1)) as string;
        if (members?.has(key)) throw new ParseError(`duplicate JSON member ${JSON.stringify(key)} at character ${start + 1}; native capture is ambiguous`);
        members?.add(key);
      }
    }
  }
}

/** Null/empty optional arrays are absent in native files. A populated channel
 * must align exactly: padding/truncating it would move evidence between frames.
 */
function channel(data: ObjectValue, key: string, count: number, path: string): unknown[] | undefined {
  const value = data[key];
  if (value === undefined || value === null) return;
  if (!Array.isArray(value)) throw new ParseError(`${path}.${key} must be an array or null`);
  if (value.length === 0) return;
  if (value.length !== count) throw new ParseError(`${path}.${key} has ${value.length} samples; MsBetweenPresents has ${count}. Cannot align frame evidence.`);
  return value as unknown[];
}

const duration = (value: unknown): number => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : NaN;

export function parse(text: string, fileName = "capture.json", options: ParserOptions = {}): FrameSeries {
  requireNativeJsonSize(text.length);
  let value: unknown;
  try { value = JSON.parse(text.replace(/^\uFEFF/, "")) as unknown; }
  catch { throw new ParseError("invalid JSON; expected a complete native CapFrameX saved session"); }
  requireUniqueMembers(text);
  const session = object(value, "session");
  const info = object(session.Info, "Info");
  if (!Array.isArray(session.Runs) || session.Runs.length === 0) throw new ParseError("Runs must be a non-empty array in a native CapFrameX session");
  if (options.stream !== undefined) throw new ParseError("native CapFrameX JSON holds recordings, not present-stream identities; use --capture-run instead of --stream");
  const runs = session.Runs.map((run: unknown, index: number) => {
    const path = `Runs[${index}].CaptureData`;
    const data = object(object(run, `Runs[${index}]`).CaptureData, path);
    if (!Array.isArray(data.MsBetweenPresents)) throw new ParseError(`${path}.MsBetweenPresents must be an array`);
    return { data, path, samples: data.MsBetweenPresents as unknown[] };
  });
  const selectedRun = options.captureRun ?? 1;
  if (!Number.isSafeInteger(selectedRun) || selectedRun < 1 || selectedRun > runs.length) throw new ParseError(`--capture-run must be from 1 to ${runs.length}; got ${selectedRun}`);
  const { data, path, samples } = runs[selectedRun - 1]!;
  // TimeInSeconds can be rewritten by CapFrameX when cutting/aggregating runs;
  // it does not establish a native wall-clock adjacency check for this format.
  channel(data, "TimeInSeconds", samples.length, path);
  const dropped = channel(data, "Dropped", samples.length, path);
  const cpu = channel(data, "CpuActive", samples.length, path);
  const gpu = channel(data, "GpuActive", samples.length, path);
  const latency = channel(data, "MsUntilDisplayed", samples.length, path);
  const frames = new Float64Builder(samples.length);
  const indices = new Float64Builder(samples.length);
  const flags = dropped ? new Uint8Builder(samples.length) : undefined;
  const cpuMs = cpu ? new Float64Builder(samples.length) : undefined;
  const gpuMs = gpu ? new Float64Builder(samples.length) : undefined;
  const latencyMs = latency ? new Float64Builder(samples.length) : undefined;
  const continuity = new FrameContinuity();
  const warnings: string[] = [];
  let skippedRows = 0;
  for (let i = 0; i < samples.length; i++) {
    const ms = duration(samples[i]);
    if (!Number.isFinite(ms)) {
      skippedRows++;
      if (warnings.length < 20) warnings.push(`${path}.MsBetweenPresents[${i}]: invalid frame time; sample skipped`);
      continuity.skip();
      continue;
    }
    continuity.keep();
    frames.push(ms); indices.push(i);
    flags?.push(dropped![i] === true ? 1 : dropped![i] === false ? 0 : 2);
    cpuMs?.push(duration(cpu![i])); gpuMs?.push(duration(gpu![i]));
    latencyMs?.push(duration(latency![i]));
  }
  if (frames.length === 0) throw new ParseError(`${path}.MsBetweenPresents has no usable frame times (${samples.length} samples)`);
  const frameTimeMs = frames.toArray();
  return {
    meta: {
      format: "capframex-json", sourceFileName: fileName,
      application: typeof info.ProcessName === "string" ? info.ProcessName : undefined,
      warnings, skippedRows, columns: Object.keys(data),
      nativeCapture: {
        selectedRun, runs: runs.map((r, i) => ({ run: i + 1, sampleCount: r.samples.length })),
        appVersion: typeof info.AppVersion === "string" ? info.AppVersion : null,
        frameTimePath: `${path}.MsBetweenPresents`,
        note: "One saved recording is analyzed at a time. TimeInSeconds may be normalized by CapFrameX; the timeline sums retained frame durations. Adjacent retained array entries within this recording support pacing; skipped samples break continuity. Missing frames and elapsed gaps are not reconstructed. SensorData, RTSS and display-change arrays are not substituted for present frame times.",
      },
    },
    frameCount: frames.length, frameTimeMs, timeSec: cumulativeSeconds(frameTimeMs),
    sourceSample: indices.toArray(), gapBefore: continuity.toArray(),
    channels: { dropped: flags?.toArray(), cpuBusyMs: cpuMs?.toArray(), gpuBusyMs: gpuMs?.toArray(), displayLatencyMs: latencyMs?.toArray() },
  };
}

/** The shared file driver sends raw decoded chunks to this bounded document
 * parser. Native minified files bypass the CSV-only physical-line size limit. */
export function createParser(options: ParserOptions = {}): StreamingParser {
  const parts: string[] = [];
  let length = 0;
  return {
    pushChunk(chunk) { length += chunk.length; requireNativeJsonSize(length); parts.push(chunk); },
    pushLine() { throw new ParseError("native JSON requires decoded chunks, not CSV records"); },
    finish(fileName) { return parse(parts.join(""), fileName, options); },
  };
}
