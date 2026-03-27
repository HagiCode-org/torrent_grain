import { spawn } from 'node:child_process';
import process from 'node:process';
import { npmCommand, resolvePeerConfig } from './peer-config.mjs';

const peer = resolvePeerConfig(process.argv[2]);
const child = spawn(npmCommand(), ['run', 'dev:server'], {
  env: {
    ...process.env,
    TORRENT_GRAIN_PORT: peer.port,
    TORRENT_GRAIN_DATA_DIR: peer.dataDir,
    ...peer.env,
  },
  stdio: 'inherit',
});

process.stdout.write(`[${peer.label}] port=${peer.port} dataDir=${peer.dataDir}\n`);
if (peer.env.TORRENT_GRAIN_HTTP_FALLBACK_ENABLED === 'false') {
  process.stdout.write(`[${peer.label}] http fallback disabled\n`);
}

const forwardSignal = (signal) => {
  if (!child.killed) {
    child.kill(signal);
  }
};

process.on('SIGINT', () => forwardSignal('SIGINT'));
process.on('SIGTERM', () => forwardSignal('SIGTERM'));

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
