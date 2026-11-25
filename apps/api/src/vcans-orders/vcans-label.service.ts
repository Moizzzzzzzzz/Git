import { Injectable } from '@nestjs/common';
import { RoleCode } from '@fabricqc/shared';
import type { Actor } from '../common/actor';
import { AppError } from '../common/app-error';
import { PrismaService } from '../prisma/prisma.service';
import { chooseMeasuredLength } from './measurement-choice';
import { renderRollLabels, type RollLabelInput } from './document-renderer';

@Injectable()
export class VcansLabelService {
  constructor(private readonly prisma: PrismaService) {}
  async data(actor: Actor, rollId: string, purpose: 'INITIAL' | 'REPRINT') {
    const privileged = actor.roles.some((role) => role.role === RoleCode.ADMIN || role.role === RoleCode.QUALITY_MANAGER);
    const supervisor = actor.roles.some((role) => role.role === RoleCode.QC_SUPERVISOR);
    const inspector = actor.roles.some((role) => role.role === RoleCode.INSPECTOR);
    if (!privileged && !supervisor && !inspector) throw AppError.forbidden('没有标签打印权限');
    const entry = await this.prisma.vcansOrderRoll.findUnique({ where: { rollId }, include: { roll: true, lot: { include: { line: { include: { order: true } } } }, taskRoll: { include: { inspections: { where: { status: { not: 'VOIDED' }, actualLengthM: { not: null }, submittedAt: { not: null } }, orderBy: { submittedAt: 'desc' }, take: 1, select: { actualLengthM: true, submittedAt: true } } } } } });
    if (!entry || (!privileged && !(supervisor && entry.lot.line.order.supervisorId === actor.userId) && !(inspector && entry.lot.line.order.assignedInspectorId === actor.userId))) throw AppError.forbidden('没有该布卷标签权限');
    const latestInspection = entry.taskRoll?.inspections[0];
    const number = (value: { toString(): string } | null | undefined) => value?.toString() ?? null;
    const nominalLengthM = number(entry.nominalLengthM), nominalWeightKg = number(entry.nominalWeightKg);
    const choice = chooseMeasuredLength({ value: number(entry.measuredLengthM), at: entry.measuredLengthAt }, { value: number(latestInspection?.actualLengthM ?? entry.roll.actualLengthM), at: latestInspection?.submittedAt ?? null });
    const measuredLengthM = choice.value, measuredWeightKg = number(entry.measuredWeightKg);
    const useMeasuredLength = purpose === 'REPRINT' && measuredLengthM !== null;
    const useMeasuredWeight = purpose === 'REPRINT' && measuredWeightKg !== null;
    return { rollId, rollNo: entry.roll.rollNo, qrCode: entry.roll.qrCode, hNo: entry.lot.line.order.hNo, lotNo: entry.lot.dyeLotNo, productName: entry.lot.line.productName, specification: entry.lot.line.specification, color: entry.lot.line.color, customerOrderNo: entry.lot.line.customerOrderNo, nominalLengthM, nominalWeightKg, measuredLengthM, measuredWeightKg, printLengthM: useMeasuredLength ? measuredLengthM : nominalLengthM, printWeightKg: useMeasuredWeight ? measuredWeightKg : nominalWeightKg, lengthSource: useMeasuredLength ? 'MEASURED' : nominalLengthM !== null ? 'NOMINAL' : null, measuredLengthSource: choice.source, measuredLengthAt: choice.at, weightSource: useMeasuredWeight ? 'MEASURED' : nominalWeightKg !== null ? 'NOMINAL' : null, purpose };
  }
  async pdf(actor: Actor, rollId: string, purpose: 'INITIAL' | 'REPRINT') {
    const data = await this.data(actor, rollId, purpose);
    return renderRollLabels([data as RollLabelInput]);
  }
}
