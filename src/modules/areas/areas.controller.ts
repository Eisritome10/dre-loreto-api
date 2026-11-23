import { Body, ConflictException, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RolUsuario } from '@prisma/client';
import { IsBoolean, IsOptional, IsString, Matches, MinLength } from 'class-validator';
import { CurrentUser, Roles } from '../../common/decorators';
import { UsuarioActual } from '../../common/auth.types';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

class CrearAreaDto {
  @IsString() @Matches(/^[A-Z0-9-]{2,20}$/, { message: 'El código debe ir en mayúsculas, sin espacios (ej. DGP, OGAIE-EI)' }) codigo: string;
  @IsString() @MinLength(3) nombre: string;
  @IsString() @MinLength(2) sigla: string;
}

class ActualizarAreaDto {
  @IsOptional() @IsString() @MinLength(3) nombre?: string;
  @IsOptional() @IsString() @MinLength(2) sigla?: string;
  @IsOptional() @IsBoolean() activo?: boolean;
}

@ApiTags('Áreas')
@ApiBearerAuth()
@Controller('areas')
export class AreasController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  listar() {
    return this.prisma.area.findMany({ orderBy: { codigo: 'asc' } });
  }

  @Post()
  @Roles(RolUsuario.ADMIN)
  async crear(@CurrentUser() actor: UsuarioActual, @Body() dto: CrearAreaDto) {
    if (await this.prisma.area.findUnique({ where: { codigo: dto.codigo } })) throw new ConflictException('Ya existe un área con ese código');
    const area = await this.prisma.area.create({ data: dto });
    await this.audit.registrar({ usuarioId: actor.id, accion: 'CREAR', entidad: 'Area', entidadId: area.id, detalle: { ...dto } });
    return area;
  }

  @Patch(':id')
  @Roles(RolUsuario.ADMIN)
  async actualizar(@CurrentUser() actor: UsuarioActual, @Param('id') id: string, @Body() dto: ActualizarAreaDto) {
    const area = await this.prisma.area.update({ where: { id }, data: dto });
    await this.audit.registrar({ usuarioId: actor.id, accion: 'ACTUALIZAR', entidad: 'Area', entidadId: id, detalle: { ...dto } });
    return area;
  }
}
