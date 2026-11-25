import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AppConfig } from '../config/app-config';
import { AppError } from '../common/app-error';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
abstract class PurposeGuard implements CanActivate {
  constructor(protected readonly prisma: PrismaService, protected readonly config: AppConfig) {}
  abstract purpose(id: string): Promise<string | null | undefined>;
  async canActivate(context: ExecutionContext) {
    if (this.config.env.DEMO_RUNTIME_MODE === 'demo') return true;
    const id = context.switchToHttp().getRequest<{ params?: { id?: string } }>().params?.id;
    if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return true;
    if (await this.purpose(id) === 'TEST') throw AppError.notFound('记录');
    return true;
  }
}
@Injectable()
export class OrderPurposeGuard extends PurposeGuard {
  async purpose(id: string) { return (await this.prisma.vcansOrder.findUnique({ where: { id }, select: { purpose: true } }))?.purpose; }
}
@Injectable()
export class LotPurposeGuard extends PurposeGuard {
  async purpose(id: string) { return (await this.prisma.vcansDyeLot.findUnique({ where: { id }, select: { line: { select: { order: { select: { purpose: true } } } } } }))?.line.order.purpose; }
}
@Injectable()
export class RollPurposeGuard extends PurposeGuard {
  async purpose(id: string) {
    const roll = await this.prisma.fabricRoll.findUnique({ where: { id }, select: { fabric: { select: { purpose: true } }, vcansOrderRoll: { select: { lot: { select: { line: { select: { order: { select: { purpose: true } } } } } } } }, taskRolls: { where: { task: { purpose: 'TEST' } }, take: 1, select: { id: true } } } });
    return roll?.fabric?.purpose === 'TEST' || roll?.vcansOrderRoll?.lot.line.order.purpose === 'TEST' || roll?.taskRolls.length ? 'TEST' : null;
  }
}
@Injectable()
export class TaskPurposeGuard extends PurposeGuard {
  async purpose(id: string) { const task = await this.prisma.qcTask.findUnique({ where: { id }, select: { purpose: true, vcansOrder: { select: { purpose: true } } } }); return task?.purpose === 'TEST' || task?.vcansOrder?.purpose === 'TEST' ? 'TEST' : task?.purpose; }
}
@Injectable()
export class InspectionPurposeGuard extends PurposeGuard {
  async purpose(id: string) { const i = await this.prisma.rollInspection.findUnique({ where: { id }, select: { task: { select: { purpose: true, vcansOrder: { select: { purpose: true } } } } } }); return i?.task.purpose === 'TEST' || i?.task.vcansOrder?.purpose === 'TEST' ? 'TEST' : i?.task.purpose; }
  override async canActivate(context: ExecutionContext) {
    if (this.config.env.DEMO_RUNTIME_MODE === 'demo') return true;
    const req = context.switchToHttp().getRequest<{ params?: { id?: string; inspectionId?: string }; body?: { taskRollId?: string } }>();
    const id = req.params?.inspectionId ?? req.params?.id;
    if (id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      if (await this.purpose(id) === 'TEST') throw AppError.notFound('记录');
    }
    const taskRollId = req.body?.taskRollId;
    if (taskRollId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(taskRollId)) {
      const tr = await this.prisma.qcTaskRoll.findUnique({ where: { id: taskRollId }, select: { task: { select: { purpose: true, vcansOrder: { select: { purpose: true } } } } } });
      if (tr?.task.purpose === 'TEST' || tr?.task.vcansOrder?.purpose === 'TEST') throw AppError.notFound('记录');
    }
    return true;
  }
}
@Injectable()
export class MediaPurposeGuard extends PurposeGuard {
  async purpose(id: string) { const media = await this.prisma.mediaAsset.findUnique({ where: { id }, select: { inspectionId: true } }); if (!media?.inspectionId) return null; const inspection = await this.prisma.rollInspection.findUnique({ where: { id: media.inspectionId }, select: { task: { select: { purpose: true, vcansOrder: { select: { purpose: true } } } } } }); return inspection?.task.purpose === 'TEST' || inspection?.task.vcansOrder?.purpose === 'TEST' ? 'TEST' : inspection?.task.purpose; }
  override async canActivate(context: ExecutionContext) {
    if (this.config.env.DEMO_RUNTIME_MODE === 'demo') return true;
    const req = context.switchToHttp().getRequest<{ params?: { id?: string }; body?: { inspectionId?: string } }>();
    const inspectionId = req.body?.inspectionId;
    if (inspectionId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(inspectionId)) {
      const inspection = await this.prisma.rollInspection.findUnique({ where: { id: inspectionId }, select: { task: { select: { purpose: true, vcansOrder: { select: { purpose: true } } } } } });
      if (inspection?.task.purpose === 'TEST' || inspection?.task.vcansOrder?.purpose === 'TEST') throw AppError.notFound('记录');
    }
    return super.canActivate(context);
  }
}
