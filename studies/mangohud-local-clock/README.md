# Local MangoHud clock discontinuities

The parser compared the sum of adjacent `elapsed` intervals with the sum of
their frame durations. A missing block can be small relative to a long capture;
long and short disagreements can also cancel. The current checkout originally
marked both cases compatible and used the unsupported pairs in pacing, rolling
stutter context, trace connections and slow-frame episode grouping.

`before.json` records source `7f620a0` before the repair. `after.json` replays the
same bytes through the repaired source. The oracle uses the original record
ordinals before controlled deletion, rather than the parser's clock heuristic.
Python computes mean absolute successive difference (MASD) over the known
contiguous pairs only. These edited files are experiments, not captures reported
by other users to be damaged.

| Input | Known boundaries | Before / after detected | MASD before / after (ms) | Episodes before / after |
| --- | ---: | ---: | ---: | ---: |
| Controlled, complete | 0 | 0 / 0 | 1.935484 / 1.935484 | 1 / 1 |
| Controlled, six records removed | 1 | 0 / 1 | 2.4 / 0 | 1 / 2 |
| Public Witchfire, unchanged | 0 | 0 / 0 | 0.757583 / 0.757583 | 248 / 248 |
| Public, 300 records removed | 1 | 0 / 1 | 0.759428 / 0.759435 | 248 / 248 |
| Public, nine ten-record blocks removed | 9 | 0 / 9 | 0.757961 / 0.758015 | 247 / 247 |

All five cases retain their before/after frame count, summed durations, average
FPS and absolute hitch count. The uninterrupted public log retains every summary
metric. A changed MASD need not be large to be wrong: the defect is an asserted
measurement between observations whose continuity the source contradicts.

`public-controls.json` also compares all 34 pinned public inputs from the earlier
capture study: every accepted summary, episode list and analysis record is
unchanged; previously refused inputs remain refused. `controls.py` repeats this
comparison with `--before-cli` and `--after-cli` entrypoints, using the ignored
cache populated by `studies/real-captures/fetch.py`.

## Evidence and limits

The public control is an unchanged [Witchfire MangoHud 0.8.2 capture](https://github.com/Reason7322/mangohudlogs/blob/72a3bfac974b776581e382b3e2bbe2218e40c667/Witchfire-Win64-Shipping_2026-08-12_14-16-42.csv),
117,569 records, SHA-256
`f80aee599f38847c804cc2c06bbac26bf7fa21ac4a29c4813bce02ca1363aba6`.
No license is stated; its bytes and derived copies are downloaded into ignored
`cache/`, not redistributed here. The two committed small fixtures are synthetic.

MangoHud's [present hook](https://github.com/flightlessmango/MangoHud/blob/f88ef00a0cb8a3dfeab761bd96614ed08ba823b1/src/overlay.cpp#L302-L304)
calls `try_log()` for `log_interval=0`.
The [logger](https://github.com/flightlessmango/MangoHud/blob/f88ef00a0cb8a3dfeab761bd96614ed08ba823b1/src/logging.cpp#L317-L329)
samples another clock and copies the frame time. Their readings need not match
exactly. The repair therefore retains the existing conservative threshold:
disagreement greater than both 10 ms and a factor of two, now applied locally
as well as to the full sums. This is a heuristic interruption rule, not a
calibrated missing-frame detector. A logging delay can also cause a disagreement;
smaller omissions can escape it. Matching clocks do not prove per-frame logging.

The 300-record edit exposes a 1,765.099821 ms logged interval beside a
5.84847 ms frame duration. Its aggregate discrepancy is only about 0.2%.
The repaired report retains one boundary, marks timing `unverified`, and records
physical CSV lines 1007 and 1008. Nine blocks retain all nine boundaries and five
clock witnesses, explicitly counting four omitted witnesses. No missing frame
count, duration or hardware cause is inferred. The graph continues to use summed
retained frame durations, rather than inserting wall-clock gaps.

## Reproduce

From the repository after `npm ci`, with Python 3 and Node 24 or later:

```sh
python studies/mangohud-local-clock/replay.py --out /tmp/claude-1000/mangohud-after.json --verify
npm test
npm run test:browser
```

The replay fetches and verifies the public control, writes the two synthetic
fixtures and the controlled edits, invokes the actual CLI, and checks source
coordinates, pacing and witness retention. To check a packed installation, pass
its compiled entrypoint with `--cli /path/to/install/node_modules/@antonsoloviev/stutterscope/dist-cli/cli/index.js`.

`tests/browser/mangohud-clock.spec.js` imports the synthetic removed-block file
offline in Chromium and Firefox at 1440px and 375px, inspects the separate
episodes, downloads JSON and Markdown, and recomputes with a new hitch threshold.
Source-line evidence and continuity survive each operation. Verification receipts
are in `verification.json`; reviewed screenshots are in `screenshots/`.

The fresh archive passed `npm ci`, lint, strict type checking, 384 unit checks,
the web and CLI builds, and 98 browser workflows under Node 24.21.0. Its built
web and CLI files match the working checkout byte for byte. A packed local
installation passes all five oracle cases on Node 22.6.0 and 24.21.0; the receipt
records the tarball hash. The documented dev server command also serves the app.
Four screenshot workflows were repeated with the existing trace-reveal animation
finished: all four final image files match between the working and clean builds.
The screenshots show the two episodes and physical-line gap evidence without
horizontal page overflow at either width. This changes no UI layout.

This is local source and built-artifact evidence. The hosted demo and npm 0.2.5
have not been updated by this repair.
