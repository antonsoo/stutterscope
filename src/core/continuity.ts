import { Uint8Builder } from "./buffer.ts";

/** Known interruptions, tracked per stream rather than by CSV line distance. */
export class FrameContinuity {
  private readonly gaps = new Uint8Builder(4096);
  private readonly generations = new Map<string | number, number>();
  private readonly interrupted = new Set<string | number>();
  private generation = 0;

  /** An unidentified bad row may belong to any stream; a known one affects only its stream. */
  skip(stream?: string | number): void {
    if (stream === undefined) this.generation++;
    else if (this.generations.has(stream)) this.interrupted.add(stream);
  }

  keep(stream: string | number = 0): void {
    const previous = this.generations.get(stream);
    this.gaps.push(Number(previous !== undefined &&
      (previous !== this.generation || this.interrupted.has(stream))));
    this.generations.set(stream, this.generation);
    this.interrupted.delete(stream);
  }

  toArray(): Uint8Array { return this.gaps.toArray(); }
}
