#!/usr/bin/env node
/**
 * Generates synthetic capture files in every format stutterscope parses,
 * all built from one shared, deterministic frame-time scenario so the
 * "same" run can be compared across tools. Every output file is clearly
 * labelled synthetic (in its Application/GameName field and in
 * examples/manifest.json) — none of this is real hardware telemetry.
 *
 * Run with: npm run samples
 *
 * The scenario walks through patterns real captures actually show:
 *   1. vsync-locked menu (tight, steady 60 fps pacing)
 *   2. a shader-compilation hitch on entering gameplay
 *   3. open-world traversal: VRR-style smooth variable frame time, with
 *      periodic streaming/traversal stutter
 *   4. a second, larger shader-compile hitch (new area load)
 *   5. a CPU-bound section (CPUBusy close to FrameTime, GPUBusy well under)
 *   6. a cluster of traversal-stutter hitches
 *   7. a GPU-bound, vsync-mismatched section with classic frame-time
 *      sawtooth pacing (alternating ~16.7ms/~33.3ms)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const examplesDir = join(here, "..", "examples");

// --- deterministic PRNG (mulberry32) so regenerating gives byte-identical output ---
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(0x53545554); // "STUT"
const gaussian = (mean: number, stddev: number): number => {
  const u1 = 1 - rng();
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z * stddev;
};

export interface SyntheticFrame {
  frameTimeMs: number;
  cpuBusyMs: number;
  gpuBusyMs: number;
  dropped: boolean;
  displayLatencyMs: number;
}

function buildScenario(): SyntheticFrame[] {
  const frames: SyntheticFrame[] = [];
  const push = (frameTimeMs: number, cpuFrac: number, gpuFrac: number, dropped = false) => {
    const ft = Math.max(1, frameTimeMs);
    frames.push({
      frameTimeMs: ft,
      cpuBusyMs: ft * cpuFrac,
      gpuBusyMs: ft * gpuFrac,
      dropped,
      displayLatencyMs: ft * 2 + gaussian(0, 1),
    });
  };

  // 1. vsync-locked menu: ~1500 frames at a tight 60 fps.
  for (let i = 0; i < 1500; i++) push(gaussian(16.6667, 0.15), 0.35, 0.45);

  // 2. shader-compilation hitch entering gameplay.
  push(420 + gaussian(0, 20), 0.9, 0.1);
  for (let i = 0; i < 3; i++) push(gaussian(20, 2), 0.4, 0.5);

  // 3. open-world traversal: VRR-style smooth 90-165 fps variation with
  //    periodic streaming stutter roughly every 150 frames.
  for (let i = 0; i < 2480; i++) {
    if (i % 151 === 0 && i > 0) {
      push(gaussian(28, 4), 0.45, 0.55, rng() < 0.1);
    } else {
      push(gaussian(7.8, 1.1), 0.4, 0.5);
    }
  }

  // 4. a bigger shader-compile hitch loading a new area.
  push(650 + gaussian(0, 40), 0.92, 0.08, true);
  for (let i = 0; i < 4; i++) push(gaussian(22, 3), 0.4, 0.5);

  // 5. CPU-bound section: ~80 fps, CPU busy dominates.
  for (let i = 0; i < 1980; i++) push(gaussian(12.4, 1.4), 0.86, 0.5);

  // 6. a cluster of traversal-stutter hitches.
  for (let i = 0; i < 50; i++) {
    push(i % 6 === 0 ? gaussian(32, 5) : gaussian(9, 1.2), 0.42, 0.52, i % 6 === 0 && rng() < 0.2);
  }

  // 7. GPU-bound, vsync-mismatched section: classic sawtooth pacing.
  for (let i = 0; i < 1950; i++) {
    const sawtooth = i % 2 === 0 ? 16.6667 : 33.3333;
    push(sawtooth + gaussian(0, 0.3), 0.3, 0.92);
  }

  return frames;
}

// --- per-format CSV writers ---

const APP_NAME = "stutterscope-synthetic-demo.exe";

function header(cols: string[]): string {
  return cols.join(",");
}

function writePresentMon1(frames: SyntheticFrame[]): string {
  const lines = [
    header([
      "Application",
      "ProcessID",
      "SwapChainAddress",
      "Runtime",
      "SyncInterval",
      "PresentFlags",
      "Dropped",
      "TimeInSeconds",
      "msInPresentAPI",
      "msBetweenPresents",
      "AllowsTearing",
      "PresentMode",
      "msUntilRenderComplete",
      "msUntilDisplayed",
      "msBetweenDisplayChange",
      "msFlipDelay",
      "msUntilRenderStart",
      "msGPUActive",
      "msGPUVideoActive",
      "msSinceInput",
      "QPCTime",
    ]),
  ];
  let t = 0;
  frames.forEach((f, i) => {
    t += f.frameTimeMs / 1000;
    lines.push(
      [
        APP_NAME,
        4242,
        "0x000001",
        "DXGI",
        0,
        0,
        f.dropped ? 1 : 0,
        t.toFixed(6),
        (f.frameTimeMs * 0.02).toFixed(3),
        f.frameTimeMs.toFixed(3),
        0,
        "Hardware: Independent Flip",
        (f.gpuBusyMs * 0.9).toFixed(3),
        f.dropped ? "0.000" : f.frameTimeMs.toFixed(3),
        f.frameTimeMs.toFixed(3),
        "0.000",
        (-f.frameTimeMs * 0.1).toFixed(3),
        f.gpuBusyMs.toFixed(3),
        "0.000",
        "0.000",
        10000 * i,
      ].join(","),
    );
  });
  return lines.join("\n") + "\n";
}

function writePresentMon2(frames: SyntheticFrame[]): string {
  const lines = [
    header([
      "Application",
      "ProcessID",
      "SwapChainAddress",
      "PresentRuntime",
      "SyncInterval",
      "PresentFlags",
      "AllowsTearing",
      "PresentMode",
      "FrameType",
      "CPUStartQPC",
      "FrameTime",
      "CPUBusy",
      "CPUWait",
      "GPULatency",
      "GPUTime",
      "GPUBusy",
      "GPUWait",
      "VideoBusy",
      "DisplayLatency",
      "DisplayedTime",
      "AnimationError",
      "AnimationTime",
      "MsFlipDelay",
      "AllInputToPhotonLatency",
      "ClickToPhotonLatency",
      "InstrumentedLatency",
    ]),
  ];
  frames.forEach((f, i) => {
    lines.push(
      [
        APP_NAME,
        4242,
        "0x000001",
        "DXGI",
        0,
        0,
        0,
        "Hardware: Independent Flip",
        "Application",
        10000 * i,
        f.frameTimeMs.toFixed(4),
        f.cpuBusyMs.toFixed(4),
        (f.frameTimeMs - f.cpuBusyMs).toFixed(4),
        (f.gpuBusyMs * 0.1).toFixed(4),
        f.gpuBusyMs.toFixed(4),
        f.gpuBusyMs.toFixed(4),
        (f.frameTimeMs - f.gpuBusyMs).toFixed(4),
        "0.0000",
        f.displayLatencyMs.toFixed(4),
        f.dropped ? "NA" : f.frameTimeMs.toFixed(4),
        "NA",
        "NA",
        "NA",
        "NA",
        "NA",
        "NA",
      ].join(","),
    );
  });
  return lines.join("\n") + "\n";
}

function writeOcatLike(frames: SyntheticFrame[], withMetadataComment: boolean): string {
  const dataHeader = header([
    "Application",
    "ProcessID",
    "SwapChainAddress",
    "Runtime",
    "SyncInterval",
    "PresentFlags",
    "AllowsTearing",
    "PresentMode",
    "WasBatched",
    "DwmNotified",
    "Dropped",
    "TimeInSeconds",
    "MsBetweenPresents",
    "MsBetweenDisplayChange",
    "MsInPresentAPI",
    "MsUntilRenderComplete",
    "MsUntilDisplayed",
  ]);
  const lines: string[] = [];
  if (withMetadataComment) {
    lines.push(
      "//GameName=stutterscope-synthetic-demo.exe",
      "//ProcessName=stutterscope synthetic demo",
      "//CreationDate=2026-09-24",
      "//CreationTime=00:00:00",
      "//RecordTime=" + (frames.reduce((s, f) => s + f.frameTimeMs, 0) / 1000).toFixed(0),
      "//Comment=Synthetic data generated by scripts/generate-samples.ts, not a real capture",
    );
  }
  lines.push(dataHeader);
  let t = 0;
  frames.forEach((f) => {
    t += f.frameTimeMs / 1000;
    lines.push(
      [
        APP_NAME,
        4242,
        "0x000001",
        "DXGI",
        0,
        0,
        0,
        "Hardware: Independent Flip",
        0,
        0,
        f.dropped ? 1 : 0,
        t.toFixed(6),
        f.frameTimeMs.toFixed(3),
        f.frameTimeMs.toFixed(3),
        (f.frameTimeMs * 0.02).toFixed(3),
        (f.gpuBusyMs * 0.9).toFixed(3),
        f.dropped ? "0.000" : f.frameTimeMs.toFixed(3),
      ].join(","),
    );
  });
  return lines.join("\n") + "\n";
}

function writeFrameView(frames: SyntheticFrame[]): string {
  const lines = [
    header([
      "Application",
      "GPU",
      "CPU",
      "Resolution",
      "Runtime",
      "AllowsTearing",
      "ProcessID",
      "SwapChainAddress",
      "SyncInterval",
      "PresentFlags",
      "PresentMode",
      "Dropped",
      "TimeInSeconds",
      "MsBetweenPresents",
      "MsBetweenDisplayChange",
      "MsInPresentAPI",
      "MsRenderPresentLatency",
      "MsUntilDisplayed",
      "MsPCLatency",
      "GPU0Clk(MHz)",
      "GPU0MemClk(MHz)",
      "GPU0Util(%)",
      "GPU0Temp(C)",
      "CPUClk(MHz)",
      "CPUUtil(%)",
    ]),
  ];
  let t = 0;
  frames.forEach((f) => {
    t += f.frameTimeMs / 1000;
    const gpuUtil = Math.min(100, Math.round((f.gpuBusyMs / f.frameTimeMs) * 100));
    const cpuUtil = Math.min(100, Math.round((f.cpuBusyMs / f.frameTimeMs) * 100));
    lines.push(
      [
        "stutterscope-synthetic-demo",
        "Synthetic GPU (not real hardware)",
        "Synthetic CPU (not real hardware)",
        "2560x1440",
        "DXGI",
        0,
        4242,
        "0x000001",
        0,
        0,
        "Hardware: Independent Flip",
        f.dropped ? 1 : 0,
        t.toFixed(6),
        f.frameTimeMs.toFixed(3),
        f.frameTimeMs.toFixed(3),
        (f.frameTimeMs * 0.02).toFixed(3),
        f.frameTimeMs.toFixed(3),
        f.dropped ? "0.000" : f.frameTimeMs.toFixed(3),
        f.displayLatencyMs.toFixed(3),
        1800,
        9500,
        gpuUtil,
        62,
        4200,
        cpuUtil,
      ].join(","),
    );
  });
  return lines.join("\n") + "\n";
}

function writeMangoHud(frames: SyntheticFrame[]): string {
  const lines = [
    "v1",
    "0.8.0-synthetic",
    "---------------------SYSTEM INFO---------------------",
    "os,cpu,gpu,ram,kernel,driver,cpuscheduler",
    "Synthetic Linux (stutterscope demo data),Synthetic CPU,Synthetic GPU,32 GB,6.9.0,1.0.0,schedutil",
    "--------------------FRAME METRICS--------------------",
    "fps,frametime,cpu_load,cpu_power,gpu_load,cpu_temp,gpu_temp,gpu_core_clock,gpu_mem_clock,gpu_vram_used,gpu_power,ram_used,swap_used,process_rss,cpu_mhz,elapsed",
  ];
  let elapsedNs = 0;
  frames.forEach((f) => {
    elapsedNs += f.frameTimeMs * 1e6;
    const fps = 1000 / f.frameTimeMs;
    const cpuLoad = Math.min(100, Math.round((f.cpuBusyMs / f.frameTimeMs) * 100));
    const gpuLoad = Math.min(100, Math.round((f.gpuBusyMs / f.frameTimeMs) * 100));
    lines.push(
      [
        fps.toFixed(2),
        f.frameTimeMs.toFixed(3),
        cpuLoad,
        (35 + cpuLoad * 0.6).toFixed(1),
        gpuLoad,
        58,
        64,
        1800,
        9500,
        "6.2",
        (80 + gpuLoad * 1.5).toFixed(1),
        "9.4",
        "0.0",
        640,
        4200,
        Math.round(elapsedNs),
      ].join(","),
    );
  });
  return lines.join("\n") + "\n";
}

function writeGeneric(frames: SyntheticFrame[]): string {
  const lines = ["frame_index,timestamp_seconds,frame_time_ms,fps"];
  let t = 0;
  frames.forEach((f, i) => {
    t += f.frameTimeMs / 1000;
    lines.push([i, t.toFixed(6), f.frameTimeMs.toFixed(3), (1000 / f.frameTimeMs).toFixed(2)].join(","));
  });
  return lines.join("\n") + "\n";
}

function main(): void {
  mkdirSync(examplesDir, { recursive: true });
  const frames = buildScenario();

  const files: Array<{ name: string; format: string; label: string; contents: string }> = [
    {
      name: "presentmon1-synthetic-demo.csv",
      format: "presentmon1",
      label: "PresentMon 1.x",
      contents: writePresentMon1(frames),
    },
    {
      name: "presentmon2-synthetic-demo.csv",
      format: "presentmon2",
      label: "PresentMon 2.x",
      contents: writePresentMon2(frames),
    },
    {
      name: "frameview-synthetic-demo.csv",
      format: "frameview",
      label: "NVIDIA FrameView",
      contents: writeFrameView(frames),
    },
    {
      name: "capframex-synthetic-demo.csv",
      format: "capframex",
      label: "CapFrameX",
      contents: writeOcatLike(frames, true),
    },
    {
      name: "ocat-synthetic-demo.csv",
      format: "ocat",
      label: "OCAT",
      contents: writeOcatLike(frames, false),
    },
    {
      name: "mangohud-synthetic-demo.csv",
      format: "mangohud",
      label: "MangoHud",
      contents: writeMangoHud(frames),
    },
    {
      name: "generic-synthetic-demo.csv",
      format: "generic",
      label: "Generic CSV",
      contents: writeGeneric(frames),
    },
  ];

  const manifest = files.map(({ name, format, label }) => ({
    file: name,
    format,
    label,
    synthetic: true,
    description:
      "Synthetic data generated by scripts/generate-samples.ts: vsync-locked menu, a shader-compile " +
      "hitch, VRR-style open-world traversal with periodic streaming stutter, a second larger hitch, a " +
      "CPU-bound section, a stutter cluster, and a GPU-bound vsync-mismatch sawtooth section.",
    frameCount: frames.length,
  }));

  for (const file of files) {
    writeFileSync(join(examplesDir, file.name), file.contents, "utf-8");
    console.log(`wrote examples/${file.name} (${file.contents.length.toLocaleString()} bytes)`);
  }
  writeFileSync(join(examplesDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf-8");
  console.log(`wrote examples/manifest.json (${files.length} entries, ${frames.length} frames each)`);
}

main();
