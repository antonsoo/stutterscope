# What "1% low" means in the tools people compare against: 34 public capture files, 8 long enough to measure

This study looked for real frame-time captures made by other people and found 34 files in six public GitHub repositories. There was no systematic crawl: these are the files that turned up in the capture tools' own repositories and a few others. Eighteen of those are the expected-output ("gold") CSVs of PresentMon's own test suite, which checks them against ETW traces ([`Tests/README.md` L3](https://github.com/GameTechDev/PresentMon/blob/38ec4a7e2998a7c4eea2c3c7dd4772f29ef32f76/Tests/README.md)); they cover six traces, each in three CSV schemas, and they are test fixtures, not captures from users' machines. The other 16 are user or example captures: 4 PresentMon logs, 1 MangoHud log (with MangoHud's own summary), 2 files in the xD3I/Benchmarks repository, 3 FrameView logs (with FrameView's own summary for two of them), 3 MSI Afterburner logs and 3 MangoHud logs. Nine per-frame captures have 900 frames or more, which is where a "1% low" starts to mean anything. One of them, `witcher_3_test.csv` (906 frames), is left out because its origin is unclear and it holds a 7.8-second frame, so the definition comparison below is on 8 captures: five titles, one of them a benchmark, and some pairs from the same machine. This is not a census.

Flightlessmango.com, the benchmark site that was meant to be the yardstick, returned HTTP 502 on every attempt on 8 October 2026. Nothing in this study uses it.

stutterscope reports a "1% low" in two forms, and the question here is whether those forms are the ones the tools people compare against print, and how far apart the forms land.

## What came out

- **The percentile definitions agree; the others do not.** Four implementations of the 99th-percentile frame time (stutterscope's linear interpolation, MangoHud's summary, mangoplot, CapFrameX's R8 quantile) differ by a median of 0.13% and at most 3.7% on the 1% low across the 8 captures. Across all the definitions, the highest 1% low is a median of 21% above the lowest, and on a capture with a 5.3 s stall it is 29,000% above (55.4 fps against 0.19 fps). (`mangoplot` itself skips logs under 10,000 frames, which three of the 8 are; its rule is applied to them here all the same.)
- **stutterscope matched MangoHud's own summary of one capture to 0.03% (1% low) and 0.21% (0.1% low).** The file is one 117,569-frame Witchfire log. MangoHud's rule, re-implemented from its source, reproduced its two printed figures exactly (49.475 and 65.744).
- **The released 0.2.5 "slowest-mean" figure disagreed with FrameView's own summary on short captures, and the cause was a rounding rule.** On the two FrameView captures that come with a FrameView summary, 0.2.5 was 1.9% and 3.4% below FrameView's "1% Low FPS" and 28.6% below its "0.1% Low FPS" on one of them. FrameView's four printed figures are reproduced exactly by averaging the slowest `ceil(n × fraction)` frames; 0.2.5 used `round(n × fraction)`. The source checkout now uses `ceil` and matches all four. That after-score is on the two rows the rule was found on, and `ceil` is not the only rule that fits them: see below.
- **The source checkout adds a third figure, the time-weighted low CapFrameX calls "low integral".** On the 8 captures it is a median 9.7% below the percentile figure and as much as 99.7% below it (the mean-of-slowest figure is at most 85% below). Neither released stutterscope nor any other figure stutterscope printed corresponded to it.
- **Four MangoHud files that 0.2.5 parsed are not per-frame captures, and the checkout refuses them.** Their `elapsed` column steps by about 100 ms per row (consistent with a non-zero `log_interval`), so 3,694 rows span 369.6 s while the rows' frame times sum to 24.1 s. 0.2.5 reported that file as a 24.1 s capture. The refusal comes from commit 9f4d75a, made after v0.2.5 and before this study; this study is the first measurement of it on files not made for its tests.
- **Frame counts and durations agree with an independent count.** For all 31 files that 0.2.5 parsed and all 27 that the checkout parsed, frame count and duration equal a count made with the csv module and no stutterscope code, the duration to 1 microsecond. That count reads the same columns the parser chose, so it checks the arithmetic and not the interpretation: 4 of the 31 that 0.2.5 parsed are not per-frame captures at all (next point).

## The data

`fetch.py` downloads each file from `raw.githubusercontent.com` at a pinned commit and writes `manifest.json` (URL, commit, SHA-256, size, licence). The cache (86 MB) is not committed. The files were found by GitHub repository search and by listing the file trees of the tools' own repositories; I did not run a systematic crawl, and GitHub code search needs authentication, so other captures certainly exist.

| Source (commit) | Licence | Files | What they are |
|---|---|---|---|
| GameTechDev/PresentMon `Tests/Gold` (38ec4a7) | MIT | 18 | gold CSVs of six ETW traces, each in three schemas (unsuffixed, `_v1`, `_v2`). Frames in the analysed stream: 7 to 259. Test fixtures. |
| cosmiclf/Intel_PresentMon_Performance_Analysis `Logs` (afceff4) | none stated | 4 | PresentMon console logs of Apex Legends and Superposition, 8,020 to 13,143 frames |
| Reason7322/mangohudlogs (72a3bfa) | none stated | 1 (+ summary) | MangoHud 0.8.2 log of Witchfire, 117,569 frames, with MangoHud's `_summary.csv` |
| xD3I/Benchmarks `examples` (6dc5048) | Unlicense | 2 | a MangoHud log (periodic) and a FrameView 1.6 log of Resident Evil 4, 112,316 frames |
| Pavelioso/Frameviewer `assets` (084d4cb) | none stated | 3 (+ summary) | FrameView logs of The Witcher 3 and FrameView's summary CSV (2 rows) |
| erkexzcx/flightlesssomething `testdata` (ab582e5) | none detected | 6 | 3 MSI Afterburner logs and 3 MangoHud logs (periodic), test data of a flightlessmango.com clone |

Repositories without a stated licence are fetched and hashed, not redistributed here; the manifest lists where they are. `witcher_3_test.csv` in Pavelioso/Frameviewer is a third Witcher 3 file that no row of the FrameView summary matches and that holds a 7.8 s frame the other two lack. I could not establish where it came from, so it is parsed in the census and left out of the definition comparison.

## What each tool computes

Each row quotes the source at the pinned commit. These files were read on 2026-10-08, and nothing here is described from memory. PresentMon's own source was not examined, and closed tools' methods were not read.

| Tool | "1% low" as the source computes it | Where |
|---|---|---|
| MangoHud summary (`_summary.csv`) | Sort frame times descending, take index `uint64(0.01 × n − 1)`, `1000 / frametime`. "0.1% Min FPS" and "1% Min FPS" use 0.001 and 0.01. It is a frame time at a rank, not an average. | [`src/fps_metrics.h` L54, L82, L86](https://github.com/flightlessmango/MangoHud/blob/f88ef00a0cb8a3dfeab761bd96614ed08ba823b1/src/fps_metrics.h#L54-L86); [`src/logging.cpp` L112](https://github.com/flightlessmango/MangoHud/blob/f88ef00a0cb8a3dfeab761bd96614ed08ba823b1/src/logging.cpp#L112) |
| MangoHud `mangoplot` | Sort the log's `fps` column ascending, take index `int(n × 0.01)` (`0.001` for the 0.1% figure). Skips logs under 10,000 frames. Its "average fps" is the mean of the per-frame `fps` column. | [`bin/mangoplot.py` L342-L360](https://github.com/flightlessmango/MangoHud/blob/f88ef00a0cb8a3dfeab761bd96614ed08ba823b1/bin/mangoplot.py#L342-L360) |
| CapFrameX "P1" | `Quantile(fps, 0.01)` from MathNet.Numerics, which is the R8 (median-unbiased) estimator. | [`FrametimeStatisticProvider.cs` L245-L248, L374-L376](https://github.com/CXWorld/CapFrameX/blob/9f488ea6c39e33ec25c6ebfae1c4a1c4063c3026/source/CapFrameX.Statistics.NetStandard/FrametimeStatisticProvider.cs#L245-L248); [MathNet `ArrayStatistics.cs` L498-L528](https://github.com/mathnet/mathnet-numerics/blob/84e9432bc1e8a6b2ae7acd32cda4175abeaeaed1/src/Numerics/Statistics/ArrayStatistics.cs#L498-L528) |
| CapFrameX "1% Low Avg" | `q = Quantile(frametimes, 0.99)`, then `1000 / mean(frametimes ≥ q)`. | same file, L316-L324, L384-L386 |
| CapFrameX "1% Low Int" | Frame times descending; add them up until the sum reaches `0.01 × total time`; `1000 /` the frame time reached. The source comment calls it "Equivalent x% low integral metric definition to MSI Afterburner"; I did not check that claim. | same file, L251-L308, L394-L396 |
| flightlesssomething (a Go clone of flightlessmango.com, not the site) | Computes percentiles twice, linear interpolation and a MangoHud-style floor index. | [`internal/app/benchmark_stats.go` L59-L107](https://github.com/erkexzcx/flightlesssomething/blob/ab582e57e7baf0dcbba80f9f13b758ec0da2dd18/internal/app/benchmark_stats.go#L59-L107) |
| FrameView (closed) | Not read. Its summary CSV prints "1% Low FPS", "0.1% Low FPS", "1% FPS", "0.1% FPS". The measurement below finds which rules reproduce those columns on two captures. | `Pavelioso/Frameviewer assets/FrameView_Summary.csv` |
| stutterscope 0.2.5 | percentile: `1000 / P99` with linear interpolation; slowest-mean: `1000 / mean(slowest round(n × 0.01))` | `src/core/metrics.ts` at v0.2.5 |

So there are three families. A frame time at a rank (MangoHud, mangoplot, CapFrameX P1, FrameView's "1% FPS"). The mean of the slowest frames (CapFrameX "low avg", FrameView's "1% Low FPS"). A time-weighted threshold (CapFrameX "low integral"). stutterscope 0.2.5 printed the first and second; the third was missing.

## Measure

`definitions.py` implements each rule above from the quoted lines, applies it to the busiest non-`dwm.exe` stream of every capture with 900 or more frames, and asserts that the TypeScript figures (from the checkout CLI) equal its own to 1e-9. MangoHud's rule is run in float32 as in its source. Spread is the highest figure over the lowest, minus one. `census.py` runs the released CLI (v0.2.5, built from the tag in a worktree) and the checkout CLI on every file, and counts frames and sums frame times with its own csv reader.

## Results

### 1% low by definition, fps (8 captures of 907 to 117,569 frames)

| Capture | Frames | Avg | Percentile (stutterscope) | MangoHud rule | CapFrameX P1 | Slowest-mean | Time-weighted |
|---|---|---|---|---|---|---|---|
| Witchfire, MangoHud | 117,569 | 135.3 | 65.76 | 65.74 | 65.76 | 52.87 | 58.36 |
| Resident Evil 4, FrameView 1.6 | 112,316 | 204.9 | 151.33 | 151.29 | 151.31 | 127.77 | 139.39 |
| Apex Legends, run 1 | 10,652 | 154.0 | 68.67 | 68.52 | 68.61 | 62.05 | 63.60 |
| Apex Legends, run 2 | 8,020 | 130.8 | 56.62 | 56.54 | 56.57 | 52.40 | 51.96 |
| Superposition, run 1 (5.3 s stall) | 13,143 | 68.8 | 55.37 | 55.31 | 55.31 | 8.33 | 0.19 |
| Superposition, run 2 | 12,431 | 71.2 | 55.66 | 55.66 | 55.66 | 51.23 | 54.97 |
| The Witcher 3, FrameView | 1,146 | 42.6 | 21.65 | 21.22 | 21.30 | 13.09 | 8.84 |
| The Witcher 3 (other capture) | 907 | 44.8 | 20.66 | 19.92 | 20.20 | 17.02 | 16.61 |

The slowest-mean column is the checkout's (`ceil`). The full table with the 0.1% low, mangoplot's index rule and the released `round` figure is in `results.json` under `definitions.captures`.

| Over 8 captures | 1% low | 0.1% low |
|---|---|---|
| Highest ÷ lowest, all definitions: median | +21% | +38% |
| Highest ÷ lowest, all definitions: worst | +29,034% | +5,051% |
| Percentile family only (4 implementations): median | +0.13% | +1.1% |
| Percentile family only: worst | +3.7% | +146% |
| Slowest-mean vs stutterscope percentile: median | −16.6% | −23.9% |
| Time-weighted vs stutterscope percentile: median | −9.7% | −27.6% |

At 0.1% a capture of 907 to 1,146 frames has about one frame in the bucket, so the +146% worst case of the percentile family is a one-frame effect (3.79 fps against 9.31 fps on the Witcher 3 capture) and says that the figure is not defined there.

### Against the tools' own summaries

MangoHud, Witchfire (`results.json`, `definitions.yardsticks.mangohud_witchfire`):

| | MangoHud's summary file | stutterscope (both versions) |
|---|---|---|
| 1% Min FPS | 65.744 | 65.764 (+0.03%) |
| 0.1% Min FPS | 49.475 | 49.579 (+0.21%) |
| Average FPS | 135.2 | 135.27 (+0.05%) |

MangoHud sums frame times in a `float` (`logging.cpp` L91 and the loop after it). Re-running that summation in float32 gives 135.159, which prints as 135.2; the double-precision sum is 135.270. The 0.05% is MangoHud's rounding, not a disagreement about definition.

FrameView (`definitions.yardsticks.frameview`). Each summary row was matched to a capture by Average, Min and Max FPS, which agree to the printed precision.

| Capture (frames) | Figure | FrameView prints | stutterscope 0.2.5 | checkout |
|---|---|---|---|---|
| Witcher 3 (907) | 1% Low FPS | 17.024 | 16.700 (−1.9%) | 17.024 |
| | 0.1% Low FPS | 11.422 | 11.422 | 11.422 |
| | 1% FPS | 20.627 | 20.661 percentile (+0.16%) | same |
| | 0.1% FPS | 11.422 | 15.527 percentile (+36%) | same |
| Witcher 3 (1,146) | 1% Low FPS | 13.093 | 12.649 (−3.4%) | 13.093 |
| | 0.1% Low FPS | 5.305 | 3.790 (−28.6%) | 5.305 |
| | 1% FPS | 21.323 | 21.647 percentile (+1.5%) | same |
| | 0.1% FPS | 8.837 | 9.308 percentile (+5.3%) | same |

"1% Low FPS" and "0.1% Low FPS" equal `1000 / mean(slowest ceil(n × fraction) frames)` on all four values, to the printed three decimals. "1% FPS" and "0.1% FPS" equal the ascending-`fps` array at index `int(n × fraction)` on all four values, the rule `mangoplot.py` L357-L358 uses. Two other rules fit the first one equally well: `floor(n × fraction) + 1`, which differs from `ceil` only when `n × fraction` is a whole number, and the mean of the frames at or above the linearly interpolated percentile, which differs for some n (at n = 1,001 it takes 10 frames where `ceil` takes 11). `ceil` was chosen because it does not add a frame to an exact 1%. These are four numbers from two captures of one game on one machine; they are enough to show that `round` was wrong at small n, and not enough to say which of the three rules FrameView implements.

### Parse census (`results.json`, `census`)

| | Released 0.2.5 | Checkout |
|---|---|---|
| Files | 34 | 34 |
| Parsed | 31 | 27 |
| Refused | 3 (Afterburner `.csv`, "isn't a capture format stutterscope knows") | 7 (the same 3, and the 4 periodic MangoHud logs) |
| Frame count and duration differ from the independent count | 0 | 0 |
| Format labels | PresentMon 1.x 6, PresentMon 2.x 6, OCAT 10, FrameView 4, MangoHud 5 | same, MangoHud 1 |

The 10 files labelled OCAT are PresentMon 2.0/2.1 console logs (the 6 unsuffixed Gold files and the 4 Apex and Superposition logs): their schema is the OCAT schema, and `docs/formats.md` states that the two cannot be told apart from content. The Gold files in the three schemas parse with the same frame counts, except that each `_v1` file has one more frame in the analysed stream than the other two (19 against 18 in trace 0); I did not investigate why.

## What was wrong and what changed

1. **Slowest-mean bucket size.** `lowFps` used `Math.round(n * fraction)` frames. It now uses `ceil` with a 1e-9 guard against `7.000000000000001`. FrameView's own columns are the evidence; the change moves the figure on short captures only (on the 117,569-frame log both rules take 1,176 frames for the 1% low).
2. **A third definition.** `LowFpsResult.timeWeightedFps` (the CapFrameX integral rule) is added to the core, the CLI summary and compare table, the JSON report and the browser Markdown/JSON export, with tests taken from the real Witcher 3 tail and from a stall case, and `scripts/oracle.py` extended. The browser's stat tiles still show two figures; I did not change UI layout and did not run the browser suite.
3. **CLI column width.** The new labels are longer, so the summary block is aligned to 25 columns. This changes the text output, and one test string.
4. `docs/metrics.md` describes three definitions and states where each is used.

These are source-checkout changes and are not published.

## What is left

- The browser stat tiles do not show the time-weighted figure.
- Afterburner logs are refused. Three were available; the format is not one of the six.
- The 0.1% percentile on captures under about 2,000 frames is one frame wide in every tool; no definition fixes that.
- stutterscope's percentile interpolates; MangoHud, mangoplot and FrameView's "1% FPS" take an index. On the 8 captures this is within 3.7% at 1% and was not changed.
- flightlessmango.com's code and output, PresentMon's own statistics, and CapFrameX's published numbers for any capture were not looked at.

## What this does not show

- It is 8 captures from at most 6 games on a few machines. The median and worst-case spreads are a description of these files, not an estimate for captures in general. The two stall captures dominate the worst case.
- Eighteen of the 34 files are PresentMon's test fixtures; a clean parse of those says the parsers handle the schemas, not that real user captures parse.
- The FrameView rule is inferred from four numbers on two captures. The ceil change was found on those numbers, so its after-score is on the data that selected it; no held-out FrameView summary was available.
- MangoHud's summary is one capture. The 0.03% and 0.21% agreements say nothing about other files.
- The parse census counts rows and summed frame times against a separate reader. It cannot catch a wrong choice of frame-time column made the same way in both; the reader used `MsBetweenPresents` or `FrameTime` as the format documents say.
- The claim in CapFrameX's source comment that the integral rule equals MSI Afterburner's was not checked.

## Reproduce

```bash
cd studies/real-captures
python3 -I fetch.py                                   # 37 files, 86 MB into cache/ (gitignored), writes manifest.json
git worktree add /tmp/ss-rel v0.2.5 && ln -s "$PWD/../../node_modules" /tmp/ss-rel/node_modules
(cd /tmp/ss-rel && npx tsc -p tsconfig.cli.json --outDir /tmp/ss-rel-out)
(cd ../.. && npx tsc -p tsconfig.cli.json --outDir /tmp/ss-head-out)
python3 -I census.py /tmp/ss-rel-out /tmp/ss-head-out > /tmp/census.json
python3 -I definitions.py /tmp/census.json > /tmp/defs.json
python3 -I make_results.py /tmp/census.json /tmp/defs.json > results.json
```

The sources quoted in the table were fetched at the commits shown in the links (CapFrameX 9f488ea, MangoHud f88ef00, MathNet.Numerics 84e9432, flightlesssomething ab582e5), the latest on 2026-10-08.

## References and licences

MangoHud and MathNet.Numerics are MIT. CapFrameX's `LICENSE` file at the pinned commit is MIT, with third-party licences appended (GitHub's API reports it as unrecognised for that reason); only line numbers and short excerpts of its code are quoted. The capture files are not redistributed; `manifest.json` has URL, commit and SHA-256 for each, and licences are in the table above (PresentMon MIT, xD3I/Benchmarks Unlicense, the rest unstated).
