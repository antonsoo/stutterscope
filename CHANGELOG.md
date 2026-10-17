# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

Changes below are in source and have not been released as an npm package.

### Local MangoHud clock continuity (source only)

- Interrupt pacing, rolling stutter context, traces and slow-frame episodes at
  large local elapsed/frame-duration disagreements. Whole-capture sums could
  hide a removed block or cancel opposing disagreements and label it compatible.
- Preserve retained durations and distribution metrics, mark clock coverage
  unverified, and retain bounded physical-line witnesses in JSON exports. The
  [record-removal replay](studies/mangohud-local-clock/README.md) includes an
  unchanged 117,569-frame public control. This has not been deployed or released.

### Native CapFrameX saved sessions

- Import Windows native JSON without requiring CSV conversion. Keep recordings
  separate, with browser selection and CLI `--capture-run` / per-comparison flags.
- Retain original sample indices through skipped durations, intervals, source gaps,
  episode inspection and downloaded evidence. Validate parallel array alignment
  and duplicate JSON members before analysis; preserve unknown telemetry.
- Buffer JSON in the cancellable parser worker with a 64 MiB input limit. CSV
  keeps its streaming path. Five pinned game recordings and a separately compiled
  upstream C# serializer exercise are documented in `studies/native-json/`.

### Native present-clock continuity

- Recognize discontinuities in native `TimeInSeconds` against the current
  `msBetweenPresents`/`MsBetweenPresents`, within each present stream and allowing
  for written decimal precision. Filtered presents and reversed clocks cannot
  establish adjacent pacing pairs, rolling context, trace connections or episodes.
- Preserve retained durations, distribution metrics and observed dropped outcomes.
  Record clock-supported boundaries separately from rejected CSV rows; do not
  invent missing frames, durations or causes. JSON, Markdown, report cards and
  browser notes retain that distinction.
- Retain five bounded clock witnesses per stream, with physical CSV lines,
  elapsed/native frame durations, rounding allowances and an explicit omitted
  count. Validate them against original cells. Human reports keep tiny positive
  allowances in scientific notation instead of rounding them to zero.
- Add an attributed, directly loadable Intel filtered-capture example. An
  untouched public FrameView excerpt, ordinal-based oracle on six Intel traces,
  and replay of 34 pinned capture files are in `studies/present-clock/`.

### CSV column alignment correction (source only)

- Skip records with more cells than the header before assigning measurements
  or stream identity. An inserted cell could become a false long frame; retain
  a line-specific warning and interrupt every stream it could belong to.
- Reset generic cumulative-timestamp and MangoHud elapsed comparisons across
  these records. Preserve quoted commas and native OCAT's shorter hardware tails.
  See the [controlled and pinned-public replay](studies/csv-width/README.md).

### Text decoding correction (source only)

- Reject malformed UTF-8 and BOM-marked UTF-16 in both CLI and browser imports.
  Replacement characters from permissive decoding could collapse distinct
  application names into one stream and produce misleading FPS and pacing.
- Permit a format preview to end mid-character only when more input remains;
  validate the entire stream and its final bytes before accepting a capture.
  Failed replacement or comparison imports preserve the previous valid report.
  See the [byte-level replay and public-capture controls](studies/text-integrity/README.md).

### Stream identity correction (source only)

- Preserve application identity alongside the swap chain when `ProcessID` is
  absent. Selecting a compositor or overlay no longer merges it into another
  application at the same address or invents stutter between their frames.
  PresentMon 1 exports remain auto-detectable after the PID column is removed.
- Skip rows with blank declared identity cells, retain line-specific warnings,
  and break continuity for every stream they could belong to. Missing frame
  times use the same grouping rules. Complete PID/swap-chain IDs are unchanged.
  See the [replay and limitations](studies/stream-identity/README.md).

### Added

- Evidence report schema 5 with observed pacing-pair counts and source-gap
  coordinates. Episodes identify their visible gap boundaries.

- Optional-telemetry coverage in the browser, CLI summary and JSON/Markdown
  exports: observed and unknown frames for dropped outcomes, paired CPU/GPU
  busy times and latency. Counts follow the selected stream and interval.
- Evidence report schema 4, documenting that dropped fractions use observed
  outcomes as their denominator. All-unknown metrics remain `null`, with
  explicit coverage; missing columns have `null` coverage.
- Independent interval analysis for both runs, including typed bounds, applying
  the trace's visible range, full-capture restoration, cancellation, and recovery.
  Whole frames retain their original timeline and physical CSV line references.
- Slow-frame episode inspection with original frame/line ranges, per-episode
  counts, neighboring frame evidence, available timing channels, trace navigation,
  paging, and complete JSON evidence.
- `stutterscope compare A.csv B.csv`, shared and per-run interval/stream options,
  and summary `--start`, `--end`, `--events`. Comparisons use the same evidence
  schema as the browser.
- A third "1% low" / "0.1% low" figure, `timeWeightedFps` (the frame time at which
  the slowest frames use up 1% or 0.1% of the capture's time; CapFrameX's "low
  integral"), in the CLI summary and compare table, the JSON report and the
  browser's Markdown/JSON export. The browser stat tiles still show two.
- `studies/real-captures`: what "1% low" means in MangoHud, CapFrameX and
  FrameView's summary, measured on 34 public capture files (8 long enough to
  compare), and a parse census of released 0.2.5 against this checkout.
- A retained controlled Chromium animation capture and a one-click scene
  comparison, with workload code, capture hashes, and independent NumPy checks.

### Fixed

- Unusable frame rows no longer invent successive pacing changes, join separate
  slow-frame episodes, or lend rolling-median context across a source gap.
  Boundaries survive per-stream filtering, interval selection, worker
  recomputation, charts and exports. No observed pair means unavailable MASD.

- The first local CSV import, comparison, replacement and report downloads can
  run after disconnecting an already loaded production page. The parser travels
  in the initial app bundle and starts independent local workers; it no longer
  requires a later script download. Worker failure and retry remain recoverable.

- Ambiguous named CSV columns now stop imports instead of silently choosing the
  first occurrence. Malformed quotes cannot concatenate numeric fragments or
  discard record boundaries. Errors identify physical lines and fields; native
  metadata and valid quoted CSV remain supported.
- Missing or invalid dropped flags no longer become displayed frames, and a
  missing flag column no longer produces a zero-drop result. PresentMon 2
  uses only explicit `NA` as not displayed; blank, malformed and negative
  display durations remain unknown. Unknown outcomes survive worker transfer
  and selection. Usable frame times are retained.
- Non-finite or negative busy/latency values cannot enter optional estimates.
  Explicit zero remains an observation. CPU/GPU share remains a busy-time
  heuristic and reports its observed-frame denominator.
- The mean-of-slowest "1% low" / "0.1% low" averaged `round(n * fraction)` frames,
  which is too few on short captures. It now averages `ceil(n * fraction)`, one
  of the rules that reproduce the "1% Low FPS" and "0.1% Low FPS" columns of two
  real FrameView summaries (0.2.5 was 1.9% to 28.6% low against them). See
  `studies/real-captures`.
- MangoHud periodic snapshots could masquerade as per-frame captures and report
  a duration much shorter than the logging span. Compare its elapsed clock with
  frame durations, refuse large contradictions and reversed clocks, and retain
  the `log_interval=0` assumption and clock evidence in browser/CLI reports.
  Missing or insufficient clock coverage stays explicitly unverified.
- Cropping a stutter retains full-stream rolling-median context. Interval FPS
  divides by selected frame duration, not an absolute ending timestamp. Decimal
  boundaries retain their intended frames despite floating-point accumulation.
- Generic FPS/seconds conversions skip finite inputs that overflow into infinite
  frame durations. One-frame pacing variability is unavailable, not a zero.
- Comparison exports include both runs and their independent selections. Histogram
  overlays use each run's share instead of raw counts that depend on capture length.

- New imports, cancellation, removing a comparison, and New session now stop
  the superseded worker. An older import can no longer replace the chosen
  capture, revive a cleared session, or overwrite the worker's cached data.
- Worker startup and message failures settle pending operations and show a
  retry. Sample downloads check HTTP status and report failures. A failed
  cached worker reloads its original capture and mapping when settings are
  applied again.
- Detection settings reject blank, non-finite, out-of-range, and fractional
  window-radius values. Apply settings updates all loaded runs together;
  failure retains the previous results and exports. Draft values survive
  redraws and keyboard focus returns after an update.
- Redrawing or resetting destroys every chart and removes its global pan
  handlers and resize observers. Plots resize with the page; a wide comparison
  table scrolls within its keyboard-accessible region on phones.
- Comparison run B now shows skipped-row warnings, as run A already did.
- The loaded workspace hides the import panel from keyboard navigation and
  names the current capture with a page heading.

### Changed

- Web JSON exports use schema version 3, include complete episode/interval
  evidence, and retain source columns, skipped
  rows, retained warnings and the count of omitted warning details, selected
  stream, generic-column mapping, and the applied detection settings. Markdown
  carries the same interpretation and warning context and escapes source text.
  PNG cards include settings, skipped-row counts, and the selected stream.
- Production browser regression tests cover Chromium and Firefox, including
  file/worker races, failure recovery, downloads, keyboard controls, chart
  lifecycle, resizing, and desktop/phone accessibility checks.

### Accessibility

- "Could not parse <file>: ..." appeared under the drop zone without a screen reader being
  told. The message is an alert now.

## [0.2.5] - 2026-10-03

### Security

- Text from the capture reached the terminal as it came. A column name holding a terminal escape
  sequence went straight into the "column ... read as" line, and the same held for the file
  name, stream descriptions and parse errors, so a crafted CSV could clear the screen, retitle
  the window or hide part of the summary. Each control character in such text is now written as
  a visible escape (`frame_time_ms\x1b]0;title\x07`). `--json` already escaped them.

## [0.2.4] - 2026-10-03

### Changed

- The npm package has no dependencies. It listed uPlot, the chart library the
  web page bundles, so `npx @antonsoloviev/stutterscope` downloaded 560 KB
  the CLI never loads. uPlot is a development dependency now; the page is
  built the same way.

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
