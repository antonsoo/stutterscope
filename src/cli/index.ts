#!/usr/bin/env node
/**
 * `stutterscope summary <file>` — the same parsers and metrics the web app
 * uses, from the terminal. No dependencies beyond the standard library and
 * the core module: this file is the whole CLI.
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { detectFormat, createParserFor } from "../core/parsers/index.ts";
import { decodeText, requireText } from "../core/encoding.ts";
import { parseTextSync, requireFrames } from "../core/stream.ts";
import { DEFAULT_STUTTER_OPTIONS, summaryForJson, type StutterOptions } from "../core/metrics.ts";
import { analyzeCapture, type CaptureAnalysis } from "../core/analysis.ts";
import { buildJsonReport, buildComparisonReport } from "../core/report.ts";
import { slowEpisodes } from "../core/episodes.ts";
import { FORMAT_LABELS, ParseError, SOURCE_FORMATS, type SourceFormat } from "../core/types.ts";
import { describeStream } from "../core/streams.ts";
import { VERSION } from "./version.ts";
import {
  GENERIC_VALUE_KIND_LABELS,
  guessKind,
  guessMapping,
  readHeader,
  type GenericMapping,
  type GenericValueKind,
} from "../core/parsers/generic.ts";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[38;2;124;255;178m";
const AMBER = "\x1b[38;2;255;180;84m";
const RED = "\x1b[38;2;255;75;92m";

/**
 * NO_COLOR (https://no-color.org/) always wins, even over FORCE_COLOR —
 * it's an explicit "never" from the user's environment. Otherwise color is
 * on for an interactive terminal, or when FORCE_COLOR asks for it
 * explicitly (piping to `less -R`, capturing for a colored log, etc.).
 * Checked once at startup so every `color()` call agrees, instead of the
 * previous bug where only some ANSI codes went through the TTY check.
 */
function shouldUseColor(): boolean {
  if (process.env.NO_COLOR !== undefined) return false;
  const forceColor = process.env.FORCE_COLOR;
  if (forceColor !== undefined && forceColor !== "0") return true;
  return process.stdout.isTTY === true;
}

const useColor = shouldUseColor();

/**
 * `text` with each control character (bar tab and line breaks) written as a visible escape, `\x1b`.
 * File and column names, stream names and parse errors come from the capture, and a terminal obeys
 * an escape sequence in what it is given: clears the screen, retitles the window, hides text.
 */
function visible(text: string): string {
  return text.replace(/[^\P{Cc}\t\n\r]/gu, (ch) => `\\x${ch.charCodeAt(0).toString(16).padStart(2, "0")}`);
}

/** Every message goes through here, so text from the capture is always shown, never sent. */
function color(s: string, code: string): string {
  const shown = visible(s);
  return useColor ? `${code}${shown}${RESET}` : shown;
}

function fmt(n: number, digits = 1): string {
  return Number.isFinite(n) ? n.toFixed(digits) : "—";
}

interface Args {
  file?: string;
  json: boolean;
  events?: boolean;
  start?: number;
  end?: number;
  aStart?: number; aEnd?: number; bStart?: number; bEnd?: number;
  aStream?: string; bStream?: string;
  format?: SourceFormat;
  genericColumn?: string;
  genericKind?: GenericValueKind;
  stream?: string;
  stutterOptions: StutterOptions;
}

/** A bad flag or value, reported instead of silently computing with NaN or crashing later. */
class UsageError extends Error {}

function isFormat(v: string): v is SourceFormat {
  return (SOURCE_FORMATS as readonly string[]).includes(v);
}

function isGenericKind(v: string): v is GenericValueKind {
  return Object.hasOwn(GENERIC_VALUE_KIND_LABELS, v);
}

function parseArgs(argv: string[], comparison = false): Args {
  const args: Args = { json: false, stutterOptions: { ...DEFAULT_STUTTER_OPTIONS } };
  const value = (i: number, flag: string): string => {
    const v = argv[i];
    if (v === undefined || v.startsWith("--")) throw new UsageError(`${flag} needs a value`);
    return v;
  };
  const number = (i: number, flag: string, min: number, integer = false): number => {
    const raw = value(i, flag);
    const n = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(n) || n < min || (integer && !Number.isSafeInteger(n))) {
      throw new UsageError(`${flag} must be ${integer ? "an integer" : "a number"} >= ${min}, got "${raw}"`);
    }
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    if (a === "--json") args.json = true;
    else if (a === "--events") args.events = true;
    else if (a === "--start") args.start = number(++i, a, 0);
    else if (a === "--end") args.end = number(++i, a, 0);
    else if (comparison && a === "--a-start") args.aStart = number(++i, a, 0);
    else if (comparison && a === "--a-end") args.aEnd = number(++i, a, 0);
    else if (comparison && a === "--b-start") args.bStart = number(++i, a, 0);
    else if (comparison && a === "--b-end") args.bEnd = number(++i, a, 0);
    else if (comparison && a === "--a-stream") args.aStream = value(++i, a);
    else if (comparison && a === "--b-stream") args.bStream = value(++i, a);
    else if (a === "--format") {
      const f = value(++i, a);
      if (!isFormat(f)) throw new UsageError(`unknown format "${f}"; one of: ${SOURCE_FORMATS.join(", ")}`);
      args.format = f;
    } else if (a === "--generic-column") args.genericColumn = value(++i, a);
    else if (a === "--generic-kind") {
      const k = value(++i, a);
      if (!isGenericKind(k)) {
        throw new UsageError(`unknown kind "${k}"; one of: ${Object.keys(GENERIC_VALUE_KIND_LABELS).join(", ")}`);
      }
      args.genericKind = k;
    } else if (a === "--stream") args.stream = value(++i, a);
    else if (a === "--k") args.stutterOptions.kMultiplier = number(++i, a, 1);
    else if (a === "--window-radius") args.stutterOptions.windowRadius = number(++i, a, 1, true);
    else if (a === "--hitch-ms") args.stutterOptions.hitchThresholdMs = number(++i, a, 0);
    else if (a.startsWith("-")) throw new UsageError(`unknown option ${a}`);
    else if (args.file !== undefined) throw new UsageError(`one file at a time (got ${args.file} and ${a})`);
    else args.file = a;
  }
  return args;
}

/** The file's column names for an error message: the first dozen, each cut to a readable length. */
function describeColumns(header: string[]): string {
  // A file that isn't a table at all (minified JSON) is one "header" of thousands of "columns".
  const shown = header.slice(0, 12).map((name) => {
    const printable = name.replace(/\p{Cc}/gu, " ");
    return printable.length > 40 ? `${printable.slice(0, 39)}\u2026` : printable;
  });
  const rest = header.length - shown.length;
  return shown.join(", ") + (rest > 0 ? `, and ${rest.toLocaleString("en-US")} more` : "");
}

/**
 * The column to read from a CSV that isn't a known capture format, and what it holds: as
 * given, or worked out from the header and the first rows. Returns the message to print
 * when it can't be worked out; a wrong guess would be a report about the wrong numbers.
 */
function genericMapping(sample: string, args: Args): { mapping: GenericMapping; guessed?: string } | string {
  const header = readHeader(sample);
  const columns = `Columns: ${describeColumns(header)}.`;
  const kinds = Object.keys(GENERIC_VALUE_KIND_LABELS).join(" | ");
  if (args.genericColumn !== undefined && !header.includes(args.genericColumn)) {
    return `No column named "${args.genericColumn}". ${columns}`;
  }
  if (args.genericColumn !== undefined && args.genericKind !== undefined) {
    return { mapping: { valueColumn: args.genericColumn, valueKind: args.genericKind } };
  }
  if (args.genericColumn !== undefined) {
    const guess = guessKind(sample, args.genericColumn);
    if (guess) return { mapping: guess.mapping, guessed: guess.reason };
    return `Can't tell what "${args.genericColumn}" holds from its name. Say with --generic-kind <${kinds}>.`;
  }
  const guess = guessMapping(sample);
  if (guess && (args.genericKind === undefined || args.genericKind === guess.mapping.valueKind)) {
    return { mapping: guess.mapping, guessed: guess.reason };
  }
  return (
    `This isn't a capture format stutterscope knows, and no single column says it holds frame times. ` +
    `${columns} Pick one with --generic-column <name> --generic-kind <${kinds}>.`
  );
}

function printHelp(): void {
  console.log(`${color("stutterscope", BOLD)} — frame-time analysis from the terminal

Usage:
  stutterscope summary <file.csv> [options]
  stutterscope compare <a.csv> <b.csv> [options]
  stutterscope --version

Options:
  --format <name>          force a format (${Object.keys(FORMAT_LABELS).join(", ")})
  --generic-column <name>  for a CSV from another tool: the column that holds the frame timing
  --generic-kind <kind>    and what it holds: ${Object.keys(GENERIC_VALUE_KIND_LABELS).join(" | ")}
                           (both are guessed from the column names when they are clear:
                           frame_time_ms, FrameTime, a FRAPS "Time (ms)", fps)
  --k <n>                  stutter multiplier (default ${DEFAULT_STUTTER_OPTIONS.kMultiplier})
  --window-radius <n>      rolling-median window radius, frames (default ${DEFAULT_STUTTER_OPTIONS.windowRadius})
  --hitch-ms <n>           hitch threshold, ms (default ${DEFAULT_STUTTER_OPTIONS.hitchThresholdMs})
  --stream <sel>           which present stream to analyse when a capture holds several processes:
                           an application name, a process id, or pid:swapchain (default: the busiest
                           stream that isn't dwm.exe)
  --json                   print the full metrics summary as JSON instead
  --start <seconds>        analyze frames ending after this point (default: 0)
  --end <seconds>          include frames ending at or before this point (default: capture end)
                           bounds use accumulated usable frame time, not source wall-clock time;
                           whole frames are kept, with full-stream stutter-detection context
  --events                 list slow-frame episodes with original frame numbers and CSV lines

Comparison overrides (otherwise the shared --start, --end and --stream apply to both):
  --a-start / --a-end <s>   Run A interval bounds
  --b-start / --b-end <s>   Run B interval bounds
  --a-stream <sel>         Run A present stream
  --b-stream <sel>         Run B present stream
  --json                   include both reports, intervals, settings and every slow-frame episode
`);
}

function readCapture(file: string, args: Args) {
  let text: string;
  try {
    text = decodeText(readFileSync(file));
  } catch (err) {
    throw new Error(`Could not read ${file}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }

  let format: SourceFormat;
  let series;
  let mapping: GenericMapping | undefined;
  let guessed: string | undefined;
  try {
    const sample = text.slice(0, 65536);
    requireText(sample);
    format = args.format ?? detectFormat(sample).best.format;
    if (format === "generic") {
      const resolved = genericMapping(sample, args);
      if (typeof resolved === "string") {
        throw new Error(resolved);
      }
      mapping = resolved.mapping;
      guessed = resolved.guessed;
    }
    series = requireFrames(
      parseTextSync(text, createParserFor(format, mapping, { stream: args.stream }), basename(file)),
    );
  } catch (err) {
    if (!(err instanceof ParseError)) throw err;
    throw new Error(`Could not parse ${file}: ${err.message}`, { cause: err });
  }
  let analysis: CaptureAnalysis;
  try {
    const range = args.start !== undefined || args.end !== undefined
      ? { startSec: args.start ?? 0, endSec: args.end ?? null } : null;
    analysis = analyzeCapture(series, args.stutterOptions, range);
  } catch (error) {
    throw new Error(`Could not analyze ${file}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  return { analysis, format, mapping, guessed };
}

function compareFiles(argv: string[]): void {
  if (argv.includes("--help") || argv.includes("-h")) { printHelp(); return; }
  try {
    const [aFile, bFile, ...flags] = argv;
    if (!aFile || !bFile || aFile.startsWith("-") || bFile.startsWith("-")) throw new UsageError("compare needs two files followed by options");
    const args = parseArgs(flags, true);
    if (args.file) throw new UsageError("compare takes exactly two files");
    const a = readCapture(aFile, { ...args, start: args.aStart ?? args.start, end: args.aEnd ?? args.end, stream: args.aStream ?? args.stream });
    const b = readCapture(bFile, { ...args, start: args.bStart ?? args.start, end: args.bEnd ?? args.end, stream: args.bStream ?? args.stream });
    const reportFor = (run: typeof a) => buildJsonReport(run.analysis.series, run.analysis.summary, args.stutterOptions, run.mapping, run.analysis.selection);
    if (args.json) { console.log(JSON.stringify(buildComparisonReport(reportFor(a), reportFor(b)), null, 2)); return; }
    console.log(color(`A: ${basename(aFile)}   B: ${basename(bFile)}`, BOLD));
    for (const [label, run] of [["A", a], ["B", b]] as const) {
      const { selection, series, summary } = run.analysis;
      const requested = selection.requested;
      console.log(color(`${label}: ${requested ? `requested ${requested.startSec}-${requested.endSec ?? "end"} s` : "entire capture"}; frames ${selection.firstFrameIndex + 1}-${selection.lastFrameIndex + 1} of ${selection.sourceFrameCount}; ${fmt(summary.durationSec, 6)} s analyzed; ${series.meta.skippedRows} source rows skipped.`, DIM));
      if (series.meta.selectedStream) console.log(color(`   Stream: ${series.meta.selectedStream} (${series.meta.application ?? "unnamed"})`, DIM));
      if (series.meta.timingEvidence) console.log(color(`   ${series.meta.timingEvidence.note}`, AMBER));
      if (run.mapping) console.log(color(`   Column: ${run.mapping.valueColumn} (${run.mapping.valueKind})${run.guessed ? "; inferred from column name/values" : ""}.`, DIM));
    }
    console.log(color(`Detection: k = ${args.stutterOptions.kMultiplier}, radius = ${args.stutterOptions.windowRadius}, hitch > ${args.stutterOptions.hitchThresholdMs} ms; full-stream neighbors.`, DIM));
    console.log("Accumulated usable frame time; descriptive comparison, not a hardware-gain claim.\n");
    const sa = a.analysis.summary;
    const sb = b.analysis.summary;
    const rows: Array<[string, number, number]> = [
      ["Average FPS", sa.averageFps, sb.averageFps],
      ["1% low percentile (fps)", sa.onePercentLow.percentileMethodFps, sb.onePercentLow.percentileMethodFps],
      ["1% low slowest-mean (fps)", sa.onePercentLow.meanOfSlowestMethodFps, sb.onePercentLow.meanOfSlowestMethodFps],
      ["1% low time-weighted (fps)", sa.onePercentLow.timeWeightedFps, sb.onePercentLow.timeWeightedFps],
      ["P99 frame time (ms)", sa.percentilesMs.p99, sb.percentilesMs.p99],
      ["Stutter frames", sa.stutter.stutterEventCount, sb.stutter.stutterEventCount],
      ["Stutter time (%)", sa.stutter.stutterTimeFraction * 100, sb.stutter.stutterTimeFraction * 100],
      ["Hitches / 1,000 frames", sa.stutter.hitchCount / sa.frameCount * 1000, sb.stutter.hitchCount / sb.frameCount * 1000],
      ["Pacing MASD (ms)", sa.masdMs, sb.masdMs],
      ["Observed adjacent pairs", sa.pacingCoverage.observedPairs, sb.pacingCoverage.observedPairs],
      ["Gaps between frames", sa.pacingCoverage.gapBoundaries, sb.pacingCoverage.gapBoundaries],
    ];
    console.log("Metric".padEnd(28) + "A".padStart(12) + "B".padStart(12) + "B - A".padStart(12));
    for (const [name, av, bv] of rows) console.log(name.padEnd(28) + fmt(av, 3).padStart(12) + fmt(bv, 3).padStart(12) + fmt(bv - av, 3).padStart(12));
    if (args.events) { printEpisodes(a.analysis, "Run A"); printEpisodes(b.analysis, "Run B"); }
  } catch (error) {
    console.error(color(`stutterscope: ${error instanceof Error ? error.message : String(error)}`, RED));
    process.exitCode = 1;
  }
}

function main(): void {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "--version" || command === "-V") {
    console.log(`stutterscope ${VERSION}`);
    return;
  }
  if (command === "compare") { compareFiles(rest); return; }
  if (command !== "summary" || rest.length === 0 || rest.includes("-h") || rest.includes("--help")) {
    printHelp();
    process.exit(command === "summary" && rest.length > 0 ? 0 : 1);
  }

  let args: Args;
  try {
    args = parseArgs(rest);
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    console.error(color(`stutterscope: ${err.message}`, RED));
    process.exit(1);
    return;
  }
  if (!args.file) {
    printHelp();
    process.exit(1);
  }

  let loaded: ReturnType<typeof readCapture>;
  try { loaded = readCapture(args.file, args); }
  catch (error) {
    console.error(color(error instanceof Error ? error.message : String(error), RED));
    process.exit(1);
  }
  const { analysis, format, mapping, guessed } = loaded;
  const series = analysis.series;
  const { summary, selection } = analysis;
  const { streams, selectedStream } = series.meta;

  if (args.json) {
    const streamInfo = streams && streams.length > 1 ? { streams, selectedStream } : {};
    const genericInfo = mapping ? { generic: { column: mapping.valueColumn, kind: mapping.valueKind, guessed: guessed !== undefined } } : {};
    const report = buildJsonReport(series, summary, args.stutterOptions, mapping, selection);
    // Keep the existing CLI summary key; source and analysis carry the same schema as browser reports.
    console.log(JSON.stringify({ file: args.file, format, ...genericInfo, ...streamInfo,
      schemaVersion: report.schemaVersion, source: report.source, analysis: report.analysis,
      ...(args.events ? { episodes: report.episodes } : {}), summary: summaryForJson(summary) }, null, 2));
    return;
  }

  console.log(`${color(basename(args.file), BOLD)}  ${color(FORMAT_LABELS[format], DIM)}`);
  console.log(color(`${series.frameCount.toLocaleString("en-US")} ${series.frameCount === 1 ? "frame" : "frames"}, ${fmt(summary.durationSec, 1)}s`, DIM));
  if (selection.requested) {
    console.log(color(`Interval: requested ${selection.requested.startSec} to ${selection.requested.endSec ?? "end"} s; source frames ${selection.firstFrameIndex + 1}-${selection.lastFrameIndex + 1} of ${selection.sourceFrameCount}.`, AMBER));
    console.log(color(`Actual frame coverage ${fmt(selection.startSec, 6)}-${fmt(selection.endSec, 6)} s; accumulated frame time, full-stream detection context.`, DIM));
  }
  if (mapping) {
    const read = `column "${mapping.valueColumn}" read as: ${GENERIC_VALUE_KIND_LABELS[mapping.valueKind]}`;
    console.log(
      guessed === undefined
        ? color(read, DIM)
        : color(`${read}. A guess (${guessed}); --generic-column and --generic-kind set it.`, AMBER),
    );
  }
  if (streams && streams.length > 1) {
    const selected = streams.find((st) => st.id === selectedStream);
    console.log(color(`${streams.length} present streams in this capture; analysing ${selected ? describeStream(selected) : selectedStream}`, AMBER));
    for (const st of streams) {
      if (st.id !== selectedStream) console.log(color(`  also: ${describeStream(st)}   (--stream ${st.id})`, DIM));
    }
  }
  if (series.meta.timingEvidence) console.log(color(series.meta.timingEvidence.note, AMBER));
  const { skippedRows } = series.meta;
  if (skippedRows > 0) {
    console.log(color(`${skippedRows.toLocaleString("en-US")} ${skippedRows === 1 ? "row" : "rows"} skipped while parsing`, AMBER));
  }
  console.log();
  const line = (label: string, value: string) => console.log(`  ${label.padEnd(25)}${value}`);
  line("Average FPS", color(fmt(summary.averageFps), GREEN));
  const lows = (label: string, low: typeof summary.onePercentLow) => {
    line(`${label} (percentile)`, `${color(fmt(low.percentileMethodFps), GREEN)} fps`);
    line(`${label} (slowest-mean)`, `${color(fmt(low.meanOfSlowestMethodFps), GREEN)} fps`);
    line(`${label} (time-weighted)`, `${color(fmt(low.timeWeightedFps), GREEN)} fps`);
  };
  lows("1% low", summary.onePercentLow);
  lows("0.1% low", summary.pointOnePercentLow);
  line("P99 frame time", `${fmt(summary.percentilesMs.p99, 2)} ms`);
  line("P99.9 frame time", `${fmt(summary.percentilesMs.p999, 2)} ms`);
  line(
    "Stutter events",
    `${summary.stutter.stutterEventCount > 0 ? color(String(summary.stutter.stutterEventCount), AMBER) : "0"}  (${fmt(summary.stutter.stutterTimeFraction * 100, 2)}% of capture time)`,
  );
  line(
    `Hitches (>${args.stutterOptions.hitchThresholdMs}ms)`,
    summary.stutter.hitchCount > 0 ? color(String(summary.stutter.hitchCount), RED) : "0",
  );
  line("Pacing (MASD)", Number.isFinite(summary.masdMs) ? `${fmt(summary.masdMs, 2)} ms` : "Unavailable");
  line("Pacing observations", `${summary.pacingCoverage.observedPairs} adjacent pairs; ${summary.pacingCoverage.gapBoundaries} gaps between analyzed frames`);
  const coverage = summary.telemetryCoverage;
  const observations = (label: string, c: { observedFrames: number; unknownFrames: number }) =>
    line(label, `${c.observedFrames}/${c.observedFrames + c.unknownFrames} frames observed; ${c.unknownFrames} unknown`);
  if (coverage.dropped) {
    line("Dropped frames", summary.dropped ? `${summary.dropped.droppedCount} (${fmt(summary.dropped.droppedFraction * 100, 2)}% of observed)` : "Unknown");
    observations("Drop observations", coverage.dropped);
  }
  if (coverage.cpuGpuBusy) {
    line("CPU- / GPU-bound", summary.boundShare ? `${fmt(summary.boundShare.cpuBoundFraction * 100, 0)}% / ${fmt(summary.boundShare.gpuBoundFraction * 100, 0)}% (busy-time heuristic)` : "Unavailable");
    observations("CPU/GPU observations", coverage.cpuGpuBusy);
  }
  if (coverage.displayLatency) {
    line("Display latency P99", summary.latency ? `${fmt(summary.latency.p99, 2)} ms` : "Unavailable");
    observations("Latency observations", coverage.displayLatency);
  }
  if (args.events) printEpisodes(analysis);
}

function printEpisodes(analysis: CaptureAnalysis, label = ""): void {
    const episodes = slowEpisodes(analysis);
    console.log(`\n${label ? label + " " : ""}Slow-frame episodes: ${episodes.length} (consecutive observed stutter/hitch frames; split at source gaps; no cause inferred)`);
    console.log("  Frames          Time (s)                Worst (ms)  CSV lines");
    for (const event of episodes.slice(0, 20)) {
      const frames = `${event.firstFrame}-${event.lastFrame}`.padEnd(15);
      const time = `${fmt(event.startSec, 4)}-${fmt(event.endSec, 4)}`.padEnd(24);
      const lines = event.firstSourceLine === null ? "unavailable" : `${event.firstSourceLine}-${event.lastSourceLine}`;
      console.log(`  ${frames} ${time}${fmt(event.longestFrameMs, 3).padEnd(12)}${lines}${event.touchesSelectionStart || event.touchesSelectionEnd ? " (selection boundary)" : ""}${event.startsAfterGap || event.endsBeforeGap ? " (source gap)" : ""}`);
    }
    if (episodes.length > 20) console.log(`  Showing 20 of ${episodes.length}. --events --json retains every episode.`);
  }

main();
