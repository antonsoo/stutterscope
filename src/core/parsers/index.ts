import { ParseError } from "../types.ts";
import type { ParserOptions, SniffResult, SourceFormat, StreamingParser } from "../types.ts";
import * as presentmon1 from "./presentmon1.ts";
import * as presentmon2 from "./presentmon2.ts";
import * as presentmon from "./presentmon.ts";
import * as frameview from "./frameview.ts";
import * as capframex from "./capframex.ts";
import * as capframexJson from "./capframex-json.ts";
import * as mangohud from "./mangohud.ts";
import * as ocat from "./ocat.ts";
import * as generic from "./generic.ts";
import type { GenericMapping } from "./generic.ts";

/**
 * Order matters only as a tie-breaker: formats are otherwise ranked purely
 * by `sniff()` confidence. PresentMon 2.x and FrameView have the most
 * specific header markers, so they're checked first; `generic` is always
 * last since it matches (weakly) everything.
 */
const SNIFFERS: Array<(sample: string) => SniffResult> = [
  capframexJson.sniff,
  presentmon.sniff,
  presentmon2.sniff,
  frameview.sniff,
  presentmon1.sniff,
  capframex.sniff,
  ocat.sniff,
  mangohud.sniff,
  generic.sniff,
];

export interface DetectionResult {
  best: SniffResult;
  all: SniffResult[];
}

/** Detects the most likely format from a sample of the file (the first chunk is enough). */
export function detectFormat(sampleText: string): DetectionResult {
  const all = SNIFFERS.map((fn) => fn(sampleText));
  const best = all.reduce((a, b) => (b.confidence > a.confidence ? b : a));
  return { best, all };
}

export function createParserFor(
  format: SourceFormat,
  genericMapping?: GenericMapping,
  options: ParserOptions = {},
): StreamingParser {
  if (options.captureRun !== undefined && format !== "capframex-json") throw new ParseError("--capture-run applies only to native CapFrameX JSON");
  switch (format) {
    case "presentmon1":
      return presentmon1.createParser(options);
    case "presentmon2":
      return presentmon2.createParser(options);
    case "presentmon":
      return presentmon.createParser(options);
    case "frameview":
      return frameview.createParser(options);
    case "capframex-json":
      return capframexJson.createParser(options);
    case "capframex":
      return capframex.createParser(options);
    case "ocat":
      return ocat.createParser(options);
    case "mangohud":
      return mangohud.createParser();
    case "generic":
      if (!genericMapping) {
        throw new Error("generic format requires a column mapping");
      }
      return generic.createParser(genericMapping);
  }
}

export { presentmon1, presentmon2, presentmon, frameview, capframex, capframexJson, mangohud, ocat, generic };
export type { GenericMapping, GenericValueKind } from "./generic.ts";
