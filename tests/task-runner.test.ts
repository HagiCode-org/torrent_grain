import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskRunner } from '../src/scheduler/task-runner.js';

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('task runner', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not emit unhandled rejection when a task fails', async () => {
    const runner = new TaskRunner(1);
    const unhandled = vi.fn();
    process.once('unhandledRejection', unhandled);

    await expect(runner.runOnce('failed-task', async () => {
      throw new Error('boom');
    })).rejects.toThrow(/boom/);

    await runner.whenIdle();
    await flushMicrotasks();

    process.removeListener('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});
