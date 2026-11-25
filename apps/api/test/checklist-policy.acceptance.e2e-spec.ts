import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { DEV_DEFAULT_FOUR_POINT_RULES } from '@fabricqc/shared';
import { api, adminLogin, bindWechat, createTestApp, type TestContext } from './helpers';

describe('检查项策略独立隔离验收', () => {
  let ctx: TestContext, admin: string, sales: string, inspector: string, supervisor: string, supervisorId: string, managerOther: string, clerkOther: string;
  let departmentId: string, standardId: string, templateId: string, inspectionId: string, taskId: string;
  const scope = { structure: ['KNIT'], fiber: ['NYLON'] };
  const policies = [
    { checklistKey: 'color', onNg: 'FAIL_ON_NG', onNa: 'INCONCLUSIVE', onMissing: 'INCONCLUSIVE' },
    { checklistKey: 'feel', onNg: 'RECORD_ONLY', onNa: 'ALLOW', onMissing: 'ALLOW' },
    { checklistKey: 'label', onNg: 'REVIEW_ON_NG', onNa: 'ALLOW', onMissing: 'INCONCLUSIVE' },
  ];
  const rules = { ...DEV_DEFAULT_FOUR_POINT_RULES, applicability: scope, checklistPolicies: policies, requireDefectPhoto: false };
  const content = { applicability: scope, checklist: [
    { key: 'color', label: '对色', required: true }, { key: 'feel', label: '手感', required: false }, { key: 'label', label: '标签', required: false },
  ], measurements: [{ key: 'roll_length', label: '卷长', unit: 'm', required: true, minReadings: 1 }], photoCheckpoints: [] };
  beforeAll(async () => {
    ctx = await createTestApp(); admin = await adminLogin(ctx.app);
    departmentId = (await api(ctx.app, admin).post('/departments', { code: 'QA-POL-B', name: '测试业务' })).body.id;
    const other = await api(ctx.app, admin).post('/departments', { code: 'QA-POL-OTHER', name: '其他业务' });
    const q = await api(ctx.app, admin).post('/departments', { code: 'QA-POL-Q', name: '测试质检' });
    async function user(no: string, role: string, dep: string) {
      const u = await api(ctx.app, admin).post('/users', { employeeNo: no, name: no, departmentId: dep, roles: [{ role, departmentId: dep }] });
      expect(u.status).toBe(201);
      return { id: u.body.id as string, token: (await bindWechat(ctx.app, admin, u.body.id, no, no)).accessToken };
    }
    sales = (await user('QA-POL-S', 'SALES', departmentId)).token;
    managerOther = (await user('QA-POL-MB', 'BUSINESS_MANAGER', other.body.id)).token;
    clerkOther = (await user('QA-POL-CB', 'BUSINESS_CLERK', other.body.id)).token;
    const sup = await user('QA-POL-QS', 'QC_SUPERVISOR', q.body.id); supervisorId = sup.id; supervisor = sup.token;
    inspector = (await user('QA-POL-I', 'INSPECTOR', q.body.id)).token;
  });
  afterAll(async () => { if (ctx) await ctx.app.close(); });
  it('测试标准创建、编辑和发布不能丢失测试标志或新字段', async () => {
    const s = await api(ctx.app, admin).post('/standards', { code: 'QA-POLICY', name: '测试策略', kind: 'FOUR_POINT' });
    expect(s.status).toBe(201); standardId = s.body.id;
    expect((await api(ctx.app, admin).post(`/standards/${standardId}/versions`, { rules })).status).toBe(400);
    const v = await api(ctx.app, admin).post(`/standards/${standardId}/versions`, { purpose: 'TEST', rules, isDevDefault: false });
    expect(v.status).toBe(201); expect(v.body.isDevDefault).toBe(true);
    expect((await api(ctx.app, admin).put(`/standards/versions/${v.body.id}`, { rules })).status).toBe(400);
    expect((await api(ctx.app, admin).put(`/standards/versions/${v.body.id}`, { purpose: 'TEST', rules: DEV_DEFAULT_FOUR_POINT_RULES })).status).toBe(400);
    expect((await api(ctx.app, admin).post(`/standards/versions/${v.body.id}/publish`)).body).toMatchObject({ status: 'PUBLISHED', isDevDefault: true });
    expect((await api(ctx.app, admin).put(`/standards/versions/${v.body.id}`, { purpose: 'TEST', rules })).status).toBe(409);
  });
  it('模板旧编辑器不得覆盖范围，业务建单检查策略键和范围', async () => {
    const t = await api(ctx.app, admin).post('/templates', { code: 'QA-POL-T', name: '测试模板', content });
    expect(t.status).toBe(201); templateId = t.body.id;
    const { applicability: _omitted, ...oldContent } = content;
    expect((await api(ctx.app, admin).put(`/templates/${templateId}`, { code: 'QA-POL-T', name: '测试模板', content: oldContent })).status).toBe(400);
    const invalidKey = await api(ctx.app, admin).post('/templates', { code: 'QA-POL-NOKEY', name: '缺检查项', content: { ...content, checklist: content.checklist.slice(0, 2) } });
    const incompatible = await api(ctx.app, admin).post('/templates', { code: 'QA-POL-WOVEN', name: '范围不同', content: { ...content, applicability: { structure: ['WOVEN'], fiber: ['NYLON'] } } });
    const task = { title: 'TEST-POL', businessDepartmentId: departmentId, supervisorId, plannedRollCount: 1, fourPointStandardId: standardId };
    expect((await api(ctx.app, sales).post('/tasks/business', { ...task, templateId: invalidKey.body.id })).status).toBe(400);
    expect((await api(ctx.app, sales).post('/tasks/business', { ...task, templateId: incompatible.body.id })).status).toBe(400);
    const created = await api(ctx.app, sales).post('/tasks/business', { ...task, templateId });
    expect(created.status).toBe(201);
    taskId = created.body.id;
    const assigned = await ctx.prisma.user.findFirstOrThrow({ where: { employeeNo: 'QA-POL-I' } });
    expect((await api(ctx.app, supervisor).post(`/tasks/${created.body.id}/assignment`, { assigneeId: assigned.id })).status).toBe(201);
    const fabric = await api(ctx.app, admin).post('/fabrics', { code: 'QA-POL-F', nameZh: '测试布', widthCm: 150 });
    expect(fabric.status).toBe(201);
    const roll = await api(ctx.app, inspector).post(`/tasks/${created.body.id}/rolls/register`, { fabricId: fabric.body.id, rolls: [{ rollNo: 'QA-POL-01', nominalLengthM: 10 }] });
    expect(roll.status).toBe(201);
    const started = await api(ctx.app, inspector).post('/inspections', { taskRollId: roll.body.items[0].taskRollId, mode: 'MANUAL', scope: 'FULL' });
    expect(started.status).toBe(201); inspectionId = started.body.id;
  });
  it('草稿按策略计算 NG、NA、missing 且拒绝重复及未知检查项', async () => {
    let version = 0;
    const comparisons: { name: string; checklist: object[]; evaluation: unknown }[] = [];
    const draft = (checklist: object[]) => ({ baseVersion: version, mode: 'MANUAL', scope: 'FULL', segments: [{ startM: 0, endM: 10 }], measurements: [], checklist, defects: [], photos: [] });
    async function evaluation(checklist: object[], expected: string, name = '') {
      const r = await api(ctx.app, inspector).put(`/inspections/${inspectionId}/draft`, draft(checklist));
      expect(r.status).toBe(200); version = r.body.draftVersion; expect(r.body.evaluation.overall.result).toBe(expected);
      if (name) comparisons.push({ name, checklist, evaluation: r.body.evaluation });
      return r;
    }
    const common = [{ key: 'color', status: 'OK' }, { key: 'feel', status: 'OK' }, { key: 'label', status: 'OK' }];
    await evaluation(common, 'PASS');
    await evaluation([{ key: 'color', status: 'NG' }, ...common.slice(1)], 'FAIL', 'FAIL_ON_NG');
    const record = await evaluation([common[0], { key: 'feel', status: 'NG' }, common[2]], 'PASS', 'RECORD_ONLY');
    expect(record.body.evaluation.warnings.join(' ')).toContain('仅记录');
    await evaluation([common[0], common[1], { key: 'label', status: 'NG' }], 'INCONCLUSIVE', 'REVIEW_ON_NG');
    await evaluation([{ key: 'color', status: 'NA' }, ...common.slice(1)], 'INCONCLUSIVE', 'NA_INCONCLUSIVE');
    await evaluation([common[0], { key: 'feel', status: 'NA' }, common[2]], 'PASS', 'NA_ALLOW');
    await evaluation([common[0], common[1]], 'INCONCLUSIVE');
    expect((await api(ctx.app, inspector).put(`/inspections/${inspectionId}/draft`, draft([common[0], common[0]]))).status).toBe(400);
    expect((await api(ctx.app, inspector).put(`/inspections/${inspectionId}/draft`, draft([...common, { key: 'unknown', status: 'OK' }]))).status).toBe(400);
    const missing = await api(ctx.app, inspector).put(`/inspections/${inspectionId}/draft`, draft([common[1], common[2]]));
    expect(missing.status).toBe(200);
    expect(missing.body.evaluation.overall.result).toBe('INCONCLUSIVE');
    const submitted = await api(ctx.app, inspector).post(`/inspections/${inspectionId}/submit`, { idempotencyKey: randomUUID(), draftVersion: missing.body.draftVersion });
    expect(submitted.status).toBe(422);
    const source = await ctx.prisma.rollInspection.findUniqueOrThrow({ where: { id: inspectionId } });
    writeFileSync('/PATH/REDACTED', JSON.stringify({ standardSnapshot: source.standardSnapshot, templateSnapshot: source.templateSnapshot, specSnapshot: source.specSnapshot, base: { mode: 'MANUAL', scope: 'FULL', segments: [{ startM: 0, endM: 10 }], measurements: [], defects: [], photos: [] }, comparisons }, null, 2));
  });
  it('旧草稿保留无策略快照并提示检查项未参与判定', async () => {
    const before = await ctx.prisma.rollInspection.findUniqueOrThrow({ where: { id: inspectionId } });
    const snapshot = before.standardSnapshot as any;
    const oldRules = { ...snapshot.fourPoint.rules }; delete oldRules.checklistPolicies; delete oldRules.applicability;
    const legacy = { ...snapshot, fourPoint: { ...snapshot.fourPoint, rules: oldRules } };
    await ctx.prisma.rollInspection.update({ where: { id: inspectionId }, data: { standardSnapshot: legacy } });
    const r = await api(ctx.app, inspector).put(`/inspections/${inspectionId}/draft`, {
      baseVersion: before.draftVersion, mode: 'MANUAL', scope: 'FULL', segments: [{ startM: 0, endM: 10 }], measurements: [],
      checklist: [{ key: 'color', status: 'NG' }, { key: 'feel', status: 'OK' }, { key: 'label', status: 'OK' }], defects: [], photos: [],
    });
    expect(r.status).toBe(200); expect(r.body.evaluation.warnings.join(' ')).toContain('未配置检查项判定策略');
    const after = await ctx.prisma.rollInspection.findUniqueOrThrow({ where: { id: inspectionId } });
    expect(after.standardSnapshot).toEqual(legacy);
    await ctx.prisma.rollInspection.update({ where: { id: inspectionId }, data: { standardSnapshot: snapshot } });
  });
  it('NG 结果在提交、审核和交付后保持 FAIL，模板变更不重算历史', async () => {
    const previous = await ctx.prisma.rollInspection.findUniqueOrThrow({ where: { id: inspectionId } });
    const saved = await api(ctx.app, inspector).put(`/inspections/${inspectionId}/draft`, {
      baseVersion: previous.draftVersion, mode: 'MANUAL', scope: 'FULL', segments: [{ startM: 0, endM: 10 }], measurements: [{ itemKey: 'roll_length', seq: 1, value: 10 }],
      checklist: [{ key: 'color', status: 'NG' }, { key: 'feel', status: 'OK' }, { key: 'label', status: 'OK' }], defects: [], photos: [],
    });
    expect(saved.status).toBe(200); expect(saved.body.evaluation.overall.result).toBe('FAIL');
    const submitted = await api(ctx.app, inspector).post(`/inspections/${inspectionId}/submit`, { idempotencyKey: randomUUID(), draftVersion: saved.body.draftVersion });
    if (submitted.status !== 200) console.error('提交失败详情', JSON.stringify(submitted.body));
    expect(submitted.status).toBe(200); expect(submitted.body.overallResult).toBe('FAIL');
    const review = await api(ctx.app, supervisor).post(`/reviews/${inspectionId}/decide`, { decision: 'APPROVE', revision: 1 });
    expect(review.status).toBe(200); expect(review.body.isConcession).toBe(false);
    expect((await api(ctx.app, sales).get(`/tasks/${taskId}/delivery`)).status).toBe(409);
    expect((await api(ctx.app, supervisor).post(`/tasks/${taskId}/delivery`, {})).status).toBe(201);
    const before = await ctx.prisma.rollInspection.findUniqueOrThrow({ where: { id: inspectionId } });
    const delivery = await api(ctx.app, sales).get(`/tasks/${taskId}/delivery`);
    expect(delivery.status).toBe(200); expect(delivery.body.items[0].overallResult).toBe('FAIL');
    for (const token of [managerOther, clerkOther]) {
      const list = await api(ctx.app, token).get('/tasks/business');
      expect(list.status).toBe(200); expect(list.body.items.some((item: {id: string}) => item.id === taskId)).toBe(false);
      expect([403, 404]).toContain((await api(ctx.app, token).get(`/tasks/${taskId}/business-progress`)).status);
      expect([403, 404]).toContain((await api(ctx.app, token).get(`/tasks/${taskId}/delivery`)).status);
    }
    const edited = await api(ctx.app, admin).put(`/templates/${templateId}`, { code: 'QA-POL-T', name: '测试模板新名称', content: { ...content, checklist: content.checklist.map(x => ({ ...x, label: `${x.label}新版` })) } });
    expect(edited.status).toBe(200);
    const after = await ctx.prisma.rollInspection.findUniqueOrThrow({ where: { id: inspectionId } });
    expect(after.resultSnapshot).toEqual(before.resultSnapshot); expect(after.templateSnapshot).toEqual(before.templateSnapshot); expect(after.overallResult).toBe('FAIL');
    expect((await api(ctx.app, sales).get(`/tasks/${taskId}/delivery`)).body.items[0].overallResult).toBe('FAIL');
  });
});
