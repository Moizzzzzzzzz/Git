import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { api, adminLogin, bindWechat, createTestApp, putPresigned, type TestContext } from './helpers';

const base = '/PATH/REDACTED';
const templates = JSON.parse(readFileSync(base + 'templates.json', 'utf8')) as any[];
const standards = JSON.parse(readFileSync(base + 'standards.json', 'utf8')) as any[];
const fabrics = JSON.parse(readFileSync(base + 'fabrics-proposed.json', 'utf8')) as any[];

describe('实际 TEST 面料配置隔离验收', () => {
  let ctx: TestContext, admin: string, sales: string, supervisor: string, inspector: string, supervisorId: string, inspectorId: string, departmentId: string;
  const templateIds = new Map<string,string>(); const standardIds = new Map<string,string>();
  beforeAll(async () => {
    ctx = await createTestApp(); admin = await adminLogin(ctx.app);
    departmentId = (await api(ctx.app, admin).post('/departments', { code: 'CONFIG-B', name: '测试业务' })).body.id;
    const q = await api(ctx.app, admin).post('/departments', { code: 'CONFIG-Q', name: '测试质检' });
    async function makeUser(no: string, role: string, dep: string) {
      const r = await api(ctx.app, admin).post('/users', { employeeNo: no, name: no, departmentId: dep, roles: [{ role, departmentId: dep }] });
      expect(r.status).toBe(201); return { id: r.body.id as string, token: (await bindWechat(ctx.app, admin, r.body.id, no, no)).accessToken };
    }
    sales = (await makeUser('CONFIG-S', 'SALES', departmentId)).token;
    const sup = await makeUser('CONFIG-SUP', 'QC_SUPERVISOR', q.body.id); supervisorId = sup.id; supervisor = sup.token;
    const ins = await makeUser('CONFIG-INS', 'INSPECTOR', q.body.id); inspectorId = ins.id; inspector = ins.token;
    for (const t of templates) {
      const r = await api(ctx.app, admin).post('/templates', t); expect(r.status).toBe(201); templateIds.set(t.code, r.body.id);
    }
    for (const s of standards) {
      const created = await api(ctx.app, admin).post('/standards', s.standard); expect(created.status).toBe(201);
      const version = await api(ctx.app, admin).post(`/standards/${created.body.id}/versions`, s.version); expect(version.status).toBe(201); expect(version.body.isDevDefault).toBe(true);
      const pub = await api(ctx.app, admin).post(`/standards/versions/${version.body.id}/publish`); expect(pub.status).toBe(200); expect(pub.body).toMatchObject({status:'PUBLISHED',isDevDefault:true});
      standardIds.set(s.standard.code, created.body.id);
    }
  });
  afterAll(async () => { if (ctx) await ctx.app.close(); });
  it.each(fabrics)('$body.code：实际配置、测量上下边界及必需照片', async (f: any) => {
    const tid = templateIds.get(f.expectedTemplateCode)!; const sid = standardIds.get(f.expectedStandardCode)!;
    const template = templates.find(t => t.code === f.expectedTemplateCode); const standard = standards.find(s => s.standard.code === f.expectedStandardCode);
    expect(template.content.applicability.structure).toContain(f.testDimensions.structure); expect(template.content.applicability.fiber).toContain(f.testDimensions.fiber);
    expect(standard.version.rules.applicability.structure).toContain(f.testDimensions.structure); expect(standard.version.rules.applicability.fiber).toContain(f.testDimensions.fiber);
    const cloth = await api(ctx.app, admin).post('/fabrics', { ...f.body, defaultTemplateId: tid, defaultFourPointStandardId: sid }); expect(cloth.status).toBe(201);
    const options = await api(ctx.app, sales).get('/tasks/business/options'); expect(options.status).toBe(200);
    expect(options.body.templates.some((x: any) => x.id === tid)).toBe(true);
    expect(options.body.standards.find((x: any) => x.id === sid).currentVersion.isDevDefault).toBe(true);
    const created = await api(ctx.app, sales).post('/tasks/business', { title: f.body.code, businessDepartmentId: departmentId, supervisorId, plannedRollCount: 1, fourPointStandardId: sid, templateId: tid }); expect(created.status).toBe(201);
    expect((await api(ctx.app, supervisor).post(`/tasks/${created.body.id}/assignment`, { assigneeId: inspectorId })).status).toBe(201);
    const reg = await api(ctx.app, inspector).post(`/tasks/${created.body.id}/rolls/register`, { fabricId: cloth.body.id, rolls: [{ rollNo: f.body.code + '-01', nominalLengthM: 10 }] }); expect(reg.status).toBe(201);
    const start = await api(ctx.app, inspector).post('/inspections', { taskRollId: reg.body.items[0].taskRollId, mode: 'MANUAL', scope: 'FULL' }); expect(start.status).toBe(201);
    const id = start.body.id; let version = 0;
    const checklist = template.content.checklist.map((x: any) => ({key:x.key,status:'OK'}));
    const readings = (width:number, effective:number, gsm:number) => [...[1,2,3].map(seq=>({itemKey:'width',seq,value:width})), ...[1,2,3].map(seq=>({itemKey:'effective_width',seq,value:effective})), {itemKey:'gsm',seq:1,value:gsm}, {itemKey:'roll_length',seq:1,value:10}];
    const save = async (width:number,effective:number,gsm:number,photos:any[] = []) => {
      const r = await api(ctx.app, inspector).put(`/inspections/${id}/draft`, {baseVersion:version,mode:'MANUAL',scope:'FULL',segments:[{startM:0,endM:10}],measurements:readings(width,effective,gsm),checklist,defects:[],photos});
      expect(r.status).toBe(200); version=r.body.draftVersion; return r.body.evaluation.overall.result;
    };
    expect(await save(150,145,180)).toBe('PASS');
    for (const [width,effective,gsm,expected] of [
      [142.5,145,180,'PASS'],[157.5,145,180,'PASS'],[142.4,145,180,'FAIL'],[157.6,145,180,'FAIL'],
      [150,137.75,180,'PASS'],[150,152.25,180,'PASS'],[150,137.65,180,'FAIL'],[150,152.35,180,'FAIL'],
      [150,145,171,'PASS'],[150,145,189,'PASS'],[150,145,170.9,'FAIL'],[150,145,189.1,'FAIL'],
    ] as [number,number,number,string][]) expect(await save(width,effective,gsm)).toBe(expected);
    expect(await save(150,145,180)).toBe('PASS');
    const missing = await api(ctx.app, inspector).post(`/inspections/${id}/submit`, { idempotencyKey: randomUUID(), draftVersion: version });
    expect(missing.status).toBe(422); expect(JSON.stringify(missing.body.details)).toContain('卷标'); expect(JSON.stringify(missing.body.details)).toContain('布面');
    const jpeg=Buffer.concat([Buffer.from([0xff,0xd8,0xff,0xe0]),Buffer.alloc(1024,7)]); const photos=[];
    for (const key of ['roll_label','fabric_face']) {
      const intent=await api(ctx.app,inspector).post('/media/upload-intents',{inspectionId:id,mimeType:'image/jpeg',sizeBytes:jpeg.length}); expect(intent.status).toBe(201);
      await putPresigned(intent.body.upload.url,'image/jpeg',jpeg); await putPresigned(intent.body.thumbUpload.url,'image/jpeg',jpeg.subarray(0,512));
      expect((await api(ctx.app,inspector).post(`/media/${intent.body.mediaId}/confirm`)).status).toBe(200); photos.push({mediaId:intent.body.mediaId,kind:'CHECKPOINT',checkpointKey:key});
    }
    for (const [index, missingLabel] of [[0, '布面'], [1, '卷标']] as const) {
      expect(await save(150,145,180,[photos[index]])).toBe('PASS');
      const incomplete=await api(ctx.app,inspector).post(`/inspections/${id}/submit`,{idempotencyKey:randomUUID(),draftVersion:version});
      expect(incomplete.status).toBe(422); expect(JSON.stringify(incomplete.body.details)).toContain(missingLabel);
    }
    expect(await save(150,145,180,photos)).toBe('PASS');
    const submitted=await api(ctx.app,inspector).post(`/inspections/${id}/submit`,{idempotencyKey:randomUUID(),draftVersion:version});
    if (submitted.status !== 200) console.error('测试配置提交错误', f.body.code, JSON.stringify(submitted.body));
    expect(submitted.status).toBe(200); expect(submitted.body.overallResult).toBe('PASS');
  });
});
