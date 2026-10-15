# An extra CSV cell must not become a measured hitch

On baseline `996b442`, adding one cell before the frame-time column was accepted
without a warning. Seven constructed capture formats all changed from a known
100 FPS sequence into 4.807692 FPS with a false 1,000 ms hitch. The parser read
the inserted value as a measurement and silently ignored the excess cell.

The [generator](generate.py), [fixtures](fixtures/), [CLI replay](replay.py),
[before](results/before.json) and [after](results/after.json) retain the complete
reproduction. These are constructed corruption controls, not game benchmarks.

| Input | Previous interpretation | Corrected interpretation |
| --- | --- | --- |
| Seven explicit native/generic frame-time formats | Five frames, 4.807692 FPS, one hitch, no warning | Four observed 10 ms frames, 100 FPS, no hitch, one skipped record and a continuity gap |
| Cumulative timestamps | A false 990 ms duration and one hitch | Two observed 10 ms durations; the damaged row and next clock anchor cannot supply a duration |
| Interleaved streams | A false 1,000 ms hitch in the game stream | Two retained observed hitches, separated by a known gap; both existing streams lose adjacency across the unknown row |

The repaired guard runs before metric and identity lookup. An over-wide row
cannot identify which column shifted or which stream owns it, even when its
leading cells look valid. It interrupts every existing stream, increments the
skipped-row count and retains a line-numbered warning. Generic cumulative
timestamps and MangoHud elapsed comparisons restart from a new clock anchor.

The report still measures the retained frames; it does not reconstruct the
missing one or certify a complete capture. JSON/Markdown downloads preserve
the warning and skipped-row count through the existing report fields.

## Found in an upstream test asset too

The retained [public-capture manifest](../real-captures/manifest.json) identifies
`Pavelioso/Frameviewer`'s
[`assets/witcher_3_test.csv`](https://github.com/Pavelioso/Frameviewer/blob/084d4cb69e35839fd4ae2738119429f5cddd2ee6/assets/witcher_3_test.csv).
A fresh pinned download matched its retained SHA-256 and bytes. The
[independent Python CSV check](results/native-width.json) finds **142 fields
on line 18 against a 110-field header**. The shifted value at `MsBetweenPresents`
is `7820`, also the process ID in the record. That row cannot establish a
7,820 ms frame duration.

The parser previously included it without a warning: 906 default-stream frames,
10 hitches, 32.350108 FPS. The repaired reader excludes it and keeps 905 frames,
9 hitches, 44.832855 FPS, with a warning and gap. These describe the parser's
retained subset of a damaged upstream test asset, not verified game performance.
The asset also has a shorter, malformed row that this guard cannot identify
as misaligned; its separate one-record stream remains inspectable. No raw
third-party capture is newly vendored by this change.

The [public before](results/public-before.json) and
[public after](results/public-after.json) replay all 34 cached inputs after
checking their pinned hashes. **33 complete report hashes remain unchanged**,
including supported inputs and existing refusals. Only the damaged test asset
above changes. The cache is ignored; regenerate it with the earlier study's
`python studies/real-captures/fetch.py` before running the public replay.

## Compatibility and limits

Native OCAT exports omit trailing hardware-information cells after their first
row. Those shorter tails remain supported, as do quoted commas. The guard
detects **more fields than the header declares**; it does not infer where the
extra field belongs, check equal-width shifts, or prove that a shortened row
omitted only a tail. Already missing or invalid measured values keep their
existing handling. Deleting a whole CSV record leaves no explicit boundary
to identify. A skipped record warning is evidence of incompleteness, not a
clean result.

## Reproduce

From a checkout with Node dependencies installed:

```sh
npm run build:cli
python studies/csv-width/replay.py --cli dist-cli/cli/index.js --out /tmp/width-replay.json --verify
python -I studies/text-integrity/replay.py dist-cli/cli/index.js --label width --corpus > /tmp/width-public.json
```

The last command reuses the existing hash-checked corpus runner. The controlled
runner also accepts the separately installed package's CLI path and `--node`.
It launches actual CLI commands and compares their JSON to independently
specified frame counts, durations, hitches and adjacency boundaries.

The [clean archive and installed-package verification](../../docs/verification-csv-width-2026-10-15.md)
records production-browser exports, source parity and inspected screenshots.
