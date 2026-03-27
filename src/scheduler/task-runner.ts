export class TaskRunner {
  private readonly queue: Array<{ key: string; task: () => Promise<void>; resolve: () => void; reject: (error: unknown) => void }> = [];
  private readonly pending = new Map<string, Promise<void>>();
  private readonly activeKeysSet = new Set<string>();
  private idleResolvers: Array<() => void> = [];

  constructor(private readonly concurrency: number) {}

  runOnce(key: string, task: () => Promise<void>): Promise<void> {
    const existing = this.pending.get(key);
    if (existing) {
      return existing;
    }

    const promise = new Promise<void>((resolve, reject) => {
      this.queue.push({ key, task, resolve, reject });
      this.tick();
    });
    this.pending.set(key, promise);
    void promise.then(() => {
      this.pending.delete(key);
      this.activeKeysSet.delete(key);
      this.resolveIdleIfNeeded();
      this.tick();
    }, () => {
      this.pending.delete(key);
      this.activeKeysSet.delete(key);
      this.resolveIdleIfNeeded();
      this.tick();
    });
    return promise;
  }

  activeKeys(): string[] {
    return [...this.activeKeysSet];
  }

  async whenIdle(): Promise<void> {
    if (this.activeKeysSet.size === 0 && this.queue.length === 0) {
      return;
    }
    await new Promise<void>((resolve) => {
      this.idleResolvers.push(resolve);
    });
  }

  private tick(): void {
    while (this.activeKeysSet.size < this.concurrency && this.queue.length > 0) {
      const next = this.queue.shift();
      if (!next) {
        break;
      }
      this.activeKeysSet.add(next.key);
      void next.task().then(next.resolve, next.reject);
    }
  }

  private resolveIdleIfNeeded(): void {
    if (this.activeKeysSet.size !== 0 || this.queue.length !== 0) {
      return;
    }
    for (const resolve of this.idleResolvers.splice(0)) {
      resolve();
    }
  }
}
