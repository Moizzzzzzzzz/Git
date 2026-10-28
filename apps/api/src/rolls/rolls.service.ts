import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { buildRollQrContent, type Pagination, type RollStatus } from '@fabricqc/shared';
import type { z } from 'zod';
import type { rollImportSchema, rollSchema, updateRollSchema } from '@fabricqc/shared';
import * as QRCode from 'qrcode';
import { AppConfig } from '../config/app-config';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { AppError } from '../common/app-error';
import { randomCode } from '../common/codes';
import type { Actor } from '../common/actor';
import type { RequestMeta } from '../common/decorators';
import { pageArgs, paged } from '../common/pagination';
import { AuditService } from '../audit/audit.service';

type RollIn = z.infer<typeof rollSchema>;
type RollUpdate = z.infer<typeof updateRollSchema>;
type ImportIn = z.infer<typeof rollImportSchema>;

const rollInclude = {
  fabric: { select: { id: true, code: true, nameZh: true, nameEn: true, widthCm: true, cuttableWidthCm: true, gsm: true, color: true, colorCode: true, composition: true } },
  lot: { select: { id: true, lotNo: true, dyeLotNo: true } },
} satisfies Prisma.FabricRollInclude;

const EDITABLE_STATUSES: RollStatus[] = ['PENDING', 'ASSIGNED'];

@Injectable()
export class RollsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
  ) {}

  /** 生成唯一二维码标识（碰撞时重试） */
  private async newQrCode(tx: Tx, taken = new Set<string>()): Promise<string> {
    for (let i = 0; i < 10; i++) {
      const code = randomCode(10);
      if (taken.has(code)) continue;
      if (!(await tx.fabricRoll.findUnique({ where: { qrCode: code } }))) {
        taken.add(code);
        return code;
      }
    }
    throw new Error('无法生成唯一二维码标识');
  }

  qrContent(qrCode: string) {
    return buildRollQrContent(this.config.env.QR_BASE_URL, qrCode);
  }

  async list(p: Pagination & { fabricId?: string; lotId?: string; status?: RollStatus }) {
    const where: Prisma.FabricRollWhereInput = {
      fabricId: p.fabricId,
      lotId: p.lotId,
      status: p.status,
      ...(p.q
        ? {
            OR: [
              { rollNo: { contains: p.q, mode: 'insensitive' } },
              { dyeLotNo: { contains: p.q, mode: 'insensitive' } },
              { fabric: { code: { contains: p.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.fabricRoll.findMany({ where, include: rollInclude, orderBy: { createdAt: 'desc' }, ...pageArgs(p) }),
      this.prisma.fabricRoll.count({ where }),
    ]);
    return paged(
      items.map((r) => ({ ...r, qrContent: this.qrContent(r.qrCode) })),
      total,
      p,
    );
  }

  async get(id: string) {
    const r = await this.prisma.fabricRoll.findUnique({ where: { id }, include: rollInclude });
    if (!r) throw AppError.notFound('布卷');
    return { ...r, qrContent: this.qrContent(r.qrCode) };
  }

  private async validateRefs(tx: Tx, d: { fabricId: string; lotId?: string | null }) {
    const fabric = await tx.fabric.findUnique({ where: { id: d.fabricId } });
    if (!fabric) throw AppError.badRequest('面料不存在');
    if (d.lotId) {
      const lot = await tx.productionLot.findUnique({ where: { id: d.lotId } });
      if (!lot || lot.fabricId !== d.fabricId) throw AppError.badRequest('批次不存在或不属于该面料');
      return lot;
    }
    return null;
  }

  async create(actor: Actor, d: RollIn, meta: RequestMeta) {
    return this.prisma.$transaction(async (tx) => {
      const lot = await this.validateRefs(tx, d);
      const roll = await tx.fabricRoll.create({
        data: {
          rollNo: d.rollNo,
          qrCode: await this.newQrCode(tx),
          fabricId: d.fabricId,
          lotId: d.lotId ?? null,
          dyeLotNo: d.dyeLotNo ?? (lot?.dyeLotNo || null),
          colorCode: d.colorCode ?? lot?.colorCode ?? null,
          nominalLengthM: d.nominalLengthM ?? null,
          notes: d.notes,
          createdById: actor.userId,
        },
        include: rollInclude,
      });
      await this.audit.log(actor, { action: 'roll.create', entityType: 'FabricRoll', entityId: roll.id, after: roll }, meta, tx);
      return { ...roll, qrContent: this.qrContent(roll.qrCode) };
    });
  }

  async update(actor: Actor, id: string, d: RollUpdate, meta: RequestMeta) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.fabricRoll.findUnique({ where: { id } });
      if (!before) throw AppError.notFound('布卷');
      if (!EDITABLE_STATUSES.includes(before.status)) {
        throw AppError.invalidState('布卷已开始检验，不能修改基础信息');
      }
      await this.validateRefs(tx, d);
      const roll = await tx.fabricRoll.update({
        where: { id },
        data: {
          fabricId: d.fabricId,
          lotId: d.lotId ?? null,
          dyeLotNo: d.dyeLotNo,
          colorCode: d.colorCode,
          nominalLengthM: d.nominalLengthM ?? null,
          notes: d.notes,
        },
        include: rollInclude,
      });
      await this.audit.log(actor, { action: 'roll.update', entityType: 'FabricRoll', entityId: id, before, after: roll }, meta, tx);
      return { ...roll, qrContent: this.qrContent(roll.qrCode) };
    });
  }

  /** 批量导入：全部校验通过才写入（要么全成功，要么全不写） */
  async import(actor: Actor, input: ImportIn, meta: RequestMeta) {
    const errors: { row: number; message: string }[] = [];
    const seen = new Map<string, number>();
    input.rows.forEach((r, i) => {
      const prev = seen.get(r.rollNo);
      if (prev !== undefined) errors.push({ row: i + 1, message: `卷号 ${r.rollNo} 与第 ${prev} 行重复` });
      else seen.set(r.rollNo, i + 1);
    });

    const fabricCodes = [...new Set(input.rows.map((r) => r.fabricCode))];
    const fabrics = await this.prisma.fabric.findMany({ where: { code: { in: fabricCodes } } });
    const fabricByCode = new Map(fabrics.map((f) => [f.code, f]));
    const existing = await this.prisma.fabricRoll.findMany({
      where: { rollNo: { in: input.rows.map((r) => r.rollNo) } },
      select: { rollNo: true },
    });
    const existingSet = new Set(existing.map((e) => e.rollNo));
    input.rows.forEach((r, i) => {
      if (!fabricByCode.has(r.fabricCode)) errors.push({ row: i + 1, message: `面料货号 ${r.fabricCode} 不存在` });
      if (existingSet.has(r.rollNo)) errors.push({ row: i + 1, message: `卷号 ${r.rollNo} 已存在` });
    });
    if (errors.length) throw AppError.badRequest(`导入数据有 ${errors.length} 处错误，未写入任何数据`, errors);

    const created = await this.prisma.$transaction(
      async (tx) => {
        const lotCache = new Map<string, { id: string; dyeLotNo: string; colorCode: string | null }>();
        const taken = new Set<string>();
        const ids: string[] = [];
        let lotsCreated = 0;
        for (const [i, r] of input.rows.entries()) {
          const fabric = fabricByCode.get(r.fabricCode)!;
          let lotId: string | null = null;
          if (r.lotNo) {
            const dye = r.dyeLotNo ?? '';
            const key = `${fabric.id}|${r.lotNo}|${dye}`;
            let lot = lotCache.get(key) ?? null;
            if (!lot) {
              lot = await tx.productionLot.findUnique({
                where: { fabricId_lotNo_dyeLotNo: { fabricId: fabric.id, lotNo: r.lotNo, dyeLotNo: dye } },
              });
              if (!lot) {
                if (!input.createMissingLots) {
                  throw AppError.badRequest(`第 ${i + 1} 行：批次 ${r.lotNo}/${dye || '-'} 不存在`);
                }
                lot = await tx.productionLot.create({
                  data: { fabricId: fabric.id, lotNo: r.lotNo, dyeLotNo: dye, colorCode: r.colorCode ?? null },
                });
                lotsCreated++;
              }
              lotCache.set(key, lot);
            }
            lotId = lot.id;
          }
          const roll = await tx.fabricRoll.create({
            data: {
              rollNo: r.rollNo,
              qrCode: await this.newQrCode(tx, taken),
              fabricId: fabric.id,
              lotId,
              dyeLotNo: r.dyeLotNo ?? null,
              colorCode: r.colorCode ?? fabric.colorCode,
              nominalLengthM: r.nominalLengthM ?? null,
              notes: r.notes,
              createdById: actor.userId,
            },
          });
          ids.push(roll.id);
        }
        await this.audit.log(
          actor,
          { action: 'roll.import', entityType: 'FabricRoll', after: { count: ids.length, lotsCreated } },
          meta,
          tx,
        );
        return { ids, lotsCreated };
      },
      { timeout: 60_000 },
    );
    return { created: created.ids.length, lotsCreated: created.lotsCreated, rollIds: created.ids };
  }

  async qr(id: string) {
    const r = await this.prisma.fabricRoll.findUnique({ where: { id } });
    if (!r) throw AppError.notFound('布卷');
    const content = this.qrContent(r.qrCode);
    const svg = await QRCode.toString(content, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 });
    return { rollNo: r.rollNo, qrCode: r.qrCode, content, svg };
  }

  /** 打印标签：最多 200 卷 */
  async labels(ids: string[]) {
    if (!ids.length || ids.length > 200) throw AppError.badRequest('一次可打印 1~200 卷');
    const rolls = await this.prisma.fabricRoll.findMany({ where: { id: { in: ids } }, include: rollInclude });
    const byId = new Map(rolls.map((r) => [r.id, r]));
    const out = [];
    for (const id of ids) {
      const r = byId.get(id);
      if (!r) continue;
      const content = this.qrContent(r.qrCode);
      out.push({
        id: r.id,
        rollNo: r.rollNo,
        qrCode: r.qrCode,
        content,
        fabricCode: r.fabric.code,
        fabricName: r.fabric.nameZh,
        lotNo: r.lot?.lotNo ?? null,
        dyeLotNo: r.dyeLotNo,
        colorCode: r.colorCode,
        nominalLengthM: r.nominalLengthM,
        svg: await QRCode.toString(content, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 }),
      });
    }
    return out;
  }

  /** 扫码：返回布卷信息以及当前用户在该布卷上的进行中任务 */
  async byQr(actor: Actor, qrCode: string) {
    const roll = await this.prisma.fabricRoll.findUnique({ where: { qrCode }, include: rollInclude });
    if (!roll) throw AppError.notFound('布卷（二维码未登记）');
    const taskRolls = await this.prisma.qcTaskRoll.findMany({
      where: {
        rollId: roll.id,
        task: { assigneeId: actor.userId, status: { in: ['OPEN', 'IN_PROGRESS'] } },
      },
      include: {
        task: { select: { id: true, taskNo: true, title: true, defaultMode: true, defaultScope: true, status: true } },
        inspections: {
          where: { status: { not: 'VOIDED' } },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, status: true, revision: true, draftVersion: true },
        },
      },
    });
    return {
      roll: { ...roll, qrContent: this.qrContent(roll.qrCode) },
      myTasks: taskRolls.map((tr) => ({
        taskRollId: tr.id,
        status: tr.status,
        task: tr.task,
        inspection: tr.inspections[0] ?? null,
      })),
    };
  }

  async findIdByRollNo(rollNo: string) {
    const r = await this.prisma.fabricRoll.findUnique({ where: { rollNo }, select: { id: true } });
    if (!r) throw AppError.notFound('布卷');
    return r.id;
  }

  /** 布卷完整质检历史（含每次检验、修订、审核） */
  async history(id: string) {
    const roll = await this.get(id);
    const inspections = await this.prisma.rollInspection.findMany({
      where: { rollId: id },
      orderBy: { createdAt: 'asc' },
      include: {
        inspector: { select: { id: true, name: true, employeeNo: true } },
        task: { select: { id: true, taskNo: true, title: true } },
        revisions: { select: { revision: true, submittedAt: true }, orderBy: { revision: 'asc' } },
        reviews: {
          orderBy: { createdAt: 'asc' },
          include: { reviewer: { select: { id: true, name: true, employeeNo: true } } },
        },
        _count: { select: { defects: true, mediaLinks: true } },
      },
    });
    return {
      roll,
      inspections: inspections.map((i) => ({
        id: i.id,
        inspectionNo: i.inspectionNo,
        status: i.status,
        mode: i.mode,
        scope: i.scope,
        revision: i.revision,
        previousInspectionId: i.previousInspectionId,
        inspector: i.inspector,
        task: i.task,
        overallResult: i.overallResult,
        fourPointResult: i.fourPointResult,
        customerResult: i.customerResult,
        totalPoints: i.totalPoints,
        normalizedPoints: i.normalizedPoints,
        inspectedLengthM: i.inspectedLengthM,
        startedAt: i.startedAt,
        submittedAt: i.submittedAt,
        decidedAt: i.decidedAt,
        defectCount: i._count.defects,
        photoCount: i._count.mediaLinks,
        revisions: i.revisions,
        reviews: i.reviews,
      })),
    };
  }
}
