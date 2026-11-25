import { parseImportInWorker } from './vcans-import-worker';
it('文件过大时在启动解析工作线程前拒绝', async () => {
  await expect(parseImportInWorker(Buffer.alloc(5 * 1024 * 1024 + 1))).rejects.toThrow('文件过大');
});
