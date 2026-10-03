// `stutterscope summary` on a CSV that isn't a known capture format: it reads the column the
// header points to and says so, or says what it could not tell and lists the columns.
import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const cliEntry = join(root, "src", "cli", "index.ts");
const dir = mkdtempSync(join(tmpdir(), "stutterscope-generic-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function run(path: string, ...flags: string[]): { status: number | null; stdout: string; stderr: string } {
  const { status, stdout, stderr } = spawnSync("node", [cliEntry, "summary", path, ...flags], {
    env: { ...process.env, NO_COLOR: "1" },
    encoding: "utf-8",
  });
  return { status, stdout, stderr };
}

interface JsonReport {
  generic?: { column: string; kind: string; guessed: boolean };
  summary: { frameCount: number };
}

function json(stdout: string): JsonReport {
  return JSON.parse(stdout) as JsonReport;
}

function write(name: string, header: string, row: (ms: number, i: number, clockMs: number) => string): string {
  let clock = 0;
  const lines = Array.from({ length: 200 }, (_, i) => {
    const ms = i % 50 === 49 ? 60 : 10;
    const line = row(ms, i, clock);
    clock += ms;
    return line;
  });
  const path = join(dir, name);
  writeFileSync(path, [header, ...lines].join("\n") + "\n");
  return path;
}

describe("stutterscope summary on a generic CSV", () => {
  it("summarises the bundled generic sample with no flags, and says which column it read", () => {
    const result = run(join(root, "examples", "samples", "generic-synthetic-demo.csv"));
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const lines = result.stdout.split("\n");
    expect(lines[0]).toBe("generic-synthetic-demo.csv  Generic CSV");
    expect(lines[1]).toBe("7,969 frames, 119.9s");
    expect(lines[2]).toBe(
      'column "frame_time_ms" read as: Frame time (milliseconds). A guess (named like a frame time; "ms" in its name); --generic-column and --generic-kind set it.',
    );
  });

  it("gives the same numbers as naming the column by hand", () => {
    const sample = join(root, "examples", "samples", "generic-synthetic-demo.csv");
    const guessed = json(run(sample, "--json").stdout);
    const named = json(run(sample, "--json", "--generic-column", "frame_time_ms", "--generic-kind", "frametime_ms").stdout);
    expect(guessed.generic).toEqual({ column: "frame_time_ms", kind: "frametime_ms", guessed: true });
    expect(named.generic).toEqual({ column: "frame_time_ms", kind: "frametime_ms", guessed: false });
    expect(guessed.summary).toEqual(named.summary);
  });

  it("reads a FRAPS-style running clock", () => {
    const path = write("frametimes.csv", "Frame, Time (ms)", (_ms, i, clock) => `${i + 1}, ${clock.toFixed(3)}`);
    const result = run(path, "--json");
    expect(result.status).toBe(0);
    const out = json(result.stdout);
    expect(out.generic).toEqual({ column: "Time (ms)", kind: "timestamp_ms_cumulative", guessed: true });
    expect(out.summary.frameCount).toBe(199);
  });

  it("works out the unit when only the column is named", () => {
    const path = write("two.csv", "frametime_cpu_ms,frametime_gpu_ms", (ms) => `${ms},${ms / 2}`);
    const refused = run(path);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("no single column says it holds frame times");
    expect(refused.stderr).toContain("Columns: frametime_cpu_ms, frametime_gpu_ms.");
    const picked = run(path, "--generic-column", "frametime_gpu_ms");
    expect(picked.status).toBe(0);
    expect(picked.stdout).toContain('column "frametime_gpu_ms" read as: Frame time (milliseconds). A guess');
  });

  it("names the columns when it can't tell, and when the named column is not there", () => {
    const path = write("abc.csv", "a,b,c", (ms) => `${ms},1,2`);
    const unknown = run(path);
    expect(unknown.status).toBe(1);
    expect(unknown.stdout).toBe("");
    expect(unknown.stderr).toContain("Columns: a, b, c.");
    const typo = run(path, "--generic-column", "d", "--generic-kind", "frametime_ms");
    expect(typo.status).toBe(1);
    expect(typo.stderr.trim()).toBe('No column named "d". Columns: a, b, c.');
    const noKind = run(path, "--generic-column", "a");
    expect(noKind.status).toBe(1);
    expect(noKind.stderr).toContain('Can\'t tell what "a" holds from its name. Say with --generic-kind');
    const both = run(path, "--generic-column", "a", "--generic-kind", "frametime_ms");
    expect(both.status).toBe(0);
    expect(both.stdout).toContain('column "a" read as: Frame time (milliseconds)\n');
  });

  it("keeps the list of columns short for a file that isn't a table", () => {
    const path = join(dir, "wide.csv");
    const names = Array.from({ length: 500 }, (_, i) => `c${i}`);
    names[1] = "x".repeat(300);
    writeFileSync(path, `${names.join(",")}\n${names.map(() => "1").join(",")}\n`);
    const result = run(path);
    expect(result.status).toBe(1);
    expect(result.stderr.trim().split("\n")).toHaveLength(1);
    expect(result.stderr).toContain(`Columns: c0, ${"x".repeat(39)}\u2026, c2, `);
    expect(result.stderr).toContain("c11, and 488 more.");
    expect(result.stderr.length).toBeLessThan(700);
  });

  it("refuses a --generic-kind that contradicts the only clear column instead of applying it elsewhere", () => {
    const path = write("fps.csv", "n,frametime_ms", (ms, i) => `${i},${ms}`);
    const result = run(path, "--generic-kind", "fps");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Pick one with --generic-column");
  });
});

describe("text from the capture", () => {
  it("is shown as visible escapes, never sent to the terminal as control characters", () => {
    // A column name holding a terminal escape sequence (this one retitles the window) went to
    // the terminal as it was, in the "column ... read as" line.
    const osc = `${String.fromCharCode(0x1b)}]0;pwned${String.fromCharCode(7)}`;
    const path = join(dir, "escape.csv");
    const rows = [`frame_index,frame_time_ms${osc}`, ...Array.from({ length: 300 }, (_, i) => `${i},${(16.6 + (i % 5) * 0.2).toFixed(2)}`)];
    writeFileSync(path, rows.join("\n") + "\n");
    const { status, stdout } = run(path);
    expect(status).toBe(0);
    expect(stdout).not.toContain(String.fromCharCode(7));
    expect(stdout).not.toContain(`${String.fromCharCode(0x1b)}]`);
    expect(stdout).toContain('column "frame_time_ms\\x1b]0;pwned\\x07" read as');
  });
});
