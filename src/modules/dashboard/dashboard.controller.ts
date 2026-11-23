import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators';
import { UsuarioActual } from '../../common/auth.types';
import { DashboardService } from './dashboard.service';

@ApiTags('Panel')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  /** Contadores personales ("5 por recibir, 3 por vencer") para el inicio. */
  @Get('mine')
  mine(@CurrentUser() u: UsuarioActual) {
    return this.dashboard.mios(u);
  }

  /** Indicadores del año: estados, tipos, meses, carga por responsable y tiempos. */
  @Get('summary')
  summary(@CurrentUser() u: UsuarioActual, @Query('anio') anio?: string) {
    return this.dashboard.resumen(u, anio ? Number(anio) : undefined);
  }
}
