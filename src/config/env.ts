import path from 'node:path';
import { buildDefaultConfig } from './defaults.js';
import type { ServiceConfig, SourceConfig } from './types.js';

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

function parseInteger(value: string | undefined, fallback: number, min = 0): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < min) {
    return fallback;
  }
  return parsed;
}

function parseBytes(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const match = value.trim().match(/^(\d+)(b|kb|kib|mb|mib|gb|gib)?$/i);
  if (!match) {
    return fallback;
  }

  const amountText = match[1];
  if (!amountText) {
    return fallback;
  }
  const amount = Number.parseInt(amountText, 10);
  const unit = (match[2] ?? 'b').toLowerCase();
  const scale: Record<string, number> = {
    b: 1,
    kb: 1000,
    kib: 1024,
    mb: 1000 ** 2,
    mib: 1024 ** 2,
    gb: 1000 ** 3,
    gib: 1024 ** 3,
  };

  return amount * (scale[unit] ?? 1);
}

function parseSources(value: string | undefined, fallback: SourceConfig[]): SourceConfig[] {
  if (!value) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(value) as Partial<SourceConfig>[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return fallback;
    }

    return parsed.map((item, index) => ({
      id: item.id ?? `source-${index + 1}`,
      kind: (item.kind === 'desktop' ? 'desktop' : 'server') as SourceConfig['kind'],
      label: item.label ?? item.id ?? `Source ${index + 1}`,
      indexUrl: item.indexUrl ?? fallback[index]?.indexUrl ?? '',
      enabled: item.enabled ?? true,
      latestPerGroup: Math.max(1, item.latestPerGroup ?? 1),
      pinnedVersions: Array.isArray(item.pinnedVersions)
        ? item.pinnedVersions.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
        : [],
    })).filter((item) => item.indexUrl.length > 0);
  } catch {
    return fallback;
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServiceConfig {
  const defaults = buildDefaultConfig();
  const dataDir = path.resolve(env.TORRENT_GRAIN_DATA_DIR ?? defaults.dataDir);
  const host = env.TORRENT_GRAIN_HOST ?? defaults.host;
  const port = parseInteger(env.TORRENT_GRAIN_PORT, defaults.port, 1);
  const pollIntervalMs = parseInteger(env.TORRENT_GRAIN_POLL_INTERVAL_MS, defaults.pollIntervalMs, 1000);
  const stallTimeoutMs = parseInteger(env.TORRENT_GRAIN_STALL_TIMEOUT_MS, defaults.stallTimeoutMs, 1000);
  const concurrency = parseInteger(env.TORRENT_GRAIN_CONCURRENCY, defaults.concurrency, 1);
  const cacheCapacityBytes = parseBytes(env.TORRENT_GRAIN_CACHE_CAPACITY, defaults.cacheCapacityBytes);
  const maxEntries = parseInteger(env.TORRENT_GRAIN_MAX_ENTRIES, defaults.maxEntries, 1);
  const retentionDays = parseInteger(env.TORRENT_GRAIN_RETENTION_DAYS, defaults.retentionDays, 1);
  const sharingEnabled = parseBoolean(env.TORRENT_GRAIN_SHARING_ENABLED, defaults.sharingEnabled);
  const httpFallbackEnabled = parseBoolean(env.TORRENT_GRAIN_HTTP_FALLBACK_ENABLED, defaults.httpFallbackEnabled);
  const uploadLimitKib = parseInteger(env.TORRENT_GRAIN_UPLOAD_LIMIT_KIB, defaults.uploadLimitKib, 0);
  const sources = parseSources(env.TORRENT_GRAIN_SOURCES, defaults.sources);
  const appVersion = env.TORRENT_GRAIN_VERSION ?? defaults.appVersion;

  return {
    appVersion,
    host,
    port,
    dataDir,
    cacheDir: path.join(dataDir, 'cache'),
    tempDir: path.join(dataDir, 'temp'),
    quarantineDir: path.join(dataDir, 'quarantine'),
    catalogPath: path.join(dataDir, 'catalog.json'),
    pollIntervalMs,
    stallTimeoutMs,
    concurrency,
    cacheCapacityBytes,
    maxEntries,
    retentionDays,
    sharingEnabled,
    httpFallbackEnabled,
    uploadLimitKib,
    sources,
  };
}
