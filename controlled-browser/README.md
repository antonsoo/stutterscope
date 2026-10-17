# A captured scene with controlled blocking work

These CSVs contain actual `requestAnimationFrame` timestamp differences from a
locally executed Chromium animation on 2026-10-07. They are **controlled browser
captures**, not PresentMon logs, game benchmarks, or simulated frame durations.

`scripts/capture-browser-workload.mjs` draws moving squares for approximately ten
seconds. Both runs deliberately block the main thread for 350 ms during warmup
and 250 ms during the tail. Run A additionally blocks for 120 ms near 2.2, 4.0,
5.8, and 7.6 seconds. Run B omits those four tasks. The 1.5–8.5 s interval selects
the scene. Frame timestamps determine the CSV values; the requested blocking
durations are not written as frame times. Animation callback timestamps and
presentation are different measurements, so a recorded frame interval need not
equal a measured blocking duration.

The immutable capture description, browser/Node/system versions, observed task
durations, and SHA-256 of each CSV and the capture script are in
[`capture.json`](capture.json). Browser scheduling and other machine activity can
affect timings. No repetitions or hardware comparisons were performed.

| Capture | All frames | Scene frames | Scene stutter frames | Scene hitches >50 ms |
| --- | ---: | ---: | ---: | ---: |
| [controlled-a.csv](controlled-a.csv) | 543 | 396 | 4 | 4 |
| [controlled-b.csv](controlled-b.csv) | 567 | 420 | 0 | 0 |

The four scene episodes in A point to CSV lines **115, 217, 319, and 421**. Each
is one frame in this capture. Before selecting the scene, both runs also include
the deliberately blocked startup and tail, which shows why the selected interval
belongs in the exported evidence.

To make a fresh capture without overwriting this retained example:

```sh
npm ci
node scripts/capture-browser-workload.mjs --out /tmp/stutterscope-capture
```

This uses Playwright's installed Chromium. It opens no remote sites and needs no
microphone, game, GPU profiler, or account. Runs are sequential; the output is a
new observation, not expected to match the committed CSV byte for byte. The script
and captures are covered by the repository's MIT license.

The independent verifier reads raw CSV through Python's CSV reader, uses the
separately recorded elapsed timestamps for interval membership, and compares
metrics against NumPy and a direct `statistics.median` window calculation:

```sh
npm run build:cli
uv run --with numpy --no-project python scripts/verify-intervals.py
```

See the [interval-analysis walkthrough](../../docs/interval-analysis.md) for the
browser and CLI investigation, boundary rules, and export coordinates.
