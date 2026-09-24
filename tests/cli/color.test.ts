/**
 * The CLI decides once, at startup, whether to emit ANSI color codes
 * (NO_COLOR > FORCE_COLOR > isTTY). That decision only really means
 * anything observed from outside the process — a piped stdout is not a
 * TTY — so this drives the actual built CLI as a subprocess with different
 * environments rather than importing the module in-process.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const cliEntry = join(here, "..", "..", "src", "cli", "index.ts");
const sampleFile = join(here, "..", "..", "examples", "samples", "presentmon1-synthetic-demo.csv");

// eslint-disable-next-line no-control-regex -- intentional: detecting the literal ESC (0x1b) that starts every ANSI code
const ANSI_PATTERN = /\x1b\[/;

function run(env: Record<string, string | undefined>): string {
  // execFileSync's stdout is always a pipe, never a TTY -- exactly the
  // "piped" case this behavior needs to get right by default.
  return execFileSync("node", [cliEntry, "summary", sampleFile], {
    env: { ...process.env, ...env },
    encoding: "utf-8",
  });
}

describe("CLI color output", () => {
  it("emits no ANSI codes when stdout is piped and no color env vars are set", () => {
    const out = run({ NO_COLOR: undefined, FORCE_COLOR: undefined });
    expect(ANSI_PATTERN.test(out)).toBe(false);
  });

  it("emits ANSI codes when FORCE_COLOR asks for them, even when piped", () => {
    const out = run({ FORCE_COLOR: "1", NO_COLOR: undefined });
    expect(ANSI_PATTERN.test(out)).toBe(true);
  });

  it("NO_COLOR overrides FORCE_COLOR", () => {
    const out = run({ FORCE_COLOR: "1", NO_COLOR: "1" });
    expect(ANSI_PATTERN.test(out)).toBe(false);
  });

  it("FORCE_COLOR=0 does not force color on", () => {
    const out = run({ FORCE_COLOR: "0", NO_COLOR: undefined });
    expect(ANSI_PATTERN.test(out)).toBe(false);
  });
});
