// The CLI's answer to a file that is a capture in an unusual shape (other line endings, UTF-16)
// and to one that is no capture at all: a summary, or one line on stderr and exit code 1.
import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const cliEntry = join(here, "..", "..", "src", "cli", "index.ts");
const sample = readFileSync(join(here, "..", "fixtures", "presentmon2", "sample.csv"), "utf-8").replace(/\r\n/g, "\n");
const dir = mkdtempSync(join(tmpdir(), "stutterscope-cli-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function run(name: string, content: string | Uint8Array, ...flags: string[]): { status: number | null; stdout: string; stderr: string } {
  const path = join(dir, name);
  writeFileSync(path, content);
  const { status, stdout, stderr } = spawnSync("node", [cliEntry, "summary", path, ...flags], {
    env: { ...process.env, NO_COLOR: "1" },
    encoding: "utf-8",
  });
  return { status, stdout, stderr };
}

/** The summary without its first line, which names the file. */
const body = (stdout: string): string => stdout.split("\n").slice(1).join("\n");

function utf16le(text: string): Uint8Array {
  const bytes = new Uint8Array(2 + text.length * 2);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 0xfeff, true);
  for (let i = 0; i < text.length; i++) view.setUint16(2 + i * 2, text.charCodeAt(i), true);
  return bytes;
}

describe("stutterscope summary on unusual files", () => {
  const reference = run("lf.csv", sample);

  it("summarises the plain capture", () => {
    expect(reference.status).toBe(0);
    expect(reference.stdout).toContain("5 frames");
    expect(reference.stdout).toContain("Average FPS            62.5");
  });

  it("reads CR-only and CRLF line endings", () => {
    for (const [name, ending] of [["cr.csv", "\r"], ["crlf.csv", "\r\n"]] as const) {
      const result = run(name, sample.replace(/\n/g, ending));
      expect(result.status).toBe(0);
      expect(body(result.stdout)).toBe(body(reference.stdout));
    }
  });

  it("reads a UTF-16 capture, as Windows PowerShell's > writes one", () => {
    const result = run("utf16.csv", utf16le(sample));
    expect(result.status).toBe(0);
    expect(body(result.stdout)).toBe(body(reference.stdout));
    const json = run("utf16-json.csv", utf16le(sample), "--json");
    expect((JSON.parse(json.stdout) as { format: string; summary: { frameCount: number } }).summary.frameCount).toBe(5);
  });

  const refused: Array<[string, string | Uint8Array, RegExp]> = [
    ["header-only.csv", sample.split("\n")[0]! + "\n", /^Could not parse .*header-only\.csv: the file has a header and no data rows\n$/],
    ["empty.csv", "", /^Could not parse .*empty\.csv: the file is empty\n$/],
    ["blank.csv", "\n\n  \n", /^Could not parse .*blank\.csv: the file is empty\n$/],
    ["workbook.csv", Uint8Array.of(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00, 0x08, 0x00), /^Could not parse .*workbook\.csv: this is not a text file/],
    [
      "all-na.csv",
      sample.split("\n").map((line, i) => (i === 0 ? line : line.replace(/^(([^,]*,){10})[^,]*/, "$1NA"))).join("\n"),
      /^Could not parse .*all-na\.csv: none of its 5 data rows has a usable frame time \(line 2: missing\/invalid FrameTime, row skipped\)\n$/,
    ],
    ["minified.json", `{"frames":[${"16.6,".repeat(300_000)}16.6]}`, /^Could not auto-detect a known format\./],
  ];
  for (const [name, content, message] of refused) {
    it(`refuses ${name} in one line, with exit code 1`, () => {
      const result = run(name, content);
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toMatch(message);
      expect(result.stderr.trim().split("\n")).toHaveLength(1);
    });
  }

  it("refuses a file with no line breaks when a format is forced on it", () => {
    const result = run("forced.json", `{"frames":[${"16.6,".repeat(300_000)}16.6]}`, "--format", "presentmon2");
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/a line is longer than 1,048,576 characters, so this is not a CSV capture\n$/);
  });

  it("counts skipped rows, in the singular for one", () => {
    const lines = sample.split("\n");
    const bad = lines[1]!.replace(/^(([^,]*,){10})[^,]*/, "$1-3");
    const one = run("one-bad.csv", [lines[0], bad, ...lines.slice(1)].join("\n"));
    expect(one.status).toBe(0);
    expect(one.stdout).toContain("5 frames");
    expect(one.stdout).toContain("\n1 row skipped while parsing\n");
    expect(body(one.stdout).replace("1 row skipped while parsing\n", "")).toBe(body(reference.stdout));
    const two = run("two-bad.csv", [lines[0], bad, bad, ...lines.slice(1)].join("\n"));
    expect(two.stdout).toContain("\n2 rows skipped while parsing\n");
  });
});
