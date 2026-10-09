// Reads the chosen source tree (or installed dist-cli), never an implicit checkout import.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

const [source, jobsFile, output] = process.argv.slice(2);
const root = resolve(source);
const extension = existsSync(join(root, "core/metrics.ts")) ? "ts" : "js";
const from = (path) => import(pathToFileURL(join(root, `${path}.${extension}`)).href);
const { createParserFor, detectFormat } = await from("core/parsers/index");
const { parseTextSync } = await from("core/stream");
const { decodeText } = await from("core/encoding");
const { computeMetricsSummary, summaryForJson } = await from("core/metrics");
const results = [];
for (const job of JSON.parse(readFileSync(jobsFile, "utf8"))) {
  const text = decodeText(readFileSync(job.path));
  const format = job.format || detectFormat(text.slice(0, 65536)).best.format;
  const start = performance.now();
  const series = parseTextSync(text, createParserFor(format, job.mapping, { stream: job.stream }), job.id);
  const summary = summaryForJson(computeMetricsSummary(series));
  results.push({ id: job.id, format, selectedStream: series.meta.selectedStream,
    summary, skippedRows: series.meta.skippedRows, milliseconds: performance.now() - start });
}
writeFileSync(output, JSON.stringify({ node: process.version, results }, null, 2) + "\n");
