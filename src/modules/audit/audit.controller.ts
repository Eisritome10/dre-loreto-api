import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RolUsuario } from '@prisma/client';
import { Roles } from '../../common/decorators';
import { AuditService } from './audit.service';

@ApiTags('Auditoría')
@ApiBearerAuth()
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Roles(RolUsuario.ADMIN, RolUsuario.DIRECTOR)
  listar(
    @Query('entidad') entidad?: string,
    @Query('entidadId') entidadId?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 30,
  ) {
    return this.audit.listar({
      entidad,
      entidadId,
      page: Math.max(1, +page),
      limit: Math.min(100, Math.max(1, +limit)),
    });
  }
}
