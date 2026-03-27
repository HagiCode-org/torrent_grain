import { describe, expect, it } from 'vitest';
import { TargetSelector } from '../src/planner/target-selector.js';
import type { ReleaseAsset } from '../src/domain/release-asset.js';
import { diagnostic } from '../src/domain/diagnostics.js';
import type { SourceConfig } from '../src/config/types.js';

const source: SourceConfig = {
  id: 'desktop',
  kind: 'desktop',
  label: 'Desktop',
  indexUrl: 'https://index.example.com/desktop/index.json',
  enabled: true,
  latestPerGroup: 2,
  pinnedVersions: ['v1.0.0'],
};

function asset(options: {
  version: string;
  name: string;
  channel: string;
  publishedAt: string;
  metadataState?: 'ready' | 'incomplete';
}): ReleaseAsset {
  const metadataState = options.metadataState ?? 'ready';
  return {
    id: `desktop::${options.version}::${options.channel}::win-x64::desktop::${options.name}`,
    sourceId: 'desktop',
    sourceKind: 'desktop',
    version: options.version,
    channel: options.channel,
    platform: 'win-x64',
    assetKind: 'desktop',
    name: options.name,
    relativePath: `${options.version}/${options.name}`,
    size: 100,
    publishedAt: options.publishedAt,
    groupKey: `desktop::${options.channel}::win-x64::desktop`,
    metadataState,
    hybrid: {
      directUrl: `https://example.com/${options.version}/${options.name}`,
      torrentUrl: `https://example.com/${options.version}/${options.name}.torrent`,
      infoHash: `${options.version}-${options.name}`,
      webSeeds: [`https://example.com/${options.version}/${options.name}`],
      sha256: `${options.version}-${options.name}`,
    },
    diagnostics: [diagnostic(metadataState === 'ready' ? 'metadata-ready' : 'missing-hybrid-metadata', metadataState)],
  };
}

describe('target selector', () => {
  it('keeps all torrent assets from the latest two versions per source/channel and preserves pinned versions', () => {
    const selector = new TargetSelector();
    const plan = selector.buildPlan([
      asset({ version: 'v1.2.0', channel: 'stable', name: 'setup.exe', publishedAt: '2026-03-28T00:00:00.000Z' }),
      asset({ version: 'v1.2.0', channel: 'stable', name: 'portable.zip', publishedAt: '2026-03-28T00:00:00.000Z' }),
      asset({ version: 'v1.1.0', channel: 'stable', name: 'setup.exe', publishedAt: '2026-03-27T00:00:00.000Z' }),
      asset({ version: 'v1.1.0', channel: 'stable', name: 'portable.zip', publishedAt: '2026-03-27T00:00:00.000Z' }),
      asset({ version: 'v1.0.0', channel: 'stable', name: 'setup.exe', publishedAt: '2026-03-20T00:00:00.000Z' }),
      asset({ version: 'v1.3.0-dev.1', channel: 'dev', name: 'setup.exe', publishedAt: '2026-03-29T00:00:00.000Z' }),
      asset({ version: 'v1.2.0-dev.1', channel: 'dev', name: 'portable.zip', publishedAt: '2026-03-26T00:00:00.000Z' }),
    ], [source]);

    expect(plan.selectedTargets.map((item) => `${item.channel}:${item.version}:${item.asset.name}:${item.retention}`)).toEqual([
      'dev:v1.3.0-dev.1:setup.exe:latest',
      'stable:v1.2.0:setup.exe:latest',
      'stable:v1.2.0:portable.zip:latest',
      'dev:v1.2.0-dev.1:portable.zip:latest',
      'stable:v1.1.0:setup.exe:latest',
      'stable:v1.1.0:portable.zip:latest',
      'stable:v1.0.0:setup.exe:pinned',
    ]);

    expect(plan.records.find((item) => item.asset.version === 'v1.0.0')?.retention).toBe('pinned');
    expect(plan.records.filter((item) => item.asset.version === 'v1.1.0').every((item) => item.selected)).toBe(true);
    expect(plan.records.filter((item) => item.asset.version === 'v1.2.0').every((item) => item.selected)).toBe(true);
    expect(plan.records.filter((item) => item.asset.version === 'v1.3.0-dev.1').every((item) => item.selected)).toBe(true);
  });
});
