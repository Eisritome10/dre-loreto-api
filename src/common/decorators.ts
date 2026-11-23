import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { RolUsuario } from '@prisma/client';
import { UsuarioActual } from './auth.types';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: RolUsuario[]) => SetMetadata(ROLES_KEY, roles);

export const PUBLIC_KEY = 'public';
export const Public = () => SetMetadata(PUBLIC_KEY, true);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): UsuarioActual => {
  return ctx.switchToHttp().getRequest().user;
});
