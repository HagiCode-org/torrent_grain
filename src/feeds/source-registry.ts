import type { SourceConfig } from '../config/types.js';

export class SourceRegistry {
  constructor(private readonly sources: SourceConfig[]) {}

  listEnabled(): SourceConfig[] {
    return this.sources.filter((source) => source.enabled);
  }

  getById(id: string): SourceConfig | undefined {
    return this.sources.find((source) => source.id === id);
  }
}
