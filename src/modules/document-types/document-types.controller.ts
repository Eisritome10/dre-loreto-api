import { Body, ConflictException, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RolUsuario } from '@prisma/client';
import { IsBoolean, IsOptional, IsString, Matches, MinLength } from 'class-validator';
import { CurrentUser, Roles } from '../../common/decorators';
import { UsuarioActual } from '../../common/auth.types';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

class CrearTipoDto {
  @IsString() @Matches(/^[A-Z0-9_]{2,30}$/, { message: 'El código debe ir en mayúsculas, sin espacios (ej. OFICIO_MULTIPLE)' }) codigo: string;
  @IsString() @MinLength(3) nombre: string;
  @IsString() @MinLength(2) prefijo: string;
  @IsOptional() @IsBoolean() generaNumeracion?: boolean;
}

class ActualizarTipoDto {
  @IsOptional() @IsString() @MinLength(3) nombre?: string;
  @IsOptional() @IsString() @MinLength(2) prefijo?: string;
  @IsOptional() @IsBoolean() generaNumeracion?: boolean;
  @IsOptional() @IsBoolean() activo?: boolean;
}

@ApiTags('Tipos de documento')
@ApiBearerAuth()
@Controller('document-types')
export class DocumentTypesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  listar() {
    return this.prisma.tipoDocumento.findMany({ orderBy: { nombre: 'asc' } });
  }

  @Post()
  @Roles(RolUsuario.ADMIN)
  async crear(@CurrentUser() actor: UsuarioActual, @Body() dto: CrearTipoDto) {
    if (await this.prisma.tipoDocumento.findUnique({ where: { codigo: dto.codigo } })) {
      throw new ConflictException('Ya existe un tipo de documento con ese código');
    }
    const tipo = await this.prisma.tipoDocumento.create({ data: dto });
    await this.audit.registrar({ usuarioId: actor.id, accion: 'CREAR', entidad: 'TipoDocumento', entidadId: tipo.id, detalle: { ...dto } });
    return tipo;
  }

  @Patch(':id')
  @Roles(RolUsuario.ADMIN)
  async actualizar(@CurrentUser() actor: UsuarioActual, @Param('id') id: string, @Body() dto: ActualizarTipoDto) {
    const tipo = await this.prisma.tipoDocumento.update({ where: { id }, data: dto });
    await this.audit.registrar({ usuarioId: actor.id, accion: 'ACTUALIZAR', entidad: 'TipoDocumento', entidadId: id, detalle: { ...dto } });
    return tipo;
  }
}
