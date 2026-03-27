export type SourceKind = 'desktop' | 'server';

export interface SourceConfig {
  id: string;
  kind: SourceKind;
  label: string;
  indexUrl: string;
  enabled: boolean;
  latestPerGroup: number;
  pinnedVersions: string[];
}

export interface ServiceConfig {
  appVersion: string;
  host: string;
  port: number;
  dataDir: string;
  cacheDir: string;
  tempDir: string;
  quarantineDir: string;
  catalogPath: string;
  pollIntervalMs: number;
  stallTimeoutMs: number;
  concurrency: number;
  cacheCapacityBytes: number;
  maxEntries: number;
  retentionDays: number;
  sharingEnabled: boolean;
  httpFallbackEnabled: boolean;
  uploadLimitKib: number;
  sources: SourceConfig[];
}
