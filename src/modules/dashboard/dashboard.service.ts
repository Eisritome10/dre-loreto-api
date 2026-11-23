import { Injectable } from '@nestjs/common';
import { EstadoDerivacion, EstadoDocumento, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UsuarioActual } from '../../common/auth.types';
import { DocumentsService } from '../documents/documents.service';
import { hoyLima, semaforo } from '../documents/documents.util';

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly docs: DocumentsService,
  ) {}

  async mios(u: UsuarioActual) {
    const bandeja = await this.docs.bandeja(u);
    const abiertas = bandeja.filter((d) => d.estado === EstadoDerivacion.PENDIENTE || d.estado === EstadoDerivacion.RECIBIDA);
    return {
      porRecibir: abiertas.filter((d) => d.estado === EstadoDerivacion.PENDIENTE).length,
      enAtencion: abiertas.filter((d) => d.estado === EstadoDerivacion.RECIBIDA).length,
      porVencer: abiertas.filter((d) => semaforo(d.fechaLimite, d.estado) === 'POR_VENCER').length,
      vencidas: abiertas.filter((d) => semaforo(d.fechaLimite, d.estado) === 'VENCIDO').length,
      urgentes: abiertas.filter((d) => d.documento.prioridad === 'URGENTE').length,
    };
  }

  async resumen(u: UsuarioActual, anioParam?: number) {
    const anio = anioParam ?? hoyLima().getUTCFullYear();
    const where: Prisma.DocumentoWhereInput = { AND: [this.docs.alcance(u), { anio }] };

    const [docs, tipos, areas] = await Promise.all([
      this.prisma.documento.findMany({
        where,
        select: { fechaIngreso: true, estado: true, origen: true, tipoDocumentoId: true, responsableId: true, areaId: true },
      }),
      this.prisma.tipoDocumento.findMany({ select: { id: true, nombre: true } }),
      this.prisma.area.findMany({ select: { id: true, codigo: true } }),
    ]);

    const contar = <T extends string>(valores: T[]) =>
      valores.reduce<Record<string, number>>((acc, v) => ((acc[v] = (acc[v] ?? 0) + 1), acc), {});

    const porEstado = contar(docs.map((d) => d.estado));
    const porOrigen = contar(docs.map((d) => d.origen));
    const nombreTipo = new Map(tipos.map((t) => [t.id, t.nombre]));
    const porTipo = Object.entries(contar(docs.map((d) => d.tipoDocumentoId)))
      .map(([id, total]) => ({ tipo: nombreTipo.get(id) ?? id, total }))
      .sort((a, b) => b.total - a.total);
    const codigoArea = new Map(areas.map((a) => [a.id, a.codigo]));
    const porArea = Object.entries(contar(docs.map((d) => d.areaId)))
      .map(([id, total]) => ({ area: codigoArea.get(id) ?? id, total }))
      .sort((a, b) => b.total - a.total);
    const meses = Array.from({ length: 12 }, (_, i) => ({ mes: i + 1, total: 0 }));
    docs.forEach((d) => (meses[d.fechaIngreso.getUTCMonth()].total += 1));

    const abiertosIds = docs.filter((d) => d.responsableId && !['ATENDIDO', 'ARCHIVADO', 'ANULADO'].includes(d.estado)).map((d) => d.responsableId!);
    const responsables = await this.prisma.usuario.findMany({
      where: { id: { in: [...new Set(abiertosIds)] } },
      select: { id: true, nombres: true, apellidos: true },
    });
    const pendientesPorResponsable = Object.entries(contar(abiertosIds))
      .map(([id, total]) => {
        const r = responsables.find((x) => x.id === id);
        return { responsable: r ? `${r.nombres} ${r.apellidos}` : id, total };
      })
      .sort((a, b) => b.total - a.total);

    const atendidas = await this.prisma.derivacion.findMany({
      where: { estado: EstadoDerivacion.ATENDIDA, documento: where, fechaAtencion: { not: null } },
      select: { fecha: true, fechaAtencion: true },
    });
    const dias = atendidas.map((d) => (d.fechaAtencion!.getTime() - d.fecha.getTime()) / 86400000);
    const tiempoPromedioAtencionDias = dias.length ? Math.round((dias.reduce((a, b) => a + b, 0) / dias.length) * 10) / 10 : null;

    return {
      anio,
      total: docs.length,
      pendientes: docs.filter((d) => ([EstadoDocumento.REGISTRADO, EstadoDocumento.DERIVADO, EstadoDocumento.EN_ATENCION] as EstadoDocumento[]).includes(d.estado)).length,
      porEstado,
      porOrigen,
      porTipo,
      porArea,
      porMes: meses,
      pendientesPorResponsable,
      tiempoPromedioAtencionDias,
    };
  }
}
