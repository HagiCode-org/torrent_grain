import { createHash } from 'node:crypto';
import fs from 'node:fs';

export class HashVerifier {
  async verifyFile(filePath: string, expectedSha256: string): Promise<boolean> {
    const hash = createHash('sha256');
    await new Promise<void>((resolve, reject) => {
      const stream = fs.createReadStream(filePath);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', resolve);
      stream.on('error', reject);
    });
    return hash.digest('hex').toLowerCase() === expectedSha256.toLowerCase();
  }
}
