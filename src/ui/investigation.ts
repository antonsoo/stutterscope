import type { CaptureAnalysis, FrameSelection } from "../core/analysis.ts";
import { slowEpisodes } from "../core/episodes.ts";
import { fmtInt, fmtMs } from "./format.ts";

export function escapeText(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function intervalControls(slot: "a" | "b", name: string, selection: FrameSelection, draft: { start: string; end: string }): string {
  const percentage = (value: number) => selection.sourceDurationSec > 0 ? Math.max(0, Math.min(100, value / selection.sourceDurationSec * 100)) : 0;
  const left = percentage(selection.startSec);
  const right = percentage(selection.endSec);
  const requested = selection.requested;
  return `<form class="interval-form" id="interval-${slot}" data-slot="${slot}" novalidate>
    <div class="interval-heading"><strong>Run ${slot.toUpperCase()}</strong> <span>${escapeText(name)}</span>
      <span class="interval-applied">${requested ? "Interval applied" : "Entire capture"}</span></div>
    <div class="interval-ruler" aria-hidden="true"><span style="left:${left}%;width:${right - left}%"></span></div>
    <div class="config-row">
      <label for="interval-start-${slot}">Start (s)<input id="interval-start-${slot}" type="number" min="0" step="any" value="${escapeText(draft.start)}" required></label>
      <label for="interval-end-${slot}">End (s)<input id="interval-end-${slot}" type="number" min="0" step="any" placeholder="Capture end" value="${escapeText(draft.end)}"></label>
      <button class="btn small" id="apply-interval-${slot}" type="submit">Apply interval ${slot.toUpperCase()}</button>
      <button class="btn small" id="entire-capture-${slot}" type="button">Entire capture ${slot.toUpperCase()}</button>
    </div>
    <p class="interval-evidence" id="interval-evidence-${slot}">Frames <strong>${fmtInt(selection.firstFrameIndex + 1)}–${fmtInt(selection.lastFrameIndex + 1)}</strong> of ${fmtInt(selection.sourceFrameCount)} · ${fmtMs(selection.durationSec, 4)} s analyzed · ${fmtInt(selection.excludedBefore + selection.excludedAfter)} frames excluded.</p>
    <p class="hint" id="interval-status-${slot}" role="status">${requested ? `Requested ${requested.startSec}–${requested.endSec ?? "end"} s. ` : ""}Actual coverage: ${fmtMs(selection.startSec, 6)}–${fmtMs(selection.endSec, 6)} s.</p>
    <p class="error-box" id="interval-error-${slot}" role="alert" hidden></p>
  </form>`;
}

const PAGE_SIZE = 20;

export function mountEpisodes(container: HTMLElement, analysis: CaptureAnalysis, onZoom: (start: number, end: number) => void): void {
  const episodes = slowEpisodes(analysis);
  let page = 0;
  let selected: number | null = null;
  let order = "time";
  let filter = "all";
  const rows = () => episodes.map((episode, index) => ({ episode, index }))
    .filter(({ episode }) => filter === "all" || episode.hitchFrames > 0)
    .sort((a, b) => order === "worst" ? b.episode.longestFrameMs - a.episode.longestFrameMs || a.index - b.index : a.index - b.index);

  function render(): void {
    const focused = (document.activeElement as HTMLElement | null)?.id;
    const filtered = rows();
    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    page = Math.min(page, pages - 1);
    container.innerHTML = `<div class="episode-heading"><h2>Slow-frame episodes</h2><span>${fmtInt(episodes.length)} in the analyzed interval</span></div>
      <p class="hint">Consecutive retained frames flagged as a stutter or hitch. These locate the slowdown; they do not identify its cause. JSON exports include every episode.</p>
      <div class="episode-controls">
        <label for="episode-filter">Show <select id="episode-filter"><option value="all">All slow frames</option><option value="hitches">Hitches only</option></select></label>
        <label for="episode-order">Order <select id="episode-order"><option value="time">Capture order</option><option value="worst">Longest frame first</option></select></label>
      </div>
      ${filtered.length ? `<div class="episode-table-scroll" tabindex="0" role="region" aria-label="Slow-frame episodes"><table class="delta-table episode-table">
        <thead><tr><th scope="col">Time (s)</th><th scope="col">Frames</th><th scope="col">Longest</th><th scope="col">Flags</th><th scope="col">CSV lines</th><th scope="col">Evidence</th></tr></thead>
        <tbody>${filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(({ episode: e, index }) => `<tr${selected === index ? ' class="selected-episode"' : ""}>
          <td class="num"><span>${fmtMs(e.startSec, 4)}</span><span>–${fmtMs(e.endSec, 4)}</span></td><td class="num">${fmtInt(e.firstFrame)}–${fmtInt(e.lastFrame)}</td>
          <td class="num">${fmtMs(e.longestFrameMs, 2)} ms</td><td>${e.stutterFrames ? `${fmtInt(e.stutterFrames)} stutter` : ""}${e.stutterFrames && e.hitchFrames ? " / " : ""}${e.hitchFrames ? `${fmtInt(e.hitchFrames)} hitch` : ""}</td>
          <td class="num">${e.firstSourceLine === null ? "Unavailable" : `${fmtInt(e.firstSourceLine)}–${fmtInt(e.lastSourceLine!)}`}</td>
          <td><button type="button" class="btn small" id="inspect-episode-${index}" data-episode="${index}" aria-controls="episode-detail" aria-expanded="${selected === index}" aria-label="Inspect frames ${e.firstFrame} to ${e.lastFrame}">Inspect</button></td>
        </tr>`).join("")}</tbody></table></div>` : `<p class="episode-empty">${episodes.length ? "No hitches exceed the applied threshold in this interval." : "No frames meet the applied stutter or hitch thresholds in this interval."}</p>`}
      <div class="episode-paging"><button class="btn small" type="button" id="episodes-previous" ${page === 0 ? "disabled" : ""}>Previous episodes</button>
        <span role="status">${filtered.length ? `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, filtered.length)} of ${fmtInt(filtered.length)}` : "0 episodes"}</span>
        <button class="btn small" type="button" id="episodes-next" ${page + 1 >= pages ? "disabled" : ""}>Next episodes</button></div>
      <div id="episode-detail"></div>`;
    const orderSelect = container.querySelector<HTMLSelectElement>("#episode-order")!;
    const filterSelect = container.querySelector<HTMLSelectElement>("#episode-filter")!;
    orderSelect.value = order;
    filterSelect.value = filter;
    orderSelect.addEventListener("change", () => { order = orderSelect.value; page = 0; selected = null; render(); });
    filterSelect.addEventListener("change", () => { filter = filterSelect.value; page = 0; selected = null; render(); });
    container.querySelector("#episodes-previous")!.addEventListener("click", () => { page--; selected = null; render(); });
    container.querySelector("#episodes-next")!.addEventListener("click", () => { page++; selected = null; render(); });
    for (const button of container.querySelectorAll<HTMLButtonElement>("[data-episode]")) {
      button.addEventListener("click", () => { selected = Number(button.dataset.episode); render(); });
    }
    if (selected !== null) renderDetail(selected);
    if (focused) container.querySelector<HTMLElement>(`#${focused}`)?.focus({ preventScroll: true });
  }

  function renderDetail(index: number): void {
    const episode = episodes[index]!;
    const { series, selection, summary } = analysis;
    const worstIndex = episode.longestFrame - selection.firstFrameIndex - 1;
    const from = Math.max(0, worstIndex - 5);
    const end = Math.min(series.frameCount, worstIndex + 6);
    const channels = ([{ key: "cpuBusyMs", label: "CPU busy (ms)" }, { key: "gpuBusyMs", label: "GPU busy (ms)" }, { key: "displayLatencyMs", label: "Latency (ms)" }] as const).filter(({ key }) => series.channels[key] !== undefined);
    const value = (channel: Float64Array | undefined, i: number) => channel && Number.isFinite(channel[i]) ? fmtMs(channel[i]!, 3) : "Unavailable";
    const detail = container.querySelector<HTMLElement>("#episode-detail")!;
    detail.innerHTML = `<div class="episode-detail"><h3>Evidence around frame ${fmtInt(episode.longestFrame)}</h3>
      <p>Longest frame: <strong>${fmtMs(episode.longestFrameMs, 3)} ms</strong>. Episode covers ${fmtMs(episode.totalTimeMs, 3)} ms across ${fmtInt(episode.frameCount)} flagged ${episode.frameCount === 1 ? "frame" : "frames"}.</p>
      <p>Source frames ${fmtInt(episode.firstFrame)}–${fmtInt(episode.lastFrame)}${episode.firstSourceLine === null ? "; CSV lines unavailable" : `; CSV lines ${fmtInt(episode.firstSourceLine)}–${fmtInt(episode.lastSourceLine!)}`}.</p>
      ${episode.touchesSelectionStart || episode.touchesSelectionEnd ? '<p class="hint">This episode touches a selection boundary and may continue outside the interval.</p>' : ""}
      <p class="hint">Up to five neighboring frames on each side, within the analyzed interval. Line numbers refer to the original file; intervening lines may belong to another process or be skipped.</p>
      <button class="btn small" type="button" id="zoom-episode">Show episode on trace</button>
      <div class="episode-table-scroll" tabindex="0" role="region" aria-label="Frame evidence around longest frame"><table class="delta-table frame-evidence"><thead><tr>
        <th scope="col">Frame</th><th scope="col">CSV line</th><th scope="col">End (s)</th><th scope="col">Time (ms)</th><th scope="col">Flags</th>${channels.map(({ label }) => `<th scope="col">${label}</th>`).join("")}</tr></thead>
        <tbody>${Array.from({ length: end - from }, (_, n) => n + from).map((i) => `<tr${i === worstIndex ? ' class="selected-episode"' : ""}>
          <th scope="row">${fmtInt(selection.firstFrameIndex + i + 1)}</th><td>${series.sourceLine?.[i] ?? "Unavailable"}</td><td>${fmtMs(series.timeSec[i]!, 6)}</td><td>${fmtMs(series.frameTimeMs[i]!, 3)}</td>
          <td>${[summary.stutter.isStutter[i] === 1 ? "Stutter" : "", series.frameTimeMs[i]! > summary.stutter.hitchThresholdMs ? "Hitch" : ""].filter(Boolean).join(" / ") || "—"}</td>
          ${channels.map(({ key }) => `<td>${value(series.channels[key], i)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></div>`;
    detail.querySelector("#zoom-episode")!.addEventListener("click", () => {
      const padding = Math.max(0.1, (episode.endSec - episode.startSec) * 2);
      onZoom(Math.max(selection.startSec, episode.startSec - padding), Math.min(selection.endSec, episode.endSec + padding));
    });
  }
  render();
}
