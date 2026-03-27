import { useEffect, useState } from 'react';

type HealthPayload = {
  live: boolean;
  ready: boolean;
  readiness: string;
  version: number;
  startedAt: string;
  updatedAt: string;
  lastScanAt: string | null;
  enabledSources: number;
  failures: Array<{ sourceId: string; message: string; at: string }>;
};

type StatusPayload = {
  mode: string;
  startedAt: string;
  lastScanStartedAt: string | null;
  lastScanCompletedAt: string | null;
  lastSuccessfulScanAt: string | null;
  totalUploadRate: number;
  totalDownloadRate: number;
  servingPeerCount: number;
  sharedTaskCount: number;
  activeTasks: Array<{
    id: string;
    sourceId: string;
    version: string;
    name: string;
    localPath: string;
    mode: string;
    bytesDone: number;
    bytesTotal: number;
    downloadRate: number;
    uploadRate: number;
    peerCount: number;
    lastError: string | null;
  }>;
  recentFailures: Array<{ sourceId: string; message: string; at: string }>;
};

type TargetsPayload = {
  generatedAt: string;
  targets: Array<{
    id: string;
    selected: boolean;
    retention: string;
    sourceId: string;
    version: string;
    channel: string;
    platform: string;
    assetKind: string;
    relativePath: string;
    localPath: string | null;
    metadataState: string;
    diagnostics: Array<{ code: string; message: string; at: string }>;
  }>;
  cacheEntries: Array<{
    id: string;
    state: string;
    retention: string;
    sourceId: string;
    version: string;
    channel: string;
    platform: string;
    assetKind: string;
    filePath: string;
    verifiedAt: string | null;
    cleanedAt: string | null;
    diagnostics: Array<{ code: string; message: string; at: string }>;
    lastError: string | null;
  }>;
};

type DashboardState = {
  health: HealthPayload | null;
  status: StatusPayload | null;
  targets: TargetsPayload | null;
  loading: boolean;
  error: string | null;
  updatedAt: string | null;
};

type CopyToastState = {
  kind: 'success' | 'error';
  path: string | null;
  message: string;
};

const initialState: DashboardState = {
  health: null,
  status: null,
  targets: null,
  loading: true,
  error: null,
  updatedAt: null,
};

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return 'N/A';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('en-US', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0 B';
  }

  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let current = value;
  let index = 0;
  while (current >= 1024 && index < units.length - 1) {
    current /= 1024;
    index += 1;
  }
  return `${current.toFixed(current >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatRate(value: number): string {
  return `${formatBytes(value)}/s`;
}

function folderLabel(pathValue: string): string {
  const segments = pathValue.split(/[\\/]+/).filter(Boolean);
  if (segments.length === 0) {
    return pathValue;
  }
  if (segments.length === 1) {
    return segments[0];
  }
  return segments[segments.length - 2];
}

function modeTone(mode: string): string {
  const map: Record<string, string> = {
    idle: 'muted',
    discovering: 'sky',
    downloading: 'amber',
    fallback: 'rose',
    verifying: 'violet',
    shared: 'mint',
    error: 'danger',
    planned: 'muted',
    verified: 'sky',
    cleaned: 'muted',
  };
  return map[mode] ?? 'muted';
}

async function readJson<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`${path} -> ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export default function App() {
  const [state, setState] = useState<DashboardState>(initialState);
  const [copyState, setCopyState] = useState<CopyToastState | null>(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const [health, status, targets] = await Promise.all([
          readJson<HealthPayload>('/health'),
          readJson<StatusPayload>('/status'),
          readJson<TargetsPayload>('/targets'),
        ]);

        if (!active) {
          return;
        }

        setState({
          health,
          status,
          targets,
          loading: false,
          error: null,
          updatedAt: new Date().toISOString(),
        });
      } catch (error) {
        if (!active) {
          return;
        }

        setState((current) => ({
          ...current,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
          updatedAt: new Date().toISOString(),
        }));
      }
    };

    void load();
    const timer = window.setInterval(() => {
      void load();
    }, 5000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!copyState) {
      return;
    }

    const timer = window.setTimeout(() => {
      setCopyState(null);
    }, 1800);

    return () => {
      window.clearTimeout(timer);
    };
  }, [copyState]);

  const splitPathForToast = (filePath: string) => {
    const normalized = filePath.replace(/\\/g, '/');
    const index = normalized.lastIndexOf('/');
    if (index < 0) {
      return { prefix: '', tail: normalized };
    }

    return {
      prefix: normalized.slice(0, index + 1),
      tail: normalized.slice(index + 1),
    };
  };

  const copyPath = async (filePath: string | null | undefined) => {
    if (!filePath) {
      setCopyState({
        kind: 'error',
        path: null,
        message: 'Local path is not available yet',
      });
      return;
    }

    try {
      await navigator.clipboard.writeText(filePath);
      setCopyState({
        kind: 'success',
        path: filePath,
        message: 'Path copied',
      });
    } catch {
      setCopyState({
        kind: 'error',
        path: filePath,
        message: 'Clipboard write failed',
      });
    }
  };

  const selectedCount = state.targets?.targets.filter((item) => item.selected).length ?? 0;
  const verifiedCount = state.targets?.cacheEntries.filter((item) => item.state === 'shared' || item.state === 'verified').length ?? 0;

  return (
    <div className="shell">
      <div className="grain" />
      <div className="flare flare-a" />
      <div className="flare flare-b" />
      {copyState ? (
        <div className={`copy-toast copy-toast-${copyState.kind}`}>
          <div className="copy-toast-label">{copyState.message}</div>
          {copyState.path ? (
            <div className="copy-toast-path">
              <span>{splitPathForToast(copyState.path).prefix}</span>
              <strong>{splitPathForToast(copyState.path).tail}</strong>
            </div>
          ) : null}
        </div>
      ) : null}
      <main className="layout">
        <section className="panel panel-header">
          <div className="header-bar">
            <div className="header-title">
              <div className="eyebrow">torrent grain / viewer</div>
              <h1>Cache Overview</h1>
            </div>
            <div className="header-status">
              <div className={`mode-pill tone-${modeTone(state.status?.mode ?? 'idle')}`}>
                {state.status?.mode ?? 'loading'}
              </div>
              <div className="subline">Updated {formatDate(state.updatedAt)}</div>
            </div>
          </div>
          <div className="stat-ribbon compact">
            <StatCard label="Ready" value={state.health?.ready ? 'Yes' : 'No'} detail={state.health?.readiness ?? 'Loading'} />
            <StatCard label="Sources" value={String(state.health?.enabledSources ?? 0)} detail="Enabled" />
            <StatCard label="Targets" value={String(selectedCount)} detail="In plan" />
            <StatCard label="Cached" value={String(verifiedCount)} detail="Verified" />
            <StatCard label="Upload" value={formatRate(state.status?.totalUploadRate ?? 0)} detail={`Serving ${state.status?.servingPeerCount ?? 0} peers`} />
          </div>
        </section>

        <section className="panel strip">
          <div>
            <span className="strip-label">Scan Start</span>
            <strong>{formatDate(state.status?.lastScanStartedAt)}</strong>
          </div>
          <div>
            <span className="strip-label">Scan End</span>
            <strong>{formatDate(state.status?.lastScanCompletedAt)}</strong>
          </div>
          <div>
            <span className="strip-label">Last Success</span>
            <strong>{formatDate(state.status?.lastSuccessfulScanAt ?? state.health?.lastScanAt)}</strong>
          </div>
          <div>
            <span className="strip-label">Failures</span>
            <strong>{String((state.health?.failures.length ?? 0) + (state.status?.recentFailures.length ?? 0))}</strong>
          </div>
        </section>

        {state.error ? (
          <section className="panel panel-error">
            <div className="eyebrow">Fetch Error</div>
            <p>{state.error}</p>
          </section>
        ) : null}

        <section className="panel">
          <SectionHead title="Target Set" kicker="planner" count={state.targets?.targets.length ?? 0} />
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Version</th>
                  <th>Channel</th>
                  <th>Platform</th>
                  <th>Retention</th>
                  <th>Metadata</th>
                  <th>Copy</th>
                </tr>
              </thead>
              <tbody>
                {(state.targets?.targets ?? []).map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div className="asset-name" title={item.relativePath}>{folderLabel(item.relativePath)}</div>
                      <div className="asset-sub">{item.sourceId} · {item.assetKind}</div>
                    </td>
                    <td>{item.version}</td>
                    <td>{item.channel}</td>
                    <td>{item.platform}</td>
                    <td>
                      <span className={`mode-pill tone-${item.selected ? 'mint' : 'muted'}`}>{item.retention}</span>
                    </td>
                    <td>
                      <span className={`mode-pill tone-${item.metadataState === 'ready' ? 'sky' : 'danger'}`}>{item.metadataState}</span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="copy-button"
                        title={item.localPath ? `Copy local path\n${item.localPath}` : 'Local path is not available yet'}
                        onClick={() => {
                          void copyPath(item.localPath);
                        }}
                      >
                        <span className="copy-icon" aria-hidden="true">⧉</span>
                        <span>Copy</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <SectionHead title="Active Tasks" kicker="runtime" count={state.status?.activeTasks.length ?? 0} />
          {(state.status?.activeTasks.length ?? 0) === 0 ? (
            <EmptyState title="No active transfers" note="The service is idle, but status still refreshes." />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Task</th>
                    <th>State</th>
                    <th>Progress</th>
                    <th>Download</th>
                    <th>Upload</th>
                    <th>Peer</th>
                    <th>Notes</th>
                    <th>Copy</th>
                  </tr>
                </thead>
                <tbody>
                  {(state.status?.activeTasks ?? []).map((task) => {
                    const ratio = task.bytesTotal > 0 ? Math.min(100, (task.bytesDone / task.bytesTotal) * 100) : 0;
                    return (
                      <tr key={task.id}>
                        <td>
                          <div className="asset-name" title={task.name}>{folderLabel(task.name)}</div>
                          <div className="asset-sub">{task.sourceId} · {task.version}</div>
                        </td>
                        <td>
                          <span className={`mode-pill tone-${modeTone(task.mode)}`}>{task.mode}</span>
                        </td>
                        <td>
                          <div className="progress-cell">
                            <div className="progress-track compact">
                              <div className="progress-fill" style={{ width: `${ratio}%` }} />
                            </div>
                            <div className="table-note">{formatBytes(task.bytesDone)} / {formatBytes(task.bytesTotal)}</div>
                          </div>
                        </td>
                        <td>{formatRate(task.downloadRate)}</td>
                        <td>{formatRate(task.uploadRate)}</td>
                        <td>{task.peerCount}</td>
                        <td className="table-note">{task.lastError ?? '—'}</td>
                        <td>
                          <button
                            type="button"
                            className="copy-button"
                            title={`Copy local path\n${task.localPath}`}
                            onClick={() => {
                              void copyPath(task.localPath);
                            }}
                          >
                            <span className="copy-icon" aria-hidden="true">⧉</span>
                            <span>Copy</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function StatCard(props: { label: string; value: string; detail: string }) {
  return (
    <article className="stat-card">
      <div className="stat-label">{props.label}</div>
      <div className="stat-value">{props.value}</div>
      <div className="stat-detail">{props.detail}</div>
    </article>
  );
}

function SectionHead(props: { title: string; kicker: string; count: number }) {
  return (
    <header className="section-head">
      <div>
        <div className="eyebrow">{props.kicker}</div>
        <h2>{props.title}</h2>
      </div>
      <div className="section-count">{props.count}</div>
    </header>
  );
}

function EmptyState(props: { title: string; note: string }) {
  return (
    <div className="empty-state">
      <strong>{props.title}</strong>
      <span>{props.note}</span>
    </div>
  );
}
