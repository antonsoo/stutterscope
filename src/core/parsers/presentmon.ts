/** PresentMon's current default CSV, verified with the official 2.6.0 executable.
 * MsBetweenPresents ends at TimeInMs/TimeInSeconds, unlike v2's forward FrameTime.
 * MsBetweenAppStart is a different interval and must not replace present timing.
 * See studies/presentmon-default for native traces and an independent replay.
 */
import { LINE_BREAK, splitCsvLine, stripBom } from "../csv.ts";
import { ParseError, type FrameSeries, type ParserOptions, type SniffResult, type StreamingParser } from "../types.ts";
import { parseTextSync } from "../stream.ts";
import { PresentFamilyParser } from "./ocat.ts";

export function sniff(sampleText: string): SniffResult {
  let columns: string[];
  try { columns = splitCsvLine(stripBom(sampleText).split(LINE_BREAK, 1)[0] ?? "").map(c => c.trim()); }
  catch (error) { if (!(error instanceof ParseError)) throw error; columns = []; }
  const matches = ["MsBetweenPresents", "MsCPUBusy", "MsCPUWait"].every(name => columns.includes(name));
  return { format: "presentmon", confidence: matches ? 0.99 : 0,
    reason: matches ? "header has native MsBetweenPresents/MsCPUBusy/MsCPUWait" : "header does not match PresentMon default metrics" };
}

export function createParser(options: ParserOptions = {}): StreamingParser {
  return new PresentFamilyParser("presentmon", options);
}

export function parse(text: string, fileName = "capture.csv", options: ParserOptions = {}): FrameSeries {
  return parseTextSync(text, createParser(options), fileName);
}
