import { defineConfig, type UserConfigExport } from '@tarojs/cli';

export default defineConfig<'webpack5'>(async () => {
  const config: UserConfigExport<'webpack5'> = {
    projectName: 'fabricqc-miniapp',
    date: '2026-10-28',
    designWidth: 750,
    deviceRatio: { 640: 2.34 / 2, 750: 1, 375: 2, 828: 1.81 / 2 },
    sourceRoot: process.env.FABRICQC_VISUAL_REVIEW === '1' ? 'review/src' : 'src',
    outputRoot: process.env.FABRICQC_OUTPUT_ROOT || (process.env.FABRICQC_VISUAL_REVIEW === '1' ? 'review/dist' : 'dist'),
    plugins: [],
    defineConstants: {},
    copy: { patterns: [], options: {} },
    framework: 'react',
    compiler: { type: 'webpack5', prebundle: { enable: false } },
    cache: { enable: false },
    alias: {
      '@': require('path').resolve(__dirname, '..', 'src'),
      // Keep Taro's reconciler and application hooks on the same React 18 instance.
      react: require('path').dirname(require.resolve('react/package.json', { paths: [require('path').resolve(__dirname, '..')] })),
    },
    mini: {
      compile: { include: [require('path').resolve(__dirname, '..', 'src')] },
      postcss: {
        pxtransform: { enable: true, config: {} },
        cssModules: { enable: false },
      },
    },
  };
  return config;
});
