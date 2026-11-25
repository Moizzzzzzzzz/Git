/**
 * 种子数据（可重复执行，不会覆盖已有数据）。
 * - 角色、初始管理员（SEED_ADMIN_USERNAME / SEED_ADMIN_PASSWORD）
 * - 默认疵点类型、检验模板、【开发默认】四分制标准
 * - SEED_DEMO=true 且非生产环境时，额外生成演示用员工、客户、面料、布卷
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Prisma, PrismaClient, RoleCode } from '@prisma/client';
import { hash } from '@node-rs/argon2';
import {
  DEFAULT_TEMPLATE_CONTENT,
  DEV_DEFAULT_FOUR_POINT_RULES,
  passwordSchema,
  ROLE_LABELS,
  standardRulesSchema,
  templateContentSchema,
} from '@fabricqc/shared';

const rootEnv = resolve(__dirname, '../../../../.env');
if (!process.env.DATABASE_URL && existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const prisma = new PrismaClient();

const DEFECT_TYPES: [string, string, string, 'MINOR' | 'MAJOR' | 'CRITICAL', string][] = [
  ['SLUB', '粗节', 'Slub', 'MINOR', '纱线'],
  ['NEP', '棉结', 'Nep', 'MINOR', '纱线'],
  ['KNOT', '结头', 'Knot', 'MINOR', '纱线'],
  ['BROKEN_END', '断经', 'Broken end', 'MAJOR', '织造'],
  ['BROKEN_PICK', '断纬', 'Broken pick', 'MAJOR', '织造'],
  ['MISSING_PICK', '缺纬', 'Missing pick', 'MAJOR', '织造'],
  ['FLOAT', '跳纱', 'Float', 'MAJOR', '织造'],
  ['BARRE', '横档', 'Barre', 'MAJOR', '织造'],
  ['HOLE', '破洞', 'Hole', 'MAJOR', '外观'],
  ['OIL', '油污', 'Oil stain', 'MAJOR', '污渍'],
  ['STAIN', '污渍', 'Stain', 'MINOR', '污渍'],
  ['CREASE', '折痕', 'Crease', 'MINOR', '外观'],
  ['SHADING', '色差（连续）', 'Shading', 'MAJOR', '染整'],
  ['CONT_STREAK', '条花（连续）', 'Continuous streak', 'MAJOR', '染整'],
  ['COATING', '涂层不良', 'Coating defect', 'MAJOR', '涂层'],
];

async function seedRoles() {
  for (const code of Object.values(RoleCode)) {
    await prisma.role.upsert({ where: { code }, create: { code, name: ROLE_LABELS[code] }, update: { name: ROLE_LABELS[code] } });
  }
}

async function seedAdmin() {
  const username = process.env.SEED_ADMIN_USERNAME || 'admin';
  const password = process.env.SEED_ADMIN_PASSWORD ?? '';
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    console.log(`管理员 ${username} 已存在，跳过`);
    return existing;
  }
  const ok = passwordSchema.safeParse(password);
  if (!ok.success) throw new Error(`SEED_ADMIN_PASSWORD 不符合要求：${ok.error.issues[0]?.message}`);
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: 'ADMIN' } });
  const user = await prisma.user.create({
    data: {
      employeeNo: 'ADMIN',
      name: '系统管理员',
      username,
      passwordHash: await hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 }),
      roles: { create: [{ roleId: adminRole.id }] },
    },
  });
  console.log(`已创建管理员 ${username}`);
  return user;
}

async function seedDefectTypes() {
  for (const [i, [code, nameZh, nameEn, defaultSeverity, category]] of DEFECT_TYPES.entries()) {
    await prisma.defectType.upsert({
      where: { code },
      create: { code, nameZh, nameEn, defaultSeverity, category, sortOrder: (i + 1) * 10 },
      update: {},
    });
  }
}

async function seedTemplate() {
  const content = templateContentSchema.parse(DEFAULT_TEMPLATE_CONTENT);
  return prisma.inspectionTemplate.upsert({
    where: { code: 'DEFAULT' },
    create: {
      code: 'DEFAULT',
      name: '通用梭织面料检验模板【开发默认】',
      description: '开发默认模板：门幅 3 点、有效门幅 3 点、克重、卷长；工厂确认后调整',
      content: content as Prisma.InputJsonValue,
    },
    update: {},
  });
}

async function seedFourPoint(adminId: string) {
  const rules = standardRulesSchema.parse(DEV_DEFAULT_FOUR_POINT_RULES);
  const std = await prisma.qualityStandard.upsert({
    where: { code: 'FOUR_POINT_DEV' },
    create: {
      code: 'FOUR_POINT_DEV',
      name: '四分制（开发默认，未经工厂批准）',
      kind: 'FOUR_POINT',
      description:
        '参照 ASTM D5430 常见口径：≤3英寸1分、3-6英寸2分、6-9英寸3分、>9英寸4分；破洞≤1英寸2分、>1英寸4分；连续性疵点每码4分；每码封顶4分；合格阈值 40分/100平方码；致命疵点一票否决。仅供开发测试，不能作为正式验收标准。',
    },
    update: {},
  });
  const v = await prisma.standardVersion.findFirst({ where: { standardId: std.id } });
  if (!v) {
    await prisma.standardVersion.create({
      data: {
        standardId: std.id,
        version: 1,
        status: 'PUBLISHED',
        rules: rules as Prisma.InputJsonValue,
        isDevDefault: true,
        notes: '【开发默认值】种子数据自动发布',
        createdById: adminId,
        publishedById: adminId,
        publishedAt: new Date(),
      },
    });
  }
  return std;
}

async function seedDemo(fourPointId: string, templateId: string) {
  console.log('生成演示数据（SEED_DEMO=true）…');
  const dept = await prisma.department.upsert({
    where: { code: 'QC' },
    create: { code: 'QC', name: '质检部' },
    update: {},
  });
  const role = async (code: RoleCode) => (await prisma.role.findUniqueOrThrow({ where: { code } })).id;
  const supervisor = await prisma.user.upsert({
    where: { employeeNo: 'DEMO-S01' },
    create: {
      employeeNo: 'DEMO-S01',
      name: '演示主管',
      departmentId: dept.id,
      position: '质检主管',
      roles: { create: [{ roleId: await role('QC_SUPERVISOR'), departmentId: dept.id }] },
    },
    update: {},
  });
  await prisma.user.upsert({
    where: { employeeNo: 'DEMO-I01' },
    create: {
      employeeNo: 'DEMO-I01',
      name: '演示质检员',
      departmentId: dept.id,
      position: '质检员',
      supervisorId: supervisor.id,
      roles: { create: [{ roleId: await role('INSPECTOR') }] },
    },
    update: {},
  });
  const customer = await prisma.customer.upsert({
    where: { code: 'DEMO-C01' },
    create: { code: 'DEMO-C01', name: '演示客户' },
    update: {},
  });
  const fabric = await prisma.fabric.upsert({
    where: { code: 'DEMO-F001' },
    create: {
      code: 'DEMO-F001',
      nameZh: '涤纶春亚纺（演示）',
      nameEn: 'Polyester Pongee (demo)',
      composition: '100% Polyester',
      widthCm: 152,
      cuttableWidthCm: 148,
      gsm: 68,
      weaveStructure: '平纹',
      coatingType: 'PU',
      color: '藏青',
      colorCode: 'NV-01',
      customerId: customer.id,
      defaultFourPointStandardId: fourPointId,
      defaultTemplateId: templateId,
    },
    update: {},
  });
  const lot = await prisma.productionLot.upsert({
    where: { fabricId_lotNo_dyeLotNo: { fabricId: fabric.id, lotNo: 'DEMO-L01', dyeLotNo: 'D01' } },
    create: { fabricId: fabric.id, lotNo: 'DEMO-L01', dyeLotNo: 'D01', colorCode: 'NV-01' },
    update: {},
  });
  const codes = ['DEMOQR0001', 'DEMOQR0002', 'DEMOQR0003'].map((c) => c.replace(/O/g, '0'));
  for (const [i, qr] of codes.entries()) {
    const rollNo = `DEMO-R${String(i + 1).padStart(3, '0')}`;
    await prisma.fabricRoll.upsert({
      where: { rollNo },
      create: {
        rollNo,
        qrCode: qr,
        fabricId: fabric.id,
        lotId: lot.id,
        dyeLotNo: 'D01',
        colorCode: 'NV-01',
        nominalLengthM: 100,
      },
      update: {},
    });
  }
  console.log('演示员工：DEMO-I01（质检员）、DEMO-S01（主管），需在后台生成绑定码后用小程序绑定');
}

async function main() {
  await seedRoles();
  const admin = await seedAdmin();
  await seedDefectTypes();
  const template = await seedTemplate();
  const fp = await seedFourPoint(admin.id);
  if (process.env.SEED_DEMO === 'true') {
    if (process.env.NODE_ENV === 'production') throw new Error('生产环境禁止生成演示数据');
    await seedDemo(fp.id, template.id);
  }
  console.log('种子数据完成');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
