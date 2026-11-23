import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { UsuarioActual } from '../../common/auth.types';

export function validarPassword(password: string) {
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw new BadRequestException('La contraseña debe tener al menos 8 caracteres, con letras y números');
  }
}

const usuarioPublico = {
  id: true,
  email: true,
  nombres: true,
  apellidos: true,
  rol: true,
  areaId: true,
  debeCambiarPassword: true,
  area: { select: { id: true, codigo: true, nombre: true } },
} as const;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  async login(email: string, password: string) {
    const u = await this.prisma.usuario.findUnique({ where: { email: email.trim().toLowerCase() } });
    const ok = u?.activo && (await bcrypt.compare(password, u.passwordHash));
    if (!u || !ok) throw new UnauthorizedException('Correo o contraseña incorrectos');
    await this.prisma.usuario.update({ where: { id: u.id }, data: { ultimoAcceso: new Date() } });
    await this.audit.registrar({ usuarioId: u.id, accion: 'LOGIN', entidad: 'Usuario', entidadId: u.id });
    return { accessToken: await this.jwt.signAsync({ sub: u.id }), user: await this.me(u.id) };
  }

  me(id: string) {
    return this.prisma.usuario.findUniqueOrThrow({ where: { id }, select: usuarioPublico });
  }

  async cambiarPassword(user: UsuarioActual, actual: string, nueva: string) {
    const u = await this.prisma.usuario.findUniqueOrThrow({ where: { id: user.id } });
    if (!(await bcrypt.compare(actual, u.passwordHash))) throw new BadRequestException('La contraseña actual no es correcta');
    validarPassword(nueva);
    await this.prisma.usuario.update({
      where: { id: u.id },
      data: { passwordHash: await bcrypt.hash(nueva, 10), debeCambiarPassword: false },
    });
    await this.audit.registrar({ usuarioId: u.id, accion: 'CAMBIO_PASSWORD', entidad: 'Usuario', entidadId: u.id });
    return { ok: true };
  }
}
