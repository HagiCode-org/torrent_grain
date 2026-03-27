import type { AssetKind, HybridMetadata } from './release-asset.js';
import type { DiagnosticItem } from './diagnostics.js';

export type CacheState = 'planned' | 'downloading' | 'fallback' | 'verifying' | 'verified' | 'shared' | 'error' | 'cleaned';

export interface CacheEntry {
  id: string;
  sourceId: string;
  version: string;
  channel: string;
  platform: string;
  assetKind: AssetKind;
  name: string;
  filePath: string;
  relativePath: string;
  size: number;
  state: CacheState;
  retention: 'latest' | 'pinned' | 'latest+pinned' | 'history';
  hybrid: HybridMetadata;
  diagnostics: DiagnosticItem[];
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
  verifiedAt?: string;
  cleanedAt?: string;
  bytesDone: number;
  bytesTotal: number;
  downloadRate: number;
  uploadRate: number;
  peerCount: number;
  lastError?: string;
}
