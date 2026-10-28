import { Controller, Get } from '@nestjs/common';
import { RoleCode } from '@fabricqc/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentActor, Roles } from '../common/decorators';
import { hasRole, REVIEWERS, type Actor } from '../common/actor';

@Controller('dashboard')
@Roles(RoleCode.ADMIN, RoleCode.QUALITY_MANAGER, RoleCode.QC_SUPERVISOR, RoleCode.SALES)
export class DashboardController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('summary')
  async summary(@CurrentActor() actor: Actor) {
    const startOfDay = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
    startOfDay.setHours(0, 0, 0, 0);
    const since30 = new Date(Date.now() - 30 * 86400_000);
    const [rollGroups, taskGroups, submittedToday, pendingReviews, myPending, results30, recent] = await Promise.all([
      this.prisma.fabricRoll.groupBy({ by: ['status'], _count: true }),
      this.prisma.qcTask.groupBy({ by: ['status'], _count: true }),
      this.prisma.rollInspection.count({ where: { submittedAt: { gte: startOfDay } } }),
      this.prisma.rollInspection.count({ where: { status: 'SUBMITTED' } }),
      hasRole(actor, ...REVIEWERS)
        ? this.prisma.reviewAssignment.count({ where: { assigneeId: actor.userId, status: 'PENDING' } })
        : Promise.resolve(0),
      this.prisma.rollInspection.groupBy({
        by: ['status'],
        where: { decidedAt: { gte: since30 }, status: { in: ['APPROVED', 'REJECTED'] } },
        _count: true,
      }),
      this.prisma.rollInspection.findMany({
        where: { submittedAt: { not: null } },
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
