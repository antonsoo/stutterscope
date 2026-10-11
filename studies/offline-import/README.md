# The first local import must not need another script download

The deployed `b1c33fd` build could analyze and export an already loaded capture
offline, but its first local import still needed `parse.worker-BHlrI1vH.js`.
Fresh Chromium and Firefox contexts opened the public app, disconnected, then
selected the four-frame telemetry fixture. Both showed **The capture worker
stopped unexpectedly** instead of an analysis. The actual hosted observations,
failed worker URL and page text are retained in [hosted-before.json](hosted-before.json).

The parser now travels with the initial application script, using Vite's
[inline worker import](https://vite.dev/guide/features#web-workers). Each slot
still starts its own worker; replacement and cancellation still terminate that
worker and its cache. The production Content Security Policy permits these
local worker blobs. It does not add external script/connect origins, inline
page scripts or `eval` permissions.

This makes local imports independent of a later asset request. It also avoids
depending on an older worker filename remaining hosted when an open tab imports
its next file after a deployment.

## Reproduce

After installing development dependencies and Playwright browsers:

```sh
npm run build
npx playwright test tests/browser/offline-import.spec.js \
  tests/browser/app.spec.js --grep 'first local import|worker startup failure'
```

The two workflows run in fresh contexts, with no warmed worker cache. They
disconnect before any file import, then exercise:

- First local import and JSON export of the partial-telemetry fixture.
- A second independent worker for a cumulative-timestamp file, including its
  column picker and the two real hitch source lines.
- Interval recomputation of A while B's complete metrics stay identical.
- New session, rejected malformed CSV, and replacement with a valid file.
- Markdown export preserving the observed denominator.
- A real worker script that throws at startup, followed by successful retry
  while still offline.

The checker rejects page errors, CSP violations and HTTP requests other than
same-origin font subsets. It attaches the downloaded metrics and observed
requests as `offline-evidence` in the Playwright result. Blob URLs are local
worker resources, not network requests.

## Size and limits

The [bundle receipt](bundle-sizes.json) compares the same source toolchain.
The old initial app was 111,429 bytes and fetched a 31,492-byte worker later.
The new initial app is 143,286 bytes. Default Python gzip gives 49,942 bytes
for the new script, compared with 41,101 plus 9,578 bytes for the old pair.
These exclude CSS, fonts, maps and example captures; they are not loading-time
measurements. Parsing and metric formulas are unchanged.

An already loaded production page is required. This is not a service worker,
an offline installer, or support for navigating to the site with no connection.
Unloaded built-in examples still require their CSV downloads. Font subsets
requested for newly displayed glyphs can fail offline and use system fallbacks;
the workflows do not require those requests to succeed. Capture contents remain
local. The CLI is unaffected, and no npm release is part of this correction.
