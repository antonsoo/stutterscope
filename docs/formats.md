# Capture formats

Every parser in `src/core/parsers/` is verified against either the tool's
own source/documentation or a real captured sample, cited below. Where a
format is closed-source or undocumented, that's stated explicitly rather
than guessed at.

## CSV boundaries

Named header columns must be unique after trimming whitespace (names remain
case-sensitive). A duplicate `FrameTime` or `GPUBusy` is ambiguous even if the
two cells happen to agree in one row. The import stops with the header's line
number and both column positions, so a report cannot silently choose one.
Empty padding headers are allowed.

Quoted commas, doubled literal quotes, and spaces or tabs around a quoted
field are supported. Quotes inside an unquoted field, text after a closing
quote, and unclosed quotes stop the import with the physical line and field
number. Records must fit on one physical line; multiline quoted fields are
unsupported. A value such as `1"00"` is an error, not a 100 ms frame.

CapFrameX comment metadata and MangoHud's preamble are handled separately
from frame records. OCAT's shorter rows after its first hardware-information
row are still supported. Missing or invalid numerical cells retain the
format-specific skipped-row/unknown rules described below; structurally
ambiguous CSV stops the whole import. [Counterexamples and a replay of the
pinned capture corpus](../studies/csv-integrity/README.md) document these limits.

## PresentMon 1.x

The legacy console app (`GameTechDev/PresentMon`, pre-2.0, and any 2.x
build run with `--v1_metrics`).

**Source:** [`PresentMon/CsvOutput.cpp`](https://github.com/GameTechDev/PresentMon/blob/v1.10.0/PresentMon/CsvOutput.cpp)
(tag `v1.10.0`) for the exact column list, and the
[1.9.2 `README.md#csv-columns`](https://github.com/GameTechDev/PresentMon/blob/v1.9.2/README.md#csv-columns)
for column definitions. Cross-checked against a real captured row in
[`Tests/Gold/test_case_0_v1.csv`](https://github.com/GameTechDev/PresentMon/blob/main/Tests/Gold/test_case_0_v1.csv).

**Header (base columns; `-track_gpu`/`-track_input`/`-track_debug` add more):**

```
Application,ProcessID,SwapChainAddress,Runtime,SyncInterval,PresentFlags,
Dropped,TimeInSeconds,msInPresentAPI,msBetweenPresents,AllowsTearing,
PresentMode,msUntilRenderComplete,msUntilDisplayed,msBetweenDisplayChange,
msFlipDelay,msUntilRenderStart,msGPUActive,msGPUVideoActive,msSinceInput,
QPCTime
```

We read `msBetweenPresents` as frame time, `Dropped` as the dropped-frame
flag, and `msGPUActive` as GPU busy time when present. The lower-case `ms`
prefix (vs. `Ms` elsewhere) is the format's fingerprint.

## PresentMon 2.x

The current console app/service, default metrics set.

**Source:** [`README-ConsoleApplication.md#csv-columns`](https://github.com/GameTechDev/PresentMon/blob/v2.3.0/README-ConsoleApplication.md#csv-columns)
(tag `v2.3.0`) for column definitions, and
[`Tests/Gold/test_case_0_v2.csv`](https://github.com/GameTechDev/PresentMon/blob/main/Tests/Gold/test_case_0_v2.csv)
(main branch) for a real captured row confirming the exact header.

**Header (default columns):**

```
Application,ProcessID,SwapChainAddress,PresentRuntime,SyncInterval,
PresentFlags,AllowsTearing,PresentMode,FrameType,CPUStartQPC,FrameTime,
CPUBusy,CPUWait,GPULatency,GPUTime,GPUBusy,GPUWait,VideoBusy,
DisplayLatency,DisplayedTime,AnimationError,AnimationTime,MsFlipDelay,
AllInputToPhotonLatency,ClickToPhotonLatency,InstrumentedLatency
```

We read `FrameTime` directly as frame time, `CPUBusy`/`GPUBusy` for the
CPU/GPU-bound-share metric, and `DisplayLatency` as display latency.
**There is no `Dropped` column in 2.x** — the closest equivalent is a frame
whose `DisplayedTime` is `NA` (never made it to screen), which we use as the
dropped-frame channel. This is a different definition from 1.x's `Dropped`
flag (see [`docs/metrics.md`](metrics.md)), and we say so in the UI.

In the source checkout, only the explicit `NA` marker establishes that a frame
was not displayed. A finite non-negative duration establishes a displayed
outcome. A blank, missing, negative or malformed cell is **unknown**, not an
inferred drop. `N/A` is also unknown: the cited format specifies `NA`.
Across the explicit-flag formats, only numeric `0` and `1` establish an outcome;
other cells are unknown. Without the column, the metric is unavailable.

`CPUStartQPC` is renamed `CPUStartTime`/`CPUStartQPCTime`/`CPUStartDateTime`
depending on `--qpc_time`/`--qpc_time_ms`/`--date_time`; we don't read it, so
this doesn't affect parsing.

## NVIDIA FrameView

FrameView is closed-source. NVIDIA's published user guides (e.g.
[`frameview-1-8-user-guide-web-version.pdf`](https://images.nvidia.com/content/geforce/technologies/frameview/frameview-1-8-user-guide-web-version.pdf))
describe the tool's UI and workflow but do not print a column-by-column CSV
schema we could cite directly. Instead, this parser is verified against a
real captured FrameView log — a Witcher 3 run redistributed as sample data
in [`Pavelioso/Frameviewer`](https://github.com/Pavelioso/Frameviewer)
(`assets/witcher_3.csv`), a third-party FrameView-log viewer.

**Header (that sample; FrameView's telemetry columns vary by driver/GPU and
what's installed — the tail after `MsPCLatency` is version-dependent):**

```
Application,GPU,CPU,Resolution,Runtime,AllowsTearing,ProcessID,
SwapChainAddress,SyncInterval,PresentFlags,PresentMode,Dropped,
TimeInSeconds,MsBetweenPresents,MsBetweenDisplayChange,MsInPresentAPI,
MsRenderPresentLatency,MsUntilDisplayed,Render Queue Depth,MsPCLatency,
GPU0Clk(MHz),GPU0MemClk(MHz),GPU0Util(%),GPU0Temp(C),...,CPUClk(MHz),
CPUUtil(%),...
```

FrameView builds on the same capitalized `Ms...` column family PresentMon's
own tooling (OCAT, CapFrameX) uses — unsurprising, since all three are built
on Present-hooking capture. We read `MsBetweenPresents` as frame time,
`Dropped`, and `MsPCLatency` (FrameView's end-to-end latency estimate) as
the display-latency channel; the sniff detector's fingerprint is the
presence of `GPU0Util(%)`/`GPU0Clk(MHz)`/`CPUUtil(%)`, which no other format
in this list has. Every other telemetry column (power, per-core utilization,
battery) is ignored.

## CapFrameX

**Source:** CapFrameX's own test fixtures in
[`CXWorld/CapFrameX`](https://github.com/CXWorld/CapFrameX),
`source/CapFrameX.Test/TestRecordFiles/`:
[`CapFrameXFileWithHeader.csv`](https://github.com/CXWorld/CapFrameX/blob/master/source/CapFrameX.Test/TestRecordFiles/CapFrameXFileWithHeader.csv)
and
[`CustomFilenameWithoutComment.csv`](https://github.com/CXWorld/CapFrameX/blob/master/source/CapFrameX.Test/TestRecordFiles/CustomFilenameWithoutComment.csv),
plus `FileRecordInfo.cs` (`HEADER_MARKER = "//"`) for the metadata-block
format.

This section describes the **CSV export**. Native saved sessions are supported
separately as `capframex-json`, with one saved recording selected at a time.

A CapFrameX CSV optionally starts with a `//Key=Value` metadata block, one
line per field:

```
//GameName=re2.exe
//ProcessName=Resident Evil 2 Remake
//CreationDate=2019-03-30
//CreationTime=12:01:36
//RecordTime=25
...
```

...followed by the same data schema OCAT uses (see below):

```
Application,ProcessID,SwapChainAddress,Runtime,SyncInterval,PresentFlags,
AllowsTearing,PresentMode,WasBatched,DwmNotified,Dropped,TimeInSeconds,
MsBetweenPresents,MsBetweenDisplayChange,MsInPresentAPI,
MsUntilRenderComplete,MsUntilDisplayed
```

**Known limitation, stated plainly rather than guessed around:** when
CapFrameX's "without comment" export option is used, its CSV is
byte-for-byte the same schema as an OCAT CSV. There is no reliable way to
tell the two apart from content alone in that case; we detect CapFrameX by
the `//` metadata block and fall back to OCAT otherwise.

## CapFrameX native JSON

Native Windows saved sessions use `Info` and `Runs[]`; each run has a
`CaptureData` object containing parallel sample arrays. The parser follows
CapFrameX's own [Session](https://github.com/CXWorld/CapFrameX/blob/1b5f53da907f0a1de6fde2b75ff8267c79b08b2b/source/CapFrameX.Data.Session/Classes/Session.cs),
[SessionRun](https://github.com/CXWorld/CapFrameX/blob/1b5f53da907f0a1de6fde2b75ff8267c79b08b2b/source/CapFrameX.Data.Session/Classes/SessionRun.cs),
[SessionCaptureData](https://github.com/CXWorld/CapFrameX/blob/1b5f53da907f0a1de6fde2b75ff8267c79b08b2b/source/CapFrameX.Data.Session/Classes/SessionCaptureData.cs)
and [RecordManager writer/normalizer](https://github.com/CXWorld/CapFrameX/blob/1b5f53da907f0a1de6fde2b75ff8267c79b08b2b/source/CapFrameX.Data/RecordManager.cs).
The [recording study](../studies/native-json/README.md) checks five unmodified
public 1.7.0.4 game captures against independently calculated results. The
newer writer's structure is source-verified; these older recordings do not
establish compatibility with every later client or Linux capture format.

| Saved field | Interpretation |
| --- | --- |
| `CaptureData.MsBetweenPresents` | Present frame duration in milliseconds; required |
| `CaptureData.Dropped` | Only JSON `true` / `false` establish a saved outcome; other entries are unknown |
| `CaptureData.CpuActive`, `GpuActive` | Optional CPU/GPU busy durations, milliseconds |
| `CaptureData.MsUntilDisplayed` | Optional display latency, milliseconds |
| `Info.ProcessName`, `Info.AppVersion` | Application and saved version labels |
| `CaptureData.TimeInSeconds` | Alignment checked when populated; not used as native clock evidence |

Run selection is one-based: the first saved recording is the default;
`--capture-run 2` or the browser's saved-recording picker selects another.
`compare` accepts `--a-capture-run` / `--b-capture-run`. Recordings are never
concatenated, and `--stream` does not apply to a saved session. The selected
recording starts its accumulated-duration axis at zero, even when CapFrameX's
stored times have an aggregation offset.

Only finite, non-negative JSON numbers are frame durations. Numeric strings,
`null`, booleans, negative numbers and strings such as `"NaN"` are skipped
without shifting parallel telemetry; the next retained sample begins a source
gap. Optional durations use the same number rule, with invalid entries kept as
unknown observations. Null, missing and empty optional arrays mean no channel.
Every populated consumed array must match `MsBetweenPresents` in length;
misalignment stops import. These are saved values: a zero-filled native array
cannot reveal whether the original capture actually measured that channel.

Original coordinates use the selected run's full path, for example
`Runs[1].CaptureData.MsBetweenPresents[17]`. Array indices are **zero-based**;
they are separate from one-based retained frame numbers and CSV line numbers.
Intervals retain original array indices. JSON reports retain the selected run,
all saved-run sample counts, selected sample range, gap coordinates and episode
indices; the frame inspector exposes the same evidence. JSON objects must have
unique member names, including escaped aliases; ambiguous documents stop import.

Native JSON is buffered and parsed in the existing cancellable worker, limited
to **64 MiB of input bytes** and 128 nesting levels. It bypasses the CSV line
limit so a real minified native file can open. CSV keeps its streaming parser.
UTF-8 and BOM-marked UTF-16 remain supported. No arbitrary JSON column mapping,
compressed archive, cloud-session envelope or Linux-native schema is implied.
Sensor/RTSS arrays, PC-latency and display-change durations are not substituted
for present frame times. Saved `TimeInSeconds` may be synthesized when runs are
cut or aggregated, so the CSV native-clock cross-check is not applied here.
Adjacent retained array indices support pacing within the selected run; skipped
entries split it. Missing frames, elapsed gaps and hardware causes stay unknown.

## OCAT

**Source:** a real OCAT capture (`OCAT-MetroExodus.exe-2019-02-20T101522.csv`)
and a second sample (`ShortFile.csv`), both redistributed as CapFrameX test
fixtures in the same `TestRecordFiles/` directory linked above (OCAT is
itself [`GPUOpen-Tools/ocat`](https://github.com/GPUOpen-Tools/ocat), and
CapFrameX's own test suite uses real OCAT output to validate against).

**Header:**

```
Application,ProcessID,SwapChainAddress,Runtime,SyncInterval,PresentFlags,
AllowsTearing,PresentMode,WasBatched,DwmNotified,Dropped,TimeInSeconds,
MsBetweenPresents,MsBetweenDisplayChange,MsInPresentAPI,
MsUntilRenderComplete,MsUntilDisplayed[,Motherboard,OS,Processor,
System RAM,Base Driver Version,Driver Package,GPU #,GPU,
GPU Core Clock (MHz),GPU Memory Clock (MHz),GPU Memory (MB),Comment]
```

Two real quirks the parser handles: the capitalized `Ms...` prefix (the
signal that distinguishes OCAT/FrameView/CapFrameX from PresentMon 1.x's
lower-case `ms...`), and a **ragged first data row** — the bracketed
hardware-info columns above appear once, only on row one, with every
subsequent row simply shorter (no trailing commas). We read columns by
name-indexed lookup with `fields[idx] ?? undefined`, so short rows are
handled without special-casing.

## MangoHud

**Source:** MangoHud commit
[`f88ef00a`](https://github.com/flightlessmango/MangoHud/tree/f88ef00a0cb8a3dfeab761bd96614ed08ba823b1),
inspected on 2026-10-07: the
[CSV writer and periodic logger](https://github.com/flightlessmango/MangoHud/blob/f88ef00a0cb8a3dfeab761bd96614ed08ba823b1/src/logging.cpp#L176-L308),
[per-frame hook](https://github.com/flightlessmango/MangoHud/blob/f88ef00a0cb8a3dfeab761bd96614ed08ba823b1/src/overlay.cpp#L217-L286),
and [default logging interval](https://github.com/flightlessmango/MangoHud/blob/f88ef00a0cb8a3dfeab761bd96614ed08ba823b1/src/overlay_params.cpp#L871).

**Per-frame logging is required.** `log_interval=0` logs on each frame; a
nonzero interval samples the latest frame duration periodically. Those snapshots
cannot reconstruct frames between samples. Zero is the default in the cited
source, but the CSV does not include the configured interval. Stutterscope
therefore cannot certify capture completeness from the CSV alone.

With `log_versioning` enabled, a log file starts with a version marker and a
one-row system-info table before the per-frame data:

```
v1
0.7.1
---------------------SYSTEM INFO---------------------
os,cpu,gpu,ram,kernel,driver,cpuscheduler
<one row of system info>
--------------------FRAME METRICS--------------------
fps,frametime,cpu_load,cpu_power,gpu_load,cpu_temp,gpu_temp,
gpu_core_clock,gpu_mem_clock,gpu_vram_used,gpu_power,ram_used,
swap_used,process_rss,cpu_mhz,elapsed
<data rows>
```

Without `log_versioning`, the system-info header and row are still written;
the version marker and separator rules are omitted. The parser scans forward
until it finds the frame-metrics header, accepting either form and stripped
files that begin at that header.

`frametime` is confirmed to be **milliseconds** by the overlay code itself
(`frametime = frametime_ms`, `fps = 1000 / frametime_ms`), and `elapsed` is
nanoseconds since logging started. `cpu_load`/`gpu_load` are utilization
*percentages*, not busy-time in milliseconds — unlike PresentMon 2.x's
`CPUBusy`/`GPUBusy`, so we don't map them onto the CPU/GPU-bound-share
metric; MangoHud captures simply don't carry that metric here. MangoHud also
has no dropped-frame column.

**Clock cross-check (source checkout).** For adjacent usable records, compare
changes in `elapsed` with the current record's frame duration. The first frame
precedes the first elapsed timestamp and is excluded from this comparison.
With at least three adjacent intervals, a disagreement greater than both 10 ms
and a factor of two refuses the report and asks for a `log_interval=0` capture.
An elapsed clock that moves backwards also refuses analysis. Invalid frame or
elapsed values break adjacency rather than making up a duration across the gap.

Accepted captures carry `source.timingEvidence` in JSON and a visible assumption
in the browser, Markdown, PNG, and terminal. `compatible` means no large
contradiction was found; it is not proof that every frame was logged. Missing,
short, or interrupted clock coverage is `unverified`. The loose threshold allows
logging overhead and short excerpts; modest sampling gaps can escape it. The
check never estimates missing frame durations, and metrics still use the
recorded per-frame durations, conditional on the logging assumption.

## Generic CSV

Any other CSV: one column holds the frame timing, as a frame time (in ms,
µs or s), an instantaneous FPS, or a running clock (in s or ms; the frame
time is then the difference between consecutive rows). A boolean
dropped-frame column is optional.

The header usually says which column that is, so stutterscope reads it
(`guessMapping` in `src/core/parsers/generic.ts`):

- a column named as a frame time (`frametime`, `frame_time_ms`,
  `FrameTime`, `Delta (ms)`, `deltaTime`, `dt`, `ms_per_frame`) is taken
  first;
- then a clock (`Time (ms)`, `time_s`, `timestamp`, `elapsed`), if its
  values only ever go up;
- then a frame rate (`fps`, `framerate`), which is last because a logged
  frame rate is often an average.

The unit comes from the name when the name has one (`ms`, `us`, `s`, as a
word or a camel-case tail). Otherwise it comes from the values: a typical
frame time below 0.5 is in seconds, below 1,000 in milliseconds, above that
in microseconds. A column counts only if at least 80% of the first 200 rows
have a number in it. When two columns fit equally well
(`frametime_cpu_ms`, `frametime_gpu_ms`) or none does, nothing is guessed.

The web app opens its column dialog with the guess filled in and the reason
under it; the CLI reads the column, prints which one and why on the line
under the frame count, and takes `--generic-column` / `--generic-kind` to
override (given only the column, it works out the unit). With no guess the
dialog opens on the first column and waits for a choice, and the CLI lists
the file's columns.

Two layouts this was checked against, both `Frame, Time (ms)` with a
running clock in milliseconds:

- FRAPS-style `frametimes.csv`, as written by AMD GPU PerfStudio's
  `FrameStatsLogger.cpp` (`"%d, %f"` rows of frame number and total
  milliseconds since the first frame);
- the benchmark table of Crystal Dynamics' games
  (`Frame, Time (ms), Delta (ms) , Memory (mb)`), where `Delta (ms)` is the
  frame time and is the column read. Its first row is `0.000` (no frame
  came before it) and is kept as a zero-length frame.

## Captures with more than one process

PresentMon (1.x and 2.x), OCAT, CapFrameX and FrameView all write one row
per present, keyed by `Application`, `ProcessID` and `SwapChainAddress`.
PresentMon started without `--process_name`/`--process_id` records every
process that presents, so a capture of a game usually also holds the
desktop compositor (`dwm.exe`) and whatever else was on screen, interleaved
in time order. Each row's frame time is measured per swap chain, so
concatenating the streams double-counts wall time and alternates between
unrelated frame rates; every metric comes out wrong.

So those parsers group rows into streams by process id and swap chain
(`src/core/streams.ts`) and analyse one:

- by default, the stream with the most frames that isn't `dwm.exe` (the
  compositor loses the default pick even when it presented more often, as
  it does behind a windowed game);
- in the web app, a picker above the tiles lists every stream with its frame
  count and re-parses the file for the one you choose;
- in the CLI, `--stream` takes an application name, a process id, or
  `pid:swapchain`, and the summary lists the other streams with the flag
  that selects each.

A capture with complete identities keeps its existing stream IDs. For an
edited export with no `ProcessID` column, the source checkout groups by
application **and** swap chain. The full fallback ID is
`app:["game.exe","0x1"]`; `--stream game.exe` selects that application's
busiest chain. If both PID and swap-chain columns are absent, the application
name alone is used. With only a swap-chain column, the ID remains `:0x1`.

An absent column differs from a blank cell. A blank `ProcessID` in a declared
PID column, a blank `SwapChainAddress` in a declared swap-chain column, or a
blank `Application` when it supplies process identity makes that row
unassignable. It is skipped with a physical line number and reason. Every
previously observed stream gets a continuity break when it next resumes;
pacing and slow-frame episodes cannot bridge the unidentified observation.
Rows skipped for a bad frame time are assigned using the same identity rules,
so a known compositor's bad row interrupts only its own stream.

The application fallback cannot distinguish two instances of the same
executable using the same address. Address-only captures cannot distinguish
processes at all, and captures with no identity columns remain a single
series. Keep process IDs for reliable per-process analysis. PID/address reuse
across process lifetimes is not reconstructed. The retained
[synthetic counterexamples and public-capture controls](../studies/stream-identity/README.md)
document the source correction; it is not yet in the npm package or live demo.

## What "verified" means here

For every format above, either:

1. we quote column names and semantics from the tool's own source code or
   published documentation, with a link and (where relevant) a version tag, or
2. we cite a specific real captured file and show the exact header we
   parsed it against.

Where neither was available (FrameView's exact schema per GPU/driver
combination), that gap is stated rather than filled with a guess.

## What every parser shares

All of this lives in `src/core/csv.ts`, `src/core/encoding.ts` and
`src/core/stream.ts`, once, not per format.

**Byte-order mark.** Every real capture fixture pulled from the sources
above (PresentMon's own gold-test CSVs included) starts with a UTF-8
byte-order mark. Left in place, it glues onto the header's first column
name and breaks every `header.get("Application")`-style lookup, silently
turning "every row skipped" into the failure mode instead of a clean parse
error. It is stripped before any column name is read.

**UTF-16.** The tools write UTF-8, but `PresentMon ... > run.csv` in
Windows PowerShell saves UTF-16LE, and so does a spreadsheet's "Unicode
text". A file that starts with a UTF-16 byte-order mark (either byte order)
is decoded as UTF-16. Without the mark it is read as UTF-8, where its NUL
characters get it refused as "not a text file".

**Invalid text.** UTF-8 and BOM-marked UTF-16 decoding is strict. Invalid bytes,
unpaired surrogates and truncated final characters reject the entire input,
including damage in an unused column. Permissive replacement could collapse
different application names into the same stream. Legacy encodings such as
Windows-1252 are not guessed; re-export them as UTF-8 or BOM-marked UTF-16.
A correctly encoded literal replacement character is valid text. The browser's
64 KiB format preview may end mid-character when more input remains, but the
complete import must decode successfully. See the
[retained before/after replay](../studies/text-integrity/README.md).

**Line endings.** A line ends at LF, CRLF or a CR on its own. A line longer
than 1,048,576 characters is refused: no capture has one, and a megabyte
without a line break is a minified JSON file or a binary one.

**Rows that are skipped.** A row is left out, and counted, when its frame
time is missing, is not a number, or is negative (counted, a negative frame
time would subtract from the capture's duration and raise its average FPS).
In a generic CSV of cumulative timestamps, a timestamp lower than the one
before it is skipped the same way and restarts the clock, which is what two
logs joined into one file look like. A missing or invalid timestamp breaks
adjacency: that record and the next valid record have no derivable frame
time, and both are counted as skipped. The next valid timestamp establishes
a new starting point; several frames are never combined across the gap.
Entirely blank lines are formatting, not timestamp observations. A frame time of zero is kept: a clock
coarser than the frame rate produces it honestly, and those frames count
toward the average. The web app and the CLI report how many rows were
skipped. The parser keeps a message with the line number for the first 50
(`meta.warnings`), and the web app lists the first 20 of those.

The source reader also skips a row with more cells than the header declares.
Its insertion point and stream identity are unknown, so no measurement is read
and every existing stream loses adjacency across it. Cumulative timestamps
restart at the next valid anchor. Shorter rows remain supported for native
OCAT hardware tails; this check cannot detect every equal-width or shortened
misalignment. [Controlled cases and a damaged upstream asset](../studies/csv-width/README.md).

**Files that are refused.** With the reason, in the web app's error box and
on the CLI's stderr with exit code 1: an empty file, a binary one, a header
with no data rows, and a capture none of whose rows has a usable frame
time (the message quotes the first skipped row, which is usually enough to
see that the wrong column or format was picked).

**Source lines (source checkout).** Every parser now retains each kept frame's
one-based physical CSV line. These references survive process filtering and
interval selection, including blank lines, format preambles and skipped rows.
For a cumulative-timestamp mapping, the reference names the ending sample whose
value is differenced from the preceding timestamp observation. Both must
be valid; missing records are not bridged. Derived frame times
that overflow milliseconds are skipped with a warning.

**Continuity (source checkout).** Every reader retains a `gapBefore` marker when
unusable timing rows separate two retained frames. Present-hook readers track
this per process/swap chain: unrelated presents and unrelated bad rows do not
break the selected stream. If a bad row lacks any identity component required
by its header, all previously observed streams are conservatively interrupted.
Missing optional telemetry alone does not break frame-time continuity.

PresentMon 1.x and the OCAT/CapFrameX/FrameView present family also compare
`TimeInSeconds` with the current row's native `msBetweenPresents` or
`MsBetweenPresents`, within each tracked stream. A clock interval longer than
that frame accounts for, or a reversed clock, interrupts adjacency. The bound
includes half a unit of each cell's written decimal precision and floating-point
roundoff; coarsely written clocks cannot establish tiny gaps. Missing, malformed
or unrecognized clocks supply no comparison. PresentMon 2's QPC/start-time fields
are not substituted into this rule.

These boundaries can exist with zero malformed/skipped CSV rows: PresentMon's
documented `-exclude_dropped` option deliberately removes presents. The optional
`source.presentClockGaps` JSON field counts clock-supported discontinuities in
the full selected source stream. It can overlap boundaries already supported
by skipped rows; do not add those counters to infer missing frames. Interval
pacing coverage and the listed original-source gap positions remain separate.
`source.presentClockEvidence` retains the first five witnesses (physical CSV
line pair, elapsed/native duration, allowed rounding/roundoff, and interval/reversal
kind) with `omittedWitnesses` for the remaining details. All gap coordinates
remain in the report. Human tables preserve tiny positive allowances in
scientific notation; they are not estimates of the physical clock's accuracy.
[Native records, independent ordinal oracle and an untouched public excerpt](../studies/present-clock/README.md).

Pacing pairs, rolling-median neighborhoods, episodes and trace lines stop at
these boundaries. No missing duration or frame count is imputed; accumulated
time still sums only usable durations. Leading/trailing skipped rows have no
pair of retained endpoints to mark, and remain visible in source warnings and
skipped-row counts. See [metrics](metrics.md#frame-pacing-variability-masd).
