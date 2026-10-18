# Open the actual native capture directly

The parser correction's native CSV can now be inspected without downloading a
study file and finding the upload control. Open
[the native PresentMon 2.6 example](https://antonsoo.github.io/stutterscope/?example=presentmon-default)
or choose **Open native PresentMon 2.6** on the landing page.

This is the unchanged `trace5-filtered.csv` produced by the official Windows
executable from Intel's ETL. The [served provenance](https://antonsoo.github.io/stutterscope/native-presentmon-default/provenance.json)
retains the executable, trace and CSV hashes, original flags and licence. It
is an offline producer replay, not a new game or hardware benchmark.

The two native examples have different input bytes and populations:

| Direct example | Recorded file | Retained frames | Observed pacing pairs | Clock gaps |
| --- | --- | ---: | ---: | ---: |
| `?example=presentmon-default` | New executable replay, `trace5-filtered.csv` | 174 | 90 | 83 |
| `?example=filtered-presents` | Earlier transformed upstream gold CSV, `filtered-presents.csv` | 175 | 91 | 83 |

The new example retains CPU/GPU busy and latency observations for all 174
selected frames. Its native clock stops pacing comparisons at the gaps.
The older example and URL remain available; its original population was not
renumbered or replaced.

## Publication checks

Source `22c9690f8193d592b2a724246b4089536743d22b` passed a fresh `npm ci`, lint,
types, all 402 unit checks, website/CLI builds and all 112 browser scenarios
on their first attempt. Node was 26.7.0. This interface change does not establish
a new minimum-runtime claim or registry release; the earlier installed CLI and
Node 22.6.0 checks remain scoped in [verification.md](verification.md).

Pages revision `dbfbf1c9512c6046372d9684ea64dd62e9e7ff4a` advances the existing
branch normally. All twenty-two immutable assets from its immediate predecessor
remain byte-identical: [retention receipt](results/example-preserved-assets.json).
All thirty-seven fresh build files, the canonical root before and after the
asset pass, and explicit `index.html` match direct public responses:
[HTTP receipt](results/example-hosted-bytes.json). No query cache busters were used.

The four [public workflows](results/example-publication.json) cover Chromium
and Firefox at 1440 and 375 px. They open the new direct route, disconnect,
download actual JSON and Markdown, inspect CPU/GPU and latency coverage, and
pass accessibility, CSP, page-error and overflow checks. They then reopen the
same native capture from its landing action and check that the older native
route still retains its separate population. All four screenshots were visually
reviewed; [full screenshots and downloads](../../docs/assets/presentmon-default/example-hosted/)
retain the public source context and original metrics.

Reproduce the hosted checks explicitly:

```sh
NATIVE_DEFAULT_EXAMPLE_EVIDENCE=/tmp/native-example-browser npx playwright test --config=studies/presentmon-default/example-hosted.config.mjs
```

This config starts no local server and substitutes no application assets.
The [underlying native producer study](README.md) remains the parsing and
measurement oracle; this follow-up adds a usable public route to its evidence.
