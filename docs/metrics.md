# Metrics

Every formula here is implemented in `src/core/metrics.ts`, which this file
mirrors — if you change one, change the other. All frame-time
quantities are milliseconds; all FPS quantities are `1000 / frame_time_ms`.

## Average FPS

```
average_fps = frame_count / total_capture_time_seconds
total_capture_time_seconds = sum(frame_time_ms) / 1000
```

This is **not** the arithmetic mean of each frame's instantaneous FPS
(`mean(1000 / frame_time_ms[i])`). That mean over-weights short frames: a
capture that's 59 frames at 1ms and 1 frame at 1000ms has a mean
instantaneous FPS of `(59×1000 + 1×1)/60 ≈ 983`, but the *actual* average
frame rate over that capture's ~1.06 seconds is `60/1.059 ≈ 56.6` fps — the
number a player would actually perceive. stutterscope computes the latter
everywhere `averageFps` is used, and exposes the (misleading) mean-of-
instantaneous figure separately (`meanOfInstantaneousFps`) only so the
difference is visible, not because it should be used to characterize a run.

## Frame-time percentiles

`P50`, `P90`, `P95`, `P99`, `P99.9` of the frame-time distribution, computed
with linear interpolation between the two nearest ranks — the same
`method="linear"` NumPy uses by default for `numpy.percentile`:

```
index = (p / 100) * (n - 1)
lower = floor(index); upper = ceil(index); frac = index - lower
value = sorted[lower] + (sorted[upper] - sorted[lower]) * frac
```

`tests/core/oracle.test.ts` cross-checks this against `numpy.percentile`
directly (see `scripts/oracle.py`).

## 1% low / 0.1% low — three definitions, on purpose

Tools disagree about "1% low" because several definitions are in circulation.
stutterscope reports the three that real tools print, labelled, rather than
picking a side. [`studies/real-captures`](../studies/real-captures/README.md)
cites each tool's source and measures how far apart they land on real captures.

**Percentile method** — convert the P99 (or P99.9) frame time straight to
FPS:

```
one_percent_low_percentile = 1000 / percentile(frame_time_ms, 99)
point_one_percent_low_percentile = 1000 / percentile(frame_time_ms, 99.9)
```

This answers "how bad is the frame time right at the boundary of the worst
1% of frames" — a single point on the distribution. The percentile uses
linear interpolation (above). MangoHud and FrameView's "1% FPS" take a frame
by index instead of interpolating, and CapFrameX uses a different
interpolation; on a capture of tens of thousands of frames the figures agree
to within a fraction of a percent.

**Mean-of-slowest-N% method** — average the frame times of the slowest 1%
(or 0.1%) of frames, *then* convert to FPS:

```
slowest = sort_descending(frame_time_ms)[0 : ceil(n * 0.01)]
one_percent_low_mean = 1000 / mean(slowest)
```

The bucket holds `ceil(n * fraction)` frames (at least one), so it always
covers at least the stated fraction of the capture. Releases up to 0.2.5
used `round(n * fraction)`, which gave a smaller bucket on short captures:
on a 1,146-frame FrameView capture, 11 frames for the 1% low and 1 frame for
the 0.1% low, where FrameView's own summary of that capture is reproduced by 12 and 2.

This answers "how bad are the worst frames on average," and is pulled
further down by a heavy tail: a handful of severe hitches drag the *mean*
down far more than they move a single percentile rank. On a capture with
one 500ms shader-compile stall in 8,000 frames, the percentile-method 1%
low barely moves (it's set by the 80th-worst frame, not the worst one),
while the mean-of-slowest-1% number can be dragged down substantially,
because that one 500ms frame is now averaged in with the other ~79 frames
in the slowest bucket.

**Time-weighted method** (source checkout) — sort frames slowest first and
add up their durations until the sum reaches 1% (or 0.1%) of the capture's
total time; the frame time reached is the figure:

```
used = 0
for ft in sort_descending(frame_time_ms):
    used += ft
    if used >= 0.01 * sum(frame_time_ms): break
one_percent_low_time_weighted = 1000 / ft
```

This is the "low integral" CapFrameX prints next to its "low average". A
single 500 ms stall in 1,000 frames of 10 ms uses up the whole 1% allowance
(0.01 × 10,490 ms = 105 ms) on its own, so the figure is 2 fps; the
mean-of-slowest method averages that stall with nine 10 ms frames and gives
about 17 fps. The three figures can differ by a factor of two or more on a
capture with a long stall.

**Neither number is wrong; they answer different questions**, and a reviewer
quoting "1% low" from two different tools may be quoting two different
quantities. The CLI and the JSON report carry the three figures under
`onePercentLow` and `pointOnePercentLow` as `percentileMethodFps`,
`meanOfSlowestMethodFps` and `timeWeightedFps`. The browser tiles still show
the first two; the time-weighted figure is in the browser's JSON export and Markdown table.

## Stutter events and hitches

Two independent definitions, both configurable in the UI:

- **Stutter event**: `frame_time[i] > k × rolling_median(frame_time, window
  radius r)[i]`, where the rolling median is computed over a centered
  window `[i - r, i + r]` (clipped at capture ends and source gaps). Defaults:
  `k = 2.0`, `r = 10` frames. This flags frames that are anomalous
  *relative to their neighborhood* — catches stutter in a capture whose
  overall pace varies a lot (e.g. a CPU-bound section running at a
  genuinely different frame time than a GPU-bound one) without needing a
  single global threshold.
- **Hitch**: `frame_time[i] > hitch_threshold_ms` (default 50ms) — a fixed,
  absolute threshold, independent of local pacing. Every hitch is usually
  also a stutter event, but not every stutter event is a hitch (a capture
  that's rock-steady at 500 fps and blips to 200 fps has a stutter event by
  the relative definition, at 5ms — nowhere near a 50ms hitch).

Both report a count, and total time spent in flagged frames as a fraction
of total capture time.

## Frame-pacing variability (MASD)

Mean absolute successive difference:

```
masd_ms = mean(|frame_time[i] - frame_time[i-1]|)
          over adjacent observed pairs only; never across a source gap
```

A perfectly steady capture is 0ms regardless of its average frame rate; a
capture that alternates between two frame times (the classic vsync-mismatch
sawtooth — see the synthetic samples) has a high MASD even if its average
FPS looks fine, which is exactly the case average FPS hides.

A source gap separates frames when the parser skipped an unusable timing row.
A bad row with a known process/swap-chain identity interrupts only that stream;
a bad row with incomplete identity conservatively interrupts every previously
observed stream. Normal interleaving, blank lines and missing optional telemetry
do not create gaps. Callers constructing a `FrameSeries` without `gapBefore`
assert uninterrupted observations; CSV line distance alone cannot establish this.

The trace, FPS chart and slow-frame episodes stop at the same boundaries.
Retained durations, distribution metrics and absolute hitches remain usable.
Neither a low stutter count nor an empty gap list proves complete recording:
missing rows that left no evidence in the file cannot be detected. A short
segment can have too little local context to reveal a relative anomaly.

## Dropped frames

Reported when the source format has a native dropped/not-displayed
concept; `null` otherwise (MangoHud has no such channel; generic CSVs require
an explicit dropped-column mapping).
**The definition differs by format** — PresentMon 1.x, OCAT, CapFrameX, and
FrameView all have an explicit `Dropped` flag; PresentMon 2.x has no such
column, so stutterscope treats a frame whose `DisplayedTime` is `NA` as the
2.x equivalent (see `docs/formats.md`). These are not guaranteed to mean
exactly the same thing across tools, and the UI doesn't claim they do.

The source checkout keeps three channel values: `0` displayed, `1` not
displayed, `2` unknown. A missing column means the channel is absent. The drop
fraction is `droppedCount / observedFrames`, counting only `0` and `1`, and
`null` when no outcome is observed. The latter is different from observing
zero drops. Optional metrics include observed-frame coverage in the UI and
exports. Generic CSVs can supply an explicitly mapped dropped column.

## CPU-/GPU-bound share

Only available when both `CPUBusy` and `GPUBusy` channels are present
(PresentMon 2.x). Each frame is classified by whichever engine was busier:

```
frame is CPU-bound if CPUBusy[i] >= GPUBusy[i], else GPU-bound
```

A frame where either value is `NA` is left out of both counts, and the two
shares are fractions of the frames that could be classified.

Non-finite and negative values are also excluded. Both values must be observed
on the same frame; two separate coverage counts would overstate usable pairs.
The UI displays this denominator, so a 100% GPU share from one observed frame
cannot masquerade as complete coverage. Zero is an observation, and ties retain
the existing CPU-side assignment.

This is a busy-time heuristic and a simplification: real frames
can be limited by sync waits or the display pipeline rather than either
engine being the bottleneck. It requires no instrumentation beyond what
PresentMon 2.x already reports.

## Display latency

Reported when the source format has a latency channel (PresentMon 2.x's
`DisplayLatency`, FrameView's `MsPCLatency`): mean, P50, P90, P99. `null`
otherwise. What exactly each tool measures as "latency" differs (see
`docs/formats.md`) — this is not a normalized cross-tool latency number.

Only finite, non-negative samples contribute. `observedFrames` records the
sample count; no observations means no percentile estimate, rather than zero
latency. A one-sample percentile still exists but carries its one-frame coverage.

### Coverage in evidence reports (source checkout)

Browser and comparison reports use schema version 5. `metrics.telemetryCoverage`
has `dropped`, `cpuGpuBusy` and `displayLatency` entries. An entry is `null` when
its required source column(s) are absent; otherwise it contains
`observedFrames` and `unknownFrames`, summing to the analyzed frame count.
When the entry has zero observations the metric itself is `null`. The summary
CLI's flat JSON has the same coverage field beside its existing metrics.

Counts cover retained frames in the selected process/swap chain and interval,
not skipped frame-time rows, other streams or unrecorded frames. Coverage is
not a confidence interval or proof that the observations are representative.
Frame-time/FPS/stutter calculations retain every otherwise usable frame;
an absent optional channel is not a reason to discard its frame time.

## Percentile curve, histogram

The percentile-curve chart plots `frame_time_ms` against `p` for `p`
walking `0..100`, sampled with increasing density near `p = 100` (via
`p = 100 × (1 - (1 - t)^3)` for `t` in `[0, 1]`) since that's where stutter
shows up and a uniform grid under-samples it.

The histogram bins the full distribution, but caps its display range at
`1.5 × P99.9` with anything beyond folded into the last bin. Without this,
a single multi-hundred-millisecond hitch stretches the x-axis so far that
every other bar collapses into a single-pixel spike — the tail is still
exactly represented by the P99.9 and 1%-low tiles, just not by the
histogram's shape.

The frame-time trace chart applies the same idea to its y-axis: it defaults
to `[0, max(50ms, 1.5 × P99.9)]` rather than the true data range, so normal
pacing and moderate stutter aren't compressed into a few pixels by a rare
severe hitch. Frames above that range are still drawn — clamped to the top
of the plot, with an upward-arrow marker and their real value labeled — and
a "Full range" toggle switches to the true `[0, max(frame_time_ms)]` range
on demand.

## Metrics over a selected interval (source checkout)

An interval keeps whole frames whose ending accumulated time is after start and
at or before end. Average FPS uses the selected count divided by the sum of
selected durations. Percentiles, lows, optional channels, and MASD use the
selected frames; MASD needs at least one observed adjacent pair and is otherwise
unavailable (`null` in JSON). `pacingCoverage.observedPairs` gives its denominator;
`gapBoundaries` counts interruptions between selected frames, not missing frames.
Stutter flags retain the full stream's rolling-median context within each
uninterrupted segment and are counted
within the interval. See [interval analysis](interval-analysis.md) for exact
boundary rules, original-source coordinates, and comparison/export behavior.
