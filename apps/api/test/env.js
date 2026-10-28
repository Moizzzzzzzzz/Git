// 测试环境变量：读取仓库根 .env，并强制使用独立测试库
const { existsSync } = require('node:fs');
const { resolve } = require('node:path');

function loadTestEnv() {
  const root = resolve(__dirname, '../../../.env');
  if (existsSync(root) && !process.env.__FQC_ENV_LOADED) {
    process.loadEnvFile(root);
    process.env.__FQC_ENV_LOADED = '1';
  }
  if (!process.env.TEST_DATABASE_URL) throw new Error('缺少 TEST_DATABASE_URL');
  if (process.env.TEST_DATABASE_URL === process.env.DEV_DATABASE_URL_GUARD) throw new Error('测试库不能与开发库相同');
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.NODE_ENV = 'test';
  process.env.RUN_WORKERS = 'false';
  process.env.SEED_ADMIN_USERNAME = 'admin';
  process.env.SEED_ADMIN_PASSWORD = 'TestAdmin12345';
  process.env.WECHAT_APP_ID = 'wx-test-app';
  process.env.WECHAT_APP_SECRET = 'test-secret-not-real';
  process.env.WECHAT_TPL_REVIEW_REQUEST = 'TPL_REVIEW_REQUEST';
  process.env.WECHAT_TPL_REVIEW_RESULT = 'TPL_REVIEW_RESULT';
}

module.exports = { loadTestEnv };
