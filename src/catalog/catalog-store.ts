import fs from 'node:fs/promises';
import path from 'node:path';
import type { ServiceConfig } from '../config/types.js';
import type { CacheEntry, CacheState } from '../domain/cache-entry.js';
import { diagnostic, type DiagnosticCode, type DiagnosticItem } from '../domain/diagnostics.js';
import type { PlannedTargetRecord, TargetSelection } from '../domain/release-asset.js';
import type { ServiceMode, ServiceRuntimeState, SourceFailureSummary } from '../domain/service-status.js';

export interface CatalogState {
  version: number;
  service: ServiceRuntimeState;
  targets: Record<string, PlannedTargetRecord>;
  entries: Record<string, CacheEntry>;
}

interface TrafficCheckpoint {
  downloadedBytes: number;
  uploadedBytes: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

function deriveServiceMode(service: ServiceRuntimeState, entries: CacheEntry[]): ServiceMode {
  if (entries.some((entry) => entry.state === 'error')) {
    return 'error';
  }
  if (entries.some((entry) => entry.state === 'verifying')) {
    return 'verifying';
  }
  if (entries.some((entry) => entry.state === 'fallback')) {
    return 'fallback';
  }
  if (entries.some((entry) => entry.state === 'downloading')) {
    return 'downloading';
  }
  if (entries.some((entry) => entry.state === 'shared')) {
    return 'shared';
  }
  if (service.lastScanStartedAt && service.lastScanStartedAt !== service.lastScanCompletedAt) {
    return 'discovering';
  }
  return 'idle';
}

function createEmptyState(config: ServiceConfig): CatalogState {
  const startedAt = nowIso();
  return {
    version: 1,
    service: {
      live: true,
      ready: false,
      mode: 'idle',
      startedAt,
      trafficStartedAt: startedAt,
      trafficUpdatedAt: startedAt,
      totalDownloadedBytes: 0,
      totalUploadedBytes: 0,
      enabledSourceCount: config.sources.filter((source) => source.enabled).length,
      recentFailures: [],
      diagnostics: [],
    },
    targets: {},
    entries: {},
  };
}

export class CatalogStore {
  private state: CatalogState;
  private persistPromise: Promise<void> = Promise.resolve();
  private trafficCheckpoints = new Map<string, TrafficCheckpoint>();

  constructor(private readonly config: ServiceConfig) {
    this.state = createEmptyState(config);
  }

  async initialize(): Promise<void> {
    await fs.mkdir(path.dirname(this.config.catalogPath), { recursive: true });
    await fs.mkdir(this.config.cacheDir, { recursive: true });
    await fs.mkdir(this.config.tempDir, { recursive: true });
    await fs.mkdir(this.config.quarantineDir, { recursive: true });

    try {
      const raw = await fs.readFile(this.config.catalogPath, 'utf8');
      const parsed = JSON.parse(raw) as CatalogState;
      if (parsed && parsed.version === 1) {
        this.state = parsed;
      }
    } catch {
      this.state = createEmptyState(this.config);
    }

    const recoveredAt = nowIso();
    this.trafficCheckpoints.clear();
    this.state.service.live = true;
    this.state.service.catalogRecoveredAt = recoveredAt;
    this.state.service.trafficStartedAt = recoveredAt;
    this.state.service.trafficUpdatedAt = recoveredAt;
    this.state.service.totalDownloadedBytes = 0;
    this.state.service.totalUploadedBytes = 0;
    this.state.service.enabledSourceCount = this.config.sources.filter((source) => source.enabled).length;
    this.state.service.ready = Boolean(this.state.service.catalogRecoveredAt && this.state.service.lastSuccessfulScanAt);
    this.state.service.mode = deriveServiceMode(this.state.service, this.listEntries());
    await this.persist();
  }

  snapshot(): CatalogState {
    return structuredClone(this.state);
  }

  listEntries(): CacheEntry[] {
    return Object.values(this.state.entries);
  }

  getEntry(id: string): CacheEntry | undefined {
    return this.state.entries[id];
  }

  getTarget(id: string): PlannedTargetRecord | undefined {
    return this.state.targets[id];
  }

  async recordScanStarted(): Promise<void> {
    this.state.service.lastScanStartedAt = nowIso();
    this.state.service.mode = 'discovering';
    await this.persist();
  }

  async recordPlan(records: PlannedTargetRecord[]): Promise<void> {
    this.state.targets = Object.fromEntries(records.map((record) => [record.id, record]));
    for (const record of records) {
      if (!record.selected) {
        const existing = this.state.entries[record.id];
        if (existing) {
          existing.retention = record.retention;
          existing.lastSeenAt = record.evaluatedAt;
          existing.updatedAt = record.evaluatedAt;
          existing.diagnostics = record.diagnostics;
        }
        continue;
      }

      const filePath = path.join(this.config.cacheDir, record.asset.relativePath);
      const existing = this.state.entries[record.id];
      if (existing) {
        existing.retention = record.retention;
        existing.lastSeenAt = record.evaluatedAt;
        existing.updatedAt = record.evaluatedAt;
        existing.diagnostics = record.diagnostics;
        existing.filePath = filePath;
        continue;
      }

      this.state.entries[record.id] = {
        id: record.id,
        sourceId: record.asset.sourceId,
        version: record.asset.version,
        channel: record.asset.channel,
        platform: record.asset.platform,
        assetKind: record.asset.assetKind,
        name: record.asset.name,
        filePath,
        relativePath: record.asset.relativePath,
        size: record.asset.size,
        state: 'planned',
        retention: record.retention,
        hybrid: record.asset.hybrid,
        diagnostics: record.diagnostics,
        createdAt: record.evaluatedAt,
        updatedAt: record.evaluatedAt,
        lastSeenAt: record.evaluatedAt,
        bytesDone: 0,
        bytesTotal: record.asset.size,
        downloadRate: 0,
        uploadRate: 0,
        peerCount: 0,
      };
    }

    this.state.service.mode = deriveServiceMode(this.state.service, this.listEntries());
    await this.persist();
  }

  async recordScanCompleted(failures: SourceFailureSummary[]): Promise<void> {
    const finishedAt = nowIso();
    this.state.service.lastScanCompletedAt = finishedAt;
    if (failures.length === 0) {
      this.state.service.lastSuccessfulScanAt = finishedAt;
    }
    this.state.service.ready = Boolean(this.state.service.catalogRecoveredAt && this.state.service.lastSuccessfulScanAt);
    this.state.service.recentFailures = failures.slice(-5);
    this.state.service.mode = deriveServiceMode(this.state.service, this.listEntries());
    await this.persist();
  }

  async ensureTargetEntry(target: TargetSelection): Promise<void> {
    const existing = this.state.entries[target.id];
    const stamp = nowIso();
    if (existing) {
      existing.retention = target.retention;
      existing.lastSeenAt = stamp;
      existing.updatedAt = stamp;
      existing.filePath = path.join(this.config.cacheDir, target.asset.relativePath);
      return;
    }

    this.state.entries[target.id] = {
      id: target.id,
      sourceId: target.sourceId,
      version: target.version,
      channel: target.channel,
      platform: target.platform,
      assetKind: target.assetKind,
      name: target.asset.name,
      filePath: path.join(this.config.cacheDir, target.asset.relativePath),
      relativePath: target.asset.relativePath,
      size: target.asset.size,
      state: 'planned',
      retention: target.retention,
      hybrid: target.asset.hybrid,
      diagnostics: target.asset.diagnostics,
      createdAt: stamp,
      updatedAt: stamp,
      lastSeenAt: stamp,
      bytesDone: 0,
      bytesTotal: target.asset.size,
      downloadRate: 0,
      uploadRate: 0,
      peerCount: 0,
    };
    await this.persist();
  }

  async markTransferState(id: string, state: Extract<CacheState, 'downloading' | 'fallback' | 'verifying'>): Promise<void> {
    const entry = this.requireEntry(id);
    entry.state = state;
    entry.updatedAt = nowIso();
    delete entry.lastError;
    if (state === 'verifying') {
      this.resetTrafficCheckpoint(id);
    }
    this.state.service.mode = deriveServiceMode(this.state.service, this.listEntries());
    await this.persist();
  }

  recordProgress(id: string, progress: {
    mode: 'downloading' | 'fallback' | 'shared';
    bytesDone: number;
    bytesTotal: number;
    downloadedBytes: number;
    uploadedBytes: number;
    downloadRate: number;
    uploadRate: number;
    peerCount: number;
  }): void {
    const entry = this.requireEntry(id);
    const stamp = nowIso();
    const checkpoint = this.trafficCheckpoints.get(id);
    const downloadBase = checkpoint && progress.downloadedBytes >= checkpoint.downloadedBytes ? checkpoint.downloadedBytes : 0;
    const uploadBase = checkpoint && progress.uploadedBytes >= checkpoint.uploadedBytes ? checkpoint.uploadedBytes : 0;
    const downloadedDelta = Math.max(0, progress.downloadedBytes - downloadBase);
    const uploadedDelta = Math.max(0, progress.uploadedBytes - uploadBase);

    if (downloadedDelta > 0 || uploadedDelta > 0) {
      this.state.service.totalDownloadedBytes += downloadedDelta;
      this.state.service.totalUploadedBytes += uploadedDelta;
      this.state.service.trafficUpdatedAt = stamp;
    }
    this.trafficCheckpoints.set(id, {
      downloadedBytes: progress.downloadedBytes,
      uploadedBytes: progress.uploadedBytes,
    });

    if (progress.mode === 'shared') {
      entry.state = 'shared';
    } else {
      entry.state = progress.mode === 'fallback' ? 'fallback' : 'downloading';
    }
    entry.updatedAt = stamp;
    entry.bytesDone = progress.bytesDone;
    entry.bytesTotal = progress.bytesTotal;
    entry.downloadRate = progress.downloadRate;
    entry.uploadRate = progress.uploadRate;
    entry.peerCount = progress.peerCount;
    this.state.service.mode = deriveServiceMode(this.state.service, this.listEntries());
  }

  async markVerified(id: string, filePath?: string): Promise<void> {
    const stamp = nowIso();
    const entry = this.requireEntry(id);
    entry.state = 'verified';
    entry.filePath = filePath ?? entry.filePath;
    entry.updatedAt = stamp;
    entry.verifiedAt = stamp;
    entry.bytesDone = entry.size;
    entry.bytesTotal = entry.size;
    entry.downloadRate = 0;
    entry.uploadRate = 0;
    entry.peerCount = 0;
    this.resetTrafficCheckpoint(id);
    this.state.service.mode = deriveServiceMode(this.state.service, this.listEntries());
    await this.persist();
  }

  async markShared(id: string): Promise<void> {
    const entry = this.requireEntry(id);
    entry.state = 'shared';
    entry.updatedAt = nowIso();
    entry.bytesDone = entry.size;
    entry.bytesTotal = entry.size;
    entry.downloadRate = 0;
    delete entry.lastError;
    this.state.service.mode = deriveServiceMode(this.state.service, this.listEntries());
    await this.persist();
  }

  async markRestored(id: string, sharingEnabled: boolean): Promise<void> {
    const entry = this.requireEntry(id);
    const stamp = nowIso();
    entry.state = sharingEnabled ? 'shared' : 'verified';
    entry.updatedAt = stamp;
    entry.verifiedAt = entry.verifiedAt ?? stamp;
    entry.bytesDone = entry.size;
    entry.bytesTotal = entry.size;
    entry.downloadRate = 0;
    if (!sharingEnabled) {
      entry.uploadRate = 0;
      entry.peerCount = 0;
    }
    entry.diagnostics = [...entry.diagnostics, diagnostic('restored', 'entry restored from catalog', stamp)];
    if (!sharingEnabled) {
      entry.diagnostics = [...entry.diagnostics, diagnostic('sharing-disabled', 'sharing disabled, seeding skipped', stamp)];
    }
    this.state.service.mode = deriveServiceMode(this.state.service, this.listEntries());
    await this.persist();
  }

  async markError(id: string, code: DiagnosticCode, message: string): Promise<void> {
    const entry = this.requireEntry(id);
    const stamp = nowIso();
    entry.state = 'error';
    entry.updatedAt = stamp;
    entry.lastError = message;
    entry.downloadRate = 0;
    entry.uploadRate = 0;
    entry.peerCount = 0;
    entry.diagnostics = [...entry.diagnostics.slice(-9), diagnostic(code, message, stamp)];
    this.resetTrafficCheckpoint(id);
    this.state.service.mode = deriveServiceMode(this.state.service, this.listEntries());
    await this.persist();
  }

  async markCleaned(id: string, reason: string): Promise<void> {
    const entry = this.requireEntry(id);
    const stamp = nowIso();
    entry.state = 'cleaned';
    entry.cleanedAt = stamp;
    entry.updatedAt = stamp;
    entry.lastError = reason;
    entry.downloadRate = 0;
    entry.uploadRate = 0;
    entry.peerCount = 0;
    entry.diagnostics = [...entry.diagnostics.slice(-9), diagnostic('cleaned-up', reason, stamp)];
    this.resetTrafficCheckpoint(id);
    this.state.service.mode = deriveServiceMode(this.state.service, this.listEntries());
    await this.persist();
  }

  async setSharingEnabled(enabled: boolean): Promise<void> {
    if (!enabled) {
      const stamp = nowIso();
      for (const entry of Object.values(this.state.entries)) {
        if (entry.state === 'shared') {
          entry.state = 'verified';
          entry.updatedAt = stamp;
          entry.uploadRate = 0;
          entry.peerCount = 0;
          entry.diagnostics = [...entry.diagnostics.slice(-9), diagnostic('sharing-disabled', 'sharing disabled, kept verified cache', stamp)];
          this.resetTrafficCheckpoint(entry.id);
        }
      }
    }
    this.state.service.mode = deriveServiceMode(this.state.service, this.listEntries());
    await this.persist();
  }

  private requireEntry(id: string): CacheEntry {
    const entry = this.state.entries[id];
    if (!entry) {
      throw new Error(`Missing catalog entry: ${id}`);
    }
    return entry;
  }

  private resetTrafficCheckpoint(id: string): void {
    this.trafficCheckpoints.delete(id);
  }

  private async persist(): Promise<void> {
    this.persistPromise = this.persistPromise.then(async () => {
      const filePath = this.config.catalogPath;
      const tempPath = `${filePath}.tmp`;
      const payload = JSON.stringify(this.state, null, 2);
      await fs.writeFile(tempPath, payload, 'utf8');
      await fs.rename(tempPath, filePath);
    });
    await this.persistPromise;
  }
}
