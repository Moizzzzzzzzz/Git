import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { standardRulesSchema, type StandardKind } from '@fabricqc/shared';
import type { z } from 'zod';
import type { inspectionTemplateSchema, qualityStandardSchema, standardVersionSchema } from '@fabricqc/shared';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { AppError } from '../common/app-error';
import type { Actor } from '../common/actor';
import type { RequestMeta } from '../common/decorators';
import { AuditService } from '../audit/audit.service';

type StandardIn = z.infer<typeof qualityStandardSchema>;
type VersionIn = z.infer<typeof standardVersionSchema>;
type TemplateIn = z.infer<typeof inspectionTemplateSchema>;

@Injectable()
export class StandardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(kind?: StandardKind) {
    const rows = await this.prisma.qualityStandard.findMany({
      where: kind ? { kind } : {},
      orderBy: [{ kind: 'asc' }, { code: 'asc' }],
      include: {
        customer: { select: { id: true, code: true, name: true } },
        versions: {
          orderBy: { version: 'desc' },
          select: { id: true, version: true, status: true, isDevDefault: true, publishedAt: true },
        },
      },
    });
    return rows.map((s) => {
      const published = s.versions.find((v) => v.status === 'PUBLISHED') ?? null;
      return { ...s, currentVersion: published, hasDraft: s.versions.some((v) => v.status === 'DRAFT') };
    });
  }

  async get(id: string) {
    const s = await this.prisma.qualityStandard.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, code: true, name: true } },
        versions: { orderBy: { version: 'desc' } },
      },
    });
    if (!s) throw AppError.notFound('质量标准');
    return s;
  }

  async create(actor: Actor, d: StandardIn, meta: RequestMeta) {
    if (d.kind === 'CUSTOMER' && !d.customerId) throw AppError.badRequest('客户标准必须选择客户');
    if (d.customerId && !(await this.prisma.customer.findUnique({ where: { id: d.customerId } }))) {
      throw AppError.badRequest('客户不存在');
    }
    const s = await this.prisma.qualityStandard.create({ data: d });
    await this.audit.log(actor, { action: 'standard.create', entityType: 'QualityStandard', entityId: s.id, after: s }, meta);
    return s;
  }

  async update(actor: Actor, id: string, d: StandardIn, meta: RequestMeta) {
    const before = await this.prisma.qualityStandard.findUnique({ where: { id } });
    if (!before) throw AppError.notFound('质量标准');
    if (before.kind !== d.kind) throw AppError.badRequest('标准类型创建后不能修改');
    if (d.kind === 'CUSTOMER' && !d.customerId) throw AppError.badRequest('客户标准必须选择客户');
    const s = await this.prisma.qualityStandard.update({ where: { id }, data: d });
    await this.audit.log(actor, { action: 'standard.update', entityType: 'QualityStandard', entityId: id, before, after: s }, meta);
    return s;
  }

  private assertRulesFitKind(kind: StandardKind, rules: VersionIn['rules']) {
    if (kind === 'FOUR_POINT' && !rules.fourPoint) {
      throw AppError.badRequest('四分制标准必须包含计分配置（fourPoint）');
    }
  }

  private async assertDefectCodes(tx: Tx, rules: VersionIn['rules']) {
    const codes = new Set<string>([
      ...rules.forbiddenDefectTypes,
      ...Object.keys(rules.maxDefectCountByType),
      ...(rules.fourPoint?.specialRules.flatMap((r) => r.defectTypeCodes) ?? []),
    ]);
    if (!codes.size) return;
    const found = await tx.defectType.findMany({ where: { code: { in: [...codes] } }, select: { code: true } });
    const missing = [...codes].filter((c) => !found.some((f) => f.code === c));
    if (missing.length) throw AppError.badRequest(`规则引用了不存在的疵点类型：${missing.join('、')}`);
  }

  /** 新建草稿版本（每个标准同时只允许一个草稿） */
  async createVersion(actor: Actor, standardId: string, d: VersionIn, meta: RequestMeta) {
    return this.prisma.$transaction(async (tx) => {
      const s = await tx.qualityStandard.findUnique({ where: { id: standardId }, include: { versions: true } });
      if (!s) throw AppError.notFound('质量标准');
      if (s.versions.some((v) => v.status === 'DRAFT')) throw AppError.invalidState('已有草稿版本，请先编辑或发布');
      this.assertRulesFitKind(s.kind, d.rules);
      await this.assertDefectCodes(tx, d.rules);
      const version = Math.max(0, ...s.versions.map((v) => v.version)) + 1;
      const v = await tx.standardVersion.create({
        data: {
          standardId,
          version,
          rules: d.rules as Prisma.InputJsonValue,
          notes: d.notes,
          createdById: actor.userId,
        },
      });
      await this.audit.log(actor, { action: 'standard.version.create', entityType: 'StandardVersion', entityId: v.id, after: v }, meta, tx);
      return v;
    });
  }

  async updateVersion(actor: Actor, versionId: string, d: VersionIn, meta: RequestMeta) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.standardVersion.findUnique({ where: { id: versionId }, include: { standard: true } });
      if (!before) throw AppError.notFound('标准版本');
      if (before.status !== 'DRAFT') throw AppError.invalidState('已发布的版本不可修改，请新建版本');
      this.assertRulesFitKind(before.standard.kind, d.rules);
      await this.assertDefectCodes(tx, d.rules);
      const v = await tx.standardVersion.update({
        where: { id: versionId },
        data: { rules: d.rules as Prisma.InputJsonValue, notes: d.notes },
      });
      await this.audit.log(
        actor,
        { action: 'standard.version.update', entityType: 'StandardVersion', entityId: versionId, before, after: v },
        meta,
        tx,
      );
      return v;
    });
  }

  /** 发布：当前已发布版本转为 RETIRED，新版本成为生效版本 */
  async publish(actor: Actor, versionId: string, meta: RequestMeta) {
    return this.prisma.$transaction(async (tx) => {
      const v = await tx.standardVersion.findUnique({ where: { id: versionId }, include: { standard: true } });
      if (!v) throw AppError.notFound('标准版本');
      if (v.status !== 'DRAFT') throw AppError.invalidState('只能发布草稿版本');
      const rules = standardRulesSchema.safeParse(v.rules);
      if (!rules.success) throw AppError.badRequest('规则格式不正确，无法发布', rules.error.issues);
      this.assertRulesFitKind(v.standard.kind, rules.data);
      await tx.standardVersion.updateMany({
        where: { standardId: v.standardId, status: 'PUBLISHED' },
        data: { status: 'RETIRED' },
      });
      const published = await tx.standardVersion.update({
        where: { id: versionId },
        data: { status: 'PUBLISHED', publishedAt: new Date(), publishedById: actor.userId },
      });
      await this.audit.log(
        actor,
        { action: 'standard.version.publish', entityType: 'StandardVersion', entityId: versionId, after: published },
        meta,
        tx,
      );
      return published;
    });
  }

  /** 当前生效版本 */
  async currentVersion(tx: Tx, standardId: string) {
    return tx.standardVersion.findFirst({
      where: { standardId, status: 'PUBLISHED' },
      orderBy: { version: 'desc' },
      include: { standard: true },
    });
  }

  // ---------- 检验模板 ----------
  listTemplates() {
    return this.prisma.inspectionTemplate.findMany({ orderBy: { code: 'asc' } });
  }

  async getTemplate(id: string) {
    const t = await this.prisma.inspectionTemplate.findUnique({ where: { id } });
    if (!t) throw AppError.notFound('检验模板');
    return t;
  }

  async createTemplate(actor: Actor, d: TemplateIn, meta: RequestMeta) {
    const t = await this.prisma.inspectionTemplate.create({
      data: { ...d, content: d.content as Prisma.InputJsonValue },
    });
    await this.audit.log(actor, { action: 'template.create', entityType: 'InspectionTemplate', entityId: t.id, after: t }, meta);
    return t;
  }

  /** 修改模板递增版本号；进行中的检验使用开始时的快照，不受影响 */
  async updateTemplate(actor: Actor, id: string, d: TemplateIn, meta: RequestMeta) {
    const before = await this.prisma.inspectionTemplate.findUnique({ where: { id } });
    if (!before) throw AppError.notFound('检验模板');
    const t = await this.prisma.inspectionTemplate.update({
      where: { id },
      data: { ...d, content: d.content as Prisma.InputJsonValue, version: { increment: 1 } },
    });
    await this.audit.log(actor, { action: 'template.update', entityType: 'InspectionTemplate', entityId: id, before, after: t }, meta);
    return t;
  }
}
