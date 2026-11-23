import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RolUsuario } from '@prisma/client';
import { IsBoolean, IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { CurrentUser, Roles } from '../../common/decorators';
import { UsuarioActual } from '../../common/auth.types';
import { UsersService } from './users.service';

class CrearUsuarioDto {
  @IsEmail() email: string;
  @IsString() @MinLength(2) nombres: string;
  @IsString() @MinLength(2) apellidos: string;
  @IsEnum(RolUsuario) rol: RolUsuario;
  @IsOptional() @IsString() areaId?: string;
  @IsString() password: string;
}

class ActualizarUsuarioDto {
  @IsOptional() @IsString() @MinLength(2) nombres?: string;
  @IsOptional() @IsString() @MinLength(2) apellidos?: string;
  @IsOptional() @IsEnum(RolUsuario) rol?: RolUsuario;
  @IsOptional() @IsString() areaId?: string;
  @IsOptional() @IsBoolean() activo?: boolean;
}

@ApiTags('Usuarios')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('options')
  opciones() {
    return this.users.opciones();
  }

  @Get()
  @Roles(RolUsuario.ADMIN)
  listar(@Query('q') q?: string) {
    return this.users.listar(q);
  }

  @Post()
  @Roles(RolUsuario.ADMIN)
  crear(@CurrentUser() actor: UsuarioActual, @Body() dto: CrearUsuarioDto) {
    return this.users.crear(actor.id, dto);
  }

  @Patch(':id')
  @Roles(RolUsuario.ADMIN)
  actualizar(@CurrentUser() actor: UsuarioActual, @Param('id') id: string, @Body() dto: ActualizarUsuarioDto) {
    return this.users.actualizar(actor.id, id, dto);
  }

  @Post(':id/reset-password')
  @Roles(RolUsuario.ADMIN)
  restablecer(@CurrentUser() actor: UsuarioActual, @Param('id') id: string) {
    return this.users.restablecerPassword(actor.id, id);
  }
}
