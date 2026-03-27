import fs from 'node:fs/promises';
import type { ServiceConfig } from '../config/types.js';
import { CatalogStore } from '../catalog/catalog-store.js';
import { CleanupPolicy } from '../catalog/cleanup-policy.js';
import { SourceRegistry } from '../feeds/source-registry.js';
import { IndexFeedClient } from '../feeds/index-feed-client.js';
import { TargetSelector } from '../planner/target-selector.js';
import type { TargetSelection } from '../domain/release-asset.js';
import type { SourceFailureSummary } from '../domain/service-status.js';
import { HybridTransfer } from '../torrent/hybrid-transfer.js';
import { TaskRunner } from './task-runner.js';

export class CacheMonitor {
  private intervalHandle: NodeJS.Timeout | null = null;
  private startPromise: Promise<void> | null = null;
  private scanPromise: Promise<void> | null = null;

  constructor(
    private readonly config: ServiceConfig,
    private readonly registry: SourceRegistry,
    private readonly feedClient: IndexFeedClient,
    private readonly selector: TargetSelector,
    private readonly catalog: CatalogStore,
    private readonly cleanupPolicy: CleanupPolicy,
    private readonly transfer: HybridTransfer,
    private readonly tasks: TaskRunner,
  ) {}

  start(): Promise<void> {
    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = (async () => {
      await this.catalog.initialize();
      await this.restoreEntries();
      await this.scanOnce();
      this.intervalHandle = setInterval(() => {
        void this.scanOnce();
      }, this.config.pollIntervalMs);
    })();

    return this.startPromise;
  }

  async stop(): Promise<void> {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    await this.tasks.whenIdle();
    await this.transfer.stopAll();
  }

  async scanOnce(): Promise<void> {
    if (this.scanPromise) {
      return this.scanPromise;
    }

    this.scanPromise = (async () => {
      await this.catalog.recordScanStarted();
      const failures: SourceFailureSummary[] = [];
      const assets = [];

      for (const source of this.registry.listEnabled()) {
        try {
          const sourceAssets = await this.feedClient.fetchSource(source);
          assets.push(...sourceAssets);
        } catch (error) {
          failures.push({
            sourceId: source.id,
            message: error instanceof Error ? error.message : String(error),
            at: new Date().toISOString(),
          });
        }
      }

      const plan = this.selector.buildPlan(assets, this.registry.listEnabled());
      await this.catalog.recordPlan(plan.records);

      for (const target of plan.selectedTargets) {
        await this.catalog.ensureTargetEntry(target);
        void this.tasks.runOnce(target.id, async () => {
          await this.processTarget(target);
        }).catch(async (error) => {
          const message = error instanceof Error ? error.message : String(error);
          await this.catalog.markError(target.id, 'download-failed', message);
        });
      }

      const cleanup = this.cleanupPolicy.evaluate(this.catalog.listEntries(), new Set(plan.selectedTargets.map((target) => target.id)));
      for (const decision of cleanup) {
        await this.transfer.stopSeeding(decision.id);
        await fs.rm(decision.filePath, { force: true }).catch(() => undefined);
        await this.catalog.markCleaned(decision.id, decision.reason);
      }

      await this.catalog.recordScanCompleted(failures);
    })().finally(() => {
      this.scanPromise = null;
    });

    return this.scanPromise;
  }

  private async restoreEntries(): Promise<void> {
    for (const entry of this.catalog.listEntries()) {
      if (entry.state === 'verified' || entry.state === 'shared') {
        await this.transfer.restoreEntry(entry);
        continue;
      }

      if (entry.state === 'downloading' || entry.state === 'fallback' || entry.state === 'verifying') {
        await this.catalog.markError(entry.id, 'interrupted-transfer', 'previous process ended during active transfer');
      }
    }
  }

  private async processTarget(target: TargetSelection): Promise<void> {
    const entry = this.catalog.getEntry(target.id);
    if (entry && (entry.state === 'verified' || entry.state === 'shared')) {
      await this.transfer.restoreEntry(entry);
      return;
    }

    await this.transfer.ensureCached(target);
  }
}
