import type { StutterOptions } from "../core/metrics.ts";

/** The bounds displayed by the browser controls, checked again at submission. */
export function readStutterOptions(k: string, radius: string, hitch: string): StutterOptions {
  const kMultiplier = Number(k);
  const windowRadius = Number(radius);
  const hitchThresholdMs = Number(hitch);
  if (!k.trim() || !Number.isFinite(kMultiplier) || kMultiplier < 1.1 || kMultiplier > 5) {
    throw new Error("k multiplier must be between 1.1 and 5.");
  }
  if (!radius.trim() || !Number.isInteger(windowRadius) || windowRadius < 2 || windowRadius > 60) {
    throw new Error("Window radius must be a whole number between 2 and 60.");
  }
  if (!hitch.trim() || !Number.isFinite(hitchThresholdMs) || hitchThresholdMs < 5 || hitchThresholdMs > 500) {
    throw new Error("Hitch threshold must be between 5 and 500 ms.");
  }
  return { kMultiplier, windowRadius, hitchThresholdMs };
}
