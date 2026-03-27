import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CatalogStore } from '../src/catalog/catalog-store.js';
import { HybridTransfer } from '../src/torrent/hybrid-transfer.js';
import type { TargetSelection } from '../src/domain/release-asset.js';
import { makeTempConfig, FakeTransferAdapter, sha256 } from './helpers.js';

function makeTarget(hash: string): TargetSelection {
  return {
    id: 'desktop::v1.0.0::stable::win-x64::desktop::artifact.zip',
    sourceId: 'desktop',
    version: 'v1.0.0',
    channel: 'stable',
    platform: 'win-x64',
    assetKind: 'desktop',
    retention: 'latest',
    asset: {
      id: 'desktop::v1.0.0::stable::win-x64::desktop::artifact.zip',
      sourceId: 'desktop',
      sourceKind: 'desktop',
      version: 'v1.0.0',
      channel: 'stable',
      platform: 'win-x64',
      assetKind: 'desktop',
      name: 'artifact.zip',
      relativePath: 'v1.0.0/artifact.zip',
      size: 7,
      publishedAt: '2026-03-27T00:00:00.000Z',
      groupKey: 'desktop::stable::win-x64::desktop',
      metadataState: 'ready',
      hybrid: {
        directUrl: 'https://example.com/artifact.zip',
        torrentUrl: 'https://example.com/artifact.zip.torrent',
        infoHash: 'abc123',
        webSeeds: ['https://example.com/artifact.zip'],
        sha256: hash,
      },
      diagnostics: [],
    },
  };
}

describe('hybrid transfer', () => {
  it('uses fallback payload and promotes verified cache to shared', async () => {
    const config = await makeTempConfig();
    const catalog = new CatalogStore(config);
    await catalog.initialize();
    const payload = 'payload';
    const adapter = new FakeTransferAdapter({ default: payload }, 'fallback', {
      downloadRate: 0,
      uploadRate: 512,
      peerCount: 2,
    });
    const transfer = new HybridTransfer(config, catalog, adapter);

    const target = makeTarget(sha256(payload));
    await transfer.ensureCached(target);

    const entry = catalog.getEntry(target.id);
    expect(entry?.state).toBe('shared');
    expect(entry?.uploadRate).toBe(512);
    expect(entry?.peerCount).toBe(2);
    expect(await fs.readFile(path.join(config.cacheDir, target.asset.relativePath), 'utf8')).toBe(payload);
    expect(adapter.downloads).toBe(1);
    expect(adapter.ensuredSeeds).toContain(target.id);
  });

  it('quarantines hash mismatch failures', async () => {
    const config = await makeTempConfig();
    const catalog = new CatalogStore(config);
    await catalog.initialize();
    const adapter = new FakeTransferAdapter({ default: 'payload' }, 'fallback');
    const transfer = new HybridTransfer(config, catalog, adapter);
    const target = makeTarget(sha256('different'));

    await expect(transfer.ensureCached(target)).rejects.toThrow(/sha256 verification failed/);
    const entry = catalog.getEntry(target.id);
    expect(entry?.state).toBe('error');
    const quarantineFiles = await fs.readdir(config.quarantineDir);
    expect(quarantineFiles.length).toBe(1);
  });

  it('rejects fallback when http fallback is disabled', async () => {
    const config = await makeTempConfig({ httpFallbackEnabled: false });
    const catalog = new CatalogStore(config);
    await catalog.initialize();
    const adapter = new FakeTransferAdapter({ default: 'payload' }, 'fallback');
    const transfer = new HybridTransfer(config, catalog, adapter);
    const target = makeTarget(sha256('payload'));

    await expect(transfer.ensureCached(target)).rejects.toThrow(/HTTP fallback disabled/);
    const entry = catalog.getEntry(target.id);
    expect(entry?.state).toBe('error');
    expect(entry?.lastError).toMatch(/HTTP fallback disabled/);
  });
});
