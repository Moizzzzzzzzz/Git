import { defineConfig, type UserConfigExport } from '@tarojs/cli';

export default defineConfig<'webpack5'>(async () => {
  const config: UserConfigExport<'webpack5'> = {
    projectName: 'fabricqc-miniapp',
    date: '2026-10-28',
    designWidth: 750,
    deviceRatio: { 640: 2.34 / 2, 750: 1, 375: 2, 828: 1.81 / 2 },
    sourceRoot: 'src',
    outputRoot: 'dist',
    plugins: [],
    defineConstants: {},
    copy: { patterns: [], options: {} },
    framework: 'react',
    compiler: { type: 'webpack5', prebundle: { enable: false } },
    cache: { enable: false },
    alias: { '@': require('path').resolve(__dirname, '..', 'src') },
    mini: {
      postcss: {
        pxtransform: { enable: true, config: {} },
        cssModules: { enable: false },
      },
    },
  };
  return config;
});
