import { describe, expect, it } from 'vitest';
import { CatalogStore } from '../src/catalog/catalog-store.js';
import type { TargetSelection } from '../src/domain/release-asset.js';
import { makeTempConfig, sha256 } from './helpers.js';

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

describe('catalog traffic checkpoints', () => {
  it('does not double count repeated snapshots and resets checkpoints between sessions', async () => {
    const config = await makeTempConfig();
    const catalog = new CatalogStore(config);
    await catalog.initialize();

    const target = makeTarget(sha256('payload'));
    await catalog.ensureTargetEntry(target);

    catalog.recordProgress(target.id, {
      mode: 'downloading',
      bytesDone: 4,
      bytesTotal: 7,
      downloadedBytes: 4,
      uploadedBytes: 2,
      downloadRate: 4,
      uploadRate: 32,
      peerCount: 1,
    });
    catalog.recordProgress(target.id, {
      mode: 'downloading',
      bytesDone: 4,
      bytesTotal: 7,
      downloadedBytes: 4,
      uploadedBytes: 2,
      downloadRate: 4,
      uploadRate: 32,
      peerCount: 1,
    });

    await catalog.markTransferState(target.id, 'verifying');

    catalog.recordProgress(target.id, {
      mode: 'shared',
      bytesDone: 7,
      bytesTotal: 7,
      downloadedBytes: 0,
      uploadedBytes: 5,
      downloadRate: 0,
      uploadRate: 128,
      peerCount: 2,
    });
    catalog.recordProgress(target.id, {
      mode: 'shared',
      bytesDone: 7,
      bytesTotal: 7,
      downloadedBytes: 0,
      uploadedBytes: 5,
      downloadRate: 0,
      uploadRate: 128,
      peerCount: 2,
    });

    const snapshot = catalog.snapshot();
    expect(snapshot.service.totalDownloadedBytes).toBe(4);
    expect(snapshot.service.totalUploadedBytes).toBe(7);
    expect(snapshot.service.trafficStartedAt).toBeTypeOf('string');
    expect(snapshot.service.trafficUpdatedAt).toBeTypeOf('string');
  });
});
