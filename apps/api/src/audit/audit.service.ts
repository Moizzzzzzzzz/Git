import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Pagination } from '@fabricqc/shared';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import type { Actor } from '../common/actor';
import type { RequestMeta } from '../common/decorators';
import { pageArgs, paged } from '../common/pagination';
import { toPlain } from '../common/serialize.interceptor';

const REDACT = new Set(['passwordHash', 'codeHash', 'refreshTokenHash', 'previousRefreshTokenHash']);

function clean(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === undefined || value === null) return Prisma.JsonNull;
  const plain = toPlain(value) as Record<string, unknown>;
  if (typeof plain === 'object' && !Array.isArray(plain)) {
    for (const k of Object.keys(plain)) if (REDACT.has(k)) plain[k] = '[REDACTED]';
  }
  return JSON.parse(JSON.stringify(plain)) as Prisma.InputJsonValue;
}

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** 写审计日志；传入 tx 时与业务操作同事务提交 */
  async log(actor: Actor | null, entry: AuditEntry, meta?: RequestMeta | null, tx?: Tx) {
    const db = tx ?? this.prisma;
    await db.auditLog.create({
      data: {
        actorId: actor?.userId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        before: clean(entry.before),
        after: clean(entry.after),
        ip: meta?.ip ?? null,
        userAgent: meta?.userAgent ?? null,
        requestId: meta?.requestId ?? null,
      },
    });
  }

  async list(p: Pagination & { entityType?: string; entityId?: string; actorId?: string }) {
    const where: Prisma.AuditLogWhereInput = {
      entityType: p.entityType || undefined,
      entityId: p.entityId || undefined,
      actorId: p.actorId || undefined,
      ...(p.q ? { action: { contains: p.q, mode: 'insensitive' } } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(p) }),
      this.prisma.auditLog.count({ where }),
    ]);
    const actorIds = [...new Set(items.map((i) => i.actorId).filter((x): x is string => !!x))];
    const actors = await this.prisma.user.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, name: true, employeeNo: true },
    });
    const byId = new Map(actors.map((a) => [a.id, a]));
    return paged(
      items.map((i) => ({ ...i, actor: i.actorId ? (byId.get(i.actorId) ?? null) : null })),
      total,
      p,
    );
  }
}
