import type { CatalogState } from './catalog-store.js';

function activeTaskStates() {
  return new Set(['downloading', 'fallback', 'verifying', 'shared']);
}

export class SnapshotProjector {
  projectHealth(state: CatalogState): Record<string, unknown> {
    return {
      live: state.service.live,
      ready: state.service.ready,
      readiness: state.service.ready ? 'healthy' : 'degraded',
      version: state.version,
      startedAt: state.service.startedAt,
      updatedAt: state.service.lastScanCompletedAt ?? state.service.catalogRecoveredAt ?? state.service.startedAt,
      lastScanAt: state.service.lastSuccessfulScanAt ?? state.service.lastScanCompletedAt ?? null,
      enabledSources: state.service.enabledSourceCount,
      failures: state.service.recentFailures,
    };
  }

  projectStatus(state: CatalogState): Record<string, unknown> {
    const activeTasks = Object.values(state.entries)
      .filter((entry) => activeTaskStates().has(entry.state))
      .map((entry) => ({
        id: entry.id,
        sourceId: entry.sourceId,
        version: entry.version,
        name: entry.name,
        localPath: entry.filePath,
        mode: entry.state,
        bytesDone: entry.bytesDone,
        bytesTotal: entry.bytesTotal,
        downloadRate: entry.downloadRate,
        uploadRate: entry.uploadRate,
        peerCount: entry.peerCount,
        lastError: entry.lastError ?? null,
      }));

    const totalUploadRate = activeTasks.reduce((sum, entry) => sum + entry.uploadRate, 0);
    const totalDownloadRate = activeTasks.reduce((sum, entry) => sum + entry.downloadRate, 0);
    const servingPeerCount = activeTasks.reduce((sum, entry) => sum + entry.peerCount, 0);
    const sharedTaskCount = activeTasks.filter((entry) => entry.mode === 'shared').length;

    return {
      mode: state.service.mode,
      startedAt: state.service.startedAt,
      lastScanStartedAt: state.service.lastScanStartedAt ?? null,
      lastScanCompletedAt: state.service.lastScanCompletedAt ?? null,
      lastSuccessfulScanAt: state.service.lastSuccessfulScanAt ?? null,
      totalUploadRate,
      totalDownloadRate,
      servingPeerCount,
      sharedTaskCount,
      activeTasks,
      recentFailures: state.service.recentFailures,
    };
  }

  projectTargets(state: CatalogState): Record<string, unknown> {
    return {
      generatedAt: new Date().toISOString(),
      targets: Object.values(state.targets).map((record) => {
        const entry = state.entries[record.id];
        return {
          id: record.id,
          selected: record.selected,
          retention: record.retention,
          sourceId: record.asset.sourceId,
          version: record.asset.version,
          channel: record.asset.channel,
          platform: record.asset.platform,
          assetKind: record.asset.assetKind,
          relativePath: record.asset.relativePath,
          localPath: entry?.filePath ?? null,
          metadataState: record.asset.metadataState,
          diagnostics: record.diagnostics,
        };
      }),
      cacheEntries: Object.values(state.entries).map((entry) => ({
        id: entry.id,
        state: entry.state,
        retention: entry.retention,
        sourceId: entry.sourceId,
        version: entry.version,
        channel: entry.channel,
        platform: entry.platform,
        assetKind: entry.assetKind,
        filePath: entry.filePath,
        verifiedAt: entry.verifiedAt ?? null,
        cleanedAt: entry.cleanedAt ?? null,
        diagnostics: entry.diagnostics,
        lastError: entry.lastError ?? null,
      })),
    };
  }
}
