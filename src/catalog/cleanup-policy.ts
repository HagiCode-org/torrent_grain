import type { ServiceConfig } from '../config/types.js';
import type { CacheEntry } from '../domain/cache-entry.js';

export interface CleanupDecision {
  id: string;
  filePath: string;
  reason: string;
}

export class CleanupPolicy {
  constructor(private readonly config: ServiceConfig) {}

  evaluate(entries: CacheEntry[], selectedTargetIds: Set<string>, now = new Date()): CleanupDecision[] {
    const decisions = new Map<string, CleanupDecision>();
    const protectedIds = new Set(
      entries
        .filter((entry) => entry.retention.includes('pinned') || selectedTargetIds.has(entry.id))
        .map((entry) => entry.id),
    );

    const candidates = entries
      .filter((entry) => !protectedIds.has(entry.id))
      .filter((entry) => entry.state === 'verified' || entry.state === 'shared' || entry.state === 'error' || entry.state === 'cleaned')
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));

    const retentionCutoff = now.getTime() - this.config.retentionDays * 24 * 60 * 60 * 1000;
    for (const entry of candidates) {
      const updatedAt = Date.parse(entry.updatedAt);
      if (Number.isFinite(updatedAt) && updatedAt < retentionCutoff) {
        decisions.set(entry.id, {
          id: entry.id,
          filePath: entry.filePath,
          reason: 'retention window exceeded',
        });
      }
    }

    const remainingEntries = entries
      .filter((entry) => entry.state === 'verified' || entry.state === 'shared')
      .filter((entry) => !decisions.has(entry.id))
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));

    let count = remainingEntries.length;
    for (const entry of remainingEntries) {
      if (count <= this.config.maxEntries) {
        break;
      }
      if (protectedIds.has(entry.id)) {
        continue;
      }
      decisions.set(entry.id, {
        id: entry.id,
        filePath: entry.filePath,
        reason: 'max entry count exceeded',
      });
      count -= 1;
    }

    let totalBytes = remainingEntries
      .filter((entry) => !decisions.has(entry.id))
      .reduce((sum, entry) => sum + entry.size, 0);

    for (const entry of remainingEntries) {
      if (totalBytes <= this.config.cacheCapacityBytes) {
        break;
      }
      if (protectedIds.has(entry.id) || decisions.has(entry.id)) {
        continue;
      }
      decisions.set(entry.id, {
        id: entry.id,
        filePath: entry.filePath,
        reason: 'cache capacity exceeded',
      });
      totalBytes -= entry.size;
    }

    return [...decisions.values()];
  }
}
