// Synthetic throughput control, not a captured game benchmark. Run with --expose-gc.
import { existsSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import os from 'node:os';
const [beforeRoot, afterRoot, output] = process.argv.slice(2);
async function parser(root) {
  root = resolve(root);
  const ext = existsSync(join(root, 'core/streams.ts')) ? 'ts' : 'js';
  return (await import(pathToFileURL(join(root, `core/parsers/presentmon2.${ext}`)).href)).parse;
}
const parsers = { before: await parser(beforeRoot), after: await parser(afterRoot) };
const result = { node: process.version, platform: os.platform(), release: os.release(),
  cpus: os.availableParallelism(), totalMemoryBytes: os.totalmem(), rows: 430000, repetitions: 5,
  procedure: 'One unrecorded full warmup per runtime/profile. Alternating runtime order each repetition. Explicit GC before each timed parse. CSV generation excluded; metrics excluded.', profiles: [] };
if (typeof global.gc !== 'function') throw new Error('Run node --expose-gc');
for (const pid of [true, false]) for (const interleaved of [false, true]) {
  const header = `Application,${pid ? 'ProcessID,' : ''}SwapChainAddress,FrameTime,CPUBusy,GPUBusy\n`;
  const game = `game.exe,${pid ? '1,' : ''}0x1,10,3,4\n`;
  const other = `dwm.exe,${pid ? '2,' : ''}0x1,40,4,5\n`;
  const csv = header + (interleaved ? (game+other).repeat(result.rows/2) : game.repeat(result.rows));
  const samples = { before: [], after: [] };
  const frames = {};
  for (const parse of Object.values(parsers)) parse(csv, 'synthetic.csv');
  for (let rep = 0; rep < result.repetitions; rep++) {
    for (const name of rep % 2 ? ['after', 'before'] : ['before', 'after']) {
      global.gc();
      const start = performance.now();
      const series = parsers[name](csv, 'synthetic.csv');
      samples[name].push(performance.now()-start);
      frames[name] = series.frameCount;
    }
  }
  const mediansMs = Object.fromEntries(Object.entries(samples).map(([k, v]) => [k, [...v].sort((a,b) => a-b)[2]]));
  result.profiles.push({ pid, interleaved, bytes: Buffer.byteLength(csv), selectedFrames: frames, samplesMs: samples, mediansMs });
}
writeFileSync(output, JSON.stringify(result, null, 2)+'\n');
console.log(JSON.stringify(result.profiles.map(p=>({ pid:p.pid, interleaved:p.interleaved, mediansMs:p.mediansMs }))));
