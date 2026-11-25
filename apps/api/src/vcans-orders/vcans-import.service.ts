import { Injectable, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma, RoleCode } from '@prisma/client';
import type { z } from 'zod';
import type { vcansImportPreviewSchema, vcansImportCommitSchema } from '@fabricqc/shared';
import type { Actor } from '../common/actor';
import { AppError } from '../common/app-error';
import { PrismaService } from '../prisma/prisma.service';
import { businessDepartments } from '../tasks/business-access';
import { parseImportInWorker } from './vcans-import-worker';
import type { VcansImportParseResult } from './vcans-import-parser';
import { AppConfig } from '../config/app-config';

@Injectable()
export class VcansImportService {
  constructor(private readonly prisma: PrismaService, @Optional() private readonly config?: AppConfig) {}
  async preview(actor: Actor, input: z.infer<typeof vcansImportPreviewSchema>) {
    if (!businessDepartments(actor).includes(input.businessDepartmentId)) throw AppError.forbidden('没有该业务部门的导入权限');
    const bytes = Buffer.from(input.fileBase64, 'base64');
    if (bytes.length > 5 * 1024 * 1024 || bytes.toString('base64') !== input.fileBase64) throw AppError.badRequest('文件编码无效或文件过大');
    const hash = createHash('sha256').update(bytes).digest('hex');
    const existing = await this.prisma.vcansImportBatch.findUnique({ where: { businessDepartmentId_idempotencyKey: { businessDepartmentId: input.businessDepartmentId, idempotencyKey: input.idempotencyKey } } });
    if (existing) {
      if (existing.createdById !== actor.userId || existing.sourceHash !== hash) throw AppError.conflict('导入请求冲突');
      if (!existing.expiresAt || existing.expiresAt <= new Date() || !existing.previewSummary) throw AppError.invalidState('预览已过期，请重新上传');
      return this.previewResponse(existing.id, existing.sourceHash, existing.expiresAt, existing.previewSummary as unknown as VcansImportParseResult);
    }
    let parsed: VcansImportParseResult;
    try { parsed = await parseImportInWorker(bytes); } catch { throw AppError.badRequest('文件解析失败或超出限制'); }
    if (parsed.sourceHash !== hash) throw AppError.badRequest('文件校验失败');
    const { rows, ...summary } = parsed;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    try {
      const batch = await this.prisma.$transaction(async (tx) => {
        const created = await tx.vcansImportBatch.create({ data: { businessDepartmentId: input.businessDepartmentId, createdById: actor.userId, idempotencyKey: input.idempotencyKey, sourceHash: hash, expiresAt, previewSummary: summary as unknown as Prisma.InputJsonValue } });
        if (rows.length) await tx.vcansImportRow.createMany({ data: rows.map((row) => ({ batchId: created.id, sourceSheet: row.sourceSheet, sourceRow: row.sourceRow, rawSnapshot: row.rawCells as unknown as Prisma.InputJsonValue })) });
        return created;
      });
      return this.previewResponse(batch.id, hash, expiresAt, summary as VcansImportParseResult);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw AppError.conflict('导入请求正在处理，请重试');
      throw error;
    }
  }
  async commit(actor: Actor, input: z.infer<typeof vcansImportCommitSchema>) {
    const departments = businessDepartments(actor);
    if (input.groups.some((group) => !departments.includes(group.businessDepartmentId))) throw AppError.forbidden('没有所选业务部门的导入权限');
    const groups = [...input.groups].map((group) => ({ ...group, hNo: group.hNo.trim().toUpperCase() })).sort((a, b) => a.hNo.localeCompare(b.hNo));
    const commitHash = createHash('sha256').update(JSON.stringify({ previewId: input.previewId, groups })).digest('hex');
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM vcans_import_batches WHERE id = ${input.previewId}::uuid FOR UPDATE`;
        const batch = await tx.vcansImportBatch.findUnique({ where: { id: input.previewId }, include: { rows: true } });
        if (!batch || batch.createdById !== actor.userId || !departments.includes(batch.businessDepartmentId)) throw AppError.forbidden('没有该导入预览的权限');
        if (batch.status === 'COMMITTED') {
          if (batch.commitKey !== input.idempotencyKey || batch.commitHash !== commitHash || !batch.commitResult) throw AppError.conflict('提交请求与已保存结果不一致');
          return batch.commitResult;
        }
        if (batch.status !== 'PREVIEW' || !batch.expiresAt || batch.expiresAt <= new Date() || !batch.previewSummary) throw AppError.invalidState('预览已过期，请重新上传');
        const parsed = batch.previewSummary as unknown as VcansImportParseResult;
        if (!parsed.canImport || parsed.errors.length) throw AppError.badRequest('预览存在错误，不能提交');
        const sourceGroups = new Map(parsed.groups.map((g) => [g.hNo.trim().toUpperCase(), g]));
        const rowMap = new Map(batch.rows.map((row) => [`${row.sourceSheet}\0${row.sourceRow}`, row]));
        const items = [];
        for (const group of groups) {
          const source = sourceGroups.get(group.hNo);
          if (!source || !source.lines.length) throw AppError.badRequest('选择的订单不在预览中');
          const supervisor = await tx.user.findUnique({ where: { id: group.supervisorId }, include: { roles: { include: { role: true } } } });
          if (!supervisor || supervisor.status !== 'ACTIVE' || !supervisor.roles.some((r) => r.role.code === RoleCode.QC_SUPERVISOR)) throw AppError.badRequest('质检主管不可用');
          if (group.fourPointStandardId) {
            const standard = await tx.qualityStandard.findUnique({ where: { id: group.fourPointStandardId }, include: { versions: { where: { status: 'PUBLISHED' }, take: 1 } } });
            if (!standard?.isActive || standard.kind !== 'FOUR_POINT' || !standard.versions.length) throw AppError.badRequest('四分制标准不可用');
            if (this.config?.env.DEMO_RUNTIME_MODE !== 'demo' && (standard.versions[0].purpose !== 'FORMAL' || standard.versions[0].isDevDefault)) throw AppError.badRequest('正式订单不能选择未确认的标准');
          }
          if (group.templateId && !(await tx.inspectionTemplate.findFirst({ where: { id: group.templateId, isActive: true, ...(this.config?.env.DEMO_RUNTIME_MODE === 'demo' ? {} : { purpose: 'FORMAL' }) } }))) throw AppError.badRequest('检验模板不可用');
          const order = await tx.vcansOrder.create({ data: { hNo: group.hNo, businessDepartmentId: group.businessDepartmentId, supervisorId: group.supervisorId, createdById: actor.userId, source: 'VCANS', purpose: this.config?.env.DEMO_RUNTIME_MODE === 'demo' ? 'TEST' : 'FORMAL', dueAt: group.dueAt ? new Date(group.dueAt) : null, fourPointStandardId: group.fourPointStandardId ?? null, templateId: group.templateId ?? null, planMode: group.plan.mode, fixedRolls: group.plan.mode === 'FIXED_PER_LOT' ? group.plan.fixedRolls : null, percent: group.plan.mode === 'PERCENT_PER_LOT' ? group.plan.percent : null }, select: { id: true, hNo: true, version: true } });
          for (const [index, line] of source.lines.entries()) {
            const raw = rowMap.get(`${line.sourceSheet}\0${line.sourceRow}`);
            if (!raw || raw.orderLineId) throw AppError.conflict('源行不存在或已提交');
            const created = await tx.vcansOrderLine.create({ data: { orderId: order.id, lineNo: index + 1, customerOrderNo: line.customerOrderNo, productName: line.productName, productCode: line.productCode, color: line.color, specification: line.specification, quantity: line.quantity, quantityUnit: line.quantityUnit, sourceSnapshot: { sourceSheet: line.sourceSheet, sourceRow: line.sourceRow, rawCells: raw.rawSnapshot, normalized: line } as unknown as Prisma.InputJsonValue } });
            await tx.vcansImportRow.update({ where: { id: raw.id }, data: { orderLineId: created.id } });
          }
          await tx.vcansOrderChange.create({ data: { orderId: order.id, actorId: actor.userId, targetType: 'IMPORT', targetId: batch.id, after: { sourceHash: batch.sourceHash, hNo: order.hNo } } });
          await tx.notification.create({ data: { userId: group.supervisorId, type: 'VCANS_NEW_ORDER', title: '待分发验布订单', body: order.hNo, entityType: 'VcansOrder', entityId: order.id, pagePath: `/pages/orders/detail?id=${order.id}` } });
          items.push(order);
        }
        const result = { items };
        await tx.vcansImportBatch.update({ where: { id: batch.id }, data: { status: 'COMMITTED', commitKey: input.idempotencyKey, commitHash, commitResult: result } });
        return result;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw AppError.conflict('该编号或请求无法使用，请核对');
      throw error;
    }
  }
  private async previewResponse(previewId: string, sourceHash: string, expiresAt: Date, parsed: VcansImportParseResult) {
    const hNos = parsed.groups.map((group) => group.hNo.trim().toUpperCase());
    const existing = await this.prisma.vcansOrder.findMany({ where: { hNo: { in: hNos } }, select: { hNo: true } });
    const conflicts = new Set(existing.map((order) => order.hNo));
    return { previewId, sourceHash, expiresAt, groups: parsed.groups.map((group) => ({ ...group, sourceRows: group.lines.map((line) => ({ sourceSheet: line.sourceSheet, sourceRow: line.sourceRow })), errors: parsed.errors.filter((issue) => group.lines.some((line) => line.sourceSheet === issue.sourceSheet && line.sourceRow === issue.sourceRow)), warnings: parsed.warnings.filter((issue) => group.lines.some((line) => line.sourceSheet === issue.sourceSheet && line.sourceRow === issue.sourceRow)), conflict: conflicts.has(group.hNo.trim().toUpperCase()) })), errors: parsed.errors, warnings: parsed.warnings, canImport: parsed.canImport };
  }
}
