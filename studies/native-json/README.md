# Open a saved CapFrameX session directly

CapFrameX saves recordings as JSON by default. Stutterscope supported its CSV
export but rejected the saved JSON file as malformed CSV. A user had to return
to the capture tool and export another file before inspecting a recording here.

The new importer accepts native Windows saved sessions, selects one recording,
and retains original array indices through slow-frame inspection and exports.
It does not concatenate recordings into an invented continuous capture.

## Recorded inputs and independent checks

Five unmodified public game recordings are pinned to
[retowyss/pc-benchmarking-r-griddb, commit 4db96be](https://github.com/retowyss/pc-benchmarking-r-griddb/tree/4db96bed6b590539fad0ddfa477ce39e7be712dc/data).
Their saved version is **1.7.0.4**. [The manifest](manifest.json) retains original
URLs, byte sizes and SHA-256 hashes. No repository license was found; the raw
recordings are fetched only into the ignored local cache and are not redistributed.

| Saved recording | Frames | Average FPS | Before |
| --- | ---: | ---: | --- |
| AC Valhalla | 58,521 | 97.533593 | CSV parse error |
| Cyberpunk 2077 | 25,294 | 42.155307 | CSV parse error |
| Doom Eternal, first | 161,992 | 89.995047 | CSV parse error |
| Doom Eternal, second | 382,323 | 212.400716 | CSV parse error |
| Rollerdrome | 150,650 | 375.822691 | CSV parse error |

These are import results from existing recordings, not a new hardware comparison.
The five files total **60,571,992 bytes and 778,780 frames**. All now import;
frame count, duration, average FPS, P99/P99.9, mean absolute adjacent difference
and dropped count agree with independent Python calculations from the saved
arrays. Every exported episode's indices and longest duration are checked against
its original array. The oracle imports no analyzer code. It checks arithmetic
and coordinates, not the accuracy or completeness of the original capture.

[Before results](results/before.json) retain the actual CLI failures at source
`336993f5ac07bbdb9f650488676977e497374205`. The reproduction commands are:

```bash
python3 studies/native-json/fetch.py
python3 studies/native-json/replay.py --output studies/native-json/results/after.json
```

The older public demo was also observed directly: all five files failed after
disconnecting in Chromium and Firefox, at desktop and 375 px. Browser replay
uses the actual selected file, actual worker, and actual downloaded reports:

```bash
npm run build
npm run preview -- --host 127.0.0.1 --port 4194 --strictPort
# In another terminal:
node studies/native-json/browser.mjs http://127.0.0.1:4194/stutterscope/ /tmp/native-json-browser
```

The corrected browser imports all five files in each session, compares complete
JSON exports with the CLI, checks accessibility and overflow, and downloads PNG
cards for Cyberpunk and the 382,323-frame Doom recording. Separate synthetic
browser workflows exercise recording selection, intervals, paired exports,
recomputation, failed replacement and a damaged second recording. They run after
disconnecting too; a failed selection retains and labels the previous report.

## Current native writer, separately exercised

The authoritative schema is CapFrameX's own session classes and
`RecordManager.SaveSessionToFile`, pinned at
[1b5f53d](https://github.com/CXWorld/CapFrameX/tree/1b5f53da907f0a1de6fde2b75ff8267c79b08b2b/source/CapFrameX.Data.Session).
The [source manifest](writer/source-manifest.json) hashes every compiled class;
CapFrameX's central dependency declaration pins Newtonsoft.Json **13.0.3**.

[Program.cs](writer/Program.cs) constructs controlled runs using those actual
classes, then applies the writer's serializer settings and UTF-8 StreamWriter.
The retained [native serializer output](../../tests/fixtures/capframex-json/native-writer.json)
has the native BOM, version serialization, null optional arrays and `"NaN"`
representation. It is checked byte-for-byte by the reproduction helper and
imported by the ordinary parser. With a .NET 10 SDK installed:

```bash
python3 studies/native-json/writer/reproduce.py
```

This is a **synthetic serializer exercise**, not a game capture, a Windows-client
run, or proof that every recent client variant works. The five original
recordings above supply separate real-input evidence. Newer fields do not replace
`MsBetweenPresents` with display-change, RTSS or sensor timings.

## CLI and coordinate contract

From a source checkout (the npm 0.2.5 release predates this feature):

```bash
npm ci
node dist-cli/cli/index.js summary tests/fixtures/capframex-json/native-writer.json --events
node dist-cli/cli/index.js compare tests/fixtures/capframex-json/native-writer.json tests/fixtures/capframex-json/native-writer.json --a-capture-run 1 --b-capture-run 2 --json
```

One-based `--capture-run` selects a recording; the default is 1. In the browser,
use the saved-recording picker for A or B. Changing the recording resets that
slot's analysis interval. `--stream` is reserved for process/swap-chain CSV data.

```text
Saved session
+-- Runs[0]  -> recording 1 -> array indices 0,1,2,...
+-- Runs[1]  -> recording 2 -> array indices 0,1,2,...
                     |
                     +--> select one recording --> retain usable samples
                                                   |
                             interval + episodes <-+-> JSON / Markdown / PNG
```

`source.nativeCapture` retains the selected recording, all saved-run sample
counts, saved version and frame-time path. `analysis.sourceSampleRange` gives the
selected first/last array index. Continuity gaps and episodes retain native
indices separately from `sourceLine`; CSV line numbers are unavailable for a
JSON source. Retained frame numbers remain one-based; array indices are zero-based.

Invalid frame durations are skipped without shifting telemetry or renumbering
array coordinates. The next usable sample begins a gap. Populated consumed
arrays must match the frame array length; malformed parallel evidence stops the
import. Duplicate object members, including escaped aliases, are ambiguous and
rejected. Native null/empty channels stay absent; unknown entries stay unknown.

The full [format contract](../../docs/formats.md#capframex-native-json) documents
limits: 64 MiB input size, 128 nesting levels, worker buffering, number/flag rules,
UTF-8/BOM-marked UTF-16, and unsupported envelopes/Linux schemas. Saved
`TimeInSeconds` can be rewritten when CapFrameX cuts or aggregates recordings,
so it does not supply the CSV native-clock cross-check. Missing durations and
frames are not reconstructed. A saved zero-filled channel cannot establish
whether its original capture measured those values.
