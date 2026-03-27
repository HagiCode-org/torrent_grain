import { spawn } from 'node:child_process';
import process from 'node:process';
import readline from 'node:readline';
import { PEER_CONFIGS, npmCommand } from './peer-config.mjs';

const READY_TIMEOUT_MS = 60_000;
const CACHE_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 2_000;
const ACTIVE_CACHE_STATES = new Set(['verified', 'shared']);

const children = [];
let shuttingDown = false;

function prefixOutput(stream, prefix, target) {
  if (!stream) {
    return;
  }

  const reader = readline.createInterface({ input: stream });
  reader.on('line', (line) => {
    target.write(`[${prefix}] ${line}\n`);
  });
}

function spawnPeer(peer) {
  const child = spawn(npmCommand(), ['run', 'dev:server'], {
    env: {
      ...process.env,
      TORRENT_GRAIN_PORT: peer.port,
      TORRENT_GRAIN_DATA_DIR: peer.dataDir,
      ...peer.env,
    },
    stdio: ['inherit', 'pipe', 'pipe'],
  });

  prefixOutput(child.stdout, peer.label, process.stdout);
  prefixOutput(child.stderr, peer.label, process.stderr);
  children.push(child);
  return child;
}

async function waitFor(url, predicate, timeoutMs, description) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const payload = await response.json();
        if (predicate(payload)) {
          return payload;
        }
      }
    } catch {
      // Service is still booting. Keep polling.
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(`Timed out waiting for ${description}: ${url}`);
}

function shutdown(exitCode = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  }

  setTimeout(() => process.exit(exitCode), 200);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

const peer1 = PEER_CONFIGS[1];
const peer2 = PEER_CONFIGS[2];

process.stdout.write(`[demo] peer1 => http://127.0.0.1:${peer1.port}  dataDir=${peer1.dataDir}\n`);
process.stdout.write(`[demo] peer2 => http://127.0.0.1:${peer2.port}  dataDir=${peer2.dataDir}  httpFallback=off\n`);
process.stdout.write('[demo] starting peer1 first\n');

const peer1Process = spawnPeer(peer1);
peer1Process.on('exit', (code) => {
  if (!shuttingDown) {
    process.stderr.write(`[demo] peer1 exited early with code ${code ?? 0}\n`);
    shutdown(code ?? 1);
  }
});

await waitFor(
  `http://127.0.0.1:${peer1.port}/health`,
  (payload) => payload?.live === true,
  READY_TIMEOUT_MS,
  'peer1 health',
);

process.stdout.write('[demo] peer1 is live, waiting for its first verified cache entry\n');

try {
  await waitFor(
    `http://127.0.0.1:${peer1.port}/targets`,
    (payload) =>
      Array.isArray(payload?.cacheEntries)
      && payload.cacheEntries.some((entry) => ACTIVE_CACHE_STATES.has(entry?.state)),
    CACHE_TIMEOUT_MS,
    'peer1 verified cache',
  );
  process.stdout.write('[demo] peer1 has verified cache, starting peer2\n');
} catch (error) {
  process.stdout.write(`[demo] ${error.message}\n`);
  process.stdout.write('[demo] peer2 will still start, but may fall back to origin before peer1 is ready\n');
}

const peer2Process = spawnPeer(peer2);
peer2Process.on('exit', (code) => {
  if (!shuttingDown) {
    process.stderr.write(`[demo] peer2 exited early with code ${code ?? 0}\n`);
    shutdown(code ?? 1);
  }
});

process.stdout.write('[demo] both peers are running\n');
process.stdout.write(`[demo] inspect peer1: http://127.0.0.1:${peer1.port}/status\n`);
process.stdout.write(`[demo] inspect peer2: http://127.0.0.1:${peer2.port}/status\n`);
process.stdout.write('[demo] verify peer2 peerCount > 0 and peer1 uploadRate > 0\n');

await Promise.all([
  new Promise((resolve) => peer1Process.on('exit', resolve)),
  new Promise((resolve) => peer2Process.on('exit', resolve)),
]);
