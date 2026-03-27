import http from 'node:http';
import fs from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { CatalogStore } from '../catalog/catalog-store.js';
import { SnapshotProjector } from '../catalog/snapshot-projector.js';
import type { ServiceConfig } from '../config/types.js';

export class StatusHttpServer {
  private server: http.Server;

  constructor(
    private readonly config: ServiceConfig,
    private readonly catalog: CatalogStore,
    private readonly projector: SnapshotProjector = new SnapshotProjector(),
    private readonly uiDistDir = path.resolve(process.cwd(), 'ui-dist'),
  ) {
    this.server = http.createServer((request, response) => {
      void this.handleRequest(request, response);
    });
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.server.listen(this.config.port, this.config.host, () => resolve());
    });
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  getUrl(): string {
    const address = this.server.address() as AddressInfo | null;
    if (!address) {
      return `http://${this.config.host}:${this.config.port}`;
    }
    return `http://${address.address}:${address.port}`;
  }

  private async handleRequest(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    if (request.method !== 'GET') {
      response.writeHead(405, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'method-not-allowed' }));
      return;
    }

    const url = new URL(request.url ?? '/', 'http://localhost');
    const snapshot = this.catalog.snapshot();

    if (url.pathname === '/health') {
      this.writeJson(response, 200, this.projector.projectHealth(snapshot));
      return;
    }
    if (url.pathname === '/status') {
      this.writeJson(response, 200, this.projector.projectStatus(snapshot));
      return;
    }
    if (url.pathname === '/targets') {
      this.writeJson(response, 200, this.projector.projectTargets(snapshot));
      return;
    }

    const handled = await this.tryServeStatic(url.pathname, response);
    if (handled) {
      return;
    }

    this.writeJson(response, 404, { error: 'not-found' });
  }

  private writeJson(response: http.ServerResponse, status: number, payload: Record<string, unknown>): void {
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(payload, null, 2));
  }

  private async tryServeStatic(pathname: string, response: http.ServerResponse): Promise<boolean> {
    const normalizedPath = pathname === '/' ? '/index.html' : pathname;
    const requestedPath = path.resolve(this.uiDistDir, `.${normalizedPath}`);
    const uiRoot = path.resolve(this.uiDistDir);

    if (!requestedPath.startsWith(uiRoot)) {
      return false;
    }

    const candidate = await this.readFileIfExists(requestedPath);
    if (candidate) {
      response.writeHead(200, { 'content-type': this.getContentType(requestedPath) });
      response.end(candidate);
      return true;
    }

    if (normalizedPath.includes('.')) {
      return false;
    }

    const indexPath = path.join(uiRoot, 'index.html');
    const index = await this.readFileIfExists(indexPath);
    if (!index) {
      return false;
    }

    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(index);
    return true;
  }

  private async readFileIfExists(filePath: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(filePath);
    } catch {
      return null;
    }
  }

  private getContentType(filePath: string): string {
    const extension = path.extname(filePath);
    const contentTypeMap: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.woff2': 'font/woff2',
    };

    return contentTypeMap[extension] ?? 'application/octet-stream';
  }
}
