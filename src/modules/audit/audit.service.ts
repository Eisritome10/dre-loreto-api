import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Registra una acción. Acepta un cliente de transacción para que quede atómica con el cambio. */
  async registrar(
    args: {
      usuarioId?: string | null;
      accion: string;
      entidad: string;
      entidadId: string;
      detalle?: Prisma.InputJsonValue;
    },
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    await tx.auditLog.create({
      data: {
        usuarioId: args.usuarioId ?? null,
        accion: args.accion,
        entidad: args.entidad,
        entidadId: args.entidadId,
        detalle: args.detalle ?? Prisma.JsonNull,
      },
    });
  }

  async listar(q: { entidad?: string; entidadId?: string; page: number; limit: number }) {
    const where: Prisma.AuditLogWhereInput = {
      ...(q.entidad ? { entidad: q.entidad } : {}),
      ...(q.entidadId ? { entidadId: q.entidadId } : {}),
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { fecha: 'desc' },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        include: { usuario: { select: { nombres: true, apellidos: true, email: true } } },
      }),
    ]);
    return { total, page: q.page, limit: q.limit, items };
  }
}
