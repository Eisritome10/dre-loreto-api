import { BadRequestException, Controller, Get, HttpException, HttpStatus, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { OrigenDocumento } from '@prisma/client';
import type { Request } from 'express';
import { Public } from '../../common/decorators';
import { PrismaService } from '../../prisma/prisma.service';

const ETIQUETA_ESTADO: Record<string, string> = {
  REGISTRADO: 'Recibido en la oficina',
  DERIVADO: 'Derivado para su atención',
  EN_ATENCION: 'En atención',
  ATENDIDO: 'Atendido',
  ARCHIVADO: 'Atendido y archivado',
  ANULADO: 'Anulado',
};

/** Límite simple por IP para evitar que se recorran expedientes uno por uno. */
const intentos = new Map<string, number[]>();
function limitar(ip: string) {
  const ahora = Date.now();
  const recientes = (intentos.get(ip) ?? []).filter((t) => ahora - t < 60_000);
  if (recientes.length >= 15) throw new HttpException('Demasiadas consultas. Intente de nuevo en un minuto.', HttpStatus.TOO_MANY_REQUESTS);
  recientes.push(ahora);
  intentos.set(ip, recientes);
}

@ApiTags('Consulta pública')
@Controller('public')
export class PublicController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Consulta de estado sin iniciar sesión. Solo muestra datos no personales:
   * no devuelve remitente, destinatario ni nombres de funcionarios.
   */
  @Public()
  @Get('consulta')
  async consulta(@Req() req: Request, @Query('expediente') expediente?: string, @Query('anio') anio?: string) {
    limitar(req.ip ?? 'desconocida');
    const exp = expediente?.trim();
    if (!exp) throw new BadRequestException('Ingrese el número de expediente');
    const docs = await this.prisma.documento.findMany({
      where: { origen: OrigenDocumento.EXTERNO, numeroExpediente: exp, ...(anio ? { anio: Number(anio) } : {}) },
      include: {
        tipoDocumento: { select: { nombre: true } },
        area: { select: { nombre: true } },
        derivaciones: { orderBy: { fecha: 'asc' }, include: { aArea: { select: { nombre: true } } } },
      },
      take: 5,
    });
    return docs.map((d) => ({
      numeroExpediente: d.numeroExpediente,
      anio: d.anio,
      fechaIngreso: d.fechaIngreso,
      tipo: d.tipoDocumento.nombre,
      asunto: d.asunto,
      areaReceptora: d.area.nombre,
      estado: d.estado,
      estadoTexto: ETIQUETA_ESTADO[d.estado] ?? d.estado,
      movimientos: d.derivaciones.map((m) => ({
        fecha: m.fecha,
        descripcion: `Derivado a ${m.aArea?.nombre ?? 'un especialista'}`,
        situacion: m.estado === 'ATENDIDA' ? 'Atendido' : m.estado === 'RECIBIDA' ? 'Recibido' : m.estado === 'DEVUELTA' ? 'Devuelto' : 'Pendiente de recepción',
      })),
    }));
  }
}
