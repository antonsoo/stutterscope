| Metric | test\_case\_5\_v1-exclude-dropped.csv |
| --- | --- |
| Average FPS | 88.5 |
| 1% Low \(percentile\) | 82.7 |
| 1% Low \(slowest-mean\) | 82.5 |
| 1% Low \(time-weighted\) | 82.6 |
| 0.1% Low \(percentile\) | 82.4 |
| 0.1% Low \(slowest-mean\) | 82.4 |
| 0.1% Low \(time-weighted\) | 82.4 |
| P99 frame time \(ms\) | 12.09 |
| P99.9 frame time \(ms\) | 12.14 |
| Stutter events | 0 |
| Hitches \(&gt;50ms\) | 0 |
| Pacing \(MASD, ms\) | 0.34 |
| Pacing observations | 91 adjacent pairs; 83 gaps between analyzed frames |
| Dropped frames | 0 \(0.0% of observed\) |
| Drop observations | 175/175 frames observed |

Source format: presentmon1. Analyzed frames: 175 of 175.

Entire capture; frames 1-175; 1.976966 s of frame time. Detection uses full-stream neighbors.

Detection: k = 2, window radius = 10, hitch threshold > 50 ms. Rolling context and episodes stop at source gaps; missing durations are unknown.

Selected stream: 24892:0x000002A70D2CAC00 (PresentBench.exe). Other streams are excluded.

Skipped rows: 0. Retained warning details: 0.

Native TimeInSeconds: 83 clock discontinuities; missing frame counts and durations unknown. Counts describe the full source stream; interval gaps are listed separately.

Retained clock witnesses (milliseconds; physical CSV lines in the full source stream):

| CSV lines | Clock interval | Native frame | Allowed rounding/roundoff |

| --- | ---: | ---: | ---: |

| 8-11 | 22.053700 | 10.999600 | 1.71e-11 |

| 14-17 | 22.019300 | 11.075100 | 1.72e-11 |

| 20-23 | 23.048500 | 11.948900 | 1.73e-11 |

| 29-32 | 22.991200 | 11.958200 | 1.75e-11 |

| 35-38 | 21.975700 | 10.974000 | 1.76e-11 |

78 further witness details were not retained; JSON lists every detected gap coordinate.
