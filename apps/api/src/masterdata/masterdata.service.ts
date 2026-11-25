import { Injectable } from '@nestjs/common';
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

type CustomerIn = z.infer<typeof customerSchema>;
type FabricIn = z.infer<typeof fabricSchema>;
type LotIn = z.infer<typeof productionLotSchema>;
type DefectTypeIn = z.infer<typeof defectTypeSchema>;

const fabricInclude = {
  customer: { select: { id: true, code: true, name: true } },
  defaultFourPointStandard: { select: { id: true, code: true, name: true } },
  defaultCustomerStandard: { select: { id: true, code: true, name: true } },
  defaultTemplate: { select: { id: true, code: true, name: true } },
} satisfies Prisma.FabricInclude;

@Injectable()
export class MasterDataService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

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
      const s = await tx.qualityStandard.findUnique({ where: { id: d.defaultFourPointStandardId } });
      if (!s || s.kind !== 'FOUR_POINT') throw AppError.badRequest('默认四分制标准不存在或类型不符');
    }
    if (d.defaultCustomerStandardId) {
      const s = await tx.qualityStandard.findUnique({ where: { id: d.defaultCustomerStandardId } });
      if (!s || s.kind !== 'CUSTOMER') throw AppError.badRequest('默认客户标准不存在或类型不符');
    }
    if (d.defaultTemplateId && !(await tx.inspectionTemplate.findUnique({ where: { id: d.defaultTemplateId } }))) {
      throw AppError.badRequest('检验模板不存在');
    }
    if (d.widthCm && d.cuttableWidthCm && d.cuttableWidthCm > d.widthCm) {
      throw AppError.badRequest('可裁门幅不能大于门幅');
    }
  }

  async listFabrics(p: Pagination & { customerId?: string }) {
    const where: Prisma.FabricWhereInput = {
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
    return paged(items, total, p);
  }

  async getFabric(id: string) {
    const f = await this.prisma.fabric.findUnique({ where: { id }, include: fabricInclude });
    if (!f) throw AppError.notFound('面料');
    return f;
  }

  async createFabric(actor: Actor, data: FabricIn, meta: RequestMeta) {
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
    if (!(await this.prisma.fabric.findUnique({ where: { id: data.fabricId } }))) throw AppError.badRequest('面料不存在');
    const lot = await this.prisma.productionLot.create({ data });
    await this.audit.log(actor, { action: 'lot.create', entityType: 'ProductionLot', entityId: lot.id, after: lot }, meta);
    return lot;
  }

  async updateLot(actor: Actor, id: string, data: LotIn, meta: RequestMeta) {
    const before = await this.prisma.productionLot.findUnique({ where: { id }, include: { _count: { select: { rolls: true } } } });
    if (!before) throw AppError.notFound('批次');
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
