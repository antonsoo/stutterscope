#!/usr/bin/env python3
"""
Independent oracle for the core metrics, used only to generate committed
test fixtures (tests/fixtures/oracle/). Run it whenever the synthetic input
below changes:

    python3 scripts/oracle.py

It writes:
  - tests/fixtures/oracle/frametimes.csv  (the input, one frame time per line)
  - tests/fixtures/oracle/expected.json   (numpy-computed expected metrics)

tests/core/oracle.test.ts reads both and asserts the TypeScript metrics
library agrees with numpy to within floating-point tolerance. Percentiles
use numpy's default 'linear' interpolation, which is the same method
`percentileOfSorted` in src/core/metrics.ts implements by hand.
"""
import json
import pathlib

import numpy as np

FIXTURES_DIR = pathlib.Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "oracle"


def generate_frame_times() -> np.ndarray:
    """
    Deterministic synthetic frame-time trace: a steady ~60 fps baseline with
    injected periodic stutter and a few hitches, seeded for reproducibility.
    """
    rng = np.random.default_rng(20260924)
    n = 5000
    base = np.full(n, 16.6667)
    jitter = rng.normal(0, 0.4, n)
    frame_times = base + jitter

    # Periodic stutter: every 137th frame runs long (simulates uneven pacing).
    frame_times[::137] += 12.0

    # A handful of severe hitches (e.g. shader compilation, traversal stutter).
    hitch_indices = [500, 1500, 3000, 4200]
    for idx in hitch_indices:
        frame_times[idx] += 180.0

    frame_times = np.clip(frame_times, 1.0, None)
    return frame_times


def slowest_fraction_mean_fps(sorted_asc: np.ndarray, fraction: float) -> float:
    n = len(sorted_asc)
    count = max(1, round(n * fraction))
    slowest = sorted_asc[n - count :]
    return 1000.0 / float(np.mean(slowest))


def main() -> None:
    FIXTURES_DIR.mkdir(parents=True, exist_ok=True)
    frame_times = generate_frame_times()

    with (FIXTURES_DIR / "frametimes.csv").open("w") as f:
        f.write("frametime_ms\n")
        for v in frame_times:
            f.write(f"{v:.10f}\n")

    sorted_asc = np.sort(frame_times)
    total_sec = float(np.sum(frame_times)) / 1000.0
    n = len(frame_times)

    percentiles = {
        "p50": float(np.percentile(frame_times, 50, method="linear")),
        "p90": float(np.percentile(frame_times, 90, method="linear")),
        "p95": float(np.percentile(frame_times, 95, method="linear")),
        "p99": float(np.percentile(frame_times, 99, method="linear")),
        "p999": float(np.percentile(frame_times, 99.9, method="linear")),
    }

    one_pct_percentile_fps = 1000.0 / percentiles["p99"]
    point1_pct_percentile_fps = 1000.0 / percentiles["p999"]
    one_pct_mean_fps = slowest_fraction_mean_fps(sorted_asc, 0.01)
    point1_pct_mean_fps = slowest_fraction_mean_fps(sorted_asc, 0.001)

    masd = float(np.mean(np.abs(np.diff(frame_times))))

    expected = {
        "frameCount": n,
        "durationSec": total_sec,
        "averageFps": n / total_sec,
        "percentilesMs": percentiles,
        "onePercentLow": {
            "percentileMethodFps": one_pct_percentile_fps,
            "meanOfSlowestMethodFps": one_pct_mean_fps,
        },
        "pointOnePercentLow": {
            "percentileMethodFps": point1_pct_percentile_fps,
            "meanOfSlowestMethodFps": point1_pct_mean_fps,
        },
        "masdMs": masd,
    }

    with (FIXTURES_DIR / "expected.json").open("w") as f:
        json.dump(expected, f, indent=2)
        f.write("\n")

    print(json.dumps(expected, indent=2))


if __name__ == "__main__":
    main()
