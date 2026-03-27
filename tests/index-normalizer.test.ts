import { describe, expect, it } from 'vitest';
import { normalizeIndexDocument, validateHybridMetadata } from '../src/feeds/index-normalizer.js';
import type { SourceConfig } from '../src/config/types.js';

const source: SourceConfig = {
  id: 'desktop',
  kind: 'desktop',
  label: 'Desktop',
  indexUrl: 'https://index.example.com/desktop/index.json',
  enabled: true,
  latestPerGroup: 1,
  pinnedVersions: [],
};

describe('index normalizer', () => {
  it('normalizes versions assets and resolves hybrid metadata', () => {
    const assets = normalizeIndexDocument(source, {
      versions: [
        {
          version: 'v1.2.3',
          assets: [
            {
              name: 'hagicode-1.2.3-win-x64-nort.zip',
              path: 'v1.2.3/hagicode-1.2.3-win-x64-nort.zip',
              size: 123,
              lastModified: '2026-03-27T00:00:00.000Z',
              torrentUrl: 'v1.2.3/hagicode-1.2.3-win-x64-nort.zip.torrent',
              infoHash: 'ABC123',
              webSeeds: ['v1.2.3/hagicode-1.2.3-win-x64-nort.zip'],
              sha256: 'DEADBEEF',
            },
          ],
        },
      ],
      channels: {
        stable: {
          latest: 'v1.2.3',
          versions: ['v1.2.3'],
        },
      },
    });

    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({
      sourceId: 'desktop',
      version: 'v1.2.3',
      channel: 'stable',
      platform: 'win-x64',
      assetKind: 'desktop',
      metadataState: 'ready',
    });
    expect(assets[0].hybrid.torrentUrl).toBe('https://index.example.com/desktop/v1.2.3/hagicode-1.2.3-win-x64-nort.zip.torrent');
    expect(assets[0].hybrid.webSeeds).toContain('https://index.example.com/desktop/v1.2.3/hagicode-1.2.3-win-x64-nort.zip');
    expect(assets[0].hybrid.sha256).toBe('deadbeef');
  });

  it('omits assets that do not support torrent metadata', () => {
    const assets = normalizeIndexDocument(source, {
      versions: [
        {
          version: 'v1.2.3',
          assets: [
            {
              name: 'hagicode-1.2.3-win-x64-nort.zip',
              path: 'v1.2.3/hagicode-1.2.3-win-x64-nort.zip',
              size: 123,
              lastModified: '2026-03-27T00:00:00.000Z',
              directUrl: 'v1.2.3/hagicode-1.2.3-win-x64-nort.zip',
            },
          ],
        },
      ],
    });

    expect(assets).toHaveLength(0);
  });

  it('still reports incomplete hybrid metadata diagnostics for validators', () => {
    const diagnostics = validateHybridMetadata({
      directUrl: 'https://example.com/file.zip',
      webSeeds: [],
    });

    expect(diagnostics.map((item) => item.code)).toContain('missing-hybrid-metadata');
    expect(diagnostics.map((item) => item.code)).toContain('missing-torrent-url');
    expect(diagnostics.map((item) => item.code)).toContain('missing-info-hash');
    expect(diagnostics.map((item) => item.code)).toContain('missing-sha256');
    expect(diagnostics.map((item) => item.code)).toContain('missing-web-seeds');
  });
});
