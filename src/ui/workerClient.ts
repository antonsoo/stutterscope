import type { SourceFormat, ParseProgress } from "../core/types.ts";
import type { GenericMapping } from "../core/parsers/generic.ts";
import type { StutterOptions } from "../core/metrics.ts";
import type { WorkerRequest, WorkerResponse, ResultResponse, NeedsMappingResponse } from "../worker/protocol.ts";

export type Slot = "a" | "b";
export type LoadOutcome =
  | { kind: "result"; response: ResultResponse }
  | { kind: "needsMapping"; response: NeedsMappingResponse };

export interface ParseSource {
  file: File;
  formatOverride?: SourceFormat;
  genericMapping?: GenericMapping;
  stream?: string;
}

interface Pending {
  resolve: (value: LoadOutcome) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: ParseProgress) => void;
}

interface Session {
  worker: Worker;
  ready: boolean;
  pending: Map<number, Pending>;
}

/** One worker per slot owns its cached capture. Replacing or removing that
 * slot terminates its worker, so a late file read cannot overwrite the cache. */
export class ParseClient {
  private readonly sessions = new Map<Slot, Session>();
  private nextRequestId = 1;

  private createSession(slot: Slot): Session {
    const worker = new Worker(new URL("../worker/parse.worker.ts", import.meta.url), { type: "module" });
    const session: Session = { worker, ready: false, pending: new Map() };
    this.sessions.set(slot, session);
    worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
      if (this.sessions.get(slot) !== session) return;
      const msg = event.data;
      const entry = session.pending.get(msg.requestId);
      if (!entry) return;
      if (msg.type === "progress") {
        entry.onProgress?.(msg.progress);
        return;
      }
      session.pending.delete(msg.requestId);
      if (msg.type === "error") entry.reject(new Error(msg.message));
      else if (msg.type === "result") {
        session.ready = true;
        entry.resolve({ kind: "result", response: msg });
      } else if (msg.type === "needsMapping") entry.resolve({ kind: "needsMapping", response: msg });
    });
    worker.addEventListener("error", (event) => {
      event.preventDefault();
      if (this.sessions.get(slot) === session) this.retire(slot, new Error("The capture worker stopped unexpectedly. Retry the import or apply detection settings to reload the capture."));
    });
    worker.addEventListener("messageerror", () => {
      if (this.sessions.get(slot) === session) this.retire(slot, new Error("The capture worker's result could not be read. Please retry."));
    });
    return session;
  }

  private retire(slot: Slot, error: Error): void {
    const session = this.sessions.get(slot);
    if (!session) return;
    this.sessions.delete(slot);
    session.worker.terminate();
    for (const entry of session.pending.values()) entry.reject(error);
    session.pending.clear();
  }

  cancel(slot: Slot): void {
    this.retire(slot, new DOMException("Import cancelled", "AbortError"));
  }

  private send(slot: Slot, session: Session, request: WorkerRequest, onProgress?: Pending["onProgress"]): Promise<LoadOutcome> {
    return new Promise((resolve, reject) => {
      session.pending.set(request.requestId, { resolve, reject, onProgress });
      try {
        session.worker.postMessage(request);
      } catch (error) {
        this.retire(slot, error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async parse(
    slot: Slot,
    file: File,
    opts: Omit<ParseSource, "file"> & { stutterOptions?: StutterOptions; onProgress?: Pending["onProgress"] } = {},
  ): Promise<LoadOutcome> {
    this.cancel(slot);
    const session = this.createSession(slot);
    return this.send(slot, session, {
      type: "parse", requestId: this.nextRequestId++, slot, file,
      formatOverride: opts.formatOverride, genericMapping: opts.genericMapping,
      stream: opts.stream, stutterOptions: opts.stutterOptions,
    }, opts.onProgress);
  }

  async recompute(slot: Slot, stutterOptions: StutterOptions, source: ParseSource): Promise<LoadOutcome> {
    const session = this.sessions.get(slot);
    // A worker failure loses its cache. Reload the exact source and mapping
    // represented by the visible report, rather than silently using another file.
    if (!session?.ready) return this.parse(slot, source.file, { ...source, stutterOptions });
    return this.send(slot, session, { type: "recompute", requestId: this.nextRequestId++, slot, stutterOptions });
  }

  terminate(): void {
    this.cancel("a");
    this.cancel("b");
  }
}
