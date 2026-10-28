import { randomUUID } from 'node:crypto';
import { DeliveryService } from '../src/notifications/delivery.service';
import { adminLogin, api, bindWechat, createTestApp, putPresigned, type TestContext } from './helpers';

/**
 * 验收主流程：建员工 → 绑定 → 面料/布卷/二维码 → 任务 → 扫码 → 检验 → 拍照 → 评分
 * → 提交 → 主管待办与提醒 → 退回 → 重新提交 → 审核 → 历史查询
 */
describe('验布主流程 (e2e)', () => {
  let ctx: TestContext;
  let admin: string;
  let inspector: string;
  let supervisor: string;
  let supervisorId: string;
  let inspectorId: string;
  let rollIds: string[] = [];
  let qrCodes: string[] = [];
  let taskId: string;
  let fourPointId: string;
  let customerStdId: string;
  let templateId: string;
  let inspectionId: string;
  let draftVersion = 0;
  const defectA = randomUUID();
  const defectB = randomUUID();
  const photoIds: Record<string, string> = {};

  beforeAll(async () => {
    ctx = await createTestApp();
    admin = await adminLogin(ctx.app);
    const dept = await api(ctx.app, admin).post('/departments', { code: 'FLOW-QC', name: '流程测试质检部' });
    const sup = await api(ctx.app, admin).post('/users', {
      employeeNo: 'F-S01',
      name: '主管王',
      departmentId: dept.body.id,
      roles: [{ role: 'QC_SUPERVISOR', departmentId: dept.body.id }],
    });
    supervisorId = sup.body.id;
    const ins = await api(ctx.app, admin).post('/users', {
      employeeNo: 'F-I01',
      name: '质检员李',
      departmentId: dept.body.id,
      supervisorId,
      roles: [{ role: 'INSPECTOR' }],
    });
    inspectorId = ins.body.id;
    inspector = (await bindWechat(ctx.app, admin, inspectorId, 'F-I01', 'f-i01')).accessToken;
    supervisor = (await bindWechat(ctx.app, admin, supervisorId, 'F-S01', 'f-s01')).accessToken;
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('创建客户、面料并批量导入布卷，生成唯一二维码', async () => {
    const c = await api(ctx.app, admin).post('/customers', { code: 'F-C01', name: '流程客户' });
    expect(c.status).toBe(201);
    const stds = await api(ctx.app, admin).get('/standards?kind=FOUR_POINT');
    fourPointId = stds.body.find((s: { code: string }) => s.code === 'FOUR_POINT_DEV').id;
    const tpls = await api(ctx.app, admin).get('/templates');
    templateId = tpls.body.find((t: { code: string }) => t.code === 'DEFAULT').id;

    const f = await api(ctx.app, admin).post('/fabrics', {
      code: 'F-FAB-01',
      nameZh: '流程测试面料',
      widthCm: 152.4,
      cuttableWidthCm: 152.4,
      gsm: 200,
      customerId: c.body.id,
      defaultFourPointStandardId: fourPointId,
      defaultTemplateId: templateId,
    });
    expect(f.status).toBe(201);

    const bad = await api(ctx.app, admin).post('/rolls/import', {
      rows: [
        { rollNo: 'F-R001', fabricCode: 'F-FAB-01' },
        { rollNo: 'F-R001', fabricCode: 'NOPE' },
      ],
    });
    expect(bad.status).toBe(400);
    expect(bad.body.details.length).toBeGreaterThanOrEqual(2);
    expect(await ctx.prisma.fabricRoll.count({ where: { rollNo: 'F-R001' } })).toBe(0);

    const imp = await api(ctx.app, admin).post('/rolls/import', {
      rows: [
        { rollNo: 'F-R001', fabricCode: 'F-FAB-01', lotNo: 'L1', dyeLotNo: 'D1', nominalLengthM: 91.44 },
        { rollNo: 'F-R002', fabricCode: 'F-FAB-01', lotNo: 'L1', dyeLotNo: 'D1', nominalLengthM: 50 },
        { rollNo: 'F-R003', fabricCode: 'F-FAB-01', lotNo: 'L1', dyeLotNo: 'D1', nominalLengthM: 50 },
      ],
    });
    expect(imp.status).toBe(201);
    expect(imp.body).toMatchObject({ created: 3, lotsCreated: 1 });
    rollIds = imp.body.rollIds;

    const qr = await api(ctx.app, admin).get(`/rolls/${rollIds[0]}/qr`);
    expect(qr.body.content).toMatch(/\/r\/[0-9A-Z]{10}$/);
    expect(qr.body.svg).toContain('<svg');
    const labels = await api(ctx.app, admin).post('/rolls/labels', { ids: rollIds });
    qrCodes = labels.body.map((l: { qrCode: string }) => l.qrCode);
    expect(new Set(qrCodes).size).toBe(3);
  });

  it('客户标准：草稿 → 发布，发布后不可修改', async () => {
    const c = await ctx.prisma.customer.findUniqueOrThrow({ where: { code: 'F-C01' } });
    const s = await api(ctx.app, admin).post('/standards', { code: 'F-CUST', name: '流程客户标准', kind: 'CUSTOMER', customerId: c.id });
    customerStdId = s.body.id;
    const v = await api(ctx.app, admin).post(`/standards/${customerStdId}/versions`, {
      rules: {
        schemaVersion: 1,
        thresholds: { maxNormalizedPoints: 20 },
        forbiddenDefectTypes: ['OIL'],
        measurementLimits: [{ itemKey: 'gsm', label: '克重', mode: 'RELATIVE_TO_SPEC', specField: 'gsm', minPct: -5, maxPct: 5 }],
      },
    });
    expect(v.status).toBe(201);
    const badRef = await api(ctx.app, admin).put(`/standards/versions/${v.body.id}`, {
      rules: { schemaVersion: 1, forbiddenDefectTypes: ['NOT_EXIST'] },
    });
    expect(badRef.status).toBe(400);
    const pub = await api(ctx.app, admin).post(`/standards/versions/${v.body.id}/publish`);
    expect(pub.body.status).toBe('PUBLISHED');
    const edit = await api(ctx.app, admin).put(`/standards/versions/${v.body.id}`, { rules: { schemaVersion: 1 } });
    expect(edit.status).toBe(409);
  });

  it('创建任务并分配；同一布卷不能进入两个任务', async () => {
    const t = await api(ctx.app, supervisor).post('/tasks', {
      title: '流程测试任务',
      assigneeId: inspectorId,
      fourPointStandardId: fourPointId,
      customerStandardId: customerStdId,
      templateId,
      rollIds: rollIds.slice(0, 2),
    });
    expect(t.status).toBe(201);
    taskId = t.body.id;
    const dup = await api(ctx.app, admin).post('/tasks', {
      title: '重复',
      assigneeId: inspectorId,
      fourPointStandardId: fourPointId,
      templateId,
      rollIds: [rollIds[0]],
    });
    expect(dup.status).toBe(409);
    const mine = await api(ctx.app, inspector).get('/tasks/mine');
    expect(mine.body.map((x: { id: string }) => x.id)).toContain(taskId);
    // 质检员收到站内通知
    const n = await api(ctx.app, inspector).get('/notifications');
    expect(n.body.items.some((x: { type: string }) => x.type === 'TASK_ASSIGNED')).toBe(true);
  });

  it('扫码进入布卷并开始检验（重复开始返回同一记录）', async () => {
    const scan = await api(ctx.app, inspector).get(`/rolls/by-qr/${encodeURIComponent(`https://qc.example.com/r/${qrCodes[0]}`)}`);
    expect(scan.status).toBe(200);
    expect(scan.body.myTasks).toHaveLength(1);
    const taskRollId = scan.body.myTasks[0].taskRollId;
    const s1 = await api(ctx.app, inspector).post('/inspections', { taskRollId, mode: 'MACHINE', scope: 'FULL' });
    expect(s1.status).toBe(201);
    const s2 = await api(ctx.app, inspector).post('/inspections', { taskRollId, mode: 'MACHINE', scope: 'FULL' });
    expect(s2.body).toEqual({ id: s1.body.id, resumed: true });
    inspectionId = s1.body.id;
    // 其他人不能开始别人的任务
    const other = await api(ctx.app, supervisor).post('/inspections', { taskRollId, mode: 'MANUAL', scope: 'FULL' });
    expect(other.status).toBe(403);
  });

  it('照片直传对象存储并由服务端确认', async () => {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2048, 7)]);
    for (const key of ['roll_label', 'fabric_face', 'defectA', 'defectB']) {
      const intent = await api(ctx.app, inspector).post('/media/upload-intents', {
        inspectionId,
        mimeType: 'image/jpeg',
        sizeBytes: jpeg.length,
      });
      expect(intent.status).toBe(201);
      // 未上传前确认会失败
      if (key === 'roll_label') {
        const early = await api(ctx.app, inspector).post(`/media/${intent.body.mediaId}/confirm`);
        expect(early.status).toBe(409);
      }
      await putPresigned(intent.body.upload.url, 'image/jpeg', jpeg);
      await putPresigned(intent.body.thumbUpload.url, 'image/jpeg', jpeg.subarray(0, 512));
      const ok = await api(ctx.app, inspector).post(`/media/${intent.body.mediaId}/confirm`);
      expect(ok.body.status).toBe('UPLOADED');
      photoIds[key] = intent.body.mediaId;
    }
  });

  function draft(overrides: Record<string, unknown> = {}) {
    return {
      baseVersion: draftVersion,
      mode: 'MACHINE',
      scope: 'FULL',
      segments: [{ startM: 0, endM: 91.44 }],
      measurements: [
        ...[1, 2, 3].map((seq) => ({ itemKey: 'width', seq, value: 153 })),
        ...[1, 2, 3].map((seq) => ({ itemKey: 'effective_width', seq, value: 152.4 })),
        { itemKey: 'gsm', seq: 1, value: 199 },
        { itemKey: 'roll_length', seq: 1, value: 91.44 },
      ],
      checklist: [
        { key: 'label_match', status: 'OK' },
        { key: 'color_match', status: 'OK' },
        { key: 'hand_feel', status: 'OK' },
        { key: 'edge_quality', status: 'OK' },
      ],
      defects: [
        { clientId: defectA, defectTypeCode: 'SLUB', lengthCm: 30, positionM: 10, severity: 'MINOR' },
        { clientId: defectB, defectTypeCode: 'HOLE', lengthCm: 2, positionM: 40, severity: 'MAJOR' },
      ],
      photos: [
        { mediaId: photoIds.roll_label, kind: 'CHECKPOINT', checkpointKey: 'roll_label' },
        { mediaId: photoIds.fabric_face, kind: 'CHECKPOINT', checkpointKey: 'fabric_face' },
        { mediaId: photoIds.defectA, kind: 'DEFECT', defectClientId: defectA },
        { mediaId: photoIds.defectB, kind: 'DEFECT', defectClientId: defectB },
      ],
      remarks: '测试备注',
      ...overrides,
    };
  }

  it('草稿同步返回服务端评分；旧版本号被拒绝', async () => {
    const r = await api(ctx.app, inspector).put(`/inspections/${inspectionId}/draft`, draft());
    expect(r.status).toBe(200);
    draftVersion = r.body.draftVersion;
    expect(draftVersion).toBe(1);
    // 30cm → 4 分；破洞 2cm → 2 分；100 码 × 60 英寸 → 6 分/100 平方码
    expect(r.body.evaluation.fourPoint.scoring.totalPoints).toBe(6);
    expect(r.body.evaluation.fourPoint.scoring.normalizedPoints).toBe(3.6);
    expect(r.body.evaluation.overall.result).toBe('PASS');

    const stale = await api(ctx.app, inspector).put(`/inspections/${inspectionId}/draft`, draft({ baseVersion: 0 }));
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('VERSION_CONFLICT');
  });

  it('不完整的检验不能提交，并给出具体缺失项', async () => {
    const r = await api(ctx.app, inspector).put(
      `/inspections/${inspectionId}/draft`,
      draft({ segments: [{ startM: 0, endM: 50 }], photos: [] }),
    );
    draftVersion = r.body.draftVersion;
    const sub = await api(ctx.app, inspector).post(`/inspections/${inspectionId}/submit`, {
      idempotencyKey: 'flow-incomplete-1',
      draftVersion,
    });
    expect(sub.status).toBe(422);
    expect(sub.body.code).toBe('INCOMPLETE_INSPECTION');
    const problems: string[] = sub.body.details.problems;
    expect(problems.some((p) => p.includes('整卷全检'))).toBe(true);
    expect(problems.some((p) => p.includes('布卷标签'))).toBe(true);
    expect(problems.some((p) => p.includes('疵点缺少照片'))).toBe(true);
  });

  it('提交审核：锁定、创建主管待办、站内通知和 outbox；重复提交幂等', async () => {
    const r = await api(ctx.app, inspector).put(`/inspections/${inspectionId}/draft`, draft());
    draftVersion = r.body.draftVersion;
    const stale = await api(ctx.app, inspector).post(`/inspections/${inspectionId}/submit`, {
      idempotencyKey: 'flow-submit-0',
      draftVersion: draftVersion - 1,
    });
    expect(stale.status).toBe(409);

    const sub = await api(ctx.app, inspector).post(`/inspections/${inspectionId}/submit`, {
      idempotencyKey: 'flow-submit-1',
      draftVersion,
    });
    expect(sub.status).toBe(200);
    expect(sub.body).toMatchObject({ status: 'SUBMITTED', revision: 1, overallResult: 'PASS' });

    const again = await api(ctx.app, inspector).post(`/inspections/${inspectionId}/submit`, {
      idempotencyKey: 'flow-submit-1',
      draftVersion,
    });
    expect(again.body).toMatchObject({ replayed: true, revision: 1 });
    expect(await ctx.prisma.inspectionRevision.count({ where: { inspectionId } })).toBe(1);

    const locked = await api(ctx.app, inspector).put(`/inspections/${inspectionId}/draft`, draft());
    expect(locked.status).toBe(409);

    const pending = await api(ctx.app, supervisor).get('/reviews/pending');
    expect(pending.body.map((p: { id: string }) => p.id)).toContain(inspectionId);
    const outbox = await ctx.prisma.notificationOutbox.findUnique({ where: { dedupeKey: `review-request:${inspectionId}:1` } });
    expect(outbox?.status).toBe('PENDING');
    const roll = await ctx.prisma.fabricRoll.findUniqueOrThrow({ where: { id: rollIds[0] } });
    expect(roll.status).toBe('SUBMITTED');
  });

  it('订阅消息：未授权跳过，授权后发送并扣减次数，不影响站内待办', async () => {
    const delivery = ctx.app.get(DeliveryService);
    const ob = await ctx.prisma.notificationOutbox.findUniqueOrThrow({ where: { dedupeKey: `review-request:${inspectionId}:1` } });
    await delivery.deliver(ob.id);
    const d1 = await ctx.prisma.notificationDelivery.findFirst({ where: { outboxId: ob.id, userId: supervisorId } });
    expect(d1).toMatchObject({ status: 'SKIPPED', errorCode: 'NO_CONSENT' });
    expect(ctx.wechat.sent).toHaveLength(0);

    const sub = await api(ctx.app, supervisor).post('/notifications/wechat-subscriptions', {
      results: [
        { templateId: 'TPL_REVIEW_REQUEST', accepted: true },
        { templateId: 'UNKNOWN_TEMPLATE', accepted: true },
      ],
    });
    expect(sub.body.subscriptions).toEqual([{ templateId: 'TPL_REVIEW_REQUEST', remaining: 1 }]);

    // 新事件：重新入队一条同类消息模拟下一次提醒
    const ob2 = await ctx.prisma.notificationOutbox.create({
      data: {
        eventType: 'REVIEW_REQUESTED',
        dedupeKey: `test-resend:${inspectionId}`,
        payload: { inspectionId, revision: 1, recipientIds: [supervisorId] },
      },
    });
    await delivery.deliver(ob2.id);
    expect(ctx.wechat.sent).toHaveLength(1);
    expect(ctx.wechat.sent[0]).toMatchObject({ openId: 'openid-f-s01', templateId: 'TPL_REVIEW_REQUEST' });
    expect(ctx.wechat.sent[0].page).toBe(`pages/review/detail?id=${inspectionId}`);
    const quota = await ctx.prisma.wechatSubscription.findFirstOrThrow({ where: { userId: supervisorId } });
    expect(quota.remaining).toBe(0);
    expect((await ctx.prisma.notificationOutbox.findUniqueOrThrow({ where: { id: ob2.id } })).status).toBe('DONE');
  });

  it('主管退回（必须填写原因），质检员修改后重新提交为修订 2', async () => {
    const noReason = await api(ctx.app, supervisor).post(`/reviews/${inspectionId}/decide`, { decision: 'RETURN', revision: 1 });
    expect(noReason.status).toBe(400);
    const selfReview = await api(ctx.app, inspector).post(`/reviews/${inspectionId}/decide`, { decision: 'APPROVE', revision: 1 });
    expect(selfReview.status).toBe(403);

    const ret = await api(ctx.app, supervisor).post(`/reviews/${inspectionId}/decide`, {
      decision: 'RETURN',
      revision: 1,
      comment: '破洞照片不清晰，请重拍',
    });
    expect(ret.status).toBe(200);
    expect(ret.body.status).toBe('RETURNED');

    const detail = await api(ctx.app, inspector).get(`/inspections/${inspectionId}`);
    expect(detail.body.status).toBe('RETURNED');
    expect(detail.body.permissions.canEdit).toBe(true);
    // 退回后加一个油污疵点（客户禁止）→ 客户标准不合格
    const defectC = randomUUID();
    const jpeg = Buffer.alloc(1024, 9);
    const intent = await api(ctx.app, inspector).post('/media/upload-intents', { inspectionId, mimeType: 'image/jpeg', sizeBytes: 1024 });
    await putPresigned(intent.body.upload.url, 'image/jpeg', jpeg);
    await putPresigned(intent.body.thumbUpload.url, 'image/jpeg', jpeg);
    await api(ctx.app, inspector).post(`/media/${intent.body.mediaId}/confirm`);
    const base = draft({ baseVersion: detail.body.draftVersion });
    const r = await api(ctx.app, inspector).put(`/inspections/${inspectionId}/draft`, {
      ...base,
      defects: [...(base.defects as object[]), { clientId: defectC, defectTypeCode: 'OIL', lengthCm: 1, positionM: 60, severity: 'MINOR' }],
      photos: [...(base.photos as object[]), { mediaId: intent.body.mediaId, kind: 'DEFECT', defectClientId: defectC }],
    });
    expect(r.status).toBe(200);
    expect(r.body.evaluation.fourPoint.result).toBe('PASS');
    expect(r.body.evaluation.customer.result).toBe('FAIL');
    expect(r.body.evaluation.overall.result).toBe('FAIL');

    const sub = await api(ctx.app, inspector).post(`/inspections/${inspectionId}/submit`, {
      idempotencyKey: 'flow-submit-2',
      draftVersion: r.body.draftVersion,
    });
    expect(sub.body).toMatchObject({ revision: 2, overallResult: 'FAIL' });
  });

  it('系统判定不合格时，审核通过必须填写让步理由；过期修订号被拒绝', async () => {
    const stale = await api(ctx.app, supervisor).post(`/reviews/${inspectionId}/decide`, { decision: 'REJECT', revision: 1, comment: 'x 原因' });
    expect(stale.status).toBe(409);
    const noReason = await api(ctx.app, supervisor).post(`/reviews/${inspectionId}/decide`, { decision: 'APPROVE', revision: 2 });
    expect(noReason.status).toBe(400);
    const ok = await api(ctx.app, supervisor).post(`/reviews/${inspectionId}/decide`, {
      decision: 'APPROVE',
      revision: 2,
      comment: '客户同意让步接收油污',
    });
    expect(ok.body).toMatchObject({ status: 'APPROVED', isConcession: true });
    const twice = await api(ctx.app, supervisor).post(`/reviews/${inspectionId}/decide`, { decision: 'REJECT', revision: 2, comment: '再次' });
    expect(twice.status).toBe(409);

    const roll = await ctx.prisma.fabricRoll.findUniqueOrThrow({ where: { id: rollIds[0] } });
    expect(roll.status).toBe('PASSED');
    expect(roll.actualLengthM?.toNumber()).toBe(91.44);
    const n = await api(ctx.app, inspector).get('/notifications');
    expect(n.body.items.some((x: { type: string }) => x.type === 'REVIEW_RESULT')).toBe(true);
  });

  it('已审核记录不可修改；PC 可按卷号查到完整历史', async () => {
    const edit = await api(ctx.app, inspector).put(`/inspections/${inspectionId}/draft`, draft({ baseVersion: 99 }));
    expect(edit.status).toBe(409);
    const h = await api(ctx.app, admin).get('/rolls/by-no/F-R001/history');
    expect(h.status).toBe(200);
    expect(h.body.inspections).toHaveLength(1);
    const rec = h.body.inspections[0];
    expect(rec.revisions.map((r: { revision: number }) => r.revision)).toEqual([1, 2]);
    expect(rec.reviews.map((r: { decision: string }) => r.decision)).toEqual(['RETURN', 'APPROVE']);
    expect(rec.photoCount).toBe(5);
    const detail = await api(ctx.app, admin).get(`/inspections/${inspectionId}`);
    expect(detail.body.photos[0].url).toContain('X-Amz-Signature');
    expect(detail.body.standards.fourPoint.isDevDefault).toBe(true);
    const audit = await api(ctx.app, admin).get(`/audit-logs?entityType=RollInspection&entityId=${inspectionId}`);
    expect(audit.body.items.map((a: { action: string }) => a.action)).toEqual(
      expect.arrayContaining(['inspection.start', 'inspection.submit', 'review.return', 'inspection.resubmit', 'review.approve']),
    );
  });

  it('部分检验如实记录范围，并可发起复验', async () => {
    const scan = await api(ctx.app, inspector).get(`/rolls/by-qr/${qrCodes[1]}`);
    const s = await api(ctx.app, inspector).post('/inspections', { taskRollId: scan.body.myTasks[0].taskRollId, mode: 'MANUAL', scope: 'PARTIAL' });
    const id = s.body.id;
    const intents: string[] = [];
    for (const _ of [1, 2]) {
      const it = await api(ctx.app, inspector).post('/media/upload-intents', { inspectionId: id, mimeType: 'image/jpeg', sizeBytes: 100, withThumbnail: false });
      await putPresigned(it.body.upload.url, 'image/jpeg', Buffer.alloc(100, 1));
      await api(ctx.app, inspector).post(`/media/${it.body.mediaId}/confirm`);
      intents.push(it.body.mediaId);
    }
    const r = await api(ctx.app, inspector).put(`/inspections/${id}/draft`, {
      ...draft({ baseVersion: 0, mode: 'MANUAL', scope: 'PARTIAL', segments: [{ startM: 0, endM: 20 }], defects: [] }),
      measurements: (draft().measurements as { itemKey: string }[]).map((m) => (m.itemKey === 'roll_length' ? { ...m, value: 50 } : m)),
      photos: [
        { mediaId: intents[0], kind: 'CHECKPOINT', checkpointKey: 'roll_label' },
        { mediaId: intents[1], kind: 'CHECKPOINT', checkpointKey: 'fabric_face' },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.body.evaluation.scope).toBe('PARTIAL');
    expect(r.body.evaluation.inspectedLengthM).toBe(20);
    expect(r.body.evaluation.warnings[0]).toContain('部分检验');
    const sub = await api(ctx.app, inspector).post(`/inspections/${id}/submit`, { idempotencyKey: 'flow-partial-1', draftVersion: r.body.draftVersion });
    expect(sub.status).toBe(200);
    const saved = await ctx.prisma.rollInspection.findUniqueOrThrow({ where: { id } });
    expect(saved.scope).toBe('PARTIAL');
    expect(saved.inspectedLengthM?.toNumber()).toBe(20);

    await api(ctx.app, supervisor).post(`/reviews/${id}/decide`, { decision: 'REJECT', revision: 1, comment: '抽查发现问题' });
    expect((await ctx.prisma.fabricRoll.findUniqueOrThrow({ where: { id: rollIds[1] } })).status).toBe('FAILED');

    const reopen = await api(ctx.app, supervisor).post(`/inspections/${id}/reopen`, { reason: '要求整卷复验' });
    expect(reopen.status).toBe(200);
    const s2 = await api(ctx.app, inspector).post('/inspections', { taskRollId: scan.body.myTasks[0].taskRollId, mode: 'MACHINE', scope: 'FULL' });
    const re = await ctx.prisma.rollInspection.findUniqueOrThrow({ where: { id: s2.body.id } });
    expect(re.previousInspectionId).toBe(id);
  });
});
