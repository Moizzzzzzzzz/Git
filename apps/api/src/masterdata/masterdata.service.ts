import { Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Pagination } from '@fabricqc/shared';
import type { z } from 'zod';
import type { customerSchema, defectTypeSchema, fabricSchema, productionLotSchema } from '@fabricqc/shared';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { AppError } from '../common/app-error';
import type { Actor } from '../common/actor';
import type { RequestMeta } from '../common/decorators';
import { pageArgs, paged } from '../common/pagination';
import { AuditService } from '../audit/audit.service';
import { AppConfig } from '../config/app-config';
import { hasRole } from '../common/actor';
import { RoleCode } from '@fabricqc/shared';

type CustomerIn = z.infer<typeof customerSchema>;
type FabricIn = z.infer<typeof fabricSchema>;
type LotIn = z.infer<typeof productionLotSchema>;
type DefectTypeIn = z.infer<typeof defectTypeSchema>;

const fabricInclude = {
  customer: { select: { id: true, code: true, name: true } },
  defaultFourPointStandard: { select: { id: true, code: true, name: true, versions: { where: { status: 'PUBLISHED' }, select: { isDevDefault: true, purpose: true } } } },
  defaultCustomerStandard: { select: { id: true, code: true, name: true, versions: { where: { status: 'PUBLISHED' }, select: { isDevDefault: true, purpose: true } } } },
  defaultTemplate: { select: { id: true, code: true, name: true, purpose: true } },
} satisfies Prisma.FabricInclude;

@Injectable()
export class MasterDataService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly config?: AppConfig,
  ) {}
  private get isDemo() { return this.config?.env.DEMO_RUNTIME_MODE === 'demo'; }
  private presentFabric(f: Prisma.FabricGetPayload<{ include: typeof fabricInclude }>) {
    const clean = <T extends { versions: { isDevDefault: boolean; purpose: string }[] } | null>(s: T) => {
      if (!s) return null;
      if (!this.isDemo && s.versions.some(v => v.isDevDefault || v.purpose === 'TEST')) return null;
      const { versions: _versions, ...rest } = s; return rest;
    };
    const fp = clean(f.defaultFourPointStandard), customer = clean(f.defaultCustomerStandard);
    const template = f.defaultTemplate && (this.isDemo || f.defaultTemplate.purpose !== 'TEST') ? { id: f.defaultTemplate.id, code: f.defaultTemplate.code, name: f.defaultTemplate.name } : null;
    return { ...f, defaultFourPointStandardId: fp?.id ?? null, defaultCustomerStandardId: customer?.id ?? null, defaultTemplateId: template?.id ?? null, defaultFourPointStandard: fp, defaultCustomerStandard: customer, defaultTemplate: template };
  }

  // ---------- 客户 ----------
  async listCustomers(p: Pagination) {
    const where: Prisma.CustomerWhereInput = p.q
      ? { OR: [{ name: { contains: p.q, mode: 'insensitive' } }, { code: { contains: p.q, mode: 'insensitive' } }] }
      : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({ where, orderBy: { code: 'asc' }, ...pageArgs(p) }),
      this.prisma.customer.count({ where }),
    ]);
    return paged(items, total, p);
  }

  async createCustomer(actor: Actor, data: CustomerIn, meta: RequestMeta) {
    const c = await this.prisma.customer.create({ data });
    await this.audit.log(actor, { action: 'customer.create', entityType: 'Customer', entityId: c.id, after: c }, meta);
    return c;
  }

  async updateCustomer(actor: Actor, id: string, data: CustomerIn, meta: RequestMeta) {
    const before = await this.prisma.customer.findUnique({ where: { id } });
    if (!before) throw AppError.notFound('客户');
    const c = await this.prisma.customer.update({ where: { id }, data });
    await this.audit.log(actor, { action: 'customer.update', entityType: 'Customer', entityId: id, before, after: c }, meta);
    return c;
  }

  // ---------- 面料 ----------
  private async validateFabricRefs(tx: Tx, d: FabricIn) {
    if (d.customerId && !(await tx.customer.findUnique({ where: { id: d.customerId } }))) {
      throw AppError.badRequest('客户不存在');
    }
    if (d.defaultFourPointStandardId) {
      const s = await tx.qualityStandard.findUnique({ where: { id: d.defaultFourPointStandardId }, include: { versions: { where: { status: 'PUBLISHED' }, take: 1 } } });
      if (!s || s.kind !== 'FOUR_POINT') throw AppError.badRequest('默认四分制标准不存在或类型不符');
      if (!this.isDemo && (s.versions[0]?.purpose !== 'FORMAL' || s.versions[0].isDevDefault)) throw AppError.badRequest('默认标准未被确认为正式');
    }
    if (d.defaultCustomerStandardId) {
      const s = await tx.qualityStandard.findUnique({ where: { id: d.defaultCustomerStandardId }, include: { versions: { where: { status: 'PUBLISHED' }, take: 1 } } });
      if (!s || s.kind !== 'CUSTOMER') throw AppError.badRequest('默认客户标准不存在或类型不符');
      if (!this.isDemo && (s.versions[0]?.purpose !== 'FORMAL' || s.versions[0].isDevDefault || s.customerId !== d.customerId)) throw AppError.badRequest('客户标准未正式确认或不属于该客户');
    }
    if (d.defaultTemplateId) {
      const template = await tx.inspectionTemplate.findUnique({ where: { id: d.defaultTemplateId } });
      if (!template || (!this.isDemo && template.purpose !== 'FORMAL')) throw AppError.badRequest('检验模板不存在或未正式确认');
    }
    if (d.widthCm && d.cuttableWidthCm && d.cuttableWidthCm > d.widthCm) {
      throw AppError.badRequest('可裁门幅不能大于门幅');
    }
  }

  async listFabrics(p: Pagination & { customerId?: string }) {
    const where: Prisma.FabricWhereInput = {
      ...(this.isDemo ? {} : { purpose: { not: 'TEST' } }),
      customerId: p.customerId,
      ...(p.q
        ? {
            OR: [
              { code: { contains: p.q, mode: 'insensitive' } },
              { nameZh: { contains: p.q, mode: 'insensitive' } },
              { nameEn: { contains: p.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.fabric.findMany({ where, include: fabricInclude, orderBy: { code: 'asc' }, ...pageArgs(p) }),
      this.prisma.fabric.count({ where }),
    ]);
    return paged(items.map(item => this.presentFabric(item)), total, p);
  }

  async getFabric(id: string) {
    const f = await this.prisma.fabric.findUnique({ where: { id }, include: fabricInclude });
    if (!f) throw AppError.notFound('面料');
    if (!this.isDemo && f.purpose === 'TEST') throw AppError.notFound('面料');
    return this.presentFabric(f);
  }

  async createFabric(actor: Actor, data: FabricIn, meta: RequestMeta) {
    if (data.purpose === 'FORMAL' && !hasRole(actor, RoleCode.ADMIN, RoleCode.QUALITY_MANAGER)) throw AppError.forbidden('仅管理员或质量经理可确认正式面料');
    if (data.purpose === 'TEST' && !this.isDemo) throw AppError.badRequest('测试面料请在隔离演示环境配置');
    return this.prisma.$transaction(async (tx) => {
      await this.validateFabricRefs(tx, data);
      const f = await tx.fabric.create({ data, include: fabricInclude });
      await this.audit.log(actor, { action: 'fabric.create', entityType: 'Fabric', entityId: f.id, after: f }, meta, tx);
      return f;
    });
  }

  async updateFabric(actor: Actor, id: string, data: FabricIn, meta: RequestMeta) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.fabric.findUnique({ where: { id } });
      if (!before) throw AppError.notFound('面料');
      if (!this.isDemo && before.purpose === 'TEST') throw AppError.notFound('面料');
      if (data.purpose && data.purpose !== before.purpose) throw AppError.badRequest('用途变更需要受控归档流程');
      await this.validateFabricRefs(tx, data);
      const f = await tx.fabric.update({ where: { id }, data, include: fabricInclude });
      await this.audit.log(actor, { action: 'fabric.update', entityType: 'Fabric', entityId: id, before, after: f }, meta, tx);
      return f;
    });
  }

  // ---------- 生产批次 ----------
  async listLots(p: Pagination & { fabricId?: string }) {
    const where: Prisma.ProductionLotWhereInput = {
      fabricId: p.fabricId,
      ...(!this.isDemo ? { fabric: { purpose: { not: 'TEST' as const } }, rolls: { none: { OR: [{ taskRolls: { some: { task: { purpose: 'TEST' as const } } } }, { vcansOrderRoll: { lot: { line: { order: { purpose: 'TEST' as const } } } } }] } } } : {}),
      ...(p.q
        ? { OR: [{ lotNo: { contains: p.q, mode: 'insensitive' } }, { dyeLotNo: { contains: p.q, mode: 'insensitive' } }] }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.productionLot.findMany({
        where,
        include: { fabric: { select: { id: true, code: true, nameZh: true } }, _count: { select: { rolls: true } } },
        orderBy: { createdAt: 'desc' },
        ...pageArgs(p),
      }),
      this.prisma.productionLot.count({ where }),
    ]);
    return paged(items, total, p);
  }

  async createLot(actor: Actor, data: LotIn, meta: RequestMeta) {
    const fabric = await this.prisma.fabric.findUnique({ where: { id: data.fabricId } });
    if (!fabric || (!this.isDemo && fabric.purpose === 'TEST')) throw AppError.badRequest('面料不存在');
    const lot = await this.prisma.productionLot.create({ data });
    await this.audit.log(actor, { action: 'lot.create', entityType: 'ProductionLot', entityId: lot.id, after: lot }, meta);
    return lot;
  }

  async updateLot(actor: Actor, id: string, data: LotIn, meta: RequestMeta) {
    const before = await this.prisma.productionLot.findFirst({ where: { id, ...(!this.isDemo ? { fabric: { purpose: { not: 'TEST' } }, rolls: { none: { OR: [{ taskRolls: { some: { task: { purpose: 'TEST' } } } }, { vcansOrderRoll: { lot: { line: { order: { purpose: 'TEST' } } } } }] } } } : {}) }, include: { _count: { select: { rolls: true } } } });
    if (!before) throw AppError.notFound('批次');
    const fabric = await this.prisma.fabric.findUnique({ where: { id: data.fabricId } });
    if (!fabric || (!this.isDemo && fabric.purpose === 'TEST')) throw AppError.badRequest('面料不存在');
    if (before.fabricId !== data.fabricId && before._count.rolls > 0) {
      throw AppError.invalidState('批次下已有布卷，不能更改面料');
    }
    const lot = await this.prisma.productionLot.update({ where: { id }, data });
    await this.audit.log(actor, { action: 'lot.update', entityType: 'ProductionLot', entityId: id, before, after: lot }, meta);
    return lot;
  }

  // ---------- 疵点类型 ----------
  listDefectTypes(activeOnly: boolean) {
    return this.prisma.defectType.findMany({
      where: activeOnly ? { isActive: true } : {},
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });
  }

  async createDefectType(actor: Actor, data: DefectTypeIn, meta: RequestMeta) {
    const d = await this.prisma.defectType.create({ data });
    await this.audit.log(actor, { action: 'defect_type.create', entityType: 'DefectType', entityId: d.id, after: d }, meta);
    return d;
  }

  async updateDefectType(actor: Actor, id: string, data: DefectTypeIn, meta: RequestMeta) {
    const before = await this.prisma.defectType.findUnique({ where: { id } });
    if (!before) throw AppError.notFound('疵点类型');
    // 编码被历史疵点和标准规则引用，禁止修改
    if (before.code !== data.code) throw AppError.badRequest('疵点类型编码创建后不能修改');
    const d = await this.prisma.defectType.update({ where: { id }, data });
    await this.audit.log(actor, { action: 'defect_type.update', entityType: 'DefectType', entityId: id, before, after: d }, meta);
    return d;
  }
}
