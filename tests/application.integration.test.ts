import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApplication } from '../src/app.js';
import { CleanupPolicy } from '../src/catalog/cleanup-policy.js';
import { makeTempConfig, FakeTransferAdapter, sha256 } from './helpers.js';

const cleanupCallbacks: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanupCallbacks.length > 0) {
    const callback = cleanupCallbacks.pop();
    if (callback) {
      await callback();
    }
  }
});

function createFetch(payloadHash: string): typeof fetch {
  return (async () => new Response(JSON.stringify({
    versions: [
      {
        version: 'v1.0.0',
        assets: [
          {
            name: 'hagicode-1.0.0-win-x64-nort.zip',
            path: 'v1.0.0/hagicode-1.0.0-win-x64-nort.zip',
            size: 7,
            torrentUrl: 'v1.0.0/hagicode-1.0.0-win-x64-nort.zip.torrent',
            infoHash: 'abc123',
            webSeeds: ['v1.0.0/hagicode-1.0.0-win-x64-nort.zip'],
            sha256: payloadHash,
            lastModified: '2026-03-27T00:00:00.000Z',
          },
          {
            name: 'Hagicode.Desktop.Setup.1.0.0.exe',
            path: 'v1.0.0/Hagicode.Desktop.Setup.1.0.0.exe',
            size: 7,
            torrentUrl: 'v1.0.0/Hagicode.Desktop.Setup.1.0.0.exe.torrent',
            infoHash: 'def456',
            webSeeds: ['v1.0.0/Hagicode.Desktop.Setup.1.0.0.exe'],
            sha256: payloadHash,
            lastModified: '2026-03-27T00:00:00.000Z',
          },
          {
            name: 'legacy-http-only.zip',
            path: 'v1.0.0/legacy-http-only.zip',
            size: 7,
            directUrl: 'v1.0.0/legacy-http-only.zip',
            lastModified: '2026-03-27T00:00:00.000Z',
          },
        ],
      },
      {
        version: 'v0.9.0',
        assets: [
          {
            name: 'hagicode-0.9.0-win-x64-nort.zip',
            path: 'v0.9.0/hagicode-0.9.0-win-x64-nort.zip',
            size: 7,
            torrentUrl: 'v0.9.0/hagicode-0.9.0-win-x64-nort.zip.torrent',
            infoHash: 'old123',
            webSeeds: ['v0.9.0/hagicode-0.9.0-win-x64-nort.zip'],
            sha256: payloadHash,
            lastModified: '2026-03-20T00:00:00.000Z',
          },
        ],
      },
    ],
    channels: {
      stable: {
        latest: 'v1.0.0',
        versions: ['v1.0.0', 'v0.9.0'],
      },
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('condition not met before timeout');
}

describe('application integration', () => {
  it('restores catalog without duplicate downloads and keeps status endpoints read-only', async () => {
    const payload = 'payload';
    const config = await makeTempConfig();
    const adapter = new FakeTransferAdapter({ default: payload }, 'fallback', {
      downloadRate: 0,
      uploadRate: 256,
      peerCount: 1,
    });
    const fetchImpl = createFetch(sha256(payload));
    const uiDistDir = path.join(config.dataDir, 'ui-dist');
    await fs.mkdir(uiDistDir, { recursive: true });
    await fs.writeFile(path.join(uiDistDir, 'index.html'), '<!doctype html><html><body><div id="root">ok</div></body></html>', 'utf8');

    const app = createApplication(config, { fetchImpl, transferAdapter: adapter, uiDistDir });
    cleanupCallbacks.push(async () => {
      await app.stop().catch(() => undefined);
      await fs.rm(config.dataDir, { recursive: true, force: true });
    });
    await app.start();
    await waitFor(() => adapter.downloads === 3);

    const firstState = app.catalog.snapshot();
    expect(firstState.service.ready).toBe(true);
    expect(adapter.downloads).toBe(3);

    const health = await fetch(`${app.httpServer.getUrl()}/health`).then((response) => response.json() as Promise<Record<string, unknown>>);
    const beforeStatus = JSON.stringify(app.catalog.snapshot());
    const status = await fetch(`${app.httpServer.getUrl()}/status`).then((response) => response.json() as Promise<Record<string, unknown>>);
    const targets = await fetch(`${app.httpServer.getUrl()}/targets`).then((response) => response.json() as Promise<Record<string, unknown>>);
    const html = await fetch(`${app.httpServer.getUrl()}/`).then((response) => response.text());
    const afterStatus = JSON.stringify(app.catalog.snapshot());

    expect(health.ready).toBe(true);
    expect(status.mode).toBe('shared');
    expect(status.totalDownloadedBytes).toBe(7 * 3);
    expect(status.totalUploadedBytes).toBe(0);
    expect(status.totalUploadRate).toBe(256 * 3);
    expect(status.totalDownloadRate).toBe(0);
    expect(status.trafficStartedAt).toBeTypeOf('string');
    expect(status.trafficUpdatedAt).toBeTypeOf('string');
    expect(status.servingPeerCount).toBe(3);
    expect(status.sharedTaskCount).toBeTypeOf('number');
    expect((status.activeTasks as Array<{ localPath: string }>).every((item) => item.localPath.includes(config.cacheDir))).toBe(true);
    expect(Array.isArray(status.activeTasks)).toBe(true);
    expect(Array.isArray(targets.targets)).toBe(true);
    expect((targets.targets as Array<{ localPath: string | null }>).every((item) => typeof item.localPath === 'string' && item.localPath.includes(config.cacheDir))).toBe(true);
    expect((targets.targets as Array<{ relativePath: string; selected: boolean }>).filter((item) => item.selected).map((item) => item.relativePath)).toEqual([
      'v1.0.0/hagicode-1.0.0-win-x64-nort.zip',
      'v1.0.0/Hagicode.Desktop.Setup.1.0.0.exe',
      'v0.9.0/hagicode-0.9.0-win-x64-nort.zip',
    ]);
    expect(html).toContain('<div id="root">ok</div>');
    expect(beforeStatus).toBe(afterStatus);

    await app.stop();

    const restarted = createApplication(config, { fetchImpl, transferAdapter: adapter, uiDistDir });
    cleanupCallbacks.push(async () => {
      await restarted.stop().catch(() => undefined);
    });
    await restarted.start();

    expect(adapter.downloads).toBe(3);
    expect(restarted.catalog.listEntries().some((entry) => entry.state === 'shared')).toBe(true);
  });

  it('returns zero-traffic status fields before any transfer and keeps reads side-effect free', async () => {
    const config = await makeTempConfig({ sources: [] });
    const uiDistDir = path.join(config.dataDir, 'ui-dist');
    await fs.mkdir(uiDistDir, { recursive: true });
    await fs.writeFile(path.join(uiDistDir, 'index.html'), '<!doctype html><html><body><div id="root">ok</div></body></html>', 'utf8');

    const app = createApplication(config, { uiDistDir });
    cleanupCallbacks.push(async () => {
      await app.stop().catch(() => undefined);
      await fs.rm(config.dataDir, { recursive: true, force: true });
    });
    await app.start();

    const beforeStatus = JSON.stringify(app.catalog.snapshot());
    const status = await fetch(`${app.httpServer.getUrl()}/status`).then((response) => response.json() as Promise<Record<string, unknown>>);
    const afterStatus = JSON.stringify(app.catalog.snapshot());

    expect(status.totalDownloadedBytes).toBe(0);
    expect(status.totalUploadedBytes).toBe(0);
    expect(status.trafficStartedAt).toBeTypeOf('string');
    expect(status.trafficUpdatedAt).toBeTypeOf('string');
    expect(Array.isArray(status.activeTasks)).toBe(true);
    expect(beforeStatus).toBe(afterStatus);
  });

  it('evaluates cleanup by age and capacity without touching pinned entries', async () => {
    const config = await makeTempConfig({
      cacheCapacityBytes: 100,
      maxEntries: 1,
      retentionDays: 1,
    });
    cleanupCallbacks.push(async () => {
      await fs.rm(config.dataDir, { recursive: true, force: true });
    });

    const policy = new CleanupPolicy(config);
    const decisions = policy.evaluate([
      {
        id: 'old',
        sourceId: 'desktop',
        version: 'v0.9.0',
        channel: 'stable',
        platform: 'win-x64',
        assetKind: 'desktop',
        name: 'old.zip',
        filePath: '/tmp/old.zip',
        relativePath: 'v0.9.0/old.zip',
        size: 80,
        state: 'verified',
        retention: 'history',
        hybrid: { webSeeds: [] },
        diagnostics: [],
        createdAt: '2026-03-20T00:00:00.000Z',
        updatedAt: '2026-03-20T00:00:00.000Z',
        lastSeenAt: '2026-03-20T00:00:00.000Z',
        bytesDone: 80,
        bytesTotal: 80,
        downloadRate: 0,
        uploadRate: 0,
        peerCount: 0,
      },
      {
        id: 'pinned',
        sourceId: 'desktop',
        version: 'v1.0.0',
        channel: 'stable',
        platform: 'win-x64',
        assetKind: 'desktop',
        name: 'pinned.zip',
        filePath: '/tmp/pinned.zip',
        relativePath: 'v1.0.0/pinned.zip',
        size: 80,
        state: 'shared',
        retention: 'latest+pinned',
        hybrid: { webSeeds: [] },
        diagnostics: [],
        createdAt: '2026-03-27T00:00:00.000Z',
        updatedAt: '2026-03-27T00:00:00.000Z',
        lastSeenAt: '2026-03-27T00:00:00.000Z',
        bytesDone: 80,
        bytesTotal: 80,
        downloadRate: 0,
        uploadRate: 0,
        peerCount: 0,
      },
    ], new Set(['pinned']), new Date('2026-03-27T00:00:00.000Z'));

    expect(decisions.map((item) => item.id)).toContain('old');
    expect(decisions.map((item) => item.id)).not.toContain('pinned');
  });
});
