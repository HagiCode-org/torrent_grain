import type { ServiceConfig } from './config/types.js';
import { CatalogStore } from './catalog/catalog-store.js';
import { CleanupPolicy } from './catalog/cleanup-policy.js';
import { IndexFeedClient, type FetchLike } from './feeds/index-feed-client.js';
import { SourceRegistry } from './feeds/source-registry.js';
import { StatusHttpServer } from './http/server.js';
import { SnapshotProjector } from './catalog/snapshot-projector.js';
import { TargetSelector } from './planner/target-selector.js';
import { CacheMonitor } from './scheduler/cache-monitor.js';
import { TaskRunner } from './scheduler/task-runner.js';
import { HybridTransfer } from './torrent/hybrid-transfer.js';
import { WebTorrentTransferAdapter, type TransferAdapter } from './torrent/torrent-session-manager.js';

export interface Application {
  start(): Promise<void>;
  stop(): Promise<void>;
  catalog: CatalogStore;
  monitor: CacheMonitor;
  httpServer: StatusHttpServer;
}

export function createApplication(
  config: ServiceConfig,
  dependencies?: {
    fetchImpl?: FetchLike;
    transferAdapter?: TransferAdapter;
    uiDistDir?: string;
  },
): Application {
  const catalog = new CatalogStore(config);
  const registry = new SourceRegistry(config.sources);
  const feedClient = new IndexFeedClient(dependencies?.fetchImpl ?? fetch);
  const selector = new TargetSelector();
  const cleanupPolicy = new CleanupPolicy(config);
  const transfer = new HybridTransfer(config, catalog, dependencies?.transferAdapter ?? new WebTorrentTransferAdapter());
  const tasks = new TaskRunner(config.concurrency);
  const monitor = new CacheMonitor(config, registry, feedClient, selector, catalog, cleanupPolicy, transfer, tasks);
  const httpServer = new StatusHttpServer(config, catalog, new SnapshotProjector(), dependencies?.uiDistDir);

  return {
    catalog,
    monitor,
    httpServer,
    async start() {
      await monitor.start();
      await httpServer.start();
    },
    async stop() {
      await httpServer.stop();
      await monitor.stop();
    },
  };
}
