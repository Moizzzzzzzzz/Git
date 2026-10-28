/** 测试用 Taro 替身：内存存储 + 可编程的 request */
const storage = new Map<string, unknown>();
const listeners = new Map<string, ((x: unknown) => void)[]>();

export const requests: { url: string; method: string; data: unknown }[] = [];
export let nextResponse: (req: { url: string; method: string; data: unknown }) => { statusCode: number; data: unknown } | Error = () => ({
  statusCode: 200,
  data: {},
});
export function setResponder(fn: typeof nextResponse) {
  nextResponse = fn;
}
export function resetStorage() {
  storage.clear();
  requests.length = 0;
}

const Taro = {
  getStorageSync: (k: string) => (storage.has(k) ? JSON.parse(JSON.stringify(storage.get(k))) : ''),
  setStorageSync: (k: string, v: unknown) => storage.set(k, JSON.parse(JSON.stringify(v))),
  removeStorageSync: (k: string) => storage.delete(k),
  eventCenter: {
    on: (e: string, fn: (x: unknown) => void) => listeners.set(e, [...(listeners.get(e) ?? []), fn]),
    off: (e: string) => listeners.delete(e),
    trigger: (e: string, x: unknown) => listeners.get(e)?.forEach((fn) => fn(x)),
  },
  getFileSystemManager: () => ({ unlinkSync: () => undefined }),
  request: async (opts: { url: string; method: string; data: unknown }) => {
    requests.push(opts);
    const r = nextResponse(opts);
    if (r instanceof Error) throw r;
    return r;
  },
  reLaunch: () => Promise.resolve(),
  showToast: () => Promise.resolve(),
  showModal: () => Promise.resolve({ confirm: true }),
};

export default Taro;
