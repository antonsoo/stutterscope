# Local verification, 2026-10-18

Implementation and retained evidence: source commit `5c570e1`. All work was
performed locally and solo. No push, deployment, tag or npm publication was run.

## Clean source and installed artifact

A fresh source snapshot, without node_modules or build outputs, was installed
with `npm ci`. The runtime source and sample-generator files match the committed
implementation byte for byte. Checks ran on Node 26.7.0 / npm 12.0.1, WSL2 Linux.

| Command or workflow | Observed result |
| --- | --- |
| `npm ci` | Fresh dependencies installed; CLI prepare build completed |
| `npm run lint` | Passed |
| `npm run typecheck` | Passed |
| `npm test` | 402 tests passed in 31 files |
| `npm run build:cli` | Passed; output `dist-cli/` |
| `npm run build` | Passed; complete static output `dist/` |
| Native CLI replay | 16 inputs, zero discrepancies |
| Packed and installed CLI replay | 16 inputs, zero discrepancies |
| Official Node 22.6.0, packed and installed CLI | 16 inputs, zero discrepancies |

`npm pack` produced the local archive identified by
[the package receipt](results/package-receipt.json). Every installed file was
compared with the tarball bytes. The version remains 0.2.5 in this development
artifact; it is not the registry's 0.2.5 release. The
[installed replay](results/installed.json) and
[minimum-runtime replay](results/installed-node22.json) retain their separate results.

The minimum runtime was downloaded directly from nodejs.org and checked against
the official SHA-256 list; its actual `--version` returned `v22.6.0`. An earlier
package-runner invocation unexpectedly selected Node 26 and was not used as
minimum-runtime evidence.

The producer itself was also rerun: all fourteen native CSV byte sequences
matched on the second complete replay. The first replay had one WSL executable
startup failure and thirteen matches. Both receipts are retained; neither
result is a claim of determinism on other hosts.

## Browser behavior and downloads

The complete browser matrix was run against the clean production build in
four batches, with 28 general workflow scenarios and 26 native import scenarios
per engine. The [browser receipt](results/browser.json) retains all outcomes.

| Engine | General workflows | Native imports | Isolated rerun |
| --- | --- | --- | --- |
| Chromium | 28 passed | 26 passed | None |
| Firefox | 28 passed | 25 passed, 1 failed | Failed case passed |

All 108 distinct scenarios reached a passing result. The initial Firefox failure
was the pre-existing `presentmon2-clock.spec.js` phone-width case, whose stream
restoration predicate exceeded 5 seconds. The isolated rerun passed in 8.1 seconds
for the whole scenario. The timeout's cause was not established; no timeout was
increased and no production behavior was changed to hide it.

The new PresentMon-default scenarios all passed in both engines. They exercise
four native variants, independent process selection, actual JSON/Markdown
downloads, interval selection, recomputation, and the new labelled synthetic
sample. At both 1440px and 375px the page had no horizontal overflow, page errors,
CSP violations or axe accessibility violations. After going offline, Chromium
attempted no HTTP requests. Firefox attempted two same-origin font requests per
width; no data/API or external-origin request was attempted. The download
receipts preserve those requests rather than calling them zero.

Reproduce the new workflows:

```sh
npm run build
npx playwright test tests/browser/presentmon-default.spec.js
```

Set `UPDATE_PRESENTMON_DEFAULT_EVIDENCE=1` to additionally retain screenshots and
downloads. The four browser screenshots and the two CLI screenshots in
[`docs/assets/presentmon-default`](../../docs/assets/presentmon-default/) were
opened and visually inspected. The existing dense layout remains readable;
clock witnesses, original column names, measured telemetry coverage and stream
selection stay visible on desktop and phone widths.

## Release boundary

The compiled CLI and static site were verified locally. The hosted demo and
registry artifact were not updated. Raw QPC ticks and local date strings still
do not establish an elapsed-time basis. These are short upstream trace replays,
not live gameplay or general hardware-performance validation.
