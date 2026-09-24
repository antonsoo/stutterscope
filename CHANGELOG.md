# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-09-24

### Added

- Initial release: parsers for PresentMon 1.x, PresentMon 2.x, NVIDIA FrameView,
  CapFrameX, MangoHud, and OCAT capture CSVs, plus a generic CSV column picker.
- Core metrics library (average FPS, frame-time percentiles, 1%/0.1% lows under
  two definitions, stutter and hitch detection, frame-pacing variability,
  dropped-frame counts, CPU/GPU-bound share, display latency).
- Web app: frame-time plot with zoom/pan, FPS-over-time, histogram, percentile
  curve, multi-run comparison overlay with a delta table.
- Export to PNG report card, Markdown table, and JSON summary.
- Synthetic sample captures with a committed generator script.
- `stutterscope summary <file>` CLI.
