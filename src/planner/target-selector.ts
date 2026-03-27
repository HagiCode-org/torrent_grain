import semver from 'semver';
import type { SourceConfig } from '../config/types.js';
import { diagnostic } from '../domain/diagnostics.js';
import type { PlannedTargetRecord, ReleaseAsset, TargetSelection } from '../domain/release-asset.js';
import type { TargetPlan } from './cache-policy.js';

function compareVersion(left: ReleaseAsset, right: ReleaseAsset): number {
  const leftVersion = semver.coerce(left.version);
  const rightVersion = semver.coerce(right.version);

  if (leftVersion && rightVersion) {
    const result = semver.rcompare(leftVersion, rightVersion);
    if (result !== 0) {
      return result;
    }
  }

  const publishedDelta = right.publishedAt.localeCompare(left.publishedAt);
  if (publishedDelta !== 0) {
    return publishedDelta;
  }

  return right.name.localeCompare(left.name);
}

function selectLatest(assets: ReleaseAsset[], count: number): ReleaseAsset[] {
  return [...assets].sort(compareVersion).slice(0, count);
}

function compareVersionNames(left: string, right: string): number {
  const leftVersion = semver.coerce(left);
  const rightVersion = semver.coerce(right);

  if (leftVersion && rightVersion) {
    const result = semver.rcompare(leftVersion, rightVersion);
    if (result !== 0) {
      return result;
    }
  }

  return right.localeCompare(left);
}

export class TargetSelector {
  buildPlan(assets: ReleaseAsset[], sources: SourceConfig[]): TargetPlan {
    const bySource = new Map(sources.map((source) => [source.id, source]));
    const selected = new Map<string, TargetSelection>();

    const readyAssets = assets.filter((asset) => asset.metadataState === 'ready');
    const groupedBySourceChannel = new Map<string, Map<string, ReleaseAsset[]>>();
    for (const asset of readyAssets) {
      const sourceChannelKey = `${asset.sourceId}::${asset.channel}`;
      const versions = groupedBySourceChannel.get(sourceChannelKey) ?? new Map<string, ReleaseAsset[]>();
      const versionAssets = versions.get(asset.version) ?? [];
      versionAssets.push(asset);
      versions.set(asset.version, versionAssets);
      groupedBySourceChannel.set(sourceChannelKey, versions);
    }

    for (const [sourceChannelKey, versions] of groupedBySourceChannel) {
      const [sourceId = ''] = sourceChannelKey.split('::');
      const source = bySource.get(sourceId);
      const latestCount = source?.latestPerGroup ?? 1;
      const selectedVersions = [...versions.keys()]
        .sort(compareVersionNames)
        .slice(0, latestCount);

      for (const version of selectedVersions) {
        for (const asset of versions.get(version) ?? []) {
          selected.set(asset.id, {
            id: asset.id,
            sourceId: asset.sourceId,
            version: asset.version,
            channel: asset.channel,
            platform: asset.platform,
            assetKind: asset.assetKind,
            retention: 'latest',
            asset,
          });
        }
      }
    }

    for (const asset of assets) {
      const source = bySource.get(asset.sourceId);
      if (!source?.pinnedVersions.includes(asset.version) || asset.metadataState !== 'ready') {
        continue;
      }

      const existing = selected.get(asset.id);
      if (existing) {
        existing.retention = 'latest+pinned';
        continue;
      }

      selected.set(asset.id, {
        id: asset.id,
        sourceId: asset.sourceId,
        version: asset.version,
        channel: asset.channel,
        platform: asset.platform,
        assetKind: asset.assetKind,
        retention: 'pinned',
        asset,
      });
    }

    const evaluatedAt = new Date().toISOString();
    const records: PlannedTargetRecord[] = assets.map((asset) => {
      const chosen = selected.get(asset.id);
      const diagnostics = [...asset.diagnostics];
      if (chosen) {
        diagnostics.push(diagnostic('scheduled', `selected as ${chosen.retention}`, evaluatedAt));
      } else if (asset.metadataState !== 'ready') {
        diagnostics.push(diagnostic('skipped-incomplete-metadata', 'asset skipped because metadata incomplete', evaluatedAt));
      }

      return {
        id: asset.id,
        asset,
        selected: Boolean(chosen),
        retention: chosen?.retention ?? 'history',
        diagnostics,
        evaluatedAt,
      };
    });

    return {
      selectedTargets: [...selected.values()].sort((left, right) => {
        const versionDelta = compareVersion(left.asset, right.asset);
        if (versionDelta !== 0) {
          return versionDelta;
        }
        return left.asset.name.localeCompare(right.asset.name);
      }),
      records,
    };
  }
}
