import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const imageTag = process.argv[2] ?? 'torrent-grain:smoke';
const repoRoot = process.cwd();
let containerId = '';
let tempDir = '';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'inherit',
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`);
  }
}

function capture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'pipe'],
    ...options,
  });

  if (result.status !== 0) {
    const stdout = result.stdout?.trim();
    const stderr = result.stderr?.trim();
    throw new Error([stdout, stderr].filter(Boolean).join('\n') || `Command failed: ${command} ${args.join(' ')}`);
  }

  return result.stdout?.trim() ?? '';
}

async function waitForHealth(port) {
  const deadline = Date.now() + 45_000;
  const url = `http://127.0.0.1:${port}/health`;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Ignore transient startup failures.
    }

    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error(`Timed out waiting for ${url}.`);
}

async function cleanup() {
  if (containerId) {
    spawnSync('docker', ['rm', '-f', containerId], { cwd: repoRoot, stdio: 'ignore' });
  }
  spawnSync('docker', ['image', 'rm', '-f', imageTag], { cwd: repoRoot, stdio: 'ignore' });
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

try {
  console.log(`Building image ${imageTag}`);
  run('docker', ['build', '--progress=plain', '--tag', imageTag, '.']);

  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'torrent-grain-smoke-'));
  console.log('Starting container');
  containerId = capture('docker', [
    'run',
    '--detach',
    '--rm',
    '--env',
    'TORRENT_GRAIN_DATA_DIR=/data',
    '--volume',
    `${tempDir}:/data`,
    '--publish',
    '127.0.0.1::32101',
    imageTag,
  ]);

  const portBinding = capture('docker', ['port', containerId, '32101/tcp']);
  const port = portBinding.split(':').pop()?.trim();
  if (!port) {
    throw new Error(`Unable to resolve mapped port from "${portBinding}".`);
  }

  console.log(`Waiting for /health on port ${port}`);
  await waitForHealth(port);
  console.log('Docker smoke test passed');
} catch (error) {
  if (containerId) {
    const logs = spawnSync('docker', ['logs', containerId], { cwd: repoRoot, encoding: 'utf8' });
    if (logs.stdout?.trim()) {
      console.error(logs.stdout.trim());
    }
    if (logs.stderr?.trim()) {
      console.error(logs.stderr.trim());
    }
  }
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await cleanup();
}
