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
import { buildJsonReport, buildMarkdownTable, exportComparisonJson, exportComparisonMarkdown, exportJson, exportMarkdown, exportReportCard } from "./share.ts";
import { intervalControls, mountEpisodes } from "./investigation.ts";
import { readAnalysisRange, type AnalysisRange } from "../core/analysis.ts";
import { readStutterOptions } from "./settings.ts";

interface RunState {
  response: ResultResponse;
  rangeDraft: { start: string; end: string };
  file: File;
  source: ParseSource;
  stutterOptions: StutterOptions;
}

interface ImportRequest { slot: Slot; version: number; controller: AbortController }

const client = new ParseClient();
const runs: { a?: RunState; b?: RunState } = {};
let stutterOptions: StutterOptions = { ...DEFAULT_STUTTER_OPTIONS };
let traceSlot: Slot = "a";
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
      <p>PresentMon, FrameView, CapFrameX, MangoHud, and OCAT CSVs, plus native CapFrameX JSON recordings, are auto-detected. Everything runs locally — nothing leaves your browser.</p>
      <div class="formats">
        ${SOURCE_FORMATS.filter((f) => f !== "generic")
          .map((f) => `<span class="format-chip">${FORMAT_LABELS[f]}</span>`)
          .join("")}
        <span class="format-chip">Generic CSV</span>
      </div>
      <div class="dropzone-cta">
        <button class="btn primary" type="button" id="choose-file-btn">Choose file&hellip;</button>
        <input type="file" id="file-input" accept=".csv,.txt,.json" />
      </div>
      <div class="samples-row">
        or load a synthetic sample:
        ${SOURCE_FORMATS.filter(f => f !== "capframex-json").map((f) => `<button class="sample-link" data-format="${f}" type="button">${FORMAT_LABELS[f]}</button>`).join(" ")}
      </div>
      <div class="captured-example"><strong>Recorded browser experiment</strong>
        <p>Two measured animation runs with known blocking work. Inspect the scene separately from startup and follow a hitch to its CSV line.</p>
        <button class="btn small" id="captured-example-btn" type="button">Open recorded comparison</button>
        <span>Controlled local capture, not a game or GPU benchmark.</span>
      </div>
      <div class="captured-example"><strong>Filtered native presents</strong>
        <p>Intel PresentMon gold data with dropped presents removed. Inspect the clock gaps between 175 retained frames, even though every CSV row is valid.</p>
        <button class="btn small" id="native-example-btn" type="button">Inspect filtered presents</button>
        <span>Test capture, not a game benchmark. <a href="https://github.com/antonsoo/stutterscope/tree/main/studies/present-clock">Source and transformation</a>.</span>
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
    if ((e.target as HTMLElement).closest(".sample-link, #choose-file-btn, #file-input, .captured-example")) return;
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
  document.getElementById("captured-example-btn")!.addEventListener("click", () => {
    void loadCapturedExample("a");
    void loadCapturedExample("b");
  });
  document.getElementById("native-example-btn")!.addEventListener("click", () => { void loadNativeExample(); });
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

async function loadCapturedExample(slot: Slot): Promise<void> {
  const request = beginImport(slot);
  setStatus(`<div class="status-line" role="status">Loading recorded Run ${slot.toUpperCase()}… ${cancelButton(slot)}</div>`, slot);
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}controlled-browser/controlled-${slot}.csv`, { signal: request.controller.signal });
    if (!response.ok) throw new Error(`Capture download returned HTTP ${response.status}.`);
    const blob = await response.blob();
    if (!isCurrent(request)) return;
    await loadFile(slot, new File([blob], `controlled-${slot}.csv`, { type: "text/csv" }), "generic",
      { valueColumn: "frame_time_ms", valueKind: "frametime_ms" }, undefined, request, { startSec: 1.5, endSec: 8.5 });
  } catch (error) {
    if (isCurrent(request)) showImportError(slot, `Could not load recorded Run ${slot.toUpperCase()}: ${errorMessage(error)}`, () => void loadCapturedExample(slot));
  } finally { finishImport(request); }
}

async function loadNativeExample(): Promise<void> {
  const request = beginImport("a");
  setStatus(`<div class="status-line" role="status">Loading filtered native presents… ${cancelButton("a")}</div>`);
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}native-filtering/filtered-presents.csv`, { signal: request.controller.signal });
    if (!response.ok) throw new Error(`Capture download returned HTTP ${response.status}.`);
    const blob = await response.blob();
    if (!isCurrent(request)) return;
    await loadFile("a", new File([blob], "filtered-presents.csv", { type: "text/csv" }), undefined, undefined, undefined, request);
  } catch (error) {
    if (isCurrent(request)) showImportError("a", `Could not load filtered presents: ${errorMessage(error)}`, () => void loadNativeExample());
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
  document.querySelectorAll<HTMLInputElement | HTMLButtonElement>("#settings-form input, #apply-settings-btn, .interval-form input, .interval-form button, #use-trace-interval").forEach((control) => { control.disabled = busy; });
  const cancel = document.getElementById("cancel-analysis");
  if (cancel) cancel.hidden = !applyingSettings;
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
  range: AnalysisRange | null = null,
  captureRun?: number,
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
      stream, captureRun,
      stutterOptions: options, range,
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
      response: outcome.response, file, stutterOptions: options, rangeDraft: { start: String(range?.startSec ?? 0), end: range?.endSec == null ? "" : String(range.endSec) },
      source: { file, formatOverride: outcome.response.series.meta.format, genericMapping, stream: outcome.response.series.meta.selectedStream ?? stream, captureRun: outcome.response.series.meta.nativeCapture?.selectedRun ?? captureRun },
    };
    renderWorkspace();
  } catch (err) {
    if (isCurrent(request)) {
      const retainedRun = runs[slot]?.response.series.meta.nativeCapture?.selectedRun;
      const select = document.getElementById(`capture-run-${slot}`) as HTMLSelectElement | null;
      if (select && retainedRun !== undefined) select.value = String(retainedRun);
      showImportError(slot, `Could not parse ${file.name}: ${errorMessage(err)}`, () => void loadFile(slot, file, formatOverride, genericMapping, stream, undefined, range, captureRun));
    }
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
          <button class="btn small" id="export-png-btn" type="button">Export ${hasB ? "A " : ""}PNG</button>
          <button class="btn small" id="export-md-btn" type="button">Export Markdown</button>
          <button class="btn small" id="export-json-btn" type="button">Export JSON</button>
          <button class="btn small" id="new-session-btn" type="button">New session</button>
        </div>
      </div>

      ${warningsNote(a)}
      ${timingNote(a, "Run A")}
      ${runs.b ? timingNote(runs.b, "Run B") : ""}
      ${nativeCaptureNote("a", a)}
      ${runs.b ? nativeCaptureNote("b", runs.b) : ""}
      ${streamNote("a", a)}
      ${hasB && runs.b ? streamNote("b", runs.b) : ""}
      ${hasB && runs.b ? warningsNote(runs.b, "Run B") : ""}

      <section class="bracket-panel interval-panel" aria-labelledby="interval-title">
        <h2 id="interval-title">Analyzed intervals</h2>
        <p class="hint">Choose the part of each capture to measure. Times sum usable frame durations; they are not wall-clock timestamps. Start excludes frames ending at that point; end includes them. Whole frames are kept.</p>
        <div class="interval-runs">${intervalControls("a", a.file.name, a.response.selection, a.rangeDraft)}${runs.b ? intervalControls("b", runs.b.file.name, runs.b.response.selection, runs.b.rangeDraft) : ""}</div>
        <p class="hint">Stutter detection keeps neighboring frames from the full stream, stopping at source gaps. Traces also break at gaps; their time axis sums usable frame durations and does not reconstruct missing time. Zooming a chart changes the view; apply an interval to change metrics and exports.${hasB ? " JSON and Markdown exports include both runs. PNG shows Run A." : ""}</p>
        <button class="btn small" id="cancel-analysis" type="button" hidden>Cancel analysis</button>
      </section>
      <p class="panel-label">Run A metrics <span class="hint">${a.response.selection.requested ? "applied interval" : "entire capture"}</span></p>
      <div class="tile-grid" id="tile-grid-a"></div>
      <div class="bracket-panel secondary-panel" id="secondary-panel-a">
        <span class="bracket-tl"></span><span class="bracket-tr"></span>
        <p class="panel-label">More Metrics <span class="hint">hover a tile above for its full definition</span></p>
        <div id="secondary-table-a"></div>
      </div>

      ${hasB ? `<div class="bracket-panel" id="comparison-panel"><span class="bracket-tl"></span><span class="bracket-tr"></span><p class="panel-label">Comparison</p><div id="comparison-table" tabindex="0" role="region" aria-label="Run comparison metrics"></div></div>` : ""}

      <div class="bracket-panel chart-panel">
        <span class="bracket-tl"></span><span class="bracket-tr"></span>
        <div class="trace-run-controls"><label for="trace-run">Inspect <select id="trace-run"><option value="a">Run A: ${escapeHtml(a.file.name)}</option>${runs.b ? `<option value="b">Run B: ${escapeHtml(runs.b.file.name)}</option>` : ""}</select></label>
          <button class="btn small" type="button" id="use-trace-interval">Analyze visible trace</button>
        </div>
        <p class="panel-label">Frame Time Trace <span class="hint">drag to zoom &middot; shift+drag to pan &middot; wheel to zoom &middot; dblclick to reset</span>
          <button class="btn small range-toggle" id="range-toggle-btn" type="button" aria-pressed="false">Full range</button>
        </p>
        <div id="trace-chart" class="trace-sweep" role="img" aria-label="${escapeHtml(chartSummary(a.response.summary))}"></div>
      </div>

      <section class="bracket-panel" id="episode-inspector" aria-label="Slow-frame investigation"></section>

      <div class="chart-grid">
        <div class="bracket-panel chart-panel">
          <span class="bracket-tl"></span><span class="bracket-tr"></span>
          <p class="panel-label">FPS Over Time</p>
          <div id="fps-chart" role="img" aria-label="FPS over time for ${escapeHtml(a.file.name)}, ${fmtInt(a.response.series.frameCount)} frames"></div>
        </div>
        <div class="bracket-panel chart-panel">
          <span class="bracket-tl"></span><span class="bracket-tr"></span>
          <p class="panel-label">Frame Time Histogram <span class="hint">${hasB ? "A = green, B = amber &middot; share of each run &middot; " : ""}P99 / P99.9 markers${hasB ? " for A" : ""}</span></p>
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


    </div>
  `;

  const tileSet = buildTiles(a.response.summary);
  renderTiles(document.getElementById("tile-grid-a")!, tileSet.headline);
  renderSecondaryTable(document.getElementById("secondary-table-a")!, tileSet.secondary);

  if (!runs[traceSlot]) traceSlot = "a";
  const inspected = runs[traceSlot]!;
  const traceSelect = document.getElementById("trace-run") as HTMLSelectElement;
  traceSelect.value = traceSlot;
  traceSelect.addEventListener("change", () => { traceSlot = traceSelect.value as Slot; renderWorkspace(); });
  const traceElement = document.getElementById("trace-chart")!;
  traceElement.setAttribute("aria-label", `Run ${traceSlot.toUpperCase()}: ${chartSummary(inspected.response.summary)}`);
  charts.trace = createTraceChart(traceElement, inspected.response.series.timeSec, inspected.response.series.frameTimeMs, inspected.response.chart.isStutter, traceSlot, inspected.response.series.gapBefore);
  charts.fps = createFpsChart(document.getElementById("fps-chart")!, inspected.response.series.timeSec, inspected.response.series.frameTimeMs, inspected.response.series.gapBefore);
  document.getElementById("fps-chart")!.setAttribute("aria-label", `FPS over time for Run ${traceSlot.toUpperCase()}: ${inspected.file.name}`);
  mountEpisodes(document.getElementById("episode-inspector")!, inspected.response, (start, end) => {
    charts.trace?.uplot.setScale("x", { min: start, max: end });
    document.getElementById("use-trace-interval")?.focus({ preventScroll: true });
    traceElement.scrollIntoView({ block: "center", behavior: "instant" });
  });

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
  const noun = run.response.series.sourceSample ? "sample" : "row";
  const rows = skippedRows === 1 ? `1 ${noun} was skipped` : `${fmtInt(skippedRows)} ${noun}s were skipped`;
  return `<details class="notes warn-note"><summary>${label}: ${rows}: bad or missing frame time</summary><pre>${listed.map(escapeHtml).join("\n")}${more}</pre></details>`;
}

function timingNote(run: RunState, label: string): string {
  const clockGaps = run.response.series.meta.presentClockGaps;
  const witnesses = run.response.series.meta.presentClockEvidence;
  const clockName = witnesses?.clockColumn ?? "TimeInSeconds";
  const durationBasis = witnesses?.frameTimeReference === "fromSourceLine" ? " The earlier row's FrameTime spans the two CPU starts." : "";
  const witnessTable = witnesses?.witnesses.length ? `<div class="episode-table-scroll" tabindex="0" role="region" aria-label="${label} native clock witnesses">
    <table class="delta-table"><caption>Retained clock witnesses (milliseconds)</caption><thead><tr><th scope="col">CSV lines</th><th scope="col">clock</th><th scope="col">frame</th><th scope="col">allowance</th></tr></thead><tbody>
      ${witnesses.witnesses.map(w => `<tr><td>${fmtInt(w.fromSourceLine)} - ${fmtInt(w.toSourceLine)}</td><td class="num">${fmtMs(w.elapsedMs, 3)}</td><td class="num">${fmtMs(w.frameTimeMs, 3)}</td><td class="num">${w.allowanceMs > 0 && w.allowanceMs < 1e-6 ? w.allowanceMs.toExponential(2) : fmtMs(w.allowanceMs, 6)}</td></tr>`).join("")}
    </tbody></table></div>${witnesses.omittedWitnesses ? `<p>${fmtInt(witnesses.omittedWitnesses)} further witness details were not retained. JSON still lists every detected gap coordinate.</p>` : ""}` : "";
  const native = clockGaps ? `<details class="notes timing-note"><summary>${label}: ${fmtInt(clockGaps)} native clock ${clockGaps === 1 ? "discontinuity" : "discontinuities"}</summary>
    <p>The count covers the full source stream. ${clockName} contradicts adjacent retained frames, after allowing for written decimal precision.${durationBasis} Filtered or missing frames and reversed clocks break pacing pairs, rolling context and trace lines. Missing frame counts and durations are unknown; the chart still sums retained frame durations. This check does not establish complete recording.</p>${witnessTable}</details>` : "";
  const evidence = run.response.series.meta.timingEvidence;
  if (!evidence) return native;
  return native + `<details class="notes timing-note"><summary>${label}: MangoHud metrics assume per-frame logging</summary>
    <p>${escapeHtml(evidence.note)}</p><p>Compared intervals: ${fmtInt(evidence.comparedIntervals)}.
    Elapsed span: ${evidence.observedSpanSec === null ? "unavailable" : fmtMs(evidence.observedSpanSec, 6) + " s"}.
    Recorded frame span: ${evidence.recordedFrameSpanSec === null ? "unavailable" : fmtMs(evidence.recordedFrameSpanSec, 6) + " s"}.</p></details>`;
}

/** Saved recordings are distinct from process/swap-chain present streams. */
function nativeCaptureNote(slot: "a" | "b", run: RunState): string {
  const native = run.response.series.meta.nativeCapture;
  if (!native) return "";
  return `<div class="notes stream-note">
    <label for="capture-run-${slot}">Run ${slot.toUpperCase()}: saved CapFrameX recording</label>
    <select id="capture-run-${slot}" class="capture-run-select" data-slot="${slot}">
      ${native.runs.map(r => `<option value="${r.run}"${r.run === native.selectedRun ? " selected" : ""}>Recording ${r.run} of ${native.runs.length}: ${fmtInt(r.sampleCount)} source samples</option>`).join("")}
    </select>
    <span class="stream-why">${escapeHtml(native.note)} Sample indices in the inspector and JSON reports are zero-based.</span>
  </div>`;
}

/** A present-hook capture may hold multiple streams; say which is analyzed. */
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
    { label: "Stutter time share", av: sa.stutter.stutterTimeFraction * 100, bv: sb.stutter.stutterTimeFraction * 100, fmt: (n) => `${fmtMs(n, 2)}%`, higherBetter: false },
    { label: "Hitches per 1,000 frames", av: sa.stutter.hitchCount / sa.frameCount * 1000, bv: sb.stutter.hitchCount / sb.frameCount * 1000, fmt: (n) => fmtMs(n, 2), higherBetter: false },
    { label: "Stutter events", av: sa.stutter.stutterEventCount, bv: sb.stutter.stutterEventCount, fmt: (n) => fmtInt(n), higherBetter: false },
    { label: `Hitches (>${sa.stutter.hitchThresholdMs}ms)`, av: sa.stutter.hitchCount, bv: sb.stutter.hitchCount, fmt: (n) => fmtInt(n), higherBetter: false },
    { label: "Pacing (MASD)", av: sa.masdMs, bv: sb.masdMs, fmt: (n) => `${fmtMs(n)} ms`, higherBetter: false },
  ];

  const html = `
    <p class="hint">Run A: ${fmtInt(sa.frameCount)} frames, ${fmtMs(sa.durationSec, 4)} s. Run B: ${fmtInt(sb.frameCount)} frames, ${fmtMs(sb.durationSec, 4)} s. Counts depend on interval length; differences do not establish a hardware gain.</p>
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
              <td class="num ${cls}">${Number.isFinite(delta) ? fmtSignedPct(delta) : Number.isNaN(delta) ? "Unavailable" : "from 0"}</td>
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
  document.getElementById("cancel-analysis")!.addEventListener("click", () => {
    settingsGeneration++;
    client.terminate();
    applyingSettings = false;
    renderWorkspace();
    document.getElementById(`interval-status-${traceSlot}`)!.textContent = "Analysis cancelled. Previous results and exports are retained.";
    document.getElementById(`apply-interval-${traceSlot}`)?.focus({ preventScroll: true });
  });
  for (const slot of ["a", "b"] as const) {
    const run = runs[slot];
    if (!run) continue;
    const start = document.getElementById(`interval-start-${slot}`) as HTMLInputElement;
    const end = document.getElementById(`interval-end-${slot}`) as HTMLInputElement;
    const changed = () => {
      run.rangeDraft = { start: start.value, end: end.value };
      document.getElementById(`interval-status-${slot}`)!.textContent = "Draft interval. Apply it to update metrics and exports.";
    };
    start.addEventListener("input", changed);
    end.addEventListener("input", changed);
    document.getElementById(`interval-${slot}`)!.addEventListener("submit", (event) => {
      event.preventDefault();
      void applyInterval(slot, () => readAnalysisRange(start.value, end.value));
    });
    document.getElementById(`entire-capture-${slot}`)!.addEventListener("click", () => void applyInterval(slot, () => null));
  }
  document.getElementById("use-trace-interval")!.addEventListener("click", () => {
    const scale = charts.trace?.uplot.scales.x;
    if (scale?.min == null || scale.max == null) return;
    const requested = { startSec: Math.max(0, scale.min), endSec: scale.max };
    void applyInterval(traceSlot, () => requested);
  });
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
    input.accept = ".csv,.txt,.json";
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

  for (const select of document.querySelectorAll<HTMLSelectElement>(".capture-run-select")) {
    select.addEventListener("change", () => {
      const slot = select.dataset.slot === "b" ? "b" : "a";
      const run = runs[slot];
      if (run) void loadFile(slot, run.file, run.source.formatOverride, undefined, undefined, undefined, null, Number(select.value));
    });
  }

  for (const select of document.querySelectorAll<HTMLSelectElement>(".stream-select")) {
    select.addEventListener("change", () => {
      const slot = select.dataset.slot === "b" ? "b" : "a";
      const run = runs[slot];
      if (run) void loadFile(slot, run.file, run.source.formatOverride, run.source.genericMapping, select.value);
    });
  }

  document.getElementById("export-png-btn")?.addEventListener("click", () => {
    if (runs.a) exportReportCard(runs.a.response.series, runs.a.response.summary, runs.a.stutterOptions, runs.a.response.selection);
  });
  document.getElementById("export-md-btn")?.addEventListener("click", () => {
    const a = runs.a;
    if (!a) return;
    const b = runs.b;
    if (b) exportComparisonMarkdown(
      buildMarkdownTable(a.response.series, a.response.summary, a.stutterOptions, a.source.genericMapping, a.response.selection),
      buildMarkdownTable(b.response.series, b.response.summary, b.stutterOptions, b.source.genericMapping, b.response.selection));
    else exportMarkdown(a.response.series, a.response.summary, a.stutterOptions, a.source.genericMapping, a.response.selection);
  });
  document.getElementById("export-json-btn")?.addEventListener("click", () => {
    const a = runs.a;
    if (!a) return;
    const b = runs.b;
    if (b) exportComparisonJson(
      buildJsonReport(a.response.series, a.response.summary, a.stutterOptions, a.source.genericMapping, a.response.selection),
      buildJsonReport(b.response.series, b.response.summary, b.stutterOptions, b.source.genericMapping, b.response.selection));
    else exportJson(a.response.series, a.response.summary, a.stutterOptions, a.source.genericMapping, a.response.selection);
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
        const outcome = await client.recompute(slot, options, run.source, run.response.selection.requested);
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

async function applyInterval(slot: Slot, read: () => AnalysisRange | null): Promise<void> {
  if (applyingSettings || imports.size) return;
  const run = runs[slot];
  if (!run) return;
  const generation = ++settingsGeneration;
  const focused = (document.activeElement as HTMLElement | null)?.id;
  const errorBox = document.getElementById(`interval-error-${slot}`)!;
  const status = document.getElementById(`interval-status-${slot}`)!;
  errorBox.hidden = true;
  try {
    const range = read();
    applyingSettings = true;
    updateBusyControls();
    status.textContent = "Analyzing interval… Previous results remain available until this finishes.";
    const outcome = await client.recompute(slot, run.stutterOptions, run.source, range);
    if (generation !== settingsGeneration || runs[slot] !== run) return;
    if (outcome.kind !== "result") throw new Error("Choose the capture's columns again.");
    run.response = outcome.response;
    run.rangeDraft = { start: String(range?.startSec ?? 0), end: range?.endSec == null ? "" : String(range.endSec) };
    applyingSettings = false;
    renderWorkspace();
    if (focused) document.getElementById(focused)?.focus({ preventScroll: true });
  } catch (error) {
    if (generation !== settingsGeneration) return;
    errorBox.textContent = `Interval was not applied: ${errorMessage(error)}`;
    errorBox.hidden = false;
    status.textContent = "Previous results and exports are retained. Adjust the interval or retry.";
  } finally {
    if (generation === settingsGeneration) applyingSettings = false;
    updateBusyControls();
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
if (new URLSearchParams(window.location.search).get("example") === "filtered-presents") void loadNativeExample();
