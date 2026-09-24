/**
 * Measures parse + metrics time on a file the size the brief calls out
 * explicitly: "a 30-minute capture at 240 fps is about 430k rows." The
 * assertion is deliberately loose (CI machines vary); the point is to fail
 * loudly if a future change makes this quadratic, and to print a real
 * number for the README's "How it works" section rather than guessing one.
 */
import { describe, expect, it } from "vitest";
import * as presentmon2 from "../../src/core/parsers/presentmon2.ts";
import { parseTextSync } from "../../src/core/stream.ts";
import { computeMetricsSummary } from "../../src/core/metrics.ts";

function buildLargePresentMon2Csv(rowCount: number): string {
  const header =
    "Application,ProcessID,SwapChainAddress,PresentRuntime,SyncInterval,PresentFlags,AllowsTearing," +
    "PresentMode,FrameType,CPUStartQPC,FrameTime,CPUBusy,CPUWait,GPULatency,GPUTime,GPUBusy,GPUWait," +
    "VideoBusy,DisplayLatency,DisplayedTime,AnimationError,AnimationTime,MsFlipDelay," +
    "AllInputToPhotonLatency,ClickToPhotonLatency,InstrumentedLatency";
  const rows: string[] = [header];
  for (let i = 0; i < rowCount; i++) {
    // A cheap deterministic wobble, not a full scenario -- this test is about throughput.
    const frameTime = 4.1667 + Math.sin(i * 0.01) * 0.6 + (i % 997 === 0 ? 25 : 0);
    const cpu = frameTime * 0.5;
    const gpu = frameTime * 0.6;
    rows.push(
      `perf.exe,1,0x1,DXGI,1,0,0,Hardware: Independent Flip,Application,${i * 1000},${frameTime.toFixed(4)},` +
        `${cpu.toFixed(4)},${(frameTime - cpu).toFixed(4)},0.1000,${gpu.toFixed(4)},${gpu.toFixed(4)},` +
        `${(frameTime - gpu).toFixed(4)},0.0000,8.0000,${frameTime.toFixed(4)},NA,NA,NA,NA,NA,NA`,
    );
  }
  return rows.join("\n") + "\n";
}

describe("large-file performance", () => {
  it("parses and computes metrics for a ~430k-row capture in bounded time", () => {
    const ROW_COUNT = 430_000;
    const csv = buildLargePresentMon2Csv(ROW_COUNT);
    const csvSizeMb = csv.length / (1024 * 1024);

    const parseStart = performance.now();
    const series = parseTextSync(csv, presentmon2.createParser(), "perf.csv");
    const parseMs = performance.now() - parseStart;

    expect(series.frameCount).toBe(ROW_COUNT);

    const metricsStart = performance.now();
    const summary = computeMetricsSummary(series);
    const metricsMs = performance.now() - metricsStart;

    expect(summary.frameCount).toBe(ROW_COUNT);
    expect(Number.isFinite(summary.averageFps)).toBe(true);

    console.log(
      `[perf] ${ROW_COUNT.toLocaleString()} rows, ${csvSizeMb.toFixed(1)} MB CSV: ` +
        `parse ${parseMs.toFixed(0)} ms, metrics ${metricsMs.toFixed(0)} ms, ` +
        `total ${(parseMs + metricsMs).toFixed(0)} ms`,
    );

    // Generous ceiling: this is about catching an accidental O(n^2), not
    // pinning down a tight perf budget that would make CI flaky.
    expect(parseMs + metricsMs).toBeLessThan(15_000);
  }, 30_000);
});
