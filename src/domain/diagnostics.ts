export type DiagnosticCode =
  | 'missing-torrent-url'
  | 'missing-info-hash'
  | 'missing-web-seeds'
  | 'missing-sha256'
  | 'missing-direct-url'
  | 'missing-hybrid-metadata'
  | 'metadata-ready'
  | 'scheduled'
  | 'skipped-incomplete-metadata'
  | 'source-fetch-failed'
  | 'source-parse-failed'
  | 'download-failed'
  | 'fallback-used'
  | 'verification-failed'
  | 'restored'
  | 'cleaned-up'
  | 'sharing-disabled'
  | 'interrupted-transfer';

export interface DiagnosticItem {
  code: DiagnosticCode;
  message: string;
  at: string;
}

export function diagnostic(code: DiagnosticCode, message: string, at = new Date().toISOString()): DiagnosticItem {
  return { code, message, at };
}
