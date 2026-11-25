import type { Readable } from 'node:stream';
export async function readBoundedObject(stream: Readable, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.length;
    if (total > maxBytes) { stream.destroy(); throw new Error('对象超过允许大小'); }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, total);
}
