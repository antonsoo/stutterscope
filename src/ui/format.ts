export function fmtMs(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return "—";
  return v.toFixed(digits);
}

export function fmtFps(v: number, digits = 1): string {
  if (!Number.isFinite(v)) return "—";
  return v.toFixed(digits);
}

export function fmtPct(fraction: number, digits = 1): string {
  if (!Number.isFinite(fraction)) return "—";
  return (fraction * 100).toFixed(digits) + "%";
}

export function fmtInt(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return Math.round(v).toLocaleString();
}

export function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

export function deltaClass(delta: number, higherIsBetter: boolean): "better" | "worse" | "" {
  if (Math.abs(delta) < 5e-4) return ""; // below display rounding (0.05%) -> not a meaningful difference
  const isBetter = higherIsBetter ? delta > 0 : delta < 0;
  return isBetter ? "better" : "worse";
}

export function fmtSignedPct(fraction: number, digits = 1): string {
  if (!Number.isFinite(fraction)) return "—";
  const rounded = Number((fraction * 100).toFixed(digits));
  if (rounded === 0) return `${(0).toFixed(digits)}%`; // avoid "-0.0%" noise from sub-precision float differences
  const sign = rounded > 0 ? "+" : "";
  return sign + rounded.toFixed(digits) + "%";
}

/**
 * B relative to A, as a fraction. When A is zero there is no percentage: the
 * result is ±Infinity if B isn't (so `deltaClass` still colors it) and 0 if
 * both are.
 */
export function relativeDelta(a: number, b: number): number {
  if (a === 0) return b === 0 ? 0 : b > 0 ? Infinity : -Infinity;
  return (b - a) / Math.abs(a);
}
