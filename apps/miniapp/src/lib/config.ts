/** API 地址由 .env.development / .env.production 中的 TARO_APP_API_BASE_URL 注入 */
export const API_BASE_URL: string = process.env.TARO_APP_API_BASE_URL;

/** 固定受信演示入口，不从服务端响应或页面参数接受任意 URL。 */
export const DEMO_API_BASE_URL: string = process.env.TARO_APP_DEMO_API_BASE_URL ?? '';

export const DEMO_MEDIA_PREFIX = DEMO_API_BASE_URL ? DEMO_API_BASE_URL.replace(/\/demo-api$/, '/demo-media/') : '';
