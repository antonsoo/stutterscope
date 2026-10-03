import "./fonts/fonts.css";
import "uplot/dist/uPlot.min.css";
import "./style.css";
import { ParseClient, type ParseSource, type Slot } from "./workerClient.ts";
import type { ResultResponse } from "../worker/protocol.ts";
import type { SourceFormat, ParseProgress } from "../core/types.ts";
import { FORMAT_LABELS, SOURCE_FORMATS } from "../core/types.ts";
import { DEFAULT_STUTTER_OPTIONS, frameTimeHistogramPair, type MetricsSummary, type StutterOptions } from "../core/metrics.ts";
import {
  GENERIC_VALUE_KIND_LABELS,
  type GenericMapping,
  type GenericValueKind,
  type MappingGuess,
} from "../core/parsers/generic.ts";
import { buildTiles, renderTiles, renderSecondaryTable } from "./statTiles.ts";
import { fmtBytes, fmtFps, fmtInt, fmtMs, fmtSignedPct, deltaClass, relativeDelta } from "./format.ts";
import { describeStream } from "../core/streams.ts";
import { createFpsChart, createPercentileChart, createTraceChart, drawHistogram, drawHistogramPair, type TraceChartHandle, type TraceChartControls } from "./charts.ts";
import { exportJson, exportMarkdown, exportReportCard } from "./share.ts";
import { readStutterOptions } from "./settings.ts";

interface RunState {
  response: ResultResponse;
  file: File;
  source: ParseSource;
  stutterOptions: StutterOptions;
}

interface ImportRequest { slot: Slot; version: number; controller: AbortController }

const client = new ParseClient();
const runs: { a?: RunState; b?: RunState } = {};
let stutterOptions: StutterOptions = { ...DEFAULT_STUTTER_OPTIONS };
let pendingMapping: { request: ImportRequest; file: File } | null = null;
const versions: Record<Slot, number> = { a: 0, b: 0 };
const imports = new Map<Slot, ImportRequest>();
const retryActions: Partial<Record<Slot, () => void>> = {};
let settingsGeneration = 0;
let applyingSettings = false;
let settingsDraft = { k: String(stutterOptions.kMultiplier), radius: String(stutterOptions.windowRadius), hitch: String(stutterOptions.hitchThresholdMs) };
const charts: { trace?: TraceChartControls; fps?: TraceChartHandle; percentile?: TraceChartHandle; histogram?: ResizeObserver } = {};

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
    <p id="map-hint" class="dialog-hint" hidden></p>
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
    if ((e.target as HTMLElement).closest(".sample-link, #choose-file-btn, #file-input")) return;
    fileInput.click();
  });
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
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
  document.getElementById("status-area")!.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-slot]");
    if (!button) return;
    const slot = button.dataset.slot as Slot;
    if (button.dataset.action === "cancel") cancelImport(slot);
    else retryActions[slot]?.();
  });
}

async function loadSample(format: SourceFormat): Promise<void> {
  const request = beginImport("a");
  setStatus(`<div class="status-line" role="status">Loading the ${FORMAT_LABELS[format]} sample… ${cancelButton("a")}</div>`);
  try {
    const manifestUrl = `${import.meta.env.BASE_URL}samples/manifest.json`;
    const manifestResponse = await fetch(manifestUrl, { signal: request.controller.signal });
    if (!manifestResponse.ok) throw new Error(`Sample list returned HTTP ${manifestResponse.status}.`);
    const manifest: unknown = await manifestResponse.json();
    if (!Array.isArray(manifest)) throw new Error("The sample list could not be read.");
    const entry = (manifest as Array<{ file?: unknown; format?: unknown }>).find((m) => m?.format === format);
    if (typeof entry?.file !== "string" || !/^[a-z0-9-]+\.csv$/i.test(entry.file)) throw new Error("This sample is missing from the sample list.");
    const response = await fetch(`${import.meta.env.BASE_URL}samples/${entry.file}`, { signal: request.controller.signal });
    if (!response.ok) throw new Error(`Sample download returned HTTP ${response.status}.`);
    const blob = await response.blob();
    if (!isCurrent(request)) return;
    await loadFile("a", new File([blob], entry.file, { type: "text/csv" }), undefined, undefined, undefined, request);
  } catch (error) {
    if (isCurrent(request)) showImportError("a", `Could not load the sample: ${errorMessage(error)}`, () => void loadSample(format));
  } finally { finishImport(request); }
}

function setStatus(html: string, slot: Slot = "a"): void {
  const area = document.getElementById("status-area");
  if (!area) return;
  let status = area.querySelector<HTMLElement>(`[data-status-slot="${slot}"]`);
  if (!status) {
    status = document.createElement("div");
    status.dataset.statusSlot = slot;
    area.append(status);
  }
  status.innerHTML = html;
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function cancelButton(slot: Slot): string { return `<button class="btn small" data-slot="${slot}" data-action="cancel">Cancel import</button>`; }
function isCurrent(request: ImportRequest): boolean { return versions[request.slot] === request.version; }

function updateBusyControls(): void {
  const busy = imports.size > 0 || applyingSettings;
  document.querySelectorAll<HTMLInputElement | HTMLButtonElement>("#settings-form input, #apply-settings-btn").forEach((control) => { control.disabled = busy; });
}

function beginImport(slot: Slot): ImportRequest {
  imports.get(slot)?.controller.abort();
  client.cancel(slot);
  delete retryActions[slot];
  if (pendingMapping?.request.slot === slot) {
    pendingMapping = null;
    mappingDialog.close();
  }
  settingsGeneration++;
  applyingSettings = false;
  const request = { slot, version: ++versions[slot], controller: new AbortController() };
  imports.set(slot, request);
  updateBusyControls();
  return request;
}

function finishImport(request: ImportRequest): void {
  if (imports.get(request.slot) === request) imports.delete(request.slot);
  updateBusyControls();
}

function cancelImport(slot: Slot): void {
  imports.get(slot)?.controller.abort();
  imports.delete(slot);
  versions[slot]++;
  client.cancel(slot);
  if (pendingMapping?.request.slot === slot) {
    pendingMapping = null;
    mappingDialog.close();
  }
  setStatus(`<div class="status-line" role="status">Run ${slot.toUpperCase()} import cancelled.</div>`, slot);
  updateBusyControls();
}

function showImportError(slot: Slot, message: string, retry: () => void): void {
  retryActions[slot] = retry;
  setStatus(`<div class="error-box" role="alert">${escapeHtml(message)} <button class="btn small" data-slot="${slot}" data-action="retry">Retry import</button></div>`, slot);
}

async function loadFile(
  slot: "a" | "b",
  file: File,
  formatOverride?: SourceFormat,
  genericMapping?: GenericMapping,
  stream?: string,
  request = beginImport(slot),
): Promise<void> {
  if (!isCurrent(request)) return;
  const options = { ...stutterOptions };
  setStatus(`
    <div class="status-line" role="status">
      <span>parsing ${escapeHtml(file.name)}&hellip;</span>
      <div class="progress-track"><div class="progress-fill" id="progress-fill-${slot}"></div></div>
      <span id="progress-text-${slot}"></span>
      ${cancelButton(slot)}
    </div>
  `, slot);
  try {
    const outcome = await client.parse(slot, file, {
      formatOverride,
      genericMapping,
      stream,
      stutterOptions: options,
      onProgress: (p: ParseProgress) => {
        if (!isCurrent(request)) return;
        const fill = document.getElementById(`progress-fill-${slot}`);
        const text = document.getElementById(`progress-text-${slot}`);
        const pct = p.totalBytes > 0 ? Math.min(100, (p.bytesRead / p.totalBytes) * 100) : 0;
        if (fill) fill.style.width = `${pct.toFixed(0)}%`;
        if (text) text.textContent = `${fmtInt(p.rowsParsed)} rows`;
      },
    });
    if (!isCurrent(request)) return;

    if (outcome.kind === "needsMapping") {
      pendingMapping = { request, file };
      openMappingDialog(outcome.response.header, outcome.response.suggested);
      setStatus("", slot);
      return;
    }

    setStatus("", slot);
    runs[slot] = {
      response: outcome.response, file, stutterOptions: options,
      source: { file, formatOverride: outcome.response.series.meta.format, genericMapping, stream: outcome.response.series.meta.selectedStream ?? stream },
    };
    renderWorkspace();
  } catch (err) {
    if (isCurrent(request)) showImportError(slot, `Could not parse ${file.name}: ${errorMessage(err)}`, () => void loadFile(slot, file, formatOverride, genericMapping, stream));
  } finally { finishImport(request); }
}

function openMappingDialog(header: string[], suggested?: MappingGuess): void {
  const columnSelect = document.getElementById("map-column") as HTMLSelectElement;
  const kindSelect = document.getElementById("map-kind") as HTMLSelectElement;
  const hint = document.getElementById("map-hint") as HTMLParagraphElement;
  columnSelect.innerHTML = header.map((h) => `<option value="${escapeHtml(h)}">${escapeHtml(h)}</option>`).join("");
  kindSelect.innerHTML = Object.entries(GENERIC_VALUE_KIND_LABELS)
    .map(([k, label]) => `<option value="${k}">${escapeHtml(label)}</option>`)
    .join("");
  if (suggested) {
    // The header said which column it is: offer that one, and say why, so it can be checked.
    columnSelect.value = suggested.mapping.valueColumn;
    kindSelect.value = suggested.mapping.valueKind;
    hint.textContent = `Filled in from the file: ${suggested.reason}. Change it if that's wrong.`;
  }
  hint.hidden = !suggested;
  mappingDialog.showModal();
}

document.getElementById("map-cancel")!.addEventListener("click", () => {
  if (pendingMapping) cancelImport(pendingMapping.request.slot);
});
mappingDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  if (pendingMapping) cancelImport(pendingMapping.request.slot);
});
document.getElementById("map-confirm")!.addEventListener("click", () => {
  if (!pendingMapping) return;
  const columnSelect = document.getElementById("map-column") as HTMLSelectElement;
  const kindSelect = document.getElementById("map-kind") as HTMLSelectElement;
  const mapping = { valueColumn: columnSelect.value, valueKind: kindSelect.value as GenericValueKind };
  const { request, file } = pendingMapping;
  mappingDialog.close();
  pendingMapping = null;
  if (isCurrent(request)) void loadFile(request.slot, file, "generic", mapping);
});

function destroyCharts(): void {
  charts.trace?.destroy();
  charts.fps?.destroy();
  charts.percentile?.destroy();
  charts.histogram?.disconnect();
  for (const key of Object.keys(charts) as Array<keyof typeof charts>) delete charts[key];
}

function renderWorkspace(): void {
  const a = runs.a;
  if (!a) return;
  const focusedId = (document.activeElement as HTMLElement | null)?.id;
  destroyCharts();
  workspaceSection.hidden = false;
  dropzoneSection.querySelector(".dropzone")?.setAttribute("hidden", "");

  const hasB = !!runs.b;
  workspaceSection.innerHTML = `
    <div class="workspace">
      <div class="run-header">
        <div class="run-meta">
          <h1 class="run-title"><strong>${escapeHtml(a.file.name)}</strong></h1>
          <span>${FORMAT_LABELS[a.response.series.meta.format]}</span>
          <span>${fmtInt(a.response.series.frameCount)} ${a.response.series.frameCount === 1 ? "frame" : "frames"}</span>
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

      ${warningsNote(a)}
      ${streamNote("a", a)}
      ${hasB && runs.b ? streamNote("b", runs.b) : ""}
      ${hasB && runs.b ? warningsNote(runs.b, "Run B") : ""}

      <div class="tile-grid" id="tile-grid-a"></div>
      <div class="bracket-panel secondary-panel" id="secondary-panel-a">
        <span class="bracket-tl"></span><span class="bracket-tr"></span>
        <p class="panel-label">More Metrics <span class="hint">hover a tile above for its full definition</span></p>
        <div id="secondary-table-a"></div>
      </div>

      <div class="bracket-panel chart-panel">
        <span class="bracket-tl"></span><span class="bracket-tr"></span>
        <p class="panel-label">Frame Time Trace <span class="hint">drag to zoom &middot; shift+drag to pan &middot; wheel to zoom &middot; dblclick to reset</span>
          <button class="btn small range-toggle" id="range-toggle-btn" type="button" aria-pressed="false">Full range</button>
        </p>
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
          <p class="panel-label">Frame Time Histogram <span class="hint">${hasB ? "A = green, B = amber &middot; " : ""}P99 / P99.9 markers</span></p>
          <canvas id="histogram-canvas" class="histogram-canvas" role="img" aria-label="Frame time distribution histogram"></canvas>
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
        <form id="settings-form" novalidate>
          <div class="config-row">
            <label>k multiplier <input type="number" id="k-input" required min="1.1" max="5" step="any" value="${escapeHtml(settingsDraft.k)}" /></label>
            <label>window radius <input type="number" id="radius-input" required min="2" max="60" step="1" value="${escapeHtml(settingsDraft.radius)}" /></label>
            <label>hitch threshold (ms) <input type="number" id="hitch-input" required min="5" max="500" step="any" value="${escapeHtml(settingsDraft.hitch)}" /></label>
            <button class="btn small" id="apply-settings-btn" type="submit">Apply settings</button>
          </div>
          <p class="hint" id="settings-status" role="status">Applied settings: k = ${stutterOptions.kMultiplier}, radius = ${stutterOptions.windowRadius}, hitch &gt; ${stutterOptions.hitchThresholdMs} ms.</p>
          <p class="error-box" id="settings-error" role="alert" hidden></p>
        </form>
      </div>

      ${hasB ? `<div class="bracket-panel" id="comparison-panel"><span class="bracket-tl"></span><span class="bracket-tr"></span><p class="panel-label">Comparison</p><div id="comparison-table" tabindex="0" role="region" aria-label="Run comparison metrics"></div></div>` : ""}
    </div>
  `;

  const tileSet = buildTiles(a.response.summary);
  renderTiles(document.getElementById("tile-grid-a")!, tileSet.headline);
  renderSecondaryTable(document.getElementById("secondary-table-a")!, tileSet.secondary);

  charts.trace = createTraceChart(document.getElementById("trace-chart")!, a.response.series.timeSec, a.response.series.frameTimeMs, a.response.chart.isStutter);
  charts.fps = createFpsChart(document.getElementById("fps-chart")!, a.response.series.timeSec, a.response.series.frameTimeMs);

  const markers = { p99: a.response.summary.percentilesMs.p99, p999: a.response.summary.percentilesMs.p999 };
  const b = runs.b;
  const canvas = document.getElementById("histogram-canvas") as HTMLCanvasElement;
  let draw: () => void;
  if (b) {
    charts.percentile = createPercentileChart(document.getElementById("percentile-chart")!, a.response.chart.percentileCurve, b.response.chart.percentileCurve);
    const pair = frameTimeHistogramPair(a.response.series.frameTimeMs, b.response.series.frameTimeMs, 60);
    draw = () => drawHistogramPair(canvas, pair, markers);
    renderComparisonTable(a, b);
  } else {
    charts.percentile = createPercentileChart(document.getElementById("percentile-chart")!, a.response.chart.percentileCurve);
    draw = () => drawHistogram(canvas, a.response.chart.histogram, markers);
  }
  draw();
  charts.histogram = new ResizeObserver(() => { if (canvas.isConnected) draw(); });
  charts.histogram.observe(canvas);

  wireWorkspaceControls();
  updateBusyControls();
  if (focusedId) document.getElementById(focusedId)?.focus({ preventScroll: true });
}

const MAX_LISTED_WARNINGS = 20;

/** Skipped rows, listed (the first few) rather than just counted, so a bad column is diagnosable. */
function warningsNote(run: RunState, label = "Run A"): string {
  const { warnings, skippedRows } = run.response.series.meta;
  if (skippedRows === 0) return "";
  // The parser describes the first skipped rows and counts the rest.
  const listed = warnings.slice(0, MAX_LISTED_WARNINGS);
  const more = skippedRows > listed.length ? `\n… and ${fmtInt(skippedRows - listed.length)} more` : "";
  const rows = skippedRows === 1 ? "1 row was skipped" : `${fmtInt(skippedRows)} rows were skipped`;
  return `<details class="notes warn-note"><summary>${label}: ${rows}: bad or missing frame time</summary><pre>${listed.map(escapeHtml).join("\n")}${more}</pre></details>`;
}

/**
 * A present-hook capture taken without a process filter holds every process
 * that presented. Only one stream is analysed; say which, and offer the others.
 */
function streamNote(slot: "a" | "b", run: RunState): string {
  const { streams, selectedStream } = run.response.series.meta;
  if (!streams || streams.length < 2) return "";
  const total = streams.reduce((n, st) => n + st.frameCount, 0);
  const options = streams
    .map((st) => `<option value="${escapeHtml(st.id)}"${st.id === selectedStream ? " selected" : ""}>${escapeHtml(describeStream(st))}</option>`)
    .join("");
  const who = slot === "b" ? `Run B (${escapeHtml(run.file.name)})` : "This capture";
  return `
    <div class="notes stream-note">
      <label for="stream-select-${slot}">${who} holds ${streams.length} present streams, ${fmtInt(total)} frames in all. Analysing</label>
      <select id="stream-select-${slot}" class="stream-select" data-slot="${slot}">${options}</select>
      <span class="stream-why">Frames from other processes are left out: mixed in, they would double-count time.</span>
    </div>`;
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
    { label: `Hitches (>${sa.stutter.hitchThresholdMs}ms)`, av: sa.stutter.hitchCount, bv: sb.stutter.hitchCount, fmt: (n) => fmtInt(n), higherBetter: false },
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
            const delta = relativeDelta(r.av, r.bv);
            const cls = deltaClass(delta, r.higherBetter);
            return `<tr>
              <td>${escapeHtml(r.label)}</td>
              <td class="num">${r.fmt(r.av)}</td>
              <td class="num">${r.fmt(r.bv)}</td>
              <td class="num ${cls}">${Number.isFinite(delta) ? fmtSignedPct(delta) : "from 0"}</td>
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
  const rangeToggleBtn = document.getElementById("range-toggle-btn") as HTMLButtonElement | null;
  rangeToggleBtn?.addEventListener("click", () => {
    const handle = charts.trace;
    if (!handle) return;
    const next = !handle.isFullRange();
    handle.setFullRange(next);
    rangeToggleBtn.textContent = next ? "Robust range" : "Full range";
    rangeToggleBtn.setAttribute("aria-pressed", String(next));
  });

  document.getElementById("new-session-btn")?.addEventListener("click", () => {
    cancelImport("a");
    cancelImport("b");
    settingsGeneration++;
    applyingSettings = false;
    stutterOptions = { ...DEFAULT_STUTTER_OPTIONS };
    settingsDraft = { k: String(stutterOptions.kMultiplier), radius: String(stutterOptions.windowRadius), hitch: String(stutterOptions.hitchThresholdMs) };
    delete retryActions.a;
    delete retryActions.b;
    destroyCharts();
    runs.a = undefined;
    runs.b = undefined;
    workspaceSection.hidden = true;
    workspaceSection.innerHTML = "";
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
    cancelImport("b");
    setStatus("", "b");
    settingsGeneration++;
    applyingSettings = false;
    runs.b = undefined;
    renderWorkspace();
  });

  for (const select of document.querySelectorAll<HTMLSelectElement>(".stream-select")) {
    select.addEventListener("change", () => {
      const slot = select.dataset.slot === "b" ? "b" : "a";
      const run = runs[slot];
      if (run) void loadFile(slot, run.file, run.source.formatOverride, run.source.genericMapping, select.value);
    });
  }

  document.getElementById("export-png-btn")?.addEventListener("click", () => {
    if (runs.a) exportReportCard(runs.a.response.series, runs.a.response.summary, runs.a.stutterOptions);
  });
  document.getElementById("export-md-btn")?.addEventListener("click", () => {
    if (runs.a) exportMarkdown(runs.a.response.series, runs.a.response.summary, runs.a.stutterOptions, runs.a.source.genericMapping);
  });
  document.getElementById("export-json-btn")?.addEventListener("click", () => {
    if (runs.a) exportJson(runs.a.response.series, runs.a.response.summary, runs.a.stutterOptions, runs.a.source.genericMapping);
  });

  const kInput = document.getElementById("k-input") as HTMLInputElement | null;
  const radiusInput = document.getElementById("radius-input") as HTMLInputElement | null;
  const hitchInput = document.getElementById("hitch-input") as HTMLInputElement | null;
  const onConfigChange = () => {
    settingsDraft = { k: kInput!.value, radius: radiusInput!.value, hitch: hitchInput!.value };
    document.getElementById("settings-status")!.textContent = "Changes are not applied yet. Apply settings to update both reports.";
  };
  kInput?.addEventListener("input", onConfigChange);
  radiusInput?.addEventListener("input", onConfigChange);
  hitchInput?.addEventListener("input", onConfigChange);
  document.getElementById("settings-form")!.addEventListener("submit", (event) => {
    event.preventDefault();
    void applyStutterOptions();
  });

  async function applyStutterOptions(): Promise<void> {
    if (applyingSettings || imports.size) return;
    const generation = ++settingsGeneration;
    const focusedId = (document.activeElement as HTMLElement | null)?.id;
    const errorBox = document.getElementById("settings-error")!;
    errorBox.hidden = true;
    try {
      const options = readStutterOptions(kInput!.value, radiusInput!.value, hitchInput!.value);
      applyingSettings = true;
      updateBusyControls();
      document.getElementById("settings-status")!.textContent = "Updating detection for the loaded runs…";
      const loaded = (["a", "b"] as const).flatMap((slot) => runs[slot] ? [{ slot, run: runs[slot] }] : []);
      const updated = await Promise.all(loaded.map(async ({ slot, run }) => {
        const outcome = await client.recompute(slot, options, run.source);
        if (outcome.kind !== "result") throw new Error("Please choose the capture's columns again.");
        return { slot, run, response: outcome.response };
      }));
      if (generation !== settingsGeneration || updated.some(({ slot, run }) => runs[slot] !== run)) return;
      for (const { run, response } of updated) {
        run.response = response;
        run.stutterOptions = options;
      }
      stutterOptions = options;
      applyingSettings = false;
      renderWorkspace();
      if (focusedId) document.getElementById(focusedId)?.focus({ preventScroll: true });
    } catch (error) {
      if (generation !== settingsGeneration) return;
      errorBox.textContent = `Settings were not applied: ${errorMessage(error)}`;
      errorBox.hidden = false;
      document.getElementById("settings-status")!.textContent = "The previous results and exports are unchanged. Correct the values or retry Apply settings.";
    } finally {
      if (generation === settingsGeneration) applyingSettings = false;
      updateBusyControls();
    }
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
