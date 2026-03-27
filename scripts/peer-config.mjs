import path from 'node:path';

export const PEER_CONFIGS = {
  1: {
    id: 'peer1',
    label: 'peer1',
    port: '32101',
    dataDir: path.resolve('.data-peer-1'),
    env: {},
  },
  2: {
    id: 'peer2',
    label: 'peer2',
    port: '32111',
    dataDir: path.resolve('.data-peer-2'),
    env: {
      TORRENT_GRAIN_HTTP_FALLBACK_ENABLED: 'false',
    },
  },
};

export function resolvePeerConfig(value) {
  const normalized = String(value ?? '1').trim().toLowerCase();
  if (normalized === '1' || normalized === 'peer1') {
    return PEER_CONFIGS[1];
  }

  if (normalized === '2' || normalized === 'peer2') {
    return PEER_CONFIGS[2];
  }

  throw new Error(`Unknown peer id: ${value}`);
}

export function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}
