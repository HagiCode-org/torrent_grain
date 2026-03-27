import fs from 'node:fs/promises';
import { PEER_CONFIGS } from './peer-config.mjs';

const directories = Object.values(PEER_CONFIGS).map((peer) => peer.dataDir);

await Promise.all(
  directories.map((directory) => fs.rm(directory, { recursive: true, force: true })),
);

process.stdout.write(`peer demo cache cleared: ${directories.join(', ')}\n`);
