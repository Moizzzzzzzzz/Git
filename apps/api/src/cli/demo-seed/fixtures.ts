import { DEMO_FIXTURE_KEYS } from './manifest';
export type FixturePhase = 'creating' | 'created' | 'advancing' | 'done';
export interface FixtureState { phase: FixturePhase; taskId?: string; taskNo?:string }
export interface FixtureDriver {
  /** Call under a held exclusive demo seed lock; persist writes before returning. */
  read(): Promise<FixtureState | null>;
  write(state: FixtureState): Promise<void>;
  create(key: string): Promise<{taskId:string;taskNo:string}>;
  advance(key: string, taskId: string): Promise<void>;
  verify(key: string, taskId: string, taskNo:string): Promise<boolean>;
}
/** Fail closed if an earlier call could have committed without returning its id. */
export async function installFixture(driver: FixtureDriver, key: string): Promise<string> {
  if (!(DEMO_FIXTURE_KEYS as readonly string[]).includes(key)) throw new Error('未知演示样例');
  const old = await driver.read();
  if (old) {
    if (old.phase !== 'done' || !old.taskId || !old.taskNo) throw new Error('演示样例存在未完成或不确定操作，待人工核查');
    if (!(await driver.verify(key, old.taskId, old.taskNo))) throw new Error('演示样例状态不一致，请人工核查');
    return 'already-installed';
  }
  await driver.write({ phase: 'creating' });
  const { taskId, taskNo } = await driver.create(key);
  if (!taskId || !taskNo) throw new Error('演示任务缺少标识，待人工核查');
  await driver.write({ phase: 'created', taskId, taskNo });
  await driver.write({ phase: 'advancing', taskId, taskNo });
  await driver.advance(key, taskId);
  if (!(await driver.verify(key, taskId, taskNo))) throw new Error('演示样例状态不一致，请人工核查');
  await driver.write({ phase: 'done', taskId, taskNo });
  return 'installed';
}

export type FixtureStep = 'create'|'assign'|'register'|'inspect-pass'|'inspect-fail'|'submit'|'review-approve'|'review-return'|'deliver';
/** Steps must be executed with fixed SALES/INSPECTOR/SUPERVISOR actors via business services. */
export function fixturePlan(key: string): readonly FixtureStep[] {
  switch(key) {
    case 'UNASSIGNED': case 'OTHER_DEPT': return ['create'];
    case 'INPROGRESS': return ['create','assign','register','inspect-pass'];
    case 'PENDING_REVIEW': return ['create','assign','register','inspect-pass','submit'];
    case 'RETURNED': return ['create','assign','register','inspect-pass','submit','review-return'];
    case 'FINAL_PENDING': return ['create','assign','register','inspect-pass','submit','review-approve'];
    case 'DELIVERED_PASS': return ['create','assign','register','inspect-pass','submit','review-approve','deliver'];
    case 'DELIVERED_FAIL': return ['create','assign','register','inspect-fail','submit','review-approve','deliver'];
    default: throw new Error('未知演示样例');
  }
}

import type { Actor } from '../../common/actor';
import type { TasksService } from '../../tasks/tasks.service';
import type { InspectionsService } from '../../inspections/inspections.service';
import type { ReviewsService } from '../../reviews/reviews.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { randomUUID } from 'node:crypto';

export interface FixtureServiceContext {
  tasks: Pick<TasksService,'createBusiness'|'assignBusiness'|'registerBusinessRolls'|'confirmDelivery'>;
  inspections: Pick<InspectionsService,'start'|'saveDraft'|'submit'>;
  reviews: Pick<ReviewsService,'decide'>;
  prisma: Pick<PrismaService,'qcTask'>;
  actors: { sales:Actor; other:Actor; supervisor:Actor; inspector:Actor };
  store: { read():Promise<FixtureState|null>; write(state:FixtureState):Promise<void> };
  base: {businessDepartmentId:string;otherDepartmentId:string;templateId:string;standardId:string;fabricId:string};
  /** Creates and confirms a synthetic image through the demo media service. */
  uploadDemoPhoto(inspectionId:string,kind:'label'|'fabric',actor:Actor):Promise<string>;
}
const META = { ip:null, userAgent:'fabricqc-demo-seed', requestId:null };
export function createServiceFixtureDriver(ctx: FixtureServiceContext): FixtureDriver {
  return {
    read: () => ctx.store.read(), write: state => ctx.store.write(state),
    async create(key) {
      const other = key === 'OTHER_DEPT';
      const created = await ctx.tasks.createBusiness(other ? ctx.actors.other : ctx.actors.sales, {
        title:`DEMO-SAMPLE-${key}`, businessDepartmentId:other?ctx.base.otherDepartmentId:ctx.base.businessDepartmentId,
        supervisorId:ctx.actors.supervisor.userId, plannedRollCount:key==='UNASSIGNED'||key==='INPROGRESS'?2:1,
        fourPointStandardId:ctx.base.standardId, templateId:ctx.base.templateId, defaultScope:'FULL',
        notes:'仅演示，非真实业务数据',
      }, META);
      return {taskId:created.id,taskNo:created.taskNo};
    },
    async advance(key,taskId) {
      const plan=fixturePlan(key);
      if (!plan.includes('assign')) return;
      await ctx.tasks.assignBusiness(ctx.actors.supervisor,taskId,{assigneeId:ctx.actors.inspector.userId},META);
      const rolls=await ctx.tasks.registerBusinessRolls(ctx.actors.inspector,taskId,{fabricId:ctx.base.fabricId,rolls:[{rollNo:`DEMO-${key}-R01`,nominalLengthM:10}]},META);
      const tr=rolls.items[0];if(!tr)throw new Error('演示卷创建失败');
      const inspection=await ctx.inspections.start(ctx.actors.inspector,{taskRollId:tr.taskRollId,mode:'MACHINE',scope:'FULL'},META);
      if (!plan.includes('submit')) return;
      const labelId=await ctx.uploadDemoPhoto(inspection.id,'label',ctx.actors.inspector);
      const fabricId=await ctx.uploadDemoPhoto(inspection.id,'fabric',ctx.actors.inspector);
      const draft=await ctx.inspections.saveDraft(ctx.actors.inspector,inspection.id,{
        baseVersion:0, mode:'MACHINE',scope:'FULL',segments:[{startM:0,endM:10}],
        measurements:[{itemKey:'width',seq:1,value:150},{itemKey:'width',seq:2,value:150},{itemKey:'width',seq:3,value:150},
          {itemKey:'effective_width',seq:1,value:145},{itemKey:'effective_width',seq:2,value:145},{itemKey:'effective_width',seq:3,value:145},
          {itemKey:'gsm',seq:1,value:180},{itemKey:'roll_length',seq:1,value:10}],
        checklist:[{key:'label_match',status:plan.includes('inspect-fail')?'NG':'OK'},{key:'color_match',status:'OK'},
          {key:'hand_feel',status:'OK'},{key:'edge_quality',status:'OK'},{key:'knit_surface',status:'OK'}],
        defects:[],photos:[{mediaId:labelId,kind:'CHECKPOINT',checkpointKey:'roll_label'},{mediaId:fabricId,kind:'CHECKPOINT',checkpointKey:'fabric_face'}],
        remarks:'演示数据，非真实面料',
      },META);
      const submitted=await ctx.inspections.submit(ctx.actors.inspector,inspection.id,{idempotencyKey:randomUUID(),draftVersion:draft.draftVersion},META);
      if(plan.includes('review-return')) await ctx.reviews.decide(ctx.actors.supervisor,inspection.id,{decision:'RETURN',revision:submitted.revision,comment:'演示退回，需重新核对'},META);
      else if(plan.includes('review-approve')) await ctx.reviews.decide(ctx.actors.supervisor,inspection.id,{decision:'APPROVE',revision:submitted.revision,comment:'演示确认结果'},META);
      if(plan.includes('deliver')) await ctx.tasks.confirmDelivery(ctx.actors.supervisor,taskId,META);
    },
    async verify(key,taskId,taskNo) {
      const t=await ctx.prisma.qcTask.findUnique({where:{id:taskId},include:{delivery:true,rolls:{include:{inspections:{orderBy:{createdAt:'desc'},take:1}}}}});
      if(!t || t.taskNo!==taskNo || t.title!==`DEMO-SAMPLE-${key}` || t.origin!=='BUSINESS' || t.supervisorId!==ctx.actors.supervisor.userId || t.businessDepartmentId!==(key==='OTHER_DEPT'?ctx.base.otherDepartmentId:ctx.base.businessDepartmentId))return false;
      const inspection=t.rolls[0]?.inspections[0];
      switch(key){
        case 'UNASSIGNED':case 'OTHER_DEPT':return !t.assigneeId && t.rolls.length===0 && !t.delivery;
        case 'INPROGRESS':return t.assigneeId===ctx.actors.inspector.userId && t.rolls.length===1 && inspection?.status==='DRAFT' && !t.delivery;
        case 'PENDING_REVIEW':return inspection?.status==='SUBMITTED' && !t.delivery;
        case 'RETURNED':return inspection?.status==='RETURNED' && !t.delivery;
        case 'FINAL_PENDING':return inspection?.status==='APPROVED' && !t.delivery;
        case 'DELIVERED_PASS':return inspection?.status==='APPROVED' && inspection.overallResult==='PASS' && !!t.delivery;
        case 'DELIVERED_FAIL':return inspection?.status==='APPROVED' && inspection.overallResult==='FAIL' && !!t.delivery;
        default:return false;
      }
    },
  };
}

/** Call only while the caller holds an exclusive demo-seed advisory lock. */
export function createPrismaFixtureStore(prisma: Pick<PrismaService,'systemSetting'>, key:string) {
  if (!(DEMO_FIXTURE_KEYS as readonly string[]).includes(key)) throw new Error('未知演示样例');
  const settingKey=`demo.fixture.v1.${key}`;
  return {
    async read():Promise<FixtureState|null> {
      const row=await prisma.systemSetting.findUnique({where:{key:settingKey}}); if(!row)return null;
      const value=row.value as {environmentId?:unknown;resetVersion?:unknown;fixtureKey?:unknown;phase?:unknown;taskId?:unknown;taskNo?:unknown}|null;
      if(!value||value.environmentId!=='fabricqc-demo'||value.resetVersion!=='v1'||value.fixtureKey!==key||!['creating','created','advancing','done'].includes(String(value.phase))||(value.taskId!==undefined&&typeof value.taskId!=='string')||(value.taskNo!==undefined&&typeof value.taskNo!=='string'))throw new Error('演示样例标记不一致');
      return {phase:value.phase as FixturePhase,...(typeof value.taskId==='string'?{taskId:value.taskId}:{}),...(typeof value.taskNo==='string'?{taskNo:value.taskNo}:{})};
    },
    async write(state:FixtureState):Promise<void> {
      const value={environmentId:'fabricqc-demo',resetVersion:'v1',fixtureKey:key,...state};
      await prisma.systemSetting.upsert({where:{key:settingKey},create:{key:settingKey,value},update:{value}});
    },
  };
}
