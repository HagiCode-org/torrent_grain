import type { SourceKind } from '../config/types.js';
import type { DiagnosticItem } from './diagnostics.js';

export type AssetKind = 'desktop' | 'server' | 'web' | 'generic';
export type MetadataState = 'ready' | 'incomplete';

export interface HybridMetadata {
  directUrl?: string;
  torrentUrl?: string;
  infoHash?: string;
  webSeeds: string[];
  sha256?: string;
}

export interface ReleaseAsset {
  id: string;
  sourceId: string;
  sourceKind: SourceKind;
  version: string;
  channel: string;
  platform: string;
  assetKind: AssetKind;
  name: string;
  relativePath: string;
  size: number;
  publishedAt: string;
  groupKey: string;
  metadataState: MetadataState;
  hybrid: HybridMetadata;
  diagnostics: DiagnosticItem[];
}

export interface TargetSelection {
  id: string;
  sourceId: string;
  version: string;
  channel: string;
  platform: string;
  assetKind: AssetKind;
  retention: 'latest' | 'pinned' | 'latest+pinned';
  asset: ReleaseAsset;
}

export interface PlannedTargetRecord {
  id: string;
  asset: ReleaseAsset;
  selected: boolean;
  retention: 'latest' | 'pinned' | 'latest+pinned' | 'history';
  diagnostics: DiagnosticItem[];
  evaluatedAt: string;
}
