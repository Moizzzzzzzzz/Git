const { execSync } = require('node:child_process');
const { loadTestEnv } = require('./env');

/**
 * 测试数据库准备：
 * 1. prisma migrate deploy（不存在则创建测试库，只应用迁移，非破坏性）
 * 2. 校验库名以 _test 结尾后清空业务表，然后写入种子数据
 */
module.exports = async () => {
  loadTestEnv();
  const url = new URL(process.env.DATABASE_URL);
  const dbName = url.pathname.replace(/^\//, '');
  if (!dbName.endsWith('_test')) throw new Error(`拒绝在非测试数据库上运行集成测试：${dbName}`);
  const opts = { stdio: 'pipe', cwd: __dirname + '/..', env: process.env };
  execSync('npx prisma migrate deploy', opts);

  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
  try {
    const [{ current_database }] = await prisma.$queryRaw`SELECT current_database()`;
    if (!String(current_database).endsWith('_test')) throw new Error('连接的不是测试库');
    const tables = await prisma.$queryRaw`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    if (tables.length) {
      const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
    }
  } finally {
    await prisma.$disconnect();
  }
  execSync('npx ts-node --transpile-only src/cli/seed.ts', opts);
};
