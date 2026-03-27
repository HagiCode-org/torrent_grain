import type { SourceConfig } from '../config/types.js';
import { normalizeIndexDocument, type HttpIndexDocument } from './index-normalizer.js';
import type { ReleaseAsset } from '../domain/release-asset.js';

export type FetchLike = typeof fetch;

export class IndexFeedClient {
  constructor(private readonly fetchImpl: FetchLike = fetch) {}

  async fetchSource(source: SourceConfig): Promise<ReleaseAsset[]> {
    const response = await this.fetchImpl(source.indexUrl, {
      headers: {
        accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Source ${source.id} returned ${response.status}`);
    }

    const document = await response.json() as HttpIndexDocument;
    return normalizeIndexDocument(source, document);
  }
}
