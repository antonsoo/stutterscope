import type { SourceFormat, ParseProgress } from "../core/types.ts";
import type { GenericMapping } from "../core/parsers/generic.ts";
import type { StutterOptions } from "../core/metrics.ts";
import type { WorkerRequest, WorkerResponse, ResultResponse, NeedsMappingResponse } from "../worker/protocol.ts";

export type LoadOutcome =
  | { kind: "result"; response: ResultResponse }
  | { kind: "needsMapping"; response: NeedsMappingResponse };

/** Thin promise-based facade over the parse worker's message protocol. */
export class ParseClient {
  private readonly worker: Worker;
  private nextRequestId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (v: LoadOutcome) => void; reject: (e: Error) => void; onProgress?: (p: ParseProgress) => void }
  >();

  constructor() {
    this.worker = new Worker(new URL("../worker/parse.worker.ts", import.meta.url), { type: "module" });
    this.worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
      this.handleMessage(event.data);
    });
  }

  private handleMessage(msg: WorkerResponse): void {
    const entry = this.pending.get(msg.requestId);
    if (!entry) return;
    if (msg.type === "progress") {
      entry.onProgress?.(msg.progress);
      return;
    }
    this.pending.delete(msg.requestId);
    if (msg.type === "error") {
      entry.reject(new Error(msg.message));
    } else if (msg.type === "result") {
      entry.resolve({ kind: "result", response: msg });
    } else if (msg.type === "needsMapping") {
      entry.resolve({ kind: "needsMapping", response: msg });
    }
  }

  private send(request: WorkerRequest, onProgress?: (p: ParseProgress) => void): Promise<LoadOutcome> {
    return new Promise((resolve, reject) => {
      this.pending.set(request.requestId, { resolve, reject, onProgress });
      this.worker.postMessage(request);
    });
  }

  parse(
    slot: "a" | "b",
    file: File,
    opts: {
      formatOverride?: SourceFormat;
      genericMapping?: GenericMapping;
      stutterOptions?: StutterOptions;
      onProgress?: (p: ParseProgress) => void;
    } = {},
  ): Promise<LoadOutcome> {
    const requestId = this.nextRequestId++;
    return this.send(
      {
        type: "parse",
        requestId,
        slot,
        file,
        formatOverride: opts.formatOverride,
        genericMapping: opts.genericMapping,
        stutterOptions: opts.stutterOptions,
      },
      opts.onProgress,
    );
  }

  recompute(slot: "a" | "b", stutterOptions: StutterOptions): Promise<LoadOutcome> {
    const requestId = this.nextRequestId++;
    return this.send({ type: "recompute", requestId, slot, stutterOptions });
  }

  terminate(): void {
    this.worker.terminate();
  }
}
