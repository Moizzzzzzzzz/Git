import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { parseVcansImport, VCANS_IMPORT_LIMITS, type VcansImportParseResult } from './vcans-import-parser';

if (!isMainThread && workerData?.kind === 'vcans-import') {
  try { parentPort!.postMessage({ result: parseVcansImport(new Uint8Array(workerData.bytes)) }); }
  catch { parentPort!.postMessage({ error: '文件解析失败' }); }
}
let active = 0;
export async function parseImportInWorker(bytes: Buffer): Promise<VcansImportParseResult> {
  if (bytes.length > VCANS_IMPORT_LIMITS.bytes) throw new Error('文件过大');
  if (active >= 2) throw new Error('导入任务繁忙，请稍后重试');
  active++;
  try {
    return await new Promise((resolve, reject) => {
      const worker = new Worker(__filename, { workerData: { kind: 'vcans-import', bytes } });
      const timer = setTimeout(() => { void worker.terminate(); reject(new Error('文件解析超时')); }, 10000);
      worker.once('message', (message: { result?: VcansImportParseResult; error?: string }) => {
        clearTimeout(timer); void worker.terminate();
        if (message.result) resolve(message.result); else reject(new Error(message.error ?? '文件解析失败'));
      });
      worker.once('error', () => { clearTimeout(timer); reject(new Error('文件解析失败')); });
      worker.once('exit', (code) => { if (code !== 0) { clearTimeout(timer); reject(new Error('文件解析失败')); } });
    });
  } finally { active--; }
}
