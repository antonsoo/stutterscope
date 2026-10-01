#!/usr/bin/env node
/**
 * `stutterscope summary <file>` — the same parsers and metrics the web app
 * uses, from the terminal. No dependencies beyond the standard library and
 * the core module: this file is the whole CLI.
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { detectFormat, createParserFor } from "../core/parsers/index.ts";
import { parseTextSync } from "../core/stream.ts";
import { computeMetricsSummary, DEFAULT_STUTTER_OPTIONS, summaryForJson, type StutterOptions } from "../core/metrics.ts";
import { FORMAT_LABELS, ParseError, SOURCE_FORMATS, type SourceFormat } from "../core/types.ts";
import { describeStream } from "../core/streams.ts";
import { VERSION } from "./version.ts";
import { GENERIC_VALUE_KIND_LABELS, type GenericMapping, type GenericValueKind } from "../core/parsers/generic.ts";

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

function color(s: string, code: string): string {
  return useColor ? `${code}${s}${RESET}` : s;
}

function fmt(n: number, digits = 1): string {
  return Number.isFinite(n) ? n.toFixed(digits) : "—";
}

interface Args {
  file?: string;
  json: boolean;
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

function parseArgs(argv: string[]): Args {
  const args: Args = { json: false, stutterOptions: { ...DEFAULT_STUTTER_OPTIONS } };
  const value = (i: number, flag: string): string => {
    const v = argv[i];
    if (v === undefined || v.startsWith("--")) throw new UsageError(`${flag} needs a value`);
    return v;
  };
  const number = (i: number, flag: string, min: number, integer = false): number => {
    const raw = value(i, flag);
    const n = Number(raw);
    if (!Number.isFinite(n) || n < min || (integer && !Number.isInteger(n))) {
      throw new UsageError(`${flag} must be ${integer ? "an integer" : "a number"} >= ${min}, got "${raw}"`);
    }
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    if (a === "--json") args.json = true;
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

function printHelp(): void {
  console.log(`${color("stutterscope", BOLD)} — frame-time analysis from the terminal

Usage:
  stutterscope summary <file.csv> [options]
  stutterscope --version

Options:
  --format <name>          force a format (${Object.keys(FORMAT_LABELS).join(", ")})
  --generic-column <name>  (generic format) column holding the value
  --generic-kind <kind>    (generic format) frametime_ms | frametime_us | frametime_s | fps | timestamp_s_cumulative
  --k <n>                  stutter multiplier (default ${DEFAULT_STUTTER_OPTIONS.kMultiplier})
  --window-radius <n>      rolling-median window radius, frames (default ${DEFAULT_STUTTER_OPTIONS.windowRadius})
  --hitch-ms <n>           hitch threshold, ms (default ${DEFAULT_STUTTER_OPTIONS.hitchThresholdMs})
  --stream <sel>           which present stream to analyse when a capture holds several processes:
                           an application name, a process id, or pid:swapchain (default: the busiest
                           stream that isn't dwm.exe)
  --json                   print the full metrics summary as JSON instead
`);
}

function main(): void {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "--version" || command === "-V") {
    console.log(`stutterscope ${VERSION}`);
    return;
  }
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

  let text: string;
  try {
    text = readFileSync(args.file, "utf-8");
  } catch (err) {
    console.error(color(`Could not read ${args.file}: ${err instanceof Error ? err.message : String(err)}`, RED));
    process.exit(1);
    return;
  }

  const format = args.format ?? detectFormat(text.slice(0, 65536)).best.format;
  let mapping: GenericMapping | undefined;
  if (format === "generic") {
    if (!args.genericColumn || !args.genericKind) {
      console.error(
        color(
          "Could not auto-detect a known format. Pass --format generic --generic-column <name> --generic-kind <kind>.",
          RED,
        ),
      );
      process.exit(1);
      return;
    }
    mapping = { valueColumn: args.genericColumn, valueKind: args.genericKind };
  }

  let series;
  try {
    series = parseTextSync(text, createParserFor(format, mapping, { stream: args.stream }), basename(args.file));
  } catch (err) {
    if (!(err instanceof ParseError)) throw err;
    console.error(color(`Could not parse ${args.file}: ${err.message}`, RED));
    process.exit(1);
    return;
  }
  const summary = computeMetricsSummary(series, args.stutterOptions);
  const { streams, selectedStream } = series.meta;

  if (args.json) {
    const streamInfo = streams && streams.length > 1 ? { streams, selectedStream } : {};
    console.log(JSON.stringify({ file: args.file, format, ...streamInfo, summary: summaryForJson(summary) }, null, 2));
    return;
  }

  console.log(`${color(basename(args.file), BOLD)}  ${color(FORMAT_LABELS[format], DIM)}`);
  console.log(color(`${series.frameCount.toLocaleString("en-US")} frames, ${fmt(summary.durationSec, 1)}s`, DIM));
  if (streams && streams.length > 1) {
    const selected = streams.find((st) => st.id === selectedStream);
    console.log(color(`${streams.length} present streams in this capture; analysing ${selected ? describeStream(selected) : selectedStream}`, AMBER));
    for (const st of streams) {
      if (st.id !== selectedStream) console.log(color(`  also: ${describeStream(st)}   (--stream ${st.id})`, DIM));
    }
  }
  if (series.meta.warnings.length > 0) {
    console.log(color(`${series.meta.warnings.length} row(s) skipped while parsing`, AMBER));
  }
  console.log();
  console.log(`  Average FPS            ${color(fmt(summary.averageFps), GREEN)}`);
  console.log(`  1% low (percentile)    ${color(fmt(summary.onePercentLow.percentileMethodFps), GREEN)} fps`);
  console.log(`  1% low (slowest-mean)  ${color(fmt(summary.onePercentLow.meanOfSlowestMethodFps), GREEN)} fps`);
  console.log(`  0.1% low (percentile)  ${color(fmt(summary.pointOnePercentLow.percentileMethodFps), GREEN)} fps`);
  console.log(`  P99 frame time         ${fmt(summary.percentilesMs.p99, 2)} ms`);
  console.log(`  P99.9 frame time       ${fmt(summary.percentilesMs.p999, 2)} ms`);
  console.log(
    `  Stutter events         ${summary.stutter.stutterEventCount > 0 ? color(String(summary.stutter.stutterEventCount), AMBER) : "0"}  (${fmt(summary.stutter.stutterTimeFraction * 100, 2)}% of capture time)`,
  );
  console.log(
    `  ${`Hitches (>${args.stutterOptions.hitchThresholdMs}ms)`.padEnd(22)} ${summary.stutter.hitchCount > 0 ? color(String(summary.stutter.hitchCount), RED) : "0"}`,
  );
  console.log(`  Pacing (MASD)          ${fmt(summary.masdMs, 2)} ms`);
  if (summary.dropped) {
    console.log(`  Dropped frames         ${summary.dropped.droppedCount} (${fmt(summary.dropped.droppedFraction * 100, 2)}%)`);
  }
  if (summary.boundShare) {
    console.log(
      `  CPU- / GPU-bound       ${fmt(summary.boundShare.cpuBoundFraction * 100, 0)}% / ${fmt(summary.boundShare.gpuBoundFraction * 100, 0)}%`,
    );
  }
  if (summary.latency) {
    console.log(`  Display latency P99    ${fmt(summary.latency.p99, 2)} ms`);
  }
}

main();
