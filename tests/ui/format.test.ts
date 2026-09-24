import { describe, expect, it } from "vitest";
import { deltaClass, fmtBytes, fmtFps, fmtInt, fmtMs, fmtPct, fmtSignedPct } from "../../src/ui/format.ts";

describe("fmtMs / fmtFps", () => {
  it("formats finite numbers with fixed digits", () => {
    expect(fmtMs(16.66666, 2)).toBe("16.67");
    expect(fmtFps(59.95, 1)).toBe("60.0");
  });

  it("renders non-finite values as an em dash, not NaN/Infinity", () => {
    expect(fmtMs(NaN)).toBe("—");
    expect(fmtFps(Infinity)).toBe("—");
  });
});

describe("fmtPct / fmtInt", () => {
  it("converts a fraction to a percentage string", () => {
    expect(fmtPct(0.016, 1)).toBe("1.6%");
    expect(fmtPct(1, 0)).toBe("100%");
  });

  it("rounds and adds thousands separators", () => {
    expect(fmtInt(7969)).toBe("7,969");
    expect(fmtInt(4.6)).toBe("5");
  });
});

describe("fmtBytes", () => {
  it("picks a sensible unit", () => {
    expect(fmtBytes(500)).toBe("500 B");
    expect(fmtBytes(1536)).toBe("1.5 KB");
    expect(fmtBytes(1_500_000)).toBe("1.4 MB");
  });
});

describe("fmtSignedPct", () => {
  it("signs positive and negative deltas", () => {
    expect(fmtSignedPct(0.183, 0)).toBe("+18%");
    expect(fmtSignedPct(-0.05, 1)).toBe("-5.0%");
  });

  it("never renders a bare -0.0%: sub-precision noise reads as exactly zero", () => {
    expect(fmtSignedPct(-0.0000001, 1)).toBe("0.0%");
    expect(fmtSignedPct(0, 1)).toBe("0.0%");
  });
});

describe("deltaClass", () => {
  it("flags a higher-is-better metric correctly", () => {
    expect(deltaClass(0.1, true)).toBe("better");
    expect(deltaClass(-0.1, true)).toBe("worse");
  });

  it("flips for a lower-is-better metric", () => {
    expect(deltaClass(0.1, false)).toBe("worse");
    expect(deltaClass(-0.1, false)).toBe("better");
  });

  it("treats sub-precision differences as neutral", () => {
    expect(deltaClass(0.00001, true)).toBe("");
  });
});
