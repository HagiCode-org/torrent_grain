import type { DiagnosticItem } from './diagnostics.js';

export type ServiceMode = 'idle' | 'discovering' | 'downloading' | 'fallback' | 'verifying' | 'shared' | 'error';

export interface SourceFailureSummary {
  sourceId: string;
  message: string;
  at: string;
}

export interface ServiceRuntimeState {
  live: boolean;
  ready: boolean;
  mode: ServiceMode;
  startedAt: string;
  catalogRecoveredAt?: string;
  lastScanStartedAt?: string;
  lastScanCompletedAt?: string;
  lastSuccessfulScanAt?: string;
  enabledSourceCount: number;
  recentFailures: SourceFailureSummary[];
  diagnostics: DiagnosticItem[];
}
