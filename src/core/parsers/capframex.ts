/**
 * CapFrameX capture CSV export (github.com/CXWorld/CapFrameX). CapFrameX's
 * native save format is JSON, but its structure is not documented anywhere
 * we could verify against an authoritative source, so — per the brief — we
 * parse its CSV export instead, which the app itself describes as giving
 * "a better view on the raw PresentMon data".
 *
 * Verified against real CapFrameX test fixtures at
 * `source/CapFrameX.Test/TestRecordFiles/` in the CapFrameX repo:
 * `CapFrameXFileWithHeader.csv` (with the `//key=value` metadata block) and
 * `CustomFilenameWithoutComment.csv` (without it). Both share the OCAT-style
 * data schema: `Application,ProcessID,...,MsBetweenPresents,...`.
 *
 * CapFrameX prefixes an optional metadata block, one `//Key=Value` line per
 * entry (`FileRecordInfo.cs`, `HEADER_MARKER = "//"`), e.g.:
 *   //GameName=re2.exe
 *   //ProcessName=Resident Evil 2 Remake
 *   //CreationDate=2019-03-30
 *   ...
 * before the ordinary CSV header and rows.
 *
 * Note: when that metadata block is absent (CapFrameX's "without comment"
 * export option), a CapFrameX CSV is byte-for-byte the same schema as an
 * OCAT CSV — there is no reliable way to tell them apart from content alone,
 * which we say plainly in `docs/formats.md` rather than guess.
 */
import type { FrameSeries, SniffResult, StreamingParser } from "../types.js";
import { parseTextSync } from "../stream.js";
import { PresentFamilyParser } from "./ocat.js";

export function sniff(sampleText: string): SniffResult {
  const lines = sampleText.split(/\r?\n/);
  const firstLine = lines[0] ?? "";
  if (firstLine.startsWith("//")) {
    return { format: "capframex", confidence: 0.95, reason: "leading //key=value metadata block" };
  }
  return { format: "capframex", confidence: 0, reason: "no //key=value metadata block found" };
}

class CapFrameXParser implements StreamingParser {
  private readonly inner = new PresentFamilyParser("capframex");
  private readonly meta = new Map<string, string>();
  private sawDataHeader = false;

  pushLine(line: string, lineIndex: number): void {
    if (!this.sawDataHeader && line.startsWith("//")) {
      const eq = line.indexOf("=");
      if (eq > 2) this.meta.set(line.slice(2, eq).trim(), line.slice(eq + 1).trim());
      return;
    }
    if (!this.sawDataHeader) {
      // First non-"//" line: hand it and everything after to the shared parser
      // as if it were line 0, so the header-detection logic still applies.
      this.sawDataHeader = true;
    }
    this.inner.pushLine(line, lineIndex);
  }

  finish(sourceFileName: string): FrameSeries {
    const series = this.inner.finish(sourceFileName);
    const gameName = this.meta.get("GameName");
    if (gameName && series.meta.application === undefined) {
      series.meta.application = gameName;
    }
    return series;
  }
}

export function createParser(): StreamingParser {
  return new CapFrameXParser();
}

export function parse(text: string, fileName = "capture.csv"): FrameSeries {
  return parseTextSync(text, createParser(), fileName);
}
