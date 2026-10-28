import { Injectable } from '@nestjs/common';
import { RoleCode } from '@fabricqc/shared';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { hasRole, hasRoleInDepartment, VIEW_QC_RECORDS, type Actor } from '../common/actor';

export interface InspectionRef {
  id: string;
  inspectorId: string;
  status: string;
  revision: number;
  taskDepartmentId: string | null;
  inspectorDepartmentId: string | null;
}

/**
 * 检验记录的权限判断，集中在一处，Controller 与未来 MCP 入口共用。
 */
@Injectable()
export class InspectionAccess {
  constructor(private readonly prisma: PrismaService) {}

  canView(actor: Actor, i: InspectionRef): boolean {
    return i.inspectorId === actor.userId || hasRole(actor, ...VIEW_QC_RECORDS);
  }

  canEdit(actor: Actor, i: InspectionRef): boolean {
    return i.inspectorId === actor.userId && (i.status === 'DRAFT' || i.status === 'RETURNED');
  }

  /**
   * 审核权：不能审核自己的检验；被分配的审核人、质量经理、或部门范围内的质检主管。
   */
  async canReview(actor: Actor, i: InspectionRef, tx?: Tx): Promise<boolean> {
    if (i.status !== 'SUBMITTED' || i.inspectorId === actor.userId) return false;
    if (hasRole(actor, RoleCode.QUALITY_MANAGER)) return true;
    const dept = i.taskDepartmentId ?? i.inspectorDepartmentId;
    if (hasRoleInDepartment(actor, RoleCode.QC_SUPERVISOR, dept)) return true;
    const db = tx ?? this.prisma;
    const assigned = await db.reviewAssignment.findFirst({
      where: { inspectionId: i.id, revision: i.revision, assigneeId: actor.userId, status: 'PENDING' },
    });
    return Boolean(assigned);
  }

  async load(id: string, tx?: Tx): Promise<InspectionRef | null> {
    const db = tx ?? this.prisma;
    const i = await db.rollInspection.findUnique({
      where: { id },
      select: {
        id: true,
        inspectorId: true,
        status: true,
        revision: true,
        task: { select: { departmentId: true } },
        inspector: { select: { departmentId: true } },
      },
    });
    if (!i) return null;
    return {
      id: i.id,
      inspectorId: i.inspectorId,
      status: i.status,
      revision: i.revision,
      taskDepartmentId: i.task.departmentId,
      inspectorDepartmentId: i.inspector.departmentId,
    };
  }
}

/**
 * 审核人路由（DECISIONS D-014）：
 * 任务指定审核人 → 质检员直属主管 → 部门范围内的质检主管 → 全部质量经理。取第一个非空层级。
 */
@Injectable()
export class ReviewRouting {
  async resolve(
    tx: Tx,
    input: { inspectorId: string; reviewerId: string | null; departmentId: string | null },
  ): Promise<string[]> {
    const reviewerRoles = [RoleCode.QC_SUPERVISOR, RoleCode.QUALITY_MANAGER];
    const active = { status: 'ACTIVE' as const, id: { not: input.inspectorId } };

    if (input.reviewerId) {
      const r = await tx.user.findFirst({
        where: {
          AND: [{ id: input.reviewerId }, active, { roles: { some: { role: { code: { in: reviewerRoles } } } } }],
        },
      });
      if (r) return [r.id];
    }
    const inspector = await tx.user.findUnique({ where: { id: input.inspectorId } });
    if (inspector?.supervisorId) {
      const s = await tx.user.findFirst({
        where: {
          AND: [{ id: inspector.supervisorId }, active, { roles: { some: { role: { code: { in: reviewerRoles } } } } }],
        },
      });
      if (s) return [s.id];
    }
    const dept = input.departmentId ?? inspector?.departmentId ?? null;
    const supervisors = await tx.user.findMany({
      where: {
        ...active,
        roles: {
          some: {
            role: { code: RoleCode.QC_SUPERVISOR },
            OR: [{ departmentId: null }, ...(dept ? [{ departmentId: dept }] : [])],
          },
        },
      },
      select: { id: true },
    });
    if (supervisors.length) return supervisors.map((s) => s.id);
    const managers = await tx.user.findMany({
      where: { ...active, roles: { some: { role: { code: RoleCode.QUALITY_MANAGER } } } },
      select: { id: true },
    });
    return managers.map((m) => m.id);
  }
}
