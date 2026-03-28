import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ServiceConfig } from '../src/config/types.js';
import type { TransferAdapter, TransferProgress, TransferRequest } from '../src/torrent/torrent-session-manager.js';

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export async function makeTempConfig(overrides?: Partial<ServiceConfig>): Promise<ServiceConfig> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'torrent-grain-'));
  return {
    appVersion: '0.1.0-test',
    host: '127.0.0.1',
    port: 0,
    dataDir,
    cacheDir: path.join(dataDir, 'cache'),
    tempDir: path.join(dataDir, 'temp'),
    quarantineDir: path.join(dataDir, 'quarantine'),
    catalogPath: path.join(dataDir, 'catalog.json'),
    pollIntervalMs: 60_000,
    stallTimeoutMs: 1_000,
    concurrency: 2,
    cacheCapacityBytes: 10 * 1024 * 1024,
    maxEntries: 10,
    retentionDays: 30,
    sharingEnabled: true,
    httpFallbackEnabled: true,
    uploadLimitKib: 1024,
    sources: [
      {
        id: 'desktop',
        kind: 'desktop',
        label: 'Desktop',
        indexUrl: 'https://index.example.com/desktop/index.json',
        enabled: true,
        latestPerGroup: 2,
        pinnedVersions: [],
      },
    ],
    ...overrides,
  };
}

export class FakeTransferAdapter implements TransferAdapter {
  downloads = 0;
  ensuredSeeds: string[] = [];
  stoppedSeeds: string[] = [];
  constructor(
    private readonly payloads: Record<string, string>,
    private readonly mode: 'downloading' | 'fallback' = 'fallback',
    private readonly seedingProgress?: Pick<TransferProgress, 'downloadRate' | 'uploadRate' | 'peerCount'>,
    private readonly options: {
      downloadProgress?: Array<Partial<TransferProgress>>;
      seedingProgress?: Array<Partial<TransferProgress>>;
    } = {},
  ) {}

  async download(request: TransferRequest, onProgress: (progress: TransferProgress) => void) {
    this.downloads += 1;
    if (this.mode === 'fallback' && !request.httpFallbackEnabled) {
      throw new Error(`HTTP fallback disabled for ${request.targetId}`);
    }
    const payload = this.payloads[request.targetId] ?? this.payloads.default ?? '';
    const outputPath = path.join(request.tempDir, request.fileName);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, payload, 'utf8');
    const defaultProgress: TransferProgress = {
      mode: this.mode,
      bytesDone: Buffer.byteLength(payload),
      bytesTotal: Buffer.byteLength(payload),
      downloadedBytes: Buffer.byteLength(payload),
      uploadedBytes: 0,
      downloadRate: Buffer.byteLength(payload),
      uploadRate: 0,
      peerCount: this.mode === 'downloading' ? 2 : 0,
    };
    this.emitProgressSequence(onProgress, defaultProgress, this.options.downloadProgress);
    return {
      tempFilePath: outputPath,
      usedFallback: this.mode === 'fallback',
    };
  }

  async ensureSeeding(request: { targetId: string; onProgress?: (progress: TransferProgress) => void }) {
    this.ensuredSeeds.push(request.targetId);
    if (request.onProgress && (this.seedingProgress || this.options.seedingProgress?.length)) {
      const defaultProgress: TransferProgress = {
        mode: 'shared',
        bytesDone: 0,
        bytesTotal: 0,
        downloadedBytes: 0,
        uploadedBytes: 0,
        downloadRate: this.seedingProgress?.downloadRate ?? 0,
        uploadRate: this.seedingProgress?.uploadRate ?? 0,
        peerCount: this.seedingProgress?.peerCount ?? 0,
      };
      this.emitProgressSequence(request.onProgress, defaultProgress, this.options.seedingProgress);
    }
  }

  async stopSeeding(targetId: string) {
    this.stoppedSeeds.push(targetId);
  }

  async stopAll() {
    return;
  }

  private emitProgressSequence(
    onProgress: (progress: TransferProgress) => void,
    defaults: TransferProgress,
    overrides?: Array<Partial<TransferProgress>>,
  ) {
    const sequence = overrides && overrides.length > 0
      ? overrides.map((item) => ({ ...defaults, ...item }))
      : [defaults];
    for (const progress of sequence) {
      onProgress(progress);
    }
  }
}
