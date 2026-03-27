import { createApplication } from './app.js';
import { loadConfig } from './config/env.js';

const config = loadConfig();
const app = createApplication(config);

async function main(): Promise<void> {
  await app.start();
  process.stdout.write(`torrent_grain listening on ${config.host}:${config.port}\n`);
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.stop().finally(() => {
      process.exit(0);
    });
  });
}
