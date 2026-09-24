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
```

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
