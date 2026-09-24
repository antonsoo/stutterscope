/**
 * Growable typed-array builders. Parsers don't know the final row count in
 * advance (bad rows get skipped), so we double capacity like a `Vec` instead
 * of pushing onto a plain `number[]` — for a 430k-row capture that avoids
 * millions of small boxed-number allocations and keeps memory close to the
 * final `Float64Array`/`Uint8Array` size.
 */
class TypedArrayBuilder<T extends Float64Array | Uint8Array> {
  private array: T;
  private len = 0;
  private readonly ctor: new (length: number) => T;

  constructor(ctor: new (length: number) => T, initialCapacity = 1024) {
    this.ctor = ctor;
    this.array = new ctor(Math.max(1, initialCapacity));
  }

  push(value: number): void {
    if (this.len >= this.array.length) {
      const grown = new this.ctor(this.array.length * 2);
      grown.set(this.array);
      this.array = grown;
    }
    this.array[this.len++] = value;
  }

  get length(): number {
    return this.len;
  }

  /** Returns a right-sized array (copies only if the buffer overshot). */
  toArray(): T {
    if (this.len === this.array.length) return this.array;
    return this.array.subarray(0, this.len) as T;
  }
}

export class Float64Builder extends TypedArrayBuilder<Float64Array> {
  constructor(initialCapacity = 1024) {
    super(Float64Array, initialCapacity);
  }
}

export class Uint8Builder extends TypedArrayBuilder<Uint8Array> {
  constructor(initialCapacity = 1024) {
    super(Uint8Array, initialCapacity);
  }
}
