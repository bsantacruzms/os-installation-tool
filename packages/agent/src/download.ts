import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export interface DownloadProgress {
  bytesDone: number;
  bytesTotal: number;
  bytesPerSecond: number;
  etaSeconds: number;
}

export interface DownloadOptions {
  url: string;
  destination: string;
  sha256?: string;
  signal?: AbortSignal;
  onProgress?: (progress: DownloadProgress) => void;
}

async function sizeOf(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

/**
 * Downloads with resume support. A 9 GB ISO over a flaky connection is the
 * normal case, so an interrupted transfer picks up where it left off instead of
 * starting again.
 */
export async function downloadFile(options: DownloadOptions): Promise<{ path: string; bytes: number; resumed: boolean }> {
  await mkdir(dirname(options.destination), { recursive: true });

  const existing = await sizeOf(options.destination);
  const headers: Record<string, string> = {};
  if (existing > 0) headers['Range'] = `bytes=${existing}-`;

  const response = await fetch(options.url, { headers, signal: options.signal });

  if (existing > 0 && response.status === 416) {
    // The server says there is nothing left to send, so the file is complete.
    await verifyChecksum(options.destination, options.sha256);
    return { path: options.destination, bytes: existing, resumed: true };
  }
  if (!response.ok) {
    throw new Error(`Download failed: HTTP ${response.status} ${response.statusText}`);
  }
  if (!response.body) {
    throw new Error('Download failed: the server sent no data.');
  }

  const resumed = existing > 0 && response.status === 206;
  const startAt = resumed ? existing : 0;
  const remaining = Number(response.headers.get('content-length') ?? 0);
  const total = remaining > 0 ? startAt + remaining : 0;

  let done = startAt;
  const startedAt = Date.now();
  let lastReport = 0;

  const source = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
  source.on('data', (chunk: Buffer) => {
    done += chunk.length;
    const now = Date.now();
    if (options.onProgress && now - lastReport >= 250) {
      lastReport = now;
      const elapsed = Math.max(0.001, (now - startedAt) / 1000);
      const rate = (done - startAt) / elapsed;
      options.onProgress({
        bytesDone: done,
        bytesTotal: total,
        bytesPerSecond: rate,
        etaSeconds: total > 0 && rate > 0 ? (total - done) / rate : 0,
      });
    }
  });

  const sink = createWriteStream(options.destination, { flags: resumed ? 'a' : 'w' });
  await pipeline(source, sink, { signal: options.signal });

  const finalSize = await sizeOf(options.destination);
  if (total > 0 && finalSize !== total) {
    throw new Error(`Download is incomplete: expected ${total} bytes but got ${finalSize}.`);
  }

  await verifyChecksum(options.destination, options.sha256);
  return { path: options.destination, bytes: finalSize, resumed };
}

export async function sha256File(path: string, onProgress?: (bytesDone: number) => void): Promise<string> {
  const hash = createHash('sha256');
  let done = 0;
  const stream = createReadStream(path, { highWaterMark: 4 * 1024 * 1024 });
  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
    done += (chunk as Buffer).length;
    onProgress?.(done);
  }
  return hash.digest('hex');
}

async function verifyChecksum(path: string, expected: string | undefined): Promise<void> {
  if (!expected) return;
  const actual = await sha256File(path);
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`Checksum mismatch. Expected ${expected} but the downloaded file hashes to ${actual}.`);
  }
}
