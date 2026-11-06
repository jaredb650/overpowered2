/** Generic free-list pool. Use for anything created at runtime in the hot path. */
export class Pool<T> {
  private free: T[] = [];
  constructor(
    private readonly create: () => T,
    private readonly reset?: (item: T) => void,
    prewarm = 0,
  ) {
    for (let i = 0; i < prewarm; i++) this.free.push(create());
  }
  get(): T {
    return this.free.pop() ?? this.create();
  }
  release(item: T): void {
    this.reset?.(item);
    this.free.push(item);
  }
  get available(): number {
    return this.free.length;
  }
}
