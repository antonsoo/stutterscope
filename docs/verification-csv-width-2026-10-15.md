# CSV alignment verification, 2026-10-15

The [study](../studies/csv-width/README.md) reproduces extra cells becoming
false long frames in seven supported CSV formats, and retains a pinned
upstream FrameView test asset with the same defect. The repair skips an
over-wide record before interpreting either its measurements or its stream.
It reports the source line and preserves a continuity gap. Cumulative clocks
restart at the next valid anchor.

The [verification receipt](../studies/csv-width/results/verification.json)
records the clean `89fd382` source archive and locally packed npm artifact.
This change does not release npm or update the hosted demo.

| Workflow | Result |
| --- | --- |
| Clean Node 24.21.0 archive, fresh npm install | Lint, typecheck, 354 tests, web and CLI builds pass |
| Same archive in `de_DE.UTF-8` | All 354 tests pass |
| Production build in Chromium and Firefox | All 80 browser workflows pass |
| Fresh offline contexts, 1440 and 375 px | Four workflows, 16 downloaded JSON reports, four inspected screenshots |
| Packed package installed with scripts disabled | All 22 shipped JS modules match the clean build |
| Installed CLI on Node 22.6.0 and 24.21.0 | All nine controlled corruption cases pass on each |
| Installed CLI on 34 hash-checked public captures | Complete results equal the repaired source replay |
| Node 24 and 26 production builds | All 30 build files are byte-identical |

The installed package also executes the documented PresentMon and generic
summary examples, version command, and recorded-browser comparison with
independent per-run bounds. It runs under `node_modules`, without compiling
TypeScript or running install scripts. No registry package was published.

Commands in the clean archive:

```sh
npm ci --no-audit --no-fund
npm run lint
npm run typecheck
npm test
LC_ALL=de_DE.UTF-8 LANG=de_DE.UTF-8 npm test
npm run build
npm pack --pack-destination /path/to/artifacts
npx playwright test
```

`npm ci` and `npm pack` run the repository's existing CLI build preparation.
The static web output is `dist/`. Cached Chromium and Firefox were used;
no browser installation was run. The browser suite used
`STUTTERSCOPE_WIDTH_EVIDENCE=/path/to/evidence` to retain actual downloads and
screenshots. Follow the study's replay command with the separately installed
package's `dist-cli/cli/index.js` path to repeat the installed CLI checks.

## Offline exports and visual inspection

Each new browser workflow disconnects after initial page load, before its
first local file. It imports a shifted PresentMon 2-shaped fixture, checks the
warning and 100 FPS retained-frame result, then checks interleaved streams and
a generic mapping through the actual controls. Both streams retain a gap
across the unknown row. JSON exports preserve the skip reason and known
measurements. Twelve downloaded reports' metrics, source fields and episodes
exactly match the independent CLI outputs; see the
[parity receipt](../studies/csv-width/results/browser-cli-parity.json).

Firefox can retry same-origin font files while offline, using a fallback when
they are unavailable. The receipts retain those attempts. No additional
analysis code, capture data or external-origin requests occur, and there are
no page exceptions. The first harness run omitted the generic mapping's
required Parse action; the completed checks include that real user action.

All four screenshots were opened and inspected. The warning wraps on phones,
the retained-frame metrics show 100 FPS and zero hitches, and the gap remains
visible in the trace and coverage table. No horizontal overflow occurs.

- Chromium: [desktop](assets/csv-width/chromium-1440.png),
  [phone](assets/csv-width/chromium-375.png).
- Firefox: [desktop](assets/csv-width/firefox-1440.png),
  [phone](assets/csv-width/firefox-375.png).

## Scope

Short native OCAT hardware tails and quoted commas remain supported. An
equal-width or shortened misalignment may still be unrecognized; the study
explicitly retains the shorter damaged record in the upstream test asset.
These checks cannot recover missing measurements or establish capture
completeness. The correction prevents a known extra cell from supplying a
measurement, rather than claiming the remaining subset is a complete capture.

Existing metadata remains appropriate: "Frame-time analysis for PC gamers and
hardware reviewers. Drop in a capture, see the stutter." Relevant topics:
`frame-time`, `presentmon`, `benchmarking`, `performance`, `typescript`,
`local-first`.
