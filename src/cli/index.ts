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
import { computeMetricsSummary, DEFAULT_STUTTER_OPTIONS, type StutterOptions } from "../core/metrics.ts";
import { FORMAT_LABELS } from "../core/types.ts";
import type { GenericMapping, GenericValueKind } from "../core/parsers/generic.ts";

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
  format?: string;
  genericColumn?: string;
  genericKind?: GenericValueKind;
  stutterOptions: StutterOptions;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { json: false, stutterOptions: { ...DEFAULT_STUTTER_OPTIONS } };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    if (a === "--json") args.json = true;
    else if (a === "--format") args.format = argv[++i];
    else if (a === "--generic-column") args.genericColumn = argv[++i];
    else if (a === "--generic-kind") args.genericKind = argv[++i] as GenericValueKind;
    else if (a === "--k") args.stutterOptions.kMultiplier = Number(argv[++i]);
    else if (a === "--window-radius") args.stutterOptions.windowRadius = Number(argv[++i]);
    else if (a === "--hitch-ms") args.stutterOptions.hitchThresholdMs = Number(argv[++i]);
    else if (!a.startsWith("-")) args.file = a;
  }
  return args;
}

function printHelp(): void {
  console.log(`${color("stutterscope", BOLD)} — frame-time analysis from the terminal

Usage:
  stutterscope summary <file.csv> [options]

Options:
  --format <name>          force a format (${Object.keys(FORMAT_LABELS).join(", ")})
  --generic-column <name>  (generic format) column holding the value
  --generic-kind <kind>    (generic format) frametime_ms | frametime_us | frametime_s | fps | timestamp_s_cumulative
  --k <n>                  stutter multiplier (default ${DEFAULT_STUTTER_OPTIONS.kMultiplier})
  --window-radius <n>      rolling-median window radius, frames (default ${DEFAULT_STUTTER_OPTIONS.windowRadius})
  --hitch-ms <n>           hitch threshold, ms (default ${DEFAULT_STUTTER_OPTIONS.hitchThresholdMs})
  --json                   print the full metrics summary as JSON instead
`);
}

function main(): void {
  const [command, ...rest] = process.argv.slice(2);
  if (command !== "summary" || rest.length === 0 || rest.includes("-h") || rest.includes("--help")) {
    printHelp();
    process.exit(command === "summary" && rest.length > 0 ? 0 : 1);
  }

  const args = parseArgs(rest);
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

  const parser = createParserFor(format as Parameters<typeof createParserFor>[0], mapping);
  const series = parseTextSync(text, parser, basename(args.file));
  const summary = computeMetricsSummary(series, args.stutterOptions);

  if (args.json) {
    console.log(JSON.stringify({ file: args.file, format, summary }, null, 2));
    return;
  }

  console.log(`${color(basename(args.file), BOLD)}  ${color(FORMAT_LABELS[format as keyof typeof FORMAT_LABELS], DIM)}`);
  console.log(color(`${series.frameCount.toLocaleString()} frames, ${fmt(summary.durationSec, 1)}s`, DIM));
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
    `  Hitches (>${args.stutterOptions.hitchThresholdMs}ms)         ${summary.stutter.hitchCount > 0 ? color(String(summary.stutter.hitchCount), RED) : "0"}`,
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
