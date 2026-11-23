import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { UsuarioActual } from '../../common/auth.types';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: { sub: string }): Promise<UsuarioActual> {
    const u = await this.prisma.usuario.findUnique({ where: { id: payload.sub } });
    if (!u || !u.activo) throw new UnauthorizedException('Sesión no válida');
    return {
      id: u.id,
      email: u.email,
      nombres: u.nombres,
      apellidos: u.apellidos,
      rol: u.rol,
      areaId: u.areaId,
      debeCambiarPassword: u.debeCambiarPassword,
    };
  }
}
