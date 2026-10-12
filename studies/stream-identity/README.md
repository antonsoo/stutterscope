# Keep application identity when process IDs are absent

A five-row **synthetic** PresentMon-shaped CSV exposed a real grouping error.
Removing the `ProcessID` column made the parser ignore `Application` whenever
`SwapChainAddress` remained. Two applications at the same address became one
stream, named after whichever appeared first. This was reproduced against
`b30d55b40dd2592c74b5f37ae13d742c0bbc5526`.

| Selected game | Before | Corrected source |
| --- | ---: | ---: |
| Frames | 5, including the compositor | 3 game frames |
| Average FPS | 45.4545 | 100 |
| Pacing, mean absolute successive difference | 30 ms | 0 ms |
| Stutter events | 2 | 0 |
| Select `dwm.exe` | Error: no matching stream | 2 compositor frames at 25 FPS |

The input is [mixed-default.csv](fixtures/mixed-default.csv): game times
`10, 10, 10` ms interleaved with compositor times `40, 40` ms. The correct
averages follow directly from frames divided by summed frame duration. This
is a controlled counterexample, not a captured game performance result.

Addresses are not a global process identity: Windows gives each process a
[private virtual address space](https://learn.microsoft.com/en-us/windows/win32/memory/virtual-address-space).
Stutterscope now uses the application name together with the swap chain when
the entire PID column is absent. This is still a fallback: two instances of
the same executable can remain indistinguishable without their process IDs.

## Identity and missing observations

| Header has | Identity | Missing cell behavior |
| --- | --- | --- |
| ProcessID, optionally SwapChainAddress | Existing `pid:swap` ID | Missing PID or declared swap chain skips the row |
| Application and SwapChainAddress, no PID | `app:["game.exe","0x1"]` | Missing application or swap chain skips the row |
| Application alone | Application name | Missing application skips the row |
| SwapChainAddress alone | Existing `:swap` ID | Missing swap chain skips the row; process separation cannot be established |
| No identity columns | One series | No per-process identity is available |

A blank cell in a declared column does not trigger the capture-wide fallback.
The parser keeps its physical line number in a warning, excludes its timing
and telemetry, and interrupts all previously observed streams until each
resumes. A skipped frame with a known identity interrupts only its own stream.
`track` and `skip` use the same identity calculation. Source line numbers,
optional channels, and gap flags are filtered together.

There is no reconstruction of process lifetimes, PID reuse, address reuse, or
missing duration. The fallback's application names are case-sensitive for
grouping; name selectors retain their existing case-insensitive behavior.
For repeated application names, `--stream name` still chooses the busiest
matching stream. Keep process IDs in captures when possible.

## Replay

[`replay.py`](replay.py) invokes the actual CLI and imports no application
code. It supplies explicit frame lists, partitions at known missing
observations, and computes expected FPS and pacing with Python rational
arithmetic. Its 55 cases cover the five present-hook formats, application and
swap-chain selection, automatic format detection, invalid times from the same or another application,
blank identity cells, refusal of entirely unassigned inputs, and full-identity
controls. Ten cases agreed before the correction; all 55 agree after it.

```bash
npm ci && npm run build:cli
python3 studies/stream-identity/replay.py --cli dist-cli/cli/index.js --out /tmp/stream-identity.json --verify
node dist-cli/cli/index.js summary studies/stream-identity/fixtures/mixed-default.csv
```

For the baseline receipt, point `--cli` at the baseline's `src/cli/index.ts`
under Node 24 and omit `--verify`. For an installed-package check, point it at
`node_modules/@antonsoloviev/stutterscope/dist-cli/cli/index.js` instead.
[`results/before.json`](results/before.json) retains the original reports,
input text, hashes, expected observations and differing fields.

[`public-controls.mjs`](public-controls.mjs) replays the 34 capture CSVs in the
existing [pinned manifest](../real-captures/manifest.json), verifying each file's
SHA-256 and size first. Summary-only files are excluded. It retains all parser
metadata and metrics, plus byte hashes of frame times, time axes, physical line
numbers, gap flags and optional channels. Cached captures remain unmodified
and are not redistributed by this study. Fetch them using the existing
[public-capture procedure](../real-captures/README.md#reproduce).

```bash
node studies/stream-identity/public-controls.mjs node_modules/@antonsoloviev/stutterscope/dist-cli /tmp/public-controls.json
```

The additional browser workflow imports offline, switches between applications,
downloads reports, checks missing-identity warnings and split episodes, rejects
an entirely unidentified capture, and recovers by importing the valid file.
It runs in Chromium and Firefox at 1440 and 375 px. Production UI code is
unchanged. Screenshots wait for the existing trace entrance animation to finish.

This correction is source-only; the npm package and hosted demo have not been
updated by this work.
