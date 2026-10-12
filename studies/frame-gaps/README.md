# Missing frame rows must not become adjacent observations

The parsers correctly discarded unusable frame-time rows, but downstream analysis
joined the remaining values. At baseline `fc44ae257011a33aaee50207efa20bd4b5619934`,
`60, NA, 120` produced a 60 ms successive pacing difference and one 180 ms slow-frame
episode. There was no observed consecutive pair. The chart drew a connecting line,
and the PNG export repeated the same false continuity.

| Synthetic input, milliseconds | Before | Repaired source |
| --- | --- | --- |
| `60, NA, 120` | MASD 60 ms; one two-frame episode | MASD unavailable; two one-frame episodes |
| `10, 10, 10, NA, 80` | MASD 23.333 ms; last frame flagged relative to the earlier regime | MASD 0 ms over two observed pairs; separate local context |
| `60, 120` | MASD 60 ms; one episode | Unchanged |
| Game `60, 120`, interleaved bad overlay row | MASD 60 ms | Unchanged; another stream's bad row does not split the game |

The 80 ms observation remains an absolute hitch. Stutter counts from very short
segments do not establish the absence of an anomaly; local context may be too
limited to distinguish one.

## What changed

Each reader retains a compact continuity marker alongside its frame durations.
Present-hook formats track it per process/swap chain. An invalid timing row with
incomplete identity conservatively interrupts all previously observed streams.
Blank lines, ordinary interleaving and missing optional telemetry do not split
otherwise observed frame-time sequences.

MASD excludes cross-gap pairs, rolling medians stop at gaps, and episodes split
there. Selection and worker recomputation preserve the markers. Frame-time/FPS
traces retain both endpoints without drawing a connecting segment. Schema 5
exports give pacing-pair coverage, original source-frame/CSV-line gap coordinates,
and visible episode boundaries. A gap before the selected interval's first frame
is retained as context, but does not count as a pair *within* that interval.

No missing duration or frame count is reconstructed. Source rows that disappeared
without any evidence in the file remain undetectable. The time axis continues to
sum usable frame durations. Source warnings count skipped rows across the entire
file, while pacing coverage describes the selected stream and interval.

## Retained evidence

- [Baseline CLI reports](results/before-fc44ae2.json): 24 of 35 synthetic cases
  disagree with independent segment arithmetic; 11 controls already agree.
  The baseline also lacks the new coverage fields, which is recorded separately
  from behavioral agreement.
- [Installed Node 24 reports](results/installed-node24.json) and
  [minimum Node 22.6 reports](results/installed-node22.json): all 35 cases agree.
  The Python oracle imports no application code. It independently computes
  adjacent differences, sorted-window medians and episode grouping.
- [Public-capture compatibility](results/corpus.json): all 34 cached inputs match
  their existing pinned SHA-256 and byte sizes. The same 27 parse and the same
  seven are refused; every existing metric on accepted captures is unchanged.
  These are cached public inputs, not newly downloaded captures or an estimate
  of detection accuracy.
- [Browser before](results/browsers-before.json) and
  [browser after](results/browsers-after.json): actual offline Chromium and Firefox
  imports at 1440 and 375 px. Final flows also recompute the threshold, select and
  restore an interval, replace the capture and switch present streams.
  [All 28 complete reports](results/browser-parity.json) match the installed CLI.
  No page errors, external requests or page-width overflow occurred. Firefox
  made local font requests after disconnecting; these are retained in the receipt.
- [Artifact identity](results/artifacts.json): 69 source/configuration/sample
  files match the tested archive; all 30 served files match the built `dist/`;
  all 22 installed JavaScript modules match the separately packed CLI.
- [Validation scope](results/validation.json): a fresh Node 24.21 install at
  `c16af5e` passed lint, typecheck, 271 unit checks in each of two locales, the
  production build and 72 Chromium/Firefox checks. The subsequent `3ce96b9`
  change only moves the report-card point color to the drawing site; lint,
  typecheck/build and six affected browser checks passed again. All installed
  and final browser evidence here uses the latter archive.

Screenshots were opened and inspected. The unavailable pacing value, two episodes,
source-gap explanation and separated trace points are visible without page overflow.
The interface remains its existing dark oscilloscope design at both widths.

| View | Before | After |
| --- | --- | --- |
| Chromium desktop | [PNG](../../docs/assets/frame-gaps/before/chromium-1440.png) | [PNG](../../docs/assets/frame-gaps/after/chromium-1440.png) |
| Chromium 375 px | [PNG](../../docs/assets/frame-gaps/before/chromium-375.png) | [PNG](../../docs/assets/frame-gaps/after/chromium-375.png) |
| Firefox desktop | [PNG](../../docs/assets/frame-gaps/before/firefox-1440.png) | [PNG](../../docs/assets/frame-gaps/after/firefox-1440.png) |
| Firefox 375 px | [PNG](../../docs/assets/frame-gaps/before/firefox-375.png) | [PNG](../../docs/assets/frame-gaps/after/firefox-375.png) |
| Exported report card | [PNG](../../docs/assets/frame-gaps/before/report-card.png) | [PNG](../../docs/assets/frame-gaps/after/report-card.png) |

[Whole-CLI timing](results/benchmark.json) uses a fixed synthetic 500,000-row capture,
one warmup and three alternating measured runs per build on this 14-vCPU WSL2
Linux machine (47.05 GiB RAM reported) with Node 26.7. Median wall time was 0.32 s before and 0.45 s
after; median peak RSS was 111,784 and 110,740 KiB respectively. This records the
cost of retaining continuity, not a speed improvement or a portable performance
bound. There are 499,500 retained frames, 499,000 observed pairs and 499 internal
gap boundaries; the final unusable row has no following retained endpoint.

## Reproduce

From a checkout, with Node 24 and Python 3:

```sh
npm ci
npm run lint && npm run typecheck && npm test
npm run test:browser
python3 studies/frame-gaps/replay.py --out /tmp/frame-gaps.json --verify
npm pack --pack-destination /tmp
```

Install the tarball into a separate directory, then pass its
`dist-cli/cli/index.js` to `replay.py --cli ...`; use `--node ...` to repeat on
Node 22.6.0. `browser-parity.py` compares full exported source, selection,
continuity, episode and metric objects, excluding only browser wrapper metadata.

To retain browser artifacts from the production build, start `npm run preview --
--host 127.0.0.1 --port 4197 --strictPort`, then in another terminal:

```sh
node studies/frame-gaps/observe-browser.mjs http://127.0.0.1:4197/stutterscope/ /tmp/frame-gap-browser --verify
```

`corpus.py` accepts `--before`, `--after` and `--out` CLI paths and checks the
existing `studies/real-captures` cache against its manifest. `benchmark.py` uses
the same options and Linux `/usr/bin/time`. `verify-artifacts.py --help` documents
the archive, installed-package and preview-server checks.

The source changes and local package/build verification are distinct from an npm
release or hosted deployment. This study does not establish the behavior of the
public demo or physically validate a gaming capture.
