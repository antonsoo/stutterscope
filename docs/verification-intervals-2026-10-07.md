# Interval investigation: implementation evidence

Verified locally on 2026-10-07 (America/Los_Angeles; screenshot timestamps are
2026-10-08 UTC). Application code through `9f4d75a`, following `7e9af88`,
`28edef8`, and `403f907`. Later documentation and capture-verifier edits do not
change the application. No npm release, push, or deployment was performed.

## What became possible

The previous trace zoom changed the view while metrics still described the full
capture. A user also could not trace an on-screen slow frame back to its original
CSV line, and comparison exports contained only Run A.

The browser now analyzes independently selected intervals, retains full-stream
stutter context, inspects original frame/line evidence, and exports both runs.
The CLI's `compare` command produces the same report structure. This work also
found and corrected generic-conversion overflow, a one-frame MASD incorrectly
reported as zero, decimal-boundary drift, and MangoHud periodic logging being
treated as a complete frame stream.

## Retained observation, independent arithmetic

The [controlled capture](../examples/controlled-browser/README.md) contains
recorded Chromium animation timestamps. Its workload deliberately adds four
blocking tasks to Run A's scene and startup/tail work to both runs. It is a
controlled browser experiment, not a physical game or GPU benchmark.

| Observation | Run A | Run B |
| --- | ---: | ---: |
| All recorded frames | 543 | 567 |
| Full-capture slow episodes | 6 | 2 |
| Selected scene | 1.5-8.5 s | 1.5-8.5 s |
| Selected frames | 396 | 420 |
| Summed selected duration | 6.9998 s | 6.9998 s |
| Average FPS | 56.57304494 | 60.00171433 |
| P99 frame time | 21.79 ms | 16.80 ms |
| 1% low, percentile definition | 45.89261129 fps | 59.52380952 fps |
| 1% low, slowest-mean definition | 8.57265324 fps | 59.52380952 fps |
| Scene slow episodes / hitch frames | 4 / 4 | 0 / 0 |

Run A's scene episodes point to original CSV lines **115, 217, 319, 421**.
The 2.2-2.34 s interval contains only two frames, yet its 116.6 ms frame keeps
the stutter flag detected using the full stream's neighbors.

The independent verifier reads CSV directly, checks retained capture/script
SHA-256 values, uses separately logged elapsed timestamps for selection, and
compares statistics with NumPy and a direct Python rolling median. It checks
both full captures and two intervals per run: six analyses in all.

```sh
npm run build:cli
uv run --with numpy --no-project python scripts/verify-intervals.py
```

The literal command passed using Python 3.14.7 and NumPy 2.5.3. Retained outputs:

- [Independent numeric results](verification/interval-numpy-oracle.json)
- [Browser JSON, including both complete episode lists](verification/interval-browser-report.json)
- [Browser Markdown download](verification/interval-browser-report.md)
- [CLI comparison and original-line evidence](verification/interval-cli-comparison.txt)

Browser and compiled-CLI JSON matched in every field except `generatedAt`.
The same comparison from the installed npm tarball on Node 22.6.0 matched too.
That agreement checks the delivery paths; NumPy supplies the independent
arithmetic check.

## Clean build and real browser workflows

From a fresh detached checkout at `9f4d75a`, using Node **24.21.0** and npm
**11.19.0**, with no reused `node_modules`:

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run test:browser
```

All commands passed: 207 core/CLI tests in 19 files and 54 production-browser
workflows across Chromium **153.0.8010.12** and Firefox **155.0**. `npm ci`
also compiled the CLI through `prepare`. The browser command built the static
site before serving it. These were local checks, not a claim about hosted CI.

The browser workflows exercise recorded-example loading, independent intervals,
view-versus-analysis behavior, original CSV references, offline exports,
worker failure/retry, cancellation and stale results, replacement sources,
settings updates, import failures, bounded episode paging, and MangoHud error
recovery. Accessibility and keyboard checks include 1440, 1280, 375, and 320 px
layouts. An early Chromium mobile run exposed horizontal overflow from hidden
text inside the scrolling episode table; replacing it with the button's
accessible name fixed the overflow. The complete final run passed.

New interval workflows and the screenshot capture asserted no page errors,
off-origin requests, or CSP violations. Existing privacy checks also run in the
browser suite. This is bounded workflow evidence, not a proof about every
possible file, browser, or extension.

The production build is `npm run build`, output **`dist/`**, with the existing
`/stutterscope/` base. Current asset sizes from Vite:

| Asset | Bytes reported as decimal kB | Gzipped kB |
| --- | ---: | ---: |
| Main JavaScript | 110.38 | 41.28 |
| Worker JavaScript | 29.33 | Not reported by Vite |
| CSS | 37.77 | 7.04 |

Local fonts and example captures are additional static assets.

## Installed executable and documented commands

After the clean build, `npm pack --ignore-scripts` produced a local tarball.
Installing it with scripts disabled into a new empty consumer directory installed
one package with no runtime dependencies. Its `node_modules/.bin/stutterscope`
ran `--version`, interval `summary --events`, and two-file `compare --json`
under Node **22.6.0**, the minimum declared runtime. The package contained 24
files, all executable code plain JavaScript, with no source TypeScript.

This was an **unreleased local build** retaining package version 0.2.5, not the
registry artifact with that version. The tarball built from the clean checkout
had SHA-1 `747862ffa777a5085439b304c0da6fdb214006e5`; documentation changes will
change a subsequent package's bytes.

The walkthrough's human summary, shared-interval comparison, and different
per-run bounds were executed. `npm run cli -- summary` reproduced the README's
PresentMon example metrics. `npm run samples` reproduced every committed
synthetic sample with no diff. The recorded comparison was exercised through
the production preview, and the screenshot script verified downloadable JSON,
Markdown, and PNG rather than inspecting only in-memory values.

## Timing and visual evidence

Machine: 14 logical CPUs, WSL2 Linux `6.18.40.1-microsoft-standard-WSL2`, about
47 GiB RAM. The performance fixture makes a synthetic 430,000-row, 66.7 MiB
PresentMon 2.x CSV; the timings exclude generating that CSV and exclude browser
rendering. Run with Node 24.21.0:

```sh
npx vitest run tests/core/performance.test.ts --reporter=verbose --silent=false --disableConsoleIntercept
```

| Observation | Parse | Full metrics | Combined |
| --- | ---: | ---: | ---: |
| Alongside screenshot capture | 1638 ms | 163 ms | 1801 ms |
| Later individual performance run | 782 ms | 130 ms | 912 ms |

These are observations under different load, not evidence of a speedup. The
15-second test ceiling catches gross regressions; it is not a latency promise.

`node scripts/capture-intervals.mjs` captured the production page at 1440 px and
375 px and checked browser/CLI report equality. Every retained screenshot was
visually inspected. The corrected evidence image includes both the trace and
its full inspector; the phone views keep controls readable without document
overflow. The shared scrolling frame table retains the remaining columns.

- [Interval comparison](assets/interval-comparison.png)
- [Trace, episodes, and source rows](assets/interval-evidence.png)
- [Phone interval controls](assets/interval-mobile.png)
- [Phone episode evidence](assets/interval-evidence-mobile.png)
- [Downloaded interval card](assets/interval-report-card.png)
- [MangoHud assumption and clock evidence](assets/mangohud-clock-note.png)
- [Downloaded MangoHud card](assets/mangohud-clock-card.png)
- [Capture environment, checks, and screenshot hashes](verification/interval-screenshots.json)

## Limits kept visible

- Scene boundaries are manually chosen; no automatic scene alignment or
  run-to-run significance claim is made. The retained experiment is one run
  per condition.
- The timeline sums retained frame durations. Missing or skipped source time
  is not reconstructed. Whole frames can straddle a requested bound.
- Slow episodes locate evidence, not causes. CPU/GPU/latency channels appear
  only when supplied by the format. PNG shows Run A; JSON and Markdown carry both.
- MangoHud's CSV does not record `log_interval`. The elapsed check rejects
  large contradictions but cannot establish completeness. Source links,
  thresholds, and the `unverified` case are documented in
  [formats](formats.md#mangohud).
- Detection and complete exports need memory/work proportional to capture size.
  Paging bounds the rendered table, not the input size. Browser verification
  covered Chromium and Firefox, not Safari or a physical gaming rig.

Suggested repository description: "Inspect frame-time capture intervals, trace
slow frames to CSV evidence, and compare runs locally."
Topics: `frametime`, `presentmon`, `mangohud`, `performance`, `benchmarking`,
`typescript`, `local-first`.
