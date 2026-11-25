import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@tarojs/taro': fileURLToPath(new URL('./test/taro-mock.ts', import.meta.url)),
      '@fabricqc/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
      '@fabricqc/quality-engine': fileURLToPath(new URL('../../packages/quality-engine/src/index.ts', import.meta.url)),
    },
  },
  test: { include: ['test/**/*.test.ts'] },
});
