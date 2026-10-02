# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/).

## [0.2.3] - 2026-10-02

### Added

- The CLI is published to npm as `@antonsoloviev/stutterscope`:
  `npx @antonsoloviev/stutterscope summary your-capture.csv`. The README uses
  the registry package instead of the GitHub install, which npm 12 blocks by
  default.
- A CSV from a tool stutterscope has no parser for is read by the column its
  header points to. `stutterscope summary` on the bundled generic sample
  (`frame_index,timestamp_seconds,frame_time_ms,fps`) used to stop with
  "Could not auto-detect a known format. Pass --format generic
  --generic-column <name> --generic-kind <kind>", without saying which
  columns the file has; the web app opened its column dialog on the first
  column (`frame_index`) as a frame time in milliseconds. Now a column named
  as a frame time is taken first, then a clock that only counts up, then a
  frame rate; the unit comes from the name, or from the size of the values
  when the name has none. The CLI prints which column it read and why, the
  dialog opens with the guess filled in and the reason under it, and when
  two columns fit equally or none does, nothing is guessed and the CLI lists
  the columns. See [`docs/formats.md`](docs/formats.md#generic-csv).
- A running clock in milliseconds (`timestamp_ms_cumulative`), the layout of
  FRAPS-style `frametimes.csv` files (`Frame, Time (ms)`).
- `--generic-column` on its own: the unit is worked out from the column.
  A column that isn't in the file is reported with the columns that are.
- `--json` output names the column and kind read from a generic CSV
  (`generic: { column, kind, guessed }`).

### Fixed

- Frame counts in the page followed the browser's locale (`7.969 frames` in a
  German one) while every other number is written with a decimal point
  (`119.9 s`); they are `7,969` everywhere, as in the CLI. CI now runs the
  tests a second time in a comma-decimal locale.

### Changed

- The page's fonts are served by the page itself. They came from Google Fonts,
  the one request the page made to another origin; the same font files (every
  subset, as Google serves them to a current browser) are now in
  `src/ui/fonts/`, with their SIL Open Font License texts. Nothing looks
  different: screenshots before and after match. The page now loads with
  every other host blocked.

### Security

- The built page carries a Content-Security-Policy. Scripts, styles, fonts and
  workers load from the page's own origin only, and `connect-src 'self'` has
  the browser refuse to send what you give the page to any other host, even
  for a script injected through a bug in how the page renders a file. Inline
  event handlers and `eval` are not allowed. Every control was exercised
  in Chromium and Firefox with a listener for policy violations: none.

## [0.2.2] - 2026-10-01

### Fixed

- A capture with CR-only line endings parsed as a header and no rows:
  "0 frames", every metric a dash, exit code 0. Lines now end at LF, CRLF or
  a lone CR, in the parsers and in format detection.
- A UTF-16 capture (what `>` writes in Windows PowerShell) was read as
  UTF-8: the CLI could not detect its format, and the web app showed
  0 frames. A file that starts with a UTF-16 byte-order mark is now decoded
  as UTF-16.
- A capture with no usable frames got a full report of dashes: a header
  with no rows, or every frame time missing because the wrong format or
  column was chosen. The CLI exited 0. Both now refuse it with the reason,
  and the CLI exits 1. An empty file and a binary one are refused before
  format detection; the web app used to open its column picker on them.
- A row with a negative frame time was counted: it subtracted from the
  capture's duration and raised the average FPS (four 16.6 ms frames and
  one of -5 ms read 81.4 fps, not 60.2). Such a row is now skipped like any
  other unusable row, and in a generic CSV of cumulative timestamps a
  timestamp that goes backwards is skipped and restarts the clock. A frame
  time of zero is still kept.
- Every skipped row was kept as a message. A 600,000-row capture read with
  the wrong column held 600,000 of them, and two million took 204 MB. The
  first 50 are kept and the rest counted (14 MB for the same two million).
- "N row(s) skipped while parsing" in the CLI counted the "no data rows"
  note as a row. It counts rows, and says "1 row".
- A file with no line breaks was buffered whole while looking for one. A
  line longer than 1,048,576 characters is now refused, and a long
  unterminated line is no longer re-joined on every chunk read.

## [0.2.1] - 2026-10-01

### Added

- The package is named `@antonsoloviev/stutterscope`, ready for npm (published
  there from 0.2.3), and carries only the compiled CLI.
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
