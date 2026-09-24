import "uplot/dist/uPlot.min.css";
import "./style.css";
import { ParseClient } from "./workerClient.ts";
import type { ResultResponse, NeedsMappingResponse } from "../worker/protocol.ts";
import type { SourceFormat, ParseProgress } from "../core/types.ts";
import { FORMAT_LABELS, SOURCE_FORMATS } from "../core/types.ts";
import { DEFAULT_STUTTER_OPTIONS, frameTimeHistogramPair, type MetricsSummary, type StutterOptions } from "../core/metrics.ts";
import { GENERIC_VALUE_KIND_LABELS, type GenericMapping, type GenericValueKind } from "../core/parsers/generic.ts";
import { buildTiles, renderTiles } from "./statTiles.ts";
import { fmtBytes, fmtFps, fmtInt, fmtMs, fmtSignedPct, deltaClass } from "./format.ts";
import { createFpsChart, createPercentileChart, createTraceChart, drawHistogram, drawHistogramPair, type TraceChartHandle } from "./charts.ts";
import { exportJson, exportMarkdown, exportReportCard } from "./share.ts";

interface RunState {
  response: ResultResponse;
  traceHandle?: TraceChartHandle;
  fpsHandle?: TraceChartHandle;
  file: File;
}

const client = new ParseClient();
const runs: { a?: RunState; b?: RunState } = {};
let stutterOptions: StutterOptions = { ...DEFAULT_STUTTER_OPTIONS };
let pendingMapping: { slot: "a" | "b"; file: File; header: string[]; sniffed: SourceFormat } | null = null;

const app = document.getElementById("app")!;
app.innerHTML = `
  <header class="top-bar">
    <div class="wordmark"><span class="blip" aria-hidden="true"></span>stutterscope<span class="tagline">frame-time analysis, entirely in your browser</span></div>
    <nav>
      <a class="gh-link" href="https://github.com/antonsoo/stutterscope" target="_blank" rel="noopener">source</a>
    </nav>
  </header>
  <main>
    <section id="dropzone-section"></section>
    <section id="workspace-section" hidden></section>
  </main>
  <footer>
    Nothing you drop here is uploaded — parsing and every chart run locally in your browser.
    &middot; <a href="https://github.com/antonsoo/stutterscope">stutterscope</a> is MIT-licensed.
  </footer>
  <dialog id="mapping-dialog" aria-labelledby="mapping-dialog-title">
    <h2 id="mapping-dialog-title">Map columns</h2>
    <p>This doesn't look like a known capture format. Pick which column holds frame timing and what it means.</p>
    <label for="map-column">Value column</label>
    <select id="map-column"></select>
    <label for="map-kind">Column meaning</label>
    <select id="map-kind"></select>
    <div class="dialog-actions">
      <button class="btn" id="map-cancel" type="button">Cancel</button>
      <button class="btn primary" id="map-confirm" type="button">Parse</button>
    </div>
  </dialog>
`;

const dropzoneSection = document.getElementById("dropzone-section")!;
const workspaceSection = document.getElementById("workspace-section")!;
const mappingDialog = document.getElementById("mapping-dialog") as HTMLDialogElement;

function renderDropzone(): void {
  dropzoneSection.innerHTML = `
    <div class="bracket-panel dropzone" id="dropzone">
      <span class="bracket-tl"></span><span class="bracket-tr"></span>
      <h1>Drop in a capture. See the stutter.</h1>
      <p>PresentMon, FrameView, CapFrameX, MangoHud, and OCAT CSVs are auto-detected. Everything runs locally — nothing leaves your browser.</p>
      <div class="formats">
        ${SOURCE_FORMATS.filter((f) => f !== "generic")
          .map((f) => `<span class="format-chip">${FORMAT_LABELS[f]}</span>`)
          .join("")}
        <span class="format-chip">Generic CSV</span>
      </div>
      <div class="dropzone-cta">
        <button class="btn primary" type="button" id="choose-file-btn">Choose file&hellip;</button>
        <input type="file" id="file-input" accept=".csv,.txt" />
      </div>
      <div class="samples-row">
        or load a synthetic sample:
        ${SOURCE_FORMATS.map((f) => `<button class="sample-link" data-format="${f}" type="button">${FORMAT_LABELS[f]}</button>`).join(" ")}
      </div>
    </div>
    <div id="status-area"></div>
  `;

  const dz = document.getElementById("dropzone")!;
  const fileInput = document.getElementById("file-input") as HTMLInputElement;
  document.getElementById("choose-file-btn")!.addEventListener("click", () => fileInput.click());
  // Clicking anywhere in the panel is a mouse/touch convenience on top of
  // the real, properly-labeled "Choose file…" button below — the panel
  // itself isn't a focusable control (a large role="button" wrapping other
  // real buttons is an ARIA anti-pattern: nested interactive controls).
  dz.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest(".sample-link, #choose-file-btn")) return;
    fileInput.click();
  });
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (file) void loadFile("a", file);
  });
  dz.addEventListener("dragover", (e) => {
    e.preventDefault();
    dz.classList.add("dragover");
  });
  dz.addEventListener("dragleave", () => dz.classList.remove("dragover"));
  dz.addEventListener("drop", (e) => {
    e.preventDefault();
    dz.classList.remove("dragover");
    const file = e.dataTransfer?.files?.[0];
    if (file) void loadFile("a", file);
  });

  dz.querySelectorAll<HTMLButtonElement>(".sample-link").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      void loadSample(btn.dataset["format"] as SourceFormat);
    });
  });
}

async function loadSample(format: SourceFormat): Promise<void> {
  const manifestUrl = `${import.meta.env.BASE_URL}samples/manifest.json`;
  const manifest = (await (await fetch(manifestUrl)).json()) as Array<{ file: string; format: string }>;
  const entry = manifest.find((m) => m.format === format);
  if (!entry) return;
  const res = await fetch(`${import.meta.env.BASE_URL}samples/${entry.file}`);
  const blob = await res.blob();
  const file = new File([blob], entry.file, { type: "text/csv" });
  await loadFile("a", file);
}

function setStatus(html: string): void {
  const area = document.getElementById("status-area");
  if (area) area.innerHTML = html;
}

async function loadFile(slot: "a" | "b", file: File, formatOverride?: SourceFormat, genericMapping?: GenericMapping): Promise<void> {
  setStatus(`
    <div class="status-line">
      <span>parsing ${escapeHtml(file.name)}&hellip;</span>
      <div class="progress-track"><div class="progress-fill" id="progress-fill"></div></div>
      <span id="progress-text"></span>
    </div>
  `);
  try {
    const outcome = await client.parse(slot, file, {
      formatOverride,
      genericMapping,
      stutterOptions,
      onProgress: (p: ParseProgress) => {
        const fill = document.getElementById("progress-fill");
        const text = document.getElementById("progress-text");
        const pct = p.totalBytes > 0 ? Math.min(100, (p.bytesRead / p.totalBytes) * 100) : 0;
        if (fill) fill.style.width = `${pct.toFixed(0)}%`;
        if (text) text.textContent = `${fmtInt(p.rowsParsed)} rows`;
      },
    });

    if (outcome.kind === "needsMapping") {
      const resp: NeedsMappingResponse = outcome.response;
      pendingMapping = { slot, file, header: resp.header, sniffed: resp.sniffedFormat };
      openMappingDialog(resp.header);
      setStatus("");
      return;
    }

    setStatus("");
    runs[slot] = { response: outcome.response, file };
    renderWorkspace();
  } catch (err) {
    setStatus(`<div class="error-box">Could not parse ${escapeHtml(file.name)}: ${escapeHtml(err instanceof Error ? err.message : String(err))}</div>`);
  }
}

function openMappingDialog(header: string[]): void {
  const columnSelect = document.getElementById("map-column") as HTMLSelectElement;
  const kindSelect = document.getElementById("map-kind") as HTMLSelectElement;
  columnSelect.innerHTML = header.map((h) => `<option value="${escapeHtml(h)}">${escapeHtml(h)}</option>`).join("");
  kindSelect.innerHTML = Object.entries(GENERIC_VALUE_KIND_LABELS)
    .map(([k, label]) => `<option value="${k}">${escapeHtml(label)}</option>`)
    .join("");
  mappingDialog.showModal();
}

document.getElementById("map-cancel")!.addEventListener("click", () => {
  mappingDialog.close();
  pendingMapping = null;
});
document.getElementById("map-confirm")!.addEventListener("click", () => {
  if (!pendingMapping) return;
  const columnSelect = document.getElementById("map-column") as HTMLSelectElement;
  const kindSelect = document.getElementById("map-kind") as HTMLSelectElement;
  const mapping = { valueColumn: columnSelect.value, valueKind: kindSelect.value as GenericValueKind };
  const { slot, file } = pendingMapping;
  mappingDialog.close();
  pendingMapping = null;
  void loadFile(slot, file, "generic", mapping);
});

function destroyCharts(run?: RunState): void {
  run?.traceHandle?.destroy();
  run?.fpsHandle?.destroy();
}

function renderWorkspace(): void {
  const a = runs.a;
  if (!a) return;
  workspaceSection.hidden = false;
  dropzoneSection.querySelector(".dropzone")?.classList.add("visually-hidden");

  const hasB = !!runs.b;
  workspaceSection.innerHTML = `
    <div class="workspace">
      <div class="run-header">
        <div class="run-meta">
          <span><strong>${escapeHtml(a.file.name)}</strong></span>
          <span>${FORMAT_LABELS[a.response.series.meta.format]}</span>
          <span>${fmtInt(a.response.series.frameCount)} frames</span>
          <span>${fmtMs(a.response.summary.durationSec, 1)} s</span>
          <span>${fmtBytes(a.file.size)}</span>
        </div>
        <div class="run-actions">
          ${!hasB ? `<button class="btn small" id="add-compare-btn" type="button">+ Compare another run</button>` : `<button class="btn small" id="remove-compare-btn" type="button">Remove comparison</button>`}
          <button class="btn small" id="export-png-btn" type="button">Export PNG</button>
          <button class="btn small" id="export-md-btn" type="button">Export Markdown</button>
          <button class="btn small" id="export-json-btn" type="button">Export JSON</button>
          <button class="btn small" id="new-session-btn" type="button">New session</button>
        </div>
      </div>

      ${a.response.series.meta.warnings.length > 0 ? `<div class="notes warn-note">${a.response.series.meta.warnings.length} row(s) skipped while parsing (bad/missing values). See console for detail.</div>` : ""}

      <div class="tile-grid" id="tile-grid-a"></div>

      <div class="bracket-panel chart-panel">
        <span class="bracket-tl"></span><span class="bracket-tr"></span>
        <p class="panel-label">Frame Time Trace <span class="hint">drag to zoom &middot; shift+drag to pan &middot; wheel to zoom &middot; dblclick to reset</span></p>
        <div id="trace-chart" class="trace-sweep" role="img" aria-label="${escapeHtml(chartSummary(a.response.summary))}"></div>
      </div>

      <div class="chart-grid">
        <div class="bracket-panel chart-panel">
          <span class="bracket-tl"></span><span class="bracket-tr"></span>
          <p class="panel-label">FPS Over Time</p>
          <div id="fps-chart" role="img" aria-label="FPS over time for ${escapeHtml(a.file.name)}, ${fmtInt(a.response.series.frameCount)} frames"></div>
        </div>
        <div class="bracket-panel chart-panel">
          <span class="bracket-tl"></span><span class="bracket-tr"></span>
          <p class="panel-label">Frame Time Histogram${hasB ? ' <span class="hint">A = green, B = amber</span>' : ""}</p>
          <canvas id="histogram-canvas" class="histogram-canvas" height="200" role="img" aria-label="Frame time distribution histogram"></canvas>
        </div>
      </div>

      <div class="bracket-panel chart-panel">
        <span class="bracket-tl"></span><span class="bracket-tr"></span>
        <p class="panel-label">Percentile Curve${hasB ? ' <span class="hint">A = green, B = amber</span>' : ""}</p>
        <div id="percentile-chart" role="img" aria-label="Frame time vs percentile curve"></div>
      </div>

      <div class="bracket-panel">
        <span class="bracket-tl"></span><span class="bracket-tr"></span>
        <p class="panel-label">Stutter Detection <span class="hint">frame time &gt; k &times; local median (window radius r); hitch = absolute threshold</span></p>
        <div class="config-row">
          <label>k multiplier <input type="number" id="k-input" min="1.1" max="5" step="0.1" value="${stutterOptions.kMultiplier}" /></label>
          <label>window radius <input type="number" id="radius-input" min="2" max="60" step="1" value="${stutterOptions.windowRadius}" /></label>
          <label>hitch threshold (ms) <input type="number" id="hitch-input" min="5" max="500" step="1" value="${stutterOptions.hitchThresholdMs}" /></label>
        </div>
      </div>

      ${hasB ? `<div class="bracket-panel" id="comparison-panel"><span class="bracket-tl"></span><span class="bracket-tr"></span><p class="panel-label">Comparison</p><div id="comparison-table"></div></div>` : ""}
    </div>
  `;

  renderTiles(document.getElementById("tile-grid-a")!, buildTiles(a.response.summary));

  destroyCharts(a);
  a.traceHandle = createTraceChart(document.getElementById("trace-chart")!, a.response.series.timeSec, a.response.series.frameTimeMs, a.response.chart.isStutter);
  a.fpsHandle = createFpsChart(document.getElementById("fps-chart")!, a.response.series.timeSec, a.response.series.frameTimeMs);

  if (hasB && runs.b) {
    createPercentileChart(document.getElementById("percentile-chart")!, a.response.chart.percentileCurve, runs.b.response.chart.percentileCurve);
    const pair = frameTimeHistogramPair(a.response.series.frameTimeMs, runs.b.response.series.frameTimeMs, 60);
    drawHistogramPair(document.getElementById("histogram-canvas") as HTMLCanvasElement, pair);
    renderComparisonTable(a, runs.b);
  } else {
    createPercentileChart(document.getElementById("percentile-chart")!, a.response.chart.percentileCurve);
    drawHistogram(document.getElementById("histogram-canvas") as HTMLCanvasElement, a.response.chart.histogram);
  }

  wireWorkspaceControls();
}

function renderComparisonTable(a: RunState, b: RunState): void {
  const sa = a.response.summary;
  const sb = b.response.summary;
  const rows: Array<{ label: string; av: number; bv: number; fmt: (n: number) => string; higherBetter: boolean }> = [
    { label: "Average FPS", av: sa.averageFps, bv: sb.averageFps, fmt: (n) => fmtFps(n), higherBetter: true },
    { label: "1% Low (percentile)", av: sa.onePercentLow.percentileMethodFps, bv: sb.onePercentLow.percentileMethodFps, fmt: (n) => fmtFps(n), higherBetter: true },
    { label: "0.1% Low (percentile)", av: sa.pointOnePercentLow.percentileMethodFps, bv: sb.pointOnePercentLow.percentileMethodFps, fmt: (n) => fmtFps(n), higherBetter: true },
    { label: "P99 frame time", av: sa.percentilesMs.p99, bv: sb.percentilesMs.p99, fmt: (n) => `${fmtMs(n)} ms`, higherBetter: false },
    { label: "Stutter events", av: sa.stutter.stutterEventCount, bv: sb.stutter.stutterEventCount, fmt: (n) => fmtInt(n), higherBetter: false },
    { label: "Hitches (>50ms)", av: sa.stutter.hitchCount, bv: sb.stutter.hitchCount, fmt: (n) => fmtInt(n), higherBetter: false },
    { label: "Pacing (MASD)", av: sa.masdMs, bv: sb.masdMs, fmt: (n) => `${fmtMs(n)} ms`, higherBetter: false },
  ];

  const html = `
    <table class="delta-table">
      <thead>
        <tr>
          <th>Metric</th>
          <th><span class="run-swatch" style="background:#7cffb2"></span>${escapeHtml(a.file.name)}</th>
          <th><span class="run-swatch" style="background:#ffb454"></span>${escapeHtml(b.file.name)}</th>
          <th>Δ (B vs A)</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map((r) => {
            const delta = r.av !== 0 ? (r.bv - r.av) / Math.abs(r.av) : 0;
            const cls = deltaClass(delta, r.higherBetter);
            return `<tr>
              <td>${escapeHtml(r.label)}</td>
              <td class="num">${r.fmt(r.av)}</td>
              <td class="num">${r.fmt(r.bv)}</td>
              <td class="num ${cls}">${fmtSignedPct(delta)}</td>
            </tr>`;
          })
          .join("")}
      </tbody>
    </table>
  `;
  const el = document.getElementById("comparison-table");
  if (el) el.innerHTML = html;
}

function wireWorkspaceControls(): void {
  document.getElementById("new-session-btn")?.addEventListener("click", () => {
    destroyCharts(runs.a);
    destroyCharts(runs.b);
    runs.a = undefined;
    runs.b = undefined;
    workspaceSection.hidden = true;
    workspaceSection.innerHTML = "";
    dropzoneSection.querySelector(".dropzone")?.classList.remove("visually-hidden");
    renderDropzone();
  });

  document.getElementById("add-compare-btn")?.addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,.txt";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file) void loadFile("b", file);
    });
    input.click();
  });

  document.getElementById("remove-compare-btn")?.addEventListener("click", () => {
    destroyCharts(runs.b);
    runs.b = undefined;
    renderWorkspace();
  });

  document.getElementById("export-png-btn")?.addEventListener("click", () => {
    if (runs.a) exportReportCard(runs.a.response.series, runs.a.response.summary);
  });
  document.getElementById("export-md-btn")?.addEventListener("click", () => {
    if (runs.a) exportMarkdown(runs.a.response.series, runs.a.response.summary);
  });
  document.getElementById("export-json-btn")?.addEventListener("click", () => {
    if (runs.a) exportJson(runs.a.response.series, runs.a.response.summary);
  });

  const kInput = document.getElementById("k-input") as HTMLInputElement | null;
  const radiusInput = document.getElementById("radius-input") as HTMLInputElement | null;
  const hitchInput = document.getElementById("hitch-input") as HTMLInputElement | null;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  const onConfigChange = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => void applyStutterOptions(), 200);
  };
  kInput?.addEventListener("input", onConfigChange);
  radiusInput?.addEventListener("input", onConfigChange);
  hitchInput?.addEventListener("input", onConfigChange);

  async function applyStutterOptions(): Promise<void> {
    stutterOptions = {
      kMultiplier: Number(kInput?.value) || DEFAULT_STUTTER_OPTIONS.kMultiplier,
      windowRadius: Number(radiusInput?.value) || DEFAULT_STUTTER_OPTIONS.windowRadius,
      hitchThresholdMs: Number(hitchInput?.value) || DEFAULT_STUTTER_OPTIONS.hitchThresholdMs,
    };
    for (const slot of ["a", "b"] as const) {
      const run = runs[slot];
      if (!run) continue;
      const outcome = await client.recompute(slot, stutterOptions);
      if (outcome.kind === "result") run.response = outcome.response;
    }
    renderWorkspace();
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** A short text summary of the trace chart, for the aria-label a screen reader announces instead of the canvas. */
function chartSummary(summary: MetricsSummary): string {
  return (
    `Frame time trace over ${fmtMs(summary.durationSec, 0)} seconds, ` +
    `average ${fmtFps(summary.averageFps)} fps, ` +
    `${fmtInt(summary.stutter.stutterEventCount)} stutter events, ` +
    `P99 frame time ${fmtMs(summary.percentilesMs.p99)} ms`
  );
}

renderDropzone();
