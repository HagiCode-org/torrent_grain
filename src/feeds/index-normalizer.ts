import type { SourceConfig } from '../config/types.js';
import { diagnostic, type DiagnosticItem } from '../domain/diagnostics.js';
import type { AssetKind, HybridMetadata, ReleaseAsset } from '../domain/release-asset.js';

export interface HttpIndexAsset {
  name: string;
  path?: string;
  size?: number;
  lastModified?: string;
  directUrl?: string;
  torrentUrl?: string;
  infoHash?: string;
  webSeeds?: string[];
  sha256?: string;
}

export interface HttpIndexLegacyFile {
  name?: string;
  path?: string;
  size?: number;
  lastModified?: string;
  directUrl?: string;
}

export interface HttpIndexVersion {
  version: string;
  files?: Array<string | HttpIndexLegacyFile>;
  assets?: HttpIndexAsset[];
}

export interface ChannelInfo {
  latest?: string;
  versions: string[];
}

export interface HttpIndexDocument {
  versions: HttpIndexVersion[];
  channels?: Record<string, ChannelInfo>;
}

export function assertIndexDocument(value: unknown): asserts value is HttpIndexDocument {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { versions?: unknown }).versions)) {
    throw new Error('Invalid index file format: missing versions array');
  }
}

function resolveUrl(indexUrl: string, value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return new URL(value, indexUrl).toString();
}

function normalizeVersionAssets(version: HttpIndexVersion): HttpIndexAsset[] {
  if (Array.isArray(version.assets) && version.assets.length > 0) {
    return version.assets;
  }

  if (!Array.isArray(version.files)) {
    return [];
  }

  return version.files.map((entry) => normalizeLegacyFile(entry));
}

function normalizeLegacyFile(entry: string | HttpIndexLegacyFile): HttpIndexAsset {
  if (typeof entry === 'string') {
    return {
      name: entry.split('/').filter(Boolean).at(-1) ?? entry,
      path: entry,
    };
  }

  const fallbackPath = entry.path ?? entry.directUrl;
  if (!fallbackPath) {
    throw new Error('Invalid legacy file entry');
  }

  const normalized: HttpIndexAsset = {
    name: entry.name ?? fallbackPath.split('/').filter(Boolean).at(-1) ?? fallbackPath,
  };

  if (entry.path) {
    normalized.path = entry.path;
  }
  if (typeof entry.size === 'number') {
    normalized.size = entry.size;
  }
  if (entry.lastModified) {
    normalized.lastModified = entry.lastModified;
  }
  if (entry.directUrl) {
    normalized.directUrl = entry.directUrl;
  }

  return normalized;
}

function detectPlatform(name: string): string {
  const lower = name.toLowerCase();
  const explicit = lower.match(/(linux-x64|linux-arm64|win-x64|osx-x64|osx-arm64)/);
  if (explicit?.[1]) {
    return explicit[1];
  }
  if (lower.includes('windows') || lower.includes('win-')) {
    return 'win-x64';
  }
  if (lower.includes('linux')) {
    return 'linux-x64';
  }
  if (lower.includes('osx') || lower.includes('mac')) {
    return 'osx-x64';
  }
  return 'generic';
}

function detectAssetKind(name: string, source: SourceConfig): AssetKind {
  const lower = name.toLowerCase();
  if (source.kind === 'desktop' || lower.includes('portable') || lower.includes('desktop') || lower.includes('-nort')) {
    return 'desktop';
  }
  if (lower.includes('web') || lower.includes('deploy')) {
    return 'web';
  }
  if (source.kind === 'server' || lower.includes('server')) {
    return 'server';
  }
  return 'generic';
}

function inferChannel(version: string): string {
  const lower = version.toLowerCase();
  if (lower.includes('alpha')) {
    return 'alpha';
  }
  if (lower.includes('beta')) {
    return 'beta';
  }
  if (lower.includes('rc')) {
    return 'rc';
  }
  return 'stable';
}

function buildChannelLookup(channels: Record<string, ChannelInfo> | undefined): Map<string, string> {
  const lookup = new Map<string, string>();
  if (!channels) {
    return lookup;
  }

  for (const [channel, info] of Object.entries(channels)) {
    for (const version of info.versions) {
      lookup.set(version, channel);
    }
  }
  return lookup;
}

export function validateHybridMetadata(metadata: HybridMetadata): DiagnosticItem[] {
  const diagnostics: DiagnosticItem[] = [];

  if (!metadata.directUrl) {
    diagnostics.push(diagnostic('missing-direct-url', 'directUrl missing'));
  }
  if (!metadata.torrentUrl) {
    diagnostics.push(diagnostic('missing-torrent-url', 'torrentUrl missing'));
  }
  if (!metadata.infoHash) {
    diagnostics.push(diagnostic('missing-info-hash', 'infoHash missing'));
  }
  if (!metadata.sha256) {
    diagnostics.push(diagnostic('missing-sha256', 'sha256 missing'));
  }
  if (metadata.webSeeds.length === 0) {
    diagnostics.push(diagnostic('missing-web-seeds', 'webSeeds missing'));
  }

  if (diagnostics.length === 0) {
    diagnostics.push(diagnostic('metadata-ready', 'hybrid metadata ready'));
    return diagnostics;
  }

  diagnostics.unshift(diagnostic('missing-hybrid-metadata', 'hybrid metadata incomplete'));
  return diagnostics;
}

function isTorrentCapable(diagnostics: DiagnosticItem[]): boolean {
  return !diagnostics.some((entry) => entry.code === 'missing-hybrid-metadata');
}

function buildGroupKey(asset: {
  sourceId: string;
  channel: string;
  platform: string;
  assetKind: AssetKind;
}): string {
  return [asset.sourceId, asset.channel, asset.platform, asset.assetKind].join('::');
}

function buildTargetId(asset: {
  sourceId: string;
  version: string;
  channel: string;
  platform: string;
  assetKind: AssetKind;
  name: string;
}): string {
  return [asset.sourceId, asset.version, asset.channel, asset.platform, asset.assetKind, asset.name].join('::');
}

function toRelativePath(indexUrl: string, asset: HttpIndexAsset, directUrl: string): string {
  if (asset.path) {
    return asset.path;
  }

  const pathname = new URL(directUrl, indexUrl).pathname;
  return pathname.replace(/^\/+/, '');
}

export function normalizeIndexDocument(source: SourceConfig, document: HttpIndexDocument): ReleaseAsset[] {
  assertIndexDocument(document);
  const channelLookup = buildChannelLookup(document.channels);
  const now = new Date().toISOString();
  const results: ReleaseAsset[] = [];

  for (const versionEntry of document.versions) {
    if (!versionEntry || typeof versionEntry.version !== 'string') {
      throw new Error('Invalid index file format: version entry missing version');
    }

    const channel = channelLookup.get(versionEntry.version) ?? inferChannel(versionEntry.version);
    const assets = normalizeVersionAssets(versionEntry);

    for (const asset of assets) {
      const directUrl = resolveUrl(source.indexUrl, asset.directUrl ?? asset.path);
      if (!asset.name || !directUrl) {
        throw new Error(`Invalid asset entry for version ${versionEntry.version}`);
      }

      const hybrid: HybridMetadata = {
        directUrl,
        webSeeds: Array.isArray(asset.webSeeds)
          ? asset.webSeeds
              .map((seed) => resolveUrl(source.indexUrl, seed))
              .filter((seed): seed is string => Boolean(seed))
          : [],
      };

      const torrentUrl = resolveUrl(source.indexUrl, asset.torrentUrl);
      if (torrentUrl) {
        hybrid.torrentUrl = torrentUrl;
      }
      if (asset.infoHash) {
        hybrid.infoHash = asset.infoHash.toLowerCase();
      }
      if (asset.sha256) {
        hybrid.sha256 = asset.sha256.toLowerCase();
      }

      if (hybrid.directUrl && !hybrid.webSeeds.includes(hybrid.directUrl)) {
        hybrid.webSeeds.push(hybrid.directUrl);
      }

      const diagnostics = validateHybridMetadata(hybrid);
      const metadataState = diagnostics.some((entry) => entry.code === 'missing-hybrid-metadata') ? 'incomplete' : 'ready';
      if (!isTorrentCapable(diagnostics)) {
        continue;
      }
      const platform = detectPlatform(asset.name);
      const assetKind = detectAssetKind(asset.name, source);
      const groupKey = buildGroupKey({
        sourceId: source.id,
        channel,
        platform,
        assetKind,
      });
      const id = buildTargetId({
        sourceId: source.id,
        version: versionEntry.version,
        channel,
        platform,
        assetKind,
        name: asset.name,
      });

      results.push({
        id,
        sourceId: source.id,
        sourceKind: source.kind,
        version: versionEntry.version,
        channel,
        platform,
        assetKind,
        name: asset.name,
        relativePath: toRelativePath(source.indexUrl, asset, directUrl),
        size: asset.size ?? 0,
        publishedAt: asset.lastModified ?? now,
        groupKey,
        metadataState,
        hybrid,
        diagnostics,
      });
    }
  }

  return results;
}
