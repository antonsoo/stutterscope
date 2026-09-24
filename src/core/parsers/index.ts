import type { SniffResult, SourceFormat, StreamingParser } from "../types.js";
import * as presentmon1 from "./presentmon1.js";
import * as presentmon2 from "./presentmon2.js";
import * as frameview from "./frameview.js";
import * as capframex from "./capframex.js";
import * as mangohud from "./mangohud.js";
import * as ocat from "./ocat.js";
import * as generic from "./generic.js";
import type { GenericMapping } from "./generic.js";

/**
 * Order matters only as a tie-breaker: formats are otherwise ranked purely
 * by `sniff()` confidence. PresentMon 2.x and FrameView have the most
 * specific header markers, so they're checked first; `generic` is always
 * last since it matches (weakly) everything.
 */
const SNIFFERS: Array<(sample: string) => SniffResult> = [
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

export function createParserFor(format: SourceFormat, genericMapping?: GenericMapping): StreamingParser {
  switch (format) {
    case "presentmon1":
      return presentmon1.createParser();
    case "presentmon2":
      return presentmon2.createParser();
    case "frameview":
      return frameview.createParser();
    case "capframex":
      return capframex.createParser();
    case "ocat":
      return ocat.createParser();
    case "mangohud":
      return mangohud.createParser();
    case "generic":
      if (!genericMapping) {
        throw new Error("generic format requires a column mapping");
      }
      return generic.createParser(genericMapping);
  }
}

export { presentmon1, presentmon2, frameview, capframex, mangohud, ocat, generic };
export type { GenericMapping, GenericValueKind } from "./generic.js";
