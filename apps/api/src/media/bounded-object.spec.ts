import { Readable } from 'node:stream';
import { readBoundedObject } from './bounded-object';
it('对象读取实际流量超限时拒绝，即使对象元信息不准确', async () => {
  await expect(readBoundedObject(Readable.from([Buffer.alloc(3), Buffer.alloc(3)]), 5)).rejects.toThrow();
  expect(await readBoundedObject(Readable.from([Buffer.from('abc')]), 5)).toEqual(Buffer.from('abc'));
});
