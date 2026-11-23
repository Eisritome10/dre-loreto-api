import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma, RolUsuario } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { validarPassword } from '../auth/auth.service';

const seleccion = {
  id: true,
  email: true,
  nombres: true,
  apellidos: true,
  rol: true,
  areaId: true,
  activo: true,
  ultimoAcceso: true,
  area: { select: { id: true, codigo: true, nombre: true } },
} as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  listar(q?: string) {
    const where: Prisma.UsuarioWhereInput = q
      ? {
          OR: [
            { nombres: { contains: q, mode: 'insensitive' } },
            { apellidos: { contains: q, mode: 'insensitive' } },
            { email: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {};
    return this.prisma.usuario.findMany({ where, select: seleccion, orderBy: [{ apellidos: 'asc' }, { nombres: 'asc' }] });
  }

  /** Lista mínima para selectores (derivar, asignar): cualquier usuario autenticado. */
  opciones() {
    return this.prisma.usuario.findMany({
      where: { activo: true },
      select: { id: true, nombres: true, apellidos: true, rol: true, areaId: true },
      orderBy: [{ apellidos: 'asc' }, { nombres: 'asc' }],
    });
  }

  async crear(actorId: string, d: { email: string; nombres: string; apellidos: string; rol: RolUsuario; areaId?: string; password: string }) {
    validarPassword(d.password);
    const email = d.email.trim().toLowerCase();
    if (await this.prisma.usuario.findUnique({ where: { email } })) throw new ConflictException('Ya existe un usuario con ese correo');
    const u = await this.prisma.usuario.create({
      data: {
        email,
        nombres: d.nombres.trim(),
        apellidos: d.apellidos.trim(),
        rol: d.rol,
        areaId: d.areaId || null,
        passwordHash: await bcrypt.hash(d.password, 10),
        debeCambiarPassword: true,
      },
      select: seleccion,
    });
    await this.audit.registrar({ usuarioId: actorId, accion: 'CREAR', entidad: 'Usuario', entidadId: u.id, detalle: { email, rol: d.rol } });
    return u;
  }

  async actualizar(actorId: string, id: string, d: { nombres?: string; apellidos?: string; rol?: RolUsuario; areaId?: string | null; activo?: boolean }) {
    const u = await this.prisma.usuario.update({
      where: { id },
      data: { ...d, areaId: d.areaId === '' ? null : d.areaId },
      select: seleccion,
    });
    await this.audit.registrar({ usuarioId: actorId, accion: 'ACTUALIZAR', entidad: 'Usuario', entidadId: id, detalle: d as Prisma.InputJsonValue });
    return u;
  }

  /** Genera una contraseña temporal y obliga a cambiarla en el próximo ingreso. */
  async restablecerPassword(actorId: string, id: string) {
    const temporal = `Tmp${randomBytes(4).toString('hex')}9`;
    await this.prisma.usuario.update({
      where: { id },
      data: { passwordHash: await bcrypt.hash(temporal, 10), debeCambiarPassword: true },
    });
    await this.audit.registrar({ usuarioId: actorId, accion: 'RESTABLECER_PASSWORD', entidad: 'Usuario', entidadId: id });
    return { passwordTemporal: temporal };
  }
}
