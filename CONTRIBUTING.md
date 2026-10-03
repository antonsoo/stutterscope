# Contributing

Issues and PRs are welcome.

```bash
git clone https://github.com/antonsoo/stutterscope.git
cd stutterscope
npm install
npm run dev       # local dev server
npm test          # vitest
npm run typecheck # tsc --noEmit
npm run lint      # eslint
npm run build     # production build to dist/
npm run test:browser # production build + Chromium/Firefox workflows
```

For browser checks, install the engines once with
`npx playwright install chromium firefox` (CI also uses `--with-deps`).
`tests/browser/` covers cancellation, settings, error recovery, exports,
chart cleanup and resizing, and accessibility. Run these checks when changing
the UI or worker protocol. Run CI's checks locally when Actions is unavailable.

## Adding a parser

Parsers live in `src/core/parsers/`. Each one exports a `sniff(text)` function
that returns a confidence score for whether a file matches its format, and a
`parse(text, onProgress?)` function that returns a `FrameSeries` (see
`src/core/types.ts`). Add fixtures under `tests/fixtures/<format>/` and a test
in `tests/core/parsers.test.ts` before wiring the format into the detector in
`src/core/parsers/index.ts`.

## Adding a metric

Metrics are pure functions in `src/core/metrics.ts` that take a `FrameSeries`
and return numbers. Add a hand-computed case and, where practical, an
oracle-checked case (see `scripts/oracle.py`) to `tests/core/metrics.test.ts`.

## Style

- TypeScript strict mode, no `any` outside of narrow, commented escape hatches.
- Keep `src/core` free of DOM/worker/UI imports so it stays usable as a library.
- Run `npm run lint && npm run typecheck && npm test` before opening a PR.

## Community and private reports

Please follow the [Code of Conduct](CODE_OF_CONDUCT.md). Anton Soloviev
maintains this project and handles conduct reports at
[anton@praviel.com](mailto:anton@praviel.com).

Use the bug or improvement forms for public issues. For a suspected security
vulnerability or a conduct concern, email the maintainer privately with the
repository name and relevant details. Do not post credentials, personal data,
private logs, or confidential documents in a public issue.
