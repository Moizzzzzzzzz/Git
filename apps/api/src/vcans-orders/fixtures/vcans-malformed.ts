import { deflateRawSync } from 'node:zlib';
import * as XLSX from 'xlsx';
import { syntheticBytes } from './vcans-synthetic';

/** Fully synthetic adversarial containers. Never include a customer workbook. */
export function biffWithRecord(recordId: number): Buffer {
  const cfb = XLSX.CFB.read(syntheticBytes('biff8'), { type: 'buffer' });
  const stream = cfb.FileIndex.find((entry: { name: string }) => entry.name === 'Workbook');
  const original = Buffer.from(stream.content);
  const firstEnd = 4 + original.readUInt16LE(2);
  const record = Buffer.alloc(6);
  record.writeUInt16LE(recordId, 0); record.writeUInt16LE(2, 2);
  const mutated = Buffer.concat([original.subarray(0, firstEnd), record, original.subarray(firstEnd)]);
  // The inserted forbidden record is rejected before workbook offsets are followed.
  stream.content = mutated; stream.size = mutated.length;
  return Buffer.from(XLSX.CFB.write(cfb, { type: 'buffer' }));
}

export function encryptedOfficeContainer(): Buffer {
  const cfb = XLSX.CFB.utils.cfb_new();
  XLSX.CFB.utils.cfb_add(cfb, 'EncryptedPackage', Buffer.from('SYNTHETIC-ENCRYPTED-CONTENT'));
  XLSX.CFB.utils.cfb_add(cfb, 'EncryptionInfo', Buffer.alloc(8));
  return Buffer.from(XLSX.CFB.write(cfb, { type: 'buffer' }));
}

/** A one-entry ZIP with dishonest uncompressed size. Preflight must bound real inflation. */
export function dishonestZip(content: Buffer): Buffer {
  const name = Buffer.from('xl/worksheets/sheet1.xml');
  const compressed = deflateRawSync(content);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(1, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10);
  central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(1, 24); central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(local.length + name.length + compressed.length, 16);
  return Buffer.concat([local, name, compressed, central, name, end]);
}
