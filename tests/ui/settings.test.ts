import { describe, expect, it } from "vitest";
import { readStutterOptions } from "../../src/ui/settings.ts";

describe("browser detection settings", () => {
  it("accepts documented bounds and fractional thresholds", () => {
    expect(readStutterOptions("1.1", "2", "5")).toEqual({ kMultiplier: 1.1, windowRadius: 2, hitchThresholdMs: 5 });
    expect(readStutterOptions("5", "60", "500")).toEqual({ kMultiplier: 5, windowRadius: 60, hitchThresholdMs: 500 });
    expect(readStutterOptions("2.25", "10", "50.5").hitchThresholdMs).toBe(50.5);
  });
  it.each(["", " ", "NaN", "Infinity", "-1", "1", "5.01"])("rejects invalid multiplier %j", (value) => {
    expect(() => readStutterOptions(value, "10", "50")).toThrow("k multiplier");
  });
  it.each(["", "2.5", "1", "61", "Infinity"])("rejects invalid radius %j", (value) => {
    expect(() => readStutterOptions("2", value, "50")).toThrow("Window radius");
  });
  it.each(["", "4.9", "501", "Infinity"])("rejects invalid hitch threshold %j", (value) => {
    expect(() => readStutterOptions("2", "10", value)).toThrow("Hitch threshold");
  });
});
