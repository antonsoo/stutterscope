# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/).

## [0.2.1] - 2026-10-01

### Added

- The package is named `@antonsoloviev/stutterscope`, ready for npm, and
  carries only the compiled CLI. It isn't published yet; until it is, install
  from GitHub as before.
- `stutterscope --version`.
- A fuzz test: the fixture captures, mutated line by line, either parse into a
  summary or are refused with a parse error.

### Fixed

- A one-frame capture read "1 frames".

## [0.2.0] - 2026-09-30

### Fixed

- Captures holding more than one process were analysed as one trace. A
  PresentMon, OCAT, CapFrameX or FrameView capture taken without a process
  filter interleaves the game's presents with `dwm.exe` and anything else on
  screen, and their rows were concatenated: on the synthetic 120 s PresentMon
  2.x sample with a 144 Hz `dwm.exe` and a 60 Hz browser mixed in, the
  capture read as 269.8 s long, averaging 100.2 fps with 5,354 stutter events,
  instead of 66.5 fps and 28. Rows are now grouped by process and swap chain
  and one stream is analysed: the busiest that isn't the compositor, or the
  one picked in the web app's new stream selector or with the CLI's
  `--stream <app|pid|pid:swapchain>`.
- The CPU-/GPU-bound share counted a frame with a missing (`NA`) `CPUBusy` or
  `GPUBusy` as GPU-bound; such frames are now left out of both counts.
- The hitch tile, Markdown export and comparison table said ">50ms" whatever
  the configured hitch threshold was; the summary now carries the threshold it
  counted against.
- JSON output (the CLI's `--json` and the web export) wrote the per-frame
  stutter flags as an object with one key per frame (150 KB for the 8,000-frame
  sample); it now lists the indices of the flagged frames.
- The comparison table showed "0.0%" when run A had zero of something (stutter
  events, hitches) and run B didn't; it now says "from 0" and colors it.
- The parse-warning note pointed at the browser console, where nothing was
  logged; it now lists the skipped rows.
- The CLI rejected nothing: an unknown `--format` crashed, a non-numeric `--k`
  computed with `NaN`, and a mistyped flag was ignored. Bad flags and values now
  exit 1 with a message.

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
