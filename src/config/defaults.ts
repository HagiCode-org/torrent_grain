import path from 'node:path';
import type { ServiceConfig, SourceConfig } from './types.js';

export const DEFAULT_SOURCES: SourceConfig[] = [
  {
    id: 'desktop',
    kind: 'desktop',
    label: 'HagiCode Desktop',
    indexUrl: 'https://index.hagicode.com/desktop/index.json',
    enabled: true,
    latestPerGroup: 2,
    pinnedVersions: [],
  },
  {
    id: 'server',
    kind: 'server',
    label: 'HagiCode Server/Web',
    indexUrl: 'https://index.hagicode.com/server/index.json',
    enabled: true,
    latestPerGroup: 2,
    pinnedVersions: [],
  },
];

export const DEFAULT_DATA_DIR = path.resolve(process.cwd(), '.data');

export function buildDefaultConfig(): ServiceConfig {
  return {
    appVersion: '0.1.0',
    host: '0.0.0.0',
    port: 32101,
    dataDir: DEFAULT_DATA_DIR,
    cacheDir: path.join(DEFAULT_DATA_DIR, 'cache'),
    tempDir: path.join(DEFAULT_DATA_DIR, 'temp'),
    quarantineDir: path.join(DEFAULT_DATA_DIR, 'quarantine'),
    catalogPath: path.join(DEFAULT_DATA_DIR, 'catalog.json'),
    pollIntervalMs: 5 * 60 * 1000,
    stallTimeoutMs: 45 * 1000,
    concurrency: 2,
    cacheCapacityBytes: 50 * 1024 * 1024 * 1024,
    maxEntries: 20,
    retentionDays: 30,
    sharingEnabled: true,
    httpFallbackEnabled: true,
    uploadLimitKib: 20 * 1024,
    sources: DEFAULT_SOURCES,
  };
}
