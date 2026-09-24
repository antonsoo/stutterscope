# Capture formats

Every parser in `src/core/parsers/` is verified against either the tool's
own source/documentation or a real captured sample, cited below. Where a
format is closed-source or undocumented, that's stated explicitly rather
than guessed at.

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

CapFrameX's native save format is JSON, but its structure isn't documented
anywhere we could verify against an authoritative source, so — per the
brief for this project — we parse its **CSV export** instead, which the app
itself describes as giving "a better view on the raw PresentMon data."

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

**Source:** the actual logging implementation,
[`src/logging.cpp`](https://github.com/flightlessmango/MangoHud/blob/master/src/logging.cpp)
and [`src/overlay.cpp`](https://github.com/flightlessmango/MangoHud/blob/master/src/overlay.cpp)
in [`flightlessmango/MangoHud`](https://github.com/flightlessmango/MangoHud).

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

Without `log_versioning`, the file is just the `fps,frametime,cpu_load,...`
header and data rows — `src/logging.cpp` gates the version block and the
`FRAME METRICS` rule behind that flag, so we don't assume either is present:
the parser scans forward until it finds a line matching the frame-metrics
header, skipping anything before it.

`frametime` is confirmed to be **milliseconds** by the overlay code itself
(`frametime = frametime_ms`, `fps = 1000 / frametime_ms`), and `elapsed` is
nanoseconds since logging started. `cpu_load`/`gpu_load` are utilization
*percentages*, not busy-time in milliseconds — unlike PresentMon 2.x's
`CPUBusy`/`GPUBusy`, so we don't map them onto the CPU/GPU-bound-share
metric; MangoHud captures simply don't carry that metric here. MangoHud also
has no dropped-frame column.

## Generic CSV

Any other CSV: pick a column and tell stutterscope what it means (frame
time in ms/µs/s, instantaneous FPS, or a cumulative timestamp in seconds —
frame time is then derived as the diff between consecutive rows) and,
optionally, a boolean dropped-frame column. This is the fallback the UI
opens a small dialog for when auto-detection can't confidently match one of
the formats above.

## What "verified" means here

For every format above, either:

1. we quote column names and semantics from the tool's own source code or
   published documentation, with a link and (where relevant) a version tag, or
2. we cite a specific real captured file and show the exact header we
   parsed it against.

Where neither was available (FrameView's exact schema per GPU/driver
combination), that gap is stated rather than filled with a guess.
