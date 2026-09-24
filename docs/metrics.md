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

## 1% low / 0.1% low — two definitions, on purpose

Tools disagree about "1% low" because there are two legitimate definitions
in circulation, and stutterscope reports both rather than picking a side:

**Percentile method** — convert the P99 (or P99.9) frame time straight to
FPS:

```
one_percent_low_percentile = 1000 / percentile(frame_time_ms, 99)
point_one_percent_low_percentile = 1000 / percentile(frame_time_ms, 99.9)
```

This answers "how bad is the frame time right at the boundary of the worst
1% of frames" — a single point on the distribution.

**Mean-of-slowest-N% method** — average the frame times of the slowest 1%
(or 0.1%) of frames, *then* convert to FPS:

```
slowest = sort_descending(frame_time_ms)[0 : round(n * 0.01)]
one_percent_low_mean = 1000 / mean(slowest)
```

This answers "how bad are the worst frames on average," and is pulled
further down by a heavy tail: a handful of severe hitches drag the *mean*
down far more than they move a single percentile rank. On a capture with
one 500ms shader-compile stall in 8,000 frames, the percentile-method 1%
low barely moves (it's set by the 80th-worst frame, not the worst one),
while the mean-of-slowest-1% number can be dragged down substantially,
because that one 500ms frame is now averaged in with the other ~79 frames
in the slowest bucket. **Neither number is wrong; they answer different
questions**, and a reviewer quoting "1% low" from two different tools may
be quoting two different quantities.

## Stutter events and hitches

Two independent definitions, both configurable in the UI:

- **Stutter event**: `frame_time[i] > k × rolling_median(frame_time, window
  radius r)[i]`, where the rolling median is computed over a centered
  window `[i - r, i + r]` (clipped at the ends of the capture). Defaults:
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
masd_ms = mean(|frame_time[i] - frame_time[i-1]|) for i = 1..n-1
```

A perfectly steady capture is 0ms regardless of its average frame rate; a
capture that alternates between two frame times (the classic vsync-mismatch
sawtooth — see the synthetic samples) has a high MASD even if its average
FPS looks fine, which is exactly the case average FPS hides.

## Dropped frames

Reported when the source format has a native dropped/not-displayed
concept; `null` otherwise (MangoHud and generic CSVs don't carry this).
**The definition differs by format** — PresentMon 1.x, OCAT, CapFrameX, and
FrameView all have an explicit `Dropped` flag; PresentMon 2.x has no such
column, so stutterscope treats a frame whose `DisplayedTime` is `NA` as the
2.x equivalent (see `docs/formats.md`). These are not guaranteed to mean
exactly the same thing across tools, and the UI doesn't claim they do.

## CPU-/GPU-bound share

Only available when both `CPUBusy` and `GPUBusy` channels are present
(PresentMon 2.x). Each frame is classified by whichever engine was busier:

```
frame is CPU-bound if CPUBusy[i] >= GPUBusy[i], else GPU-bound
```

This is the standard reviewer heuristic, and a simplification: real frames
can be limited by sync waits or the display pipeline rather than either
engine being the bottleneck. It requires no instrumentation beyond what
PresentMon 2.x already reports.

## Display latency

Reported when the source format has a latency channel (PresentMon 2.x's
`DisplayLatency`, FrameView's `MsPCLatency`): mean, P50, P90, P99. `null`
otherwise. What exactly each tool measures as "latency" differs (see
`docs/formats.md`) — this is not a normalized cross-tool latency number.

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
