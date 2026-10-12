// Replay pinned, unmodified capture bytes through a chosen source or installed tree.
// Results retain metadata, metrics and hashes of every aligned per-frame channel.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const [runtime, output] = process.argv.slice(2);
const root = resolve(runtime);
const ext = existsSync(join(root, 'core/streams.ts')) ? 'ts' : 'js';
const from = path => import(pathToFileURL(join(root, `${path}.${ext}`)).href);
const { createParserFor, detectFormat, generic } = await from('core/parsers/index');
const { decodeText } = await from('core/encoding');
const { parseTextSync, requireFrames } = await from('core/stream');
const { analyzeCapture } = await from('core/analysis');
const { summaryForJson } = await from('core/metrics');
const real = fileURLToPath(new URL('../real-captures/', import.meta.url));
const manifest = JSON.parse(readFileSync(join(real, 'manifest.json'), 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const arrayHash = array => array ? sha(new Uint8Array(array.buffer, array.byteOffset, array.byteLength)) : null;
const results = [];
for (const entry of manifest.files) {
  if (/summary/i.test(entry.path)) continue;
  const bytes = readFileSync(join(real, entry.local));
  if (sha(bytes) !== entry.sha256 || bytes.length !== entry.bytes) throw new Error(`Capture changed: ${entry.path}`);
  const record = { url: entry.url, sha256: entry.sha256, bytes: bytes.length };
  try {
    const text = decodeText(bytes);
    const format = detectFormat(text.slice(0, 65536)).best.format;
    const series = requireFrames(parseTextSync(text, createParserFor(format, format === 'generic' ? generic.guessMapping(text.slice(0, 65536))?.mapping : undefined), entry.path));
    const arrays = Object.fromEntries(['frameTimeMs', 'timeSec', 'sourceLine', 'gapBefore'].map(k => [k, arrayHash(series[k])]));
    for (const [key, value] of Object.entries(series.channels)) arrays[key] = arrayHash(value);
    Object.assign(record, { status: 'parsed', meta: series.meta, arrays,
      summary: summaryForJson(analyzeCapture(series).summary) });
  } catch (error) {
    Object.assign(record, { status: 'refused', reason: error.message });
  }
  results.push(record);
}
writeFileSync(output, JSON.stringify({ node: process.version, results }, null, 2) + '\n');
console.log(JSON.stringify({ files: results.length, parsed: results.filter(r => r.status === 'parsed').length }));
