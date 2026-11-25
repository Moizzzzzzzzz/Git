/// <reference types="@tarojs/taro" />

declare module '*.png';
declare module '*.svg';

declare namespace NodeJS {
  interface ProcessEnv {
    TARO_ENV: 'weapp' | 'h5';
    TARO_APP_API_BASE_URL: string;
  }
}
