import { Controller, Get } from '@nestjs/common';
import { RoleCode } from '@fabricqc/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentActor, Roles } from '../common/decorators';
import { hasRole, REVIEWERS, type Actor } from '../common/actor';
import { AppError } from '../common/app-error';

@Controller('dashboard')
@Roles(RoleCode.ADMIN, RoleCode.QUALITY_MANAGER, RoleCode.QC_SUPERVISOR, RoleCode.SALES)
export class DashboardController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('summary')
  async summary(@CurrentActor() actor: Actor) {
    const supervisorRoles = actor.roles.filter((r) => r.role === RoleCode.QC_SUPERVISOR);
    const global = hasRole(actor, RoleCode.ADMIN, RoleCode.QUALITY_MANAGER) || supervisorRoles.some((r) => r.departmentId === null);
    if (!global && !supervisorRoles.length) throw AppError.forbidden('没有质检看板权限');
    const departments = supervisorRoles.flatMap((r) => r.departmentId ? [r.departmentId] : []);
    const taskScope: Prisma.QcTaskWhereInput = global ? {} : { OR: [{ supervisorId: actor.userId }, { reviewerId: actor.userId }, { departmentId: { in: departments } }] };
    const inspectionScope: Prisma.RollInspectionWhereInput = global ? {} : { task: taskScope };
    const rollScope: Prisma.FabricRollWhereInput = global ? {} : { taskRolls: { some: { task: taskScope } } };
    const startOfDay = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
    startOfDay.setHours(0, 0, 0, 0);
    const since30 = new Date(Date.now() - 30 * 86400_000);
    const [rollGroups, taskGroups, submittedToday, pendingReviews, myPending, results30, recent] = await Promise.all([
      this.prisma.fabricRoll.groupBy({ by: ['status'], where: rollScope, _count: true }),
      this.prisma.qcTask.groupBy({ by: ['status'], where: taskScope, _count: true }),
      this.prisma.rollInspection.count({ where: { ...inspectionScope, submittedAt: { gte: startOfDay } } }),
      this.prisma.rollInspection.count({ where: { ...inspectionScope, status: 'SUBMITTED' } }),
      hasRole(actor, ...REVIEWERS)
        ? this.prisma.reviewAssignment.count({ where: { assigneeId: actor.userId, status: 'PENDING' } })
        : Promise.resolve(0),
      this.prisma.rollInspection.groupBy({
        by: ['status'],
        where: { ...inspectionScope, decidedAt: { gte: since30 }, status: { in: ['APPROVED', 'REJECTED'] } },
        _count: true,
      }),
      this.prisma.rollInspection.findMany({
        where: { ...inspectionScope, submittedAt: { not: null } },
        orderBy: { submittedAt: 'desc' },
        take: 8,
        select: {
          id: true,
          inspectionNo: true,
          status: true,
          overallResult: true,
          submittedAt: true,
          roll: { select: { rollNo: true, fabric: { select: { code: true, nameZh: true } } } },
          inspector: { select: { name: true } },
        },
      }),
    ]);
    return {
      rollsByStatus: Object.fromEntries(rollGroups.map((g) => [g.status, g._count])),
      tasksByStatus: Object.fromEntries(taskGroups.map((g) => [g.status, g._count])),
      submittedToday,
      pendingReviews,
      myPendingReviews: myPending,
      decided30Days: Object.fromEntries(results30.map((g) => [g.status, g._count])),
      recent,
    };
  }
}
