import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { HybridMetadata } from '../domain/release-asset.js';

export interface TransferRequest {
  targetId: string;
  fileName: string;
  hybrid: HybridMetadata;
  tempDir: string;
  stallTimeoutMs: number;
  uploadLimitKib: number;
  httpFallbackEnabled: boolean;
}

export interface TransferProgress {
  mode: 'downloading' | 'fallback' | 'shared';
  bytesDone: number;
  bytesTotal: number;
  downloadedBytes: number;
  uploadedBytes: number;
  downloadRate: number;
  uploadRate: number;
  peerCount: number;
}

export interface TransferResult {
  tempFilePath: string;
  usedFallback: boolean;
}

export interface SeedingRequest {
  targetId: string;
  filePath: string;
  hybrid: HybridMetadata;
  uploadLimitKib: number;
  onProgress?: (progress: TransferProgress) => void;
}

export interface TransferAdapter {
  download(request: TransferRequest, onProgress: (progress: TransferProgress) => void): Promise<TransferResult>;
  ensureSeeding(request: SeedingRequest): Promise<void>;
  stopSeeding(targetId: string): Promise<void>;
  stopAll(): Promise<void>;
}

export class WebTorrentTransferAdapter implements TransferAdapter {
  private client: any | null = null;
  private torrents = new Map<string, { torrent: any; reportTimer?: NodeJS.Timeout }>();

  async download(request: TransferRequest, onProgress: (progress: TransferProgress) => void): Promise<TransferResult> {
    try {
      const torrentPath = await this.downloadViaTorrent(request, onProgress);
      return {
        tempFilePath: torrentPath,
        usedFallback: false,
      };
    } catch {
      if (!request.httpFallbackEnabled) {
        throw new Error(`HTTP fallback disabled for ${request.targetId}`);
      }
      const fallbackPath = await this.downloadViaHttpFallback(request, onProgress);
      return {
        tempFilePath: fallbackPath,
        usedFallback: true,
      };
    }
  }

  async ensureSeeding(request: SeedingRequest): Promise<void> {
    if (this.torrents.has(request.targetId)) {
      return;
    }
    if (!request.hybrid.torrentUrl && !request.hybrid.infoHash) {
      return;
    }

    const client = await this.getClient(request.uploadLimitKib);
    const torrentId = request.hybrid.torrentUrl ?? request.hybrid.infoHash;
    const torrent = client.add(torrentId, {
      path: path.dirname(request.filePath),
      skipVerify: true,
      destroyStoreOnDestroy: false,
    });
    const report = () => {
      request.onProgress?.({
        mode: 'shared',
        bytesDone: Number(torrent.length ?? 0),
        bytesTotal: Number(torrent.length ?? 0),
        downloadedBytes: 0,
        uploadedBytes: Number(torrent.uploaded ?? 0),
        downloadRate: Number(torrent.downloadSpeed ?? 0),
        uploadRate: Number(torrent.uploadSpeed ?? 0),
        peerCount: Number(torrent.numPeers ?? 0),
      });
    };

    torrent.on('ready', () => {
      for (const seed of request.hybrid.webSeeds) {
        torrent.addWebSeed(seed);
      }
      if (request.hybrid.directUrl) {
        torrent.addWebSeed(request.hybrid.directUrl);
      }
      report();
    });
    torrent.on('wire', report);
    torrent.on('upload', report);
    torrent.on('warning', report);

    const reportTimer = setInterval(report, 1000);
    this.torrents.set(request.targetId, { torrent, reportTimer });
  }

  async stopSeeding(targetId: string): Promise<void> {
    const session = this.torrents.get(targetId);
    if (!session) {
      return;
    }
    if (session.reportTimer) {
      clearInterval(session.reportTimer);
    }
    await new Promise<void>((resolve) => {
      session.torrent.destroy({ destroyStore: false }, () => resolve());
    });
    this.torrents.delete(targetId);
  }

  async stopAll(): Promise<void> {
    const ids = [...this.torrents.keys()];
    for (const id of ids) {
      await this.stopSeeding(id);
    }
    if (this.client) {
      await new Promise<void>((resolve) => this.client.destroy(() => resolve()));
      this.client = null;
    }
  }

  private async downloadViaTorrent(request: TransferRequest, onProgress: (progress: TransferProgress) => void): Promise<string> {
    if (!request.hybrid.torrentUrl && !request.hybrid.infoHash) {
      throw new Error('missing torrent metadata');
    }

    const client = await this.getClient(request.uploadLimitKib);
    const torrentId = request.hybrid.torrentUrl ?? request.hybrid.infoHash;

    return await new Promise<string>((resolve, reject) => {
      let bytesDone = 0;
      let lastUpdate = Date.now();
      let settled = false;

      const torrent = client.add(torrentId, {
        path: request.tempDir,
        destroyStoreOnDestroy: false,
        maxWebConns: 8,
      });

      const teardown = async (error?: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearInterval(stallTimer);
        this.torrents.delete(request.targetId);
        await new Promise<void>((resolveDestroy) => torrent.destroy({ destroyStore: false }, () => resolveDestroy()));
        if (error) {
          reject(error);
        }
      };

      const report = () => {
        const current = Number(torrent.downloaded ?? 0);
        const total = Number(torrent.length ?? 0);
        const delta = Math.max(0, current - bytesDone);
        if (delta > 0) {
          bytesDone = current;
          lastUpdate = Date.now();
        }
        const hasPeer = Array.isArray(torrent.wires) && torrent.wires.some((wire: { type?: string }) => wire.type !== 'webSeed');
        const hasWebSeed = Array.isArray(torrent.wires) && torrent.wires.some((wire: { type?: string }) => wire.type === 'webSeed');
        onProgress({
          mode: hasPeer ? 'downloading' : hasWebSeed ? 'fallback' : 'downloading',
          bytesDone: current,
          bytesTotal: total,
          downloadedBytes: current,
          uploadedBytes: Number(torrent.uploaded ?? 0),
          downloadRate: Number(torrent.downloadSpeed ?? 0),
          uploadRate: Number(torrent.uploadSpeed ?? 0),
          peerCount: Number(torrent.numPeers ?? 0),
        });
      };

      torrent.on('ready', () => {
        for (const seed of request.hybrid.webSeeds) {
          torrent.addWebSeed(seed);
        }
        if (request.hybrid.directUrl) {
          torrent.addWebSeed(request.hybrid.directUrl);
        }
        report();
      });
      torrent.on('download', report);
      torrent.on('wire', report);
      torrent.on('warning', report);
      torrent.on('error', (error: Error) => {
        void teardown(error);
      });
      torrent.on('done', async () => {
        report();
        const file = torrent.files?.find((entry: { name?: string }) => entry.name === request.fileName) ?? torrent.files?.[0];
        if (!file) {
          await teardown(new Error('torrent finished without file'));
          return;
        }
        const filePath = path.join(torrent.path, file.path);
        if (settled) {
          return;
        }
        settled = true;
        clearInterval(stallTimer);
        this.torrents.delete(request.targetId);
        await new Promise<void>((resolveDestroy) => torrent.destroy({ destroyStore: false }, () => resolveDestroy()));
        resolve(filePath);
      });

      const stallTimer = setInterval(() => {
        if (Date.now() - lastUpdate > request.stallTimeoutMs) {
          void teardown(new Error('torrent stalled'));
        }
      }, Math.min(request.stallTimeoutMs, 5000));

      this.torrents.set(request.targetId, { torrent });
      report();
    });
  }

  private async downloadViaHttpFallback(request: TransferRequest, onProgress: (progress: TransferProgress) => void): Promise<string> {
    const candidates = [request.hybrid.directUrl, ...request.hybrid.webSeeds].filter((value): value is string => Boolean(value));
    const source = candidates[0];
    if (!source) {
      throw new Error(`No fallback source for ${request.targetId}`);
    }

    const outputPath = path.join(request.tempDir, request.fileName);
    await fsPromises.mkdir(path.dirname(outputPath), { recursive: true });

    const response = await fetch(source);
    if (!response.ok || !response.body) {
      throw new Error(`Fallback source failed: ${response.status}`);
    }

    const total = Number.parseInt(response.headers.get('content-length') ?? '0', 10) || 0;
    let bytesDone = 0;
    const startedAt = Date.now();
    const nodeStream = Readable.fromWeb(response.body as never);
    nodeStream.on('data', (chunk) => {
      bytesDone += Buffer.byteLength(chunk);
      const elapsedSeconds = Math.max(1, (Date.now() - startedAt) / 1000);
      onProgress({
        mode: 'fallback',
        bytesDone,
        bytesTotal: total,
        downloadedBytes: bytesDone,
        uploadedBytes: 0,
        downloadRate: Math.round(bytesDone / elapsedSeconds),
        uploadRate: 0,
        peerCount: 0,
      });
    });

    await pipeline(nodeStream, fs.createWriteStream(outputPath));
    return outputPath;
  }

  private async getClient(uploadLimitKib: number): Promise<any> {
    if (!this.client) {
      const module = await import('webtorrent');
      const WebTorrent = module.default;
      this.client = new WebTorrent({
        uploadLimit: uploadLimitKib * 1024,
      });
    } else if (typeof this.client.throttleUpload === 'function') {
      this.client.throttleUpload(uploadLimitKib * 1024);
    }

    return this.client;
  }
}
