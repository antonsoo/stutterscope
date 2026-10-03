import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ParseClient } from "../../src/ui/workerClient.ts";
import { DEFAULT_STUTTER_OPTIONS } from "../../src/core/metrics.ts";
import type { WorkerRequest, ResultResponse } from "../../src/worker/protocol.ts";

class FakeWorker extends EventTarget {
  static instances: FakeWorker[] = [];
  postMessage = vi.fn<(request: WorkerRequest) => void>();
  terminate = vi.fn();
  constructor() { super(); FakeWorker.instances.push(this); }
  result(index = 0): void {
    const request = this.postMessage.mock.calls[index]![0];
    this.dispatchEvent(new MessageEvent("message", { data: { type: "result", requestId: request.requestId, slot: request.slot } as ResultResponse }));
  }
}

const file = new File(["frame_time_ms\n16\n"], "capture.csv");
const source = { file, genericMapping: { valueColumn: "frame_time_ms", valueKind: "frametime_ms" as const } };
beforeEach(() => { FakeWorker.instances = []; vi.stubGlobal("Worker", FakeWorker); });
afterEach(() => vi.unstubAllGlobals());

describe("capture worker ownership", () => {
  it("cancels a superseded import and ignores replies from the retired worker", async () => {
    const client = new ParseClient();
    const old = expect(client.parse("a", file)).rejects.toMatchObject({ name: "AbortError" });
    const current = client.parse("a", file);
    const [first, second] = FakeWorker.instances;
    await old;
    expect(first!.terminate).toHaveBeenCalledOnce();
    first!.result();
    second!.result();
    await expect(current).resolves.toMatchObject({ kind: "result", response: { requestId: 2 } });
  });

  it("removes one slot without cancelling an independent comparison import", async () => {
    const client = new ParseClient();
    const a = client.parse("a", file);
    const b = expect(client.parse("b", file)).rejects.toMatchObject({ name: "AbortError" });
    client.cancel("b");
    await b;
    FakeWorker.instances[0]!.result();
    await expect(a).resolves.toMatchObject({ kind: "result" });
    expect(FakeWorker.instances[0]!.terminate).not.toHaveBeenCalled();
  });

  it("terminating a session settles both pending imports", async () => {
    const client = new ParseClient();
    const a = expect(client.parse("a", file)).rejects.toMatchObject({ name: "AbortError" });
    const b = expect(client.parse("b", file)).rejects.toMatchObject({ name: "AbortError" });
    client.terminate();
    await Promise.all([a, b]);
    expect(FakeWorker.instances.every((worker) => worker.terminate.mock.calls.length === 1)).toBe(true);
  });

  it.each(["error", "messageerror"])("settles %s failures and creates a replacement on retry", async (type) => {
    const client = new ParseClient();
    const pending = expect(client.parse("a", file)).rejects.toThrow(/worker/);
    FakeWorker.instances[0]!.dispatchEvent(new Event(type, { cancelable: true }));
    await pending;
    const retry = client.parse("a", file);
    FakeWorker.instances[1]!.result();
    await expect(retry).resolves.toMatchObject({ kind: "result" });
  });

  it("reloads the exact source and mapping after its cached worker fails", async () => {
    const client = new ParseClient();
    const parsed = client.parse("a", file, source);
    FakeWorker.instances[0]!.result();
    await parsed;
    FakeWorker.instances[0]!.dispatchEvent(new Event("error", { cancelable: true }));
    const options = { ...DEFAULT_STUTTER_OPTIONS, hitchThresholdMs: 80 };
    const recomputed = client.recompute("a", options, source);
    const replacement = FakeWorker.instances[1]!;
    expect(replacement.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "parse", file, genericMapping: source.genericMapping, stutterOptions: options,
    }));
    replacement.result();
    await recomputed;
  });

  it("reuses a healthy parsed cache for threshold changes", async () => {
    const client = new ParseClient();
    const parsed = client.parse("a", file);
    FakeWorker.instances[0]!.result();
    await parsed;
    const next = client.recompute("a", DEFAULT_STUTTER_OPTIONS, source);
    expect(FakeWorker.instances).toHaveLength(1);
    expect(FakeWorker.instances[0]!.postMessage.mock.calls[1]![0].type).toBe("recompute");
    FakeWorker.instances[0]!.result(1);
    await next;
  });

  it("settles synchronous construction and send failures", async () => {
    const client = new ParseClient();
    vi.stubGlobal("Worker", class { constructor() { throw new Error("blocked"); } });
    await expect(client.parse("a", file)).rejects.toThrow("blocked");
    vi.stubGlobal("Worker", class extends FakeWorker {
      constructor() {
        super();
        this.postMessage.mockImplementation(() => { throw new Error("cannot clone"); });
      }
    });
    await expect(client.parse("a", file)).rejects.toThrow("cannot clone");
    expect(FakeWorker.instances[0]!.terminate).toHaveBeenCalledOnce();
  });
});
