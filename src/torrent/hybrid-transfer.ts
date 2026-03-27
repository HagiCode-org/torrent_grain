import fs from 'node:fs/promises';
import path from 'node:path';
import type { ServiceConfig } from '../config/types.js';
import type { CacheEntry } from '../domain/cache-entry.js';
import type { TargetSelection } from '../domain/release-asset.js';
import { CatalogStore } from '../catalog/catalog-store.js';
import { HashVerifier } from './hash-verifier.js';
import { WebTorrentTransferAdapter, type TransferAdapter, type TransferProgress, type TransferRequest } from './torrent-session-manager.js';

function sanitizeForPath(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_');
}

export class HybridTransfer {
  constructor(
    private readonly config: ServiceConfig,
    private readonly catalog: CatalogStore,
    private readonly adapter: TransferAdapter = new WebTorrentTransferAdapter(),
    private readonly verifier: HashVerifier = new HashVerifier(),
  ) {}

  async ensureCached(target: TargetSelection): Promise<void> {
    await this.catalog.ensureTargetEntry(target);
    const finalPath = path.join(this.config.cacheDir, target.asset.relativePath);
    await fs.mkdir(path.dirname(finalPath), { recursive: true });

    if (await this.tryRestoreVerifiedFile(target.id, finalPath)) {
      return;
    }

    const tempDir = path.join(this.config.tempDir, sanitizeForPath(target.id));
    await fs.rm(tempDir, { recursive: true, force: true });
    await fs.mkdir(tempDir, { recursive: true });

    const request: TransferRequest = {
      targetId: target.id,
      fileName: target.asset.name,
      hybrid: target.asset.hybrid,
      tempDir,
      stallTimeoutMs: this.config.stallTimeoutMs,
      uploadLimitKib: this.config.uploadLimitKib,
      httpFallbackEnabled: this.config.httpFallbackEnabled,
    };

    await this.catalog.markTransferState(target.id, 'downloading');

    let result;
    try {
      result = await this.adapter.download(request, (progress) => {
        this.catalog.recordProgress(target.id, progress);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.catalog.markError(target.id, 'download-failed', message);
      throw error;
    }

    await this.catalog.markTransferState(target.id, 'verifying');
    const expectedHash = target.asset.hybrid.sha256;
    if (!expectedHash) {
      await this.catalog.markError(target.id, 'verification-failed', 'missing expected sha256');
      throw new Error(`Missing sha256 for ${target.id}`);
    }

    const verified = await this.verifier.verifyFile(result.tempFilePath, expectedHash);
    if (!verified) {
      await this.quarantineFile(result.tempFilePath, `${sanitizeForPath(target.id)}.bad`);
      await this.catalog.markError(target.id, 'verification-failed', 'sha256 verification failed');
      throw new Error(`sha256 verification failed for ${target.id}`);
    }

    await fs.rm(finalPath, { force: true });
    await fs.rename(result.tempFilePath, finalPath);
    await fs.rm(tempDir, { recursive: true, force: true });
    await this.catalog.markVerified(target.id, finalPath);

    if (this.config.sharingEnabled) {
      await this.adapter.ensureSeeding({
        targetId: target.id,
        filePath: finalPath,
        hybrid: target.asset.hybrid,
        uploadLimitKib: this.config.uploadLimitKib,
        onProgress: (progress) => {
          this.catalog.recordProgress(target.id, progress);
        },
      });
      await this.catalog.markShared(target.id);
      return;
    }

    await this.catalog.markRestored(target.id, false);
  }

  async restoreEntry(entry: CacheEntry): Promise<void> {
    const exists = await fs.stat(entry.filePath).then(() => true).catch(() => false);
    if (!exists) {
      await this.catalog.markError(entry.id, 'interrupted-transfer', 'catalog entry points to missing cache file');
      return;
    }

    if (entry.hybrid.sha256) {
      const verified = await this.verifier.verifyFile(entry.filePath, entry.hybrid.sha256);
      if (!verified) {
        await this.catalog.markError(entry.id, 'verification-failed', 'restored file failed sha256 verification');
        return;
      }
    }

    if (this.config.sharingEnabled) {
      await this.adapter.ensureSeeding({
        targetId: entry.id,
        filePath: entry.filePath,
        hybrid: entry.hybrid,
        uploadLimitKib: this.config.uploadLimitKib,
        onProgress: (progress) => {
          this.catalog.recordProgress(entry.id, progress);
        },
      });
      await this.catalog.markRestored(entry.id, true);
      return;
    }

    await this.catalog.markRestored(entry.id, false);
  }

  async stopSeeding(id: string): Promise<void> {
    await this.adapter.stopSeeding(id);
  }

  async stopAll(): Promise<void> {
    await this.adapter.stopAll();
  }

  private async tryRestoreVerifiedFile(id: string, finalPath: string): Promise<boolean> {
    const entry = this.catalog.getEntry(id);
    if (!entry) {
      return false;
    }
    if (!['verified', 'shared'].includes(entry.state)) {
      return false;
    }
    const exists = await fs.stat(finalPath).then(() => true).catch(() => false);
    if (!exists || !entry.hybrid.sha256) {
      return false;
    }

    const verified = await this.verifier.verifyFile(finalPath, entry.hybrid.sha256);
    if (!verified) {
      return false;
    }

    if (this.config.sharingEnabled) {
      await this.adapter.ensureSeeding({
        targetId: id,
        filePath: finalPath,
        hybrid: entry.hybrid,
        uploadLimitKib: this.config.uploadLimitKib,
        onProgress: (progress) => {
          this.catalog.recordProgress(id, progress);
        },
      });
      await this.catalog.markShared(id);
      return true;
    }

    await this.catalog.markVerified(id, finalPath);
    return true;
  }

  private async quarantineFile(filePath: string, fileName: string): Promise<void> {
    const quarantinePath = path.join(this.config.quarantineDir, fileName);
    await fs.mkdir(path.dirname(quarantinePath), { recursive: true });
    await fs.rename(filePath, quarantinePath).catch(async () => {
      await fs.rm(filePath, { force: true });
    });
  }
}

export type { TransferAdapter, TransferProgress };
