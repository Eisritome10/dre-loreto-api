import { BadRequestException, Controller, Get, HttpException, HttpStatus, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../common/decorators';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizarCodigo } from '../documents/documents.util';

const ETIQUETA_ESTADO: Record<string, string> = {
  REGISTRADO: 'Recibido en la oficina',
  DERIVADO: 'Derivado para su atención',
  EN_ATENCION: 'En atención',
  ATENDIDO: 'Atendido',
  ARCHIVADO: 'Atendido y archivado',
  ANULADO: 'Anulado',
};

const ETIQUETA_MOVIMIENTO: Record<string, string> = {
  PENDIENTE: 'Pendiente de recepción',
  RECIBIDA: 'Recibido',
  ATENDIDA: 'Atendido',
  DEVUELTA: 'Devuelto',
};

/** Límite simple por IP para evitar que se prueben códigos al azar. */
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
   * Consulta de estado sin iniciar sesión, con el código de seguimiento que se entrega en el cargo.
   * Solo muestra datos no personales: no devuelve remitente, destinatario ni nombres de funcionarios.
   * Responde `null` si el código no corresponde a ningún trámite.
   */
  @Public()
  @Get('consulta')
  async consulta(@Req() req: Request, @Query('codigo') codigoParam?: string) {
    limitar(req.ip ?? 'desconocida');
    const codigo = normalizarCodigo(codigoParam ?? '');
    if (!codigo) throw new BadRequestException('El código de seguimiento tiene 8 letras y números, por ejemplo K7M2-9PQX');
    const d = await this.prisma.documento.findUnique({
      where: { codigoSeguimiento: codigo },
      include: {
        tipoDocumento: { select: { nombre: true } },
        area: { select: { nombre: true } },
        derivaciones: { orderBy: { fecha: 'asc' }, include: { aArea: { select: { nombre: true } } } },
      },
    });
    if (!d) return null;
    const listo = d.listoParaRecoger && d.estado !== 'ANULADO';
    return {
      codigoSeguimiento: d.codigoSeguimiento,
      numeroExpediente: d.numeroExpediente,
      anio: d.anio,
      fechaIngreso: d.fechaIngreso,
      tipo: d.tipoDocumento.nombre,
      asunto: d.asunto,
      areaReceptora: d.area.nombre,
      estado: d.estado,
      listoParaRecoger: listo,
      listoEn: listo ? d.listoEn : null,
      estadoTexto: listo ? 'Listo para recoger' : (ETIQUETA_ESTADO[d.estado] ?? d.estado),
      movimientos: d.derivaciones.map((m) => ({
        fecha: m.fecha,
        descripcion: `Derivado a ${m.aArea?.nombre ?? 'un especialista'}`,
        situacion: ETIQUETA_MOVIMIENTO[m.estado] ?? m.estado,
      })),
    };
  }
}
