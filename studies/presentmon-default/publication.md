# Public source and demo verification

On 18 October 2026, source `76051eb` was pushed to `main` by a normal
fast-forward push. A fresh clone installed its locked dependencies and rebuilt
the website and CLI. Every website file matched the previously verified local
build. No registry publication or version change was performed.

Pages commit `4bf9546` was pushed as a descendant of the previous deployment.
It retains all nineteen previously deployed immutable assets, including both
older JavaScript entry bundles and their source maps. Only current entry and
sample files were replaced, and the new assets and sample were added.

| Surface | Observed evidence |
| --- | --- |
| Public source | `76051eb`, containing implementation `5c570e1` |
| Canonical demo | All 34 fresh build files match SHA-256, without query cache busters: [HTTP receipt](results/hosted-bytes.json) |
| Current hosted workflows | Chromium and Firefox, 1440px and 375px; native imports, stream switching, offline JSON/Markdown downloads, interval selection and recomputation: [browser receipt](results/hosted-browser.json) |
| Previous cached entry | Exact prior entry document substituted locally; its assets fetched from their canonical public URLs; both engines import and export offline: [cached-entry control](results/hosted-cached-entry.json) |
| Local npm artifact | Verified packed-and-installed artifact and actual Node 22.6.0, described in [local verification](verification.md); no new registry release |

The six hosted scenarios all passed their first attempt. Four
[screenshots and complete download receipts](../../docs/assets/presentmon-default/hosted/)
retain both engines and widths. They were visually reviewed: native source
context, 83 gap witnesses, 90 observed pairs and channel coverage are visible,
with no horizontal page overflow. The accessibility audit, CSP violation
capture and page-error checks passed. Offline request receipts preserve any
same-origin font requests; no data/API or external-origin requests occurred.

Re-run the hosted workflow explicitly from the repository root:

```sh
npx playwright test --config=studies/presentmon-default/hosted.config.mjs
node studies/presentmon2-clock/cached-entry.mjs /tmp/stutterscope-cached-entry.json
```

The hosted config starts no local server and substitutes no application assets.
The cached-entry control intentionally substitutes only the old document, and
does not claim that the old bundle contains the new parser correction. The
separate GitHub Pages build-status API returned 404 during inspection; public
byte equality and actual browser workflows, rather than that unavailable API,
establish the deployment checks above.

The later [direct-example publication](example.md) adds the unchanged native CSV
to the public sample assets and landing actions. Its separate source/deployment,
37-file HTTP check and four public workflows retain the new route's evidence;
the earlier checks above keep their original scope.
