import { fileURLToPath } from 'node:url';

// 使用绝对路径，保证从仓库根目录或 apps/admin 启动都能找到 Tailwind 配置
export default {
  plugins: {
    tailwindcss: { config: fileURLToPath(new URL('./tailwind.config.js', import.meta.url)) },
    autoprefixer: {},
  },
};
