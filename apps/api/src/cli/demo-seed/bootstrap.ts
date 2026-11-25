export interface InstallState { version: string; phase: string }
export interface BaseTransaction {
  readState(): Promise<InstallState | null>;
  validateExisting(): Promise<boolean>;
  checkNoConflicts(): Promise<boolean>;
  createBase(): Promise<void>;
  writeState(state: InstallState): Promise<void>;
}
export interface BaseStore {
  /** Must attest DB, storage, and side-effect isolation before transaction. */
  verify(): Promise<void>;
  /** Implementation must hold a DB advisory transaction lock throughout. */
  transaction(fn: (tx: BaseTransaction) => Promise<string>): Promise<string>;
}
/** Base records and marker must commit together; never repairs partial installs. */
export async function installBase(store: BaseStore): Promise<string> {
  await store.verify();
  return store.transaction(async tx => {
    const state = await tx.readState();
    if (state) {
      if (state.version !== 'v1' || state.phase !== 'base-complete') throw new Error('演示种子状态未完成或版本不符，请人工核查');
      if (!(await tx.validateExisting())) throw new Error('演示种子状态不一致，请人工核查');
      return 'already-installed';
    }
    if (!(await tx.checkNoConflicts())) throw new Error('演示种子存在冲突，拒绝覆盖');
    await tx.createBase();
    await tx.writeState({ version: 'v1', phase: 'base-complete' });
    return 'installed';
  });
}

import type { Prisma, PrismaClient } from '@prisma/client';
import { DEMO_DEPARTMENTS, DEMO_PERSONAS, DEMO_DEFECTS, DEMO_TEMPLATES, DEMO_STANDARDS, DEMO_FABRICS, DEMO_SEED_ACTOR } from './manifest';

const STATE_KEY = 'demo.seed.v1';
const ROLE_NAMES = { SALES:'业务员', BUSINESS_MANAGER:'部门经理', BUSINESS_CLERK:'内勤', QC_SUPERVISOR:'质检主管', INSPECTOR:'质检员', QUALITY_MANAGER:'质量经理', ADMIN:'管理员' } as const;
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
function canonicalJson(value:unknown):unknown {
 if(Array.isArray(value)) return value.map(canonicalJson);
 if(value!==null && typeof value==='object') return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonicalJson((value as Record<string,unknown>)[k])]));
 return value;
}
export function sameSeedJson(a:unknown,b:unknown):boolean { return JSON.stringify(canonicalJson(a))===JSON.stringify(canonicalJson(b)); }

/** Adapter is inert on construction; caller supplies a verifier tied to the exact resources. */
export function createPrismaDemoStore(prisma: PrismaClient, verify: () => Promise<void>): BaseStore {
  return {
    verify,
    transaction: fn => prisma.$transaction(async tx => {
      const lock=await tx.$queryRaw<{locked:boolean}[]>`SELECT pg_try_advisory_xact_lock(731561201, 1) AS locked`;
      if(!lock[0]?.locked) throw new Error('演示种子已有执行者');
      const adapter: BaseTransaction = {
        async readState() {
          const row = await tx.systemSetting.findUnique({ where: { key: STATE_KEY } });
          if (!row) return null;
          const value = row.value as { environmentId?: unknown; resetVersion?: unknown; version?: unknown; phase?: unknown } | null;
          if (!value || value.environmentId !== 'fabricqc-demo' || value.resetVersion !== 'v1' || typeof value.version !== 'string' || typeof value.phase !== 'string') throw new Error('演示种子标记不一致');
          return { version: value.version, phase: value.phase };
        },
        async validateExisting() {
          for (const d of DEMO_DEPARTMENTS) {
            const row = await tx.department.findUnique({ where: { id: d.id } });
            if (!row || row.code !== d.code) return false;
          }
          for (const p of [...DEMO_PERSONAS, DEMO_SEED_ACTOR]) {
            const u = await tx.user.findUnique({ where: { id: p.id }, include: { roles: { include: { role: true } }, wechat: true } });
            if (!u || u.status !== 'ACTIVE' || u.employeeNo !== p.employeeNo || u.departmentId !== p.departmentId || u.roles.length !== 1 || u.roles[0].role.code !== p.role || u.roles[0].departmentId !== p.roleDepartmentId || u.wechat.length || u.passwordHash || u.username) return false;
          }
          for (const t of DEMO_TEMPLATES) { const row=await tx.inspectionTemplate.findUnique({where:{code:t.code}}); if(!row||!row.isActive||!sameSeedJson(row.content,t.content)) return false; }
          for (const s of DEMO_STANDARDS) {
            const row = await tx.qualityStandard.findUnique({ where: { code: s.standard.code }, include: { versions: true } });
            if (!row || !row.isActive || !row.versions.some(v => v.isDevDefault && v.status === 'PUBLISHED' && sameSeedJson(v.rules,s.version.rules))) return false;
          }
          for (const f of DEMO_FABRICS) {
            const row=await tx.fabric.findUnique({where:{code:f.body.code},include:{defaultTemplate:true,defaultFourPointStandard:true}});
            if(!row||!row.isActive||row.defaultTemplate?.code!==f.expectedTemplateCode||row.defaultFourPointStandard?.code!==f.expectedStandardCode) return false;
          }
          for (const d of DEMO_DEFECTS) if (!(await tx.defectType.findUnique({ where: { code: d.code } }))) return false;
          return true;
        },
        async checkNoConflicts() {
          const [departments, users, templates, standards, fabrics, defects] = await Promise.all([
            tx.department.count({ where: { OR: [{ id: { in: DEMO_DEPARTMENTS.map(d => d.id) } }, { code: { in: DEMO_DEPARTMENTS.map(d => d.code) } }] } }),
            tx.user.count({ where: { OR: [{ id: { in: [...DEMO_PERSONAS, DEMO_SEED_ACTOR].map(p => p.id) } }, { employeeNo: { in: [...DEMO_PERSONAS, DEMO_SEED_ACTOR].map(p => p.employeeNo) } }] } }),
            tx.inspectionTemplate.count({ where: { code: { in: DEMO_TEMPLATES.map(t => t.code) } } }),
            tx.qualityStandard.count({ where: { code: { in: DEMO_STANDARDS.map(s => s.standard.code) } } }),
            tx.fabric.count({ where: { code: { in: DEMO_FABRICS.map(f => f.body.code) } } }),
            tx.defectType.count({ where: { code: { in: DEMO_DEFECTS.map(d => d.code) } } }),
          ]);
          return departments + users + templates + standards + fabrics + defects === 0;
        },
        async createBase() {
          const roleIds = new Map<string,string>();
          for (const [code,name] of Object.entries(ROLE_NAMES)) {
            const role = await tx.role.findUnique({ where: { code: code as keyof typeof ROLE_NAMES } }) ?? await tx.role.create({ data: { code: code as keyof typeof ROLE_NAMES, name } });
            roleIds.set(code,role.id);
          }
          for (const d of DEMO_DEPARTMENTS) await tx.department.create({ data: { ...d } });
          for (const p of [...DEMO_PERSONAS, DEMO_SEED_ACTOR]) {
            const roleId=roleIds.get(p.role); if(!roleId) throw new Error('演示角色缺失');
            await tx.user.create({ data: { id:p.id, employeeNo:p.employeeNo, name:p.name, departmentId:p.departmentId, roles:{create:{roleId, departmentId:p.roleDepartmentId}} } });
          }
          for (const [i,d] of DEMO_DEFECTS.entries()) await tx.defectType.create({ data: {...d, sortOrder:(i+1)*10} });
          const templateIds=new Map<string,string>(), standardIds=new Map<string,string>();
          for (const t of DEMO_TEMPLATES) { const x=await tx.inspectionTemplate.create({data:{...t,content:json(t.content)}});templateIds.set(t.code,x.id); }
          for (const s of DEMO_STANDARDS) {
            const x=await tx.qualityStandard.create({ data: {...s.standard} });standardIds.set(s.standard.code,x.id);
            await tx.standardVersion.create({ data: { standardId:x.id, version:1, status:'PUBLISHED', isDevDefault:true, rules:json(s.version.rules), notes:s.version.notes, publishedAt:new Date(), createdById:DEMO_PERSONAS[6].id, publishedById:DEMO_PERSONAS[6].id } });
          }
          for (const f of DEMO_FABRICS) {
            const defaultTemplateId=templateIds.get(f.expectedTemplateCode),defaultFourPointStandardId=standardIds.get(f.expectedStandardCode);
            if(!defaultTemplateId || !defaultFourPointStandardId) throw new Error('演示面料关联缺失');
            await tx.fabric.create({data:{...f.body,defaultTemplateId,defaultFourPointStandardId}});
          }
          await tx.auditLog.create({ data: {actorId:DEMO_PERSONAS[6].id,action:'demo.seed.base',entityType:'DemoSeed',entityId:'v1',after:json({environmentId:'fabricqc-demo',resetVersion:'v1',personaCount:DEMO_PERSONAS.length})} });
        },
        async writeState(state) {
          await tx.systemSetting.create({data:{key:STATE_KEY,value:json({...state,environmentId:'fabricqc-demo',resetVersion:'v1'})}});
        },
      };
      return fn(adapter);
    }, {timeout:30000}),
  };
}
