# Stutterscope comparison

Independently selected intervals; differences are descriptive, not a controlled hardware-performance claim.

## Run A

| Metric | controlled-a.csv |
| --- | --- |
| Average FPS | 56.6 |
| 1% Low \(percentile\) | 45.9 |
| 1% Low \(slowest-mean\) | 8.6 |
| 0.1% Low \(percentile\) | 8.6 |
| 0.1% Low \(slowest-mean\) | 8.6 |
| P99 frame time \(ms\) | 21.79 |
| P99.9 frame time \(ms\) | 116.70 |
| Stutter events | 4 |
| Hitches \(&gt;50ms\) | 4 |
| Pacing \(MASD, ms\) | 2.10 |

Source format: generic. Analyzed frames: 396 of 543.

Requested 1.5 to 8.5 s; frames 71-466; 6.999800 s of frame time. Detection uses full-stream neighbors.

Detection: k = 2, window radius = 10, hitch threshold > 50 ms.

Column: frame\_time\_ms. Interpretation: frametime_ms.

Skipped rows: 0. Retained warning details: 0.

## Run B

| Metric | controlled-b.csv |
| --- | --- |
| Average FPS | 60.0 |
| 1% Low \(percentile\) | 59.5 |
| 1% Low \(slowest-mean\) | 59.5 |
| 0.1% Low \(percentile\) | 59.5 |
| 0.1% Low \(slowest-mean\) | 59.5 |
| P99 frame time \(ms\) | 16.80 |
| P99.9 frame time \(ms\) | 16.80 |
| Stutter events | 0 |
| Hitches \(&gt;50ms\) | 0 |
| Pacing \(MASD, ms\) | 0.08 |

Source format: generic. Analyzed frames: 420 of 567.

Requested 1.5 to 8.5 s; frames 71-490; 6.999800 s of frame time. Detection uses full-stream neighbors.

Detection: k = 2, window radius = 10, hitch threshold > 50 ms.

Column: frame\_time\_ms. Interpretation: frametime_ms.

Skipped rows: 0. Retained warning details: 0.
