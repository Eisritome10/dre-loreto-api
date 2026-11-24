import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EstadoDerivacion, EstadoDocumento, OrigenDocumento, Prisma, RolUsuario } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UsuarioActual } from '../../common/auth.types';
import {
  ActualizarDocumentoDto,
  CircuitoDto,
  CrearDocumentoDto,
  DerivarDto,
  ListarDocumentosQuery,
} from './documents.dto';
import {
  claveDocumento,
  claveExpediente,
  claveRegistro,
  formatearExpediente,
  formatearNumero,
  generarCodigoSeguimiento,
  hoyLima,
  parseFecha,
  semaforo,
  siguienteCorrelativo,
  sumarDias,
} from './documents.util';

/** Registran, derivan y anulan. Mesa de Partes solo registra y deriva los documentos externos. */
const ROLES_GESTION: RolUsuario[] = [RolUsuario.ADMIN, RolUsuario.SECRETARIA, RolUsuario.DIRECTOR, RolUsuario.MESA_PARTES];
/** Además archivan, numeran al firmar y arman circuitos de vistos buenos. */
const ROLES_CIERRE: RolUsuario[] = [RolUsuario.ADMIN, RolUsuario.SECRETARIA, RolUsuario.DIRECTOR];
const ESTADOS_CERRADOS: EstadoDocumento[] = [EstadoDocumento.ANULADO, EstadoDocumento.ARCHIVADO];
const ABIERTAS: EstadoDerivacion[] = [EstadoDerivacion.PENDIENTE, EstadoDerivacion.RECIBIDA];
const PENDIENTES_O_ESPERA: EstadoDerivacion[] = [...ABIERTAS, EstadoDerivacion.EN_ESPERA];

const incluirLista = {
  tipoDocumento: { select: { id: true, codigo: true, nombre: true, prefijo: true, numeraAlFirmar: true, generaNumeracion: true } },
  area: { select: { id: true, codigo: true, nombre: true } },
  responsable: { select: { id: true, nombres: true, apellidos: true } },
} satisfies Prisma.DocumentoInclude;

/** Dónde está el documento ahora: la derivación abierta más reciente, o su oficina si no hay ninguna. */
const incluirUbicacion = {
  derivaciones: {
    where: { estado: { in: ABIERTAS } },
    orderBy: { fecha: 'desc' as const },
    take: 1,
    select: {
      estado: true,
      aArea: { select: { codigo: true, nombre: true } },
      aUsuario: { select: { nombres: true, apellidos: true } },
    },
  },
} satisfies Prisma.DocumentoInclude;

type ConUbicacion = Prisma.DocumentoGetPayload<{ include: typeof incluirLista & typeof incluirUbicacion }>;

function ubicacionActual(d: ConUbicacion) {
  const abierta = d.derivaciones[0];
  if (abierta) {
    return {
      area: abierta.aArea?.codigo ?? d.area.codigo,
      areaNombre: abierta.aArea?.nombre ?? d.area.nombre,
      persona: abierta.aUsuario ? `${abierta.aUsuario.nombres} ${abierta.aUsuario.apellidos}` : null,
      situacion: abierta.estado === EstadoDerivacion.PENDIENTE ? 'Por recibir' : 'En atención',
    };
  }
  const situacion = { REGISTRADO: 'Registrado', ATENDIDO: 'Atendido', ARCHIVADO: 'Archivado', ANULADO: 'Anulado', DERIVADO: 'Derivado', EN_ATENCION: 'En atención' }[d.estado];
  return { area: d.area.codigo, areaNombre: d.area.nombre, persona: null, situacion };
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notif: NotificationsService,
  ) {}

  /** Genera un código de seguimiento que no exista todavía. */
  private async codigoLibre(tx: Prisma.TransactionClient): Promise<string> {
    for (let i = 0; i < 10; i++) {
      const c = generarCodigoSeguimiento();
      if (!(await tx.documento.findUnique({ where: { codigoSeguimiento: c }, select: { id: true } }))) return c;
    }
    throw new ConflictException('No se pudo generar el código de seguimiento; intente de nuevo');
  }

  /** Qué documentos puede ver cada rol. */
  alcance(u: UsuarioActual): Prisma.DocumentoWhereInput {
    if (u.rol === RolUsuario.ADMIN || u.rol === RolUsuario.DIRECTOR) return {};
    if (u.rol === RolUsuario.ESPECIALISTA) {
      return {
        OR: [{ responsableId: u.id }, { creadoPorId: u.id }, { derivaciones: { some: { aUsuarioId: u.id } } }],
      };
    }
    // SECRETARIA, MESA_PARTES y CONSULTA: su área y lo derivado a su área
    return {
      OR: [
        { areaId: u.areaId ?? '__sin_area__' },
        { derivaciones: { some: { OR: [{ aUsuarioId: u.id }, ...(u.areaId ? [{ aAreaId: u.areaId }] : [])] } } },
      ],
    };
  }

  private filtros(u: UsuarioActual, q: ListarDocumentosQuery): Prisma.DocumentoWhereInput {
    const and: Prisma.DocumentoWhereInput[] = [this.alcance(u)];
    if (q.q?.trim()) {
      const t = q.q.trim();
      const campos = ['asunto', 'remitente', 'destinatario', 'numeroDocumento', 'numeroExpediente', 'registroExterno', 'referencia'];
      // "1234/2026" busca el expediente 1234 del año 2026
      const exp = t.match(/^(\d{1,9})\s*[/-]\s*(\d{4})$/);
      and.push({
        OR: [
          ...campos.map((c) => ({ [c]: { contains: t, mode: 'insensitive' as const } }) as Prisma.DocumentoWhereInput),
          ...(/^\d{1,6}$/.test(t) ? [{ numeroRegistro: Number(t) }] : []),
          ...(exp ? [{ numeroExpediente: exp[1], anio: Number(exp[2]) }] : []),
        ],
      });
    }
    if (q.estado) and.push({ estado: q.estado });
    if (q.origen) and.push({ origen: q.origen });
    if (q.prioridad) and.push({ prioridad: q.prioridad });
    if (q.tipoDocumentoId) and.push({ tipoDocumentoId: q.tipoDocumentoId });
    if (q.areaId) and.push({ areaId: q.areaId });
    if (q.responsableId) and.push({ responsableId: q.responsableId });
    if (q.anio) and.push({ anio: q.anio });
    if (q.desde) and.push({ fechaIngreso: { gte: parseFecha(q.desde) } });
    if (q.hasta) and.push({ fechaIngreso: { lte: parseFecha(q.hasta) } });
    return { AND: and };
  }

  async listar(u: UsuarioActual, q: ListarDocumentosQuery) {
    const page = q.page ?? 1;
    const limit = q.limit ?? 20;
    const where = this.filtros(u, q);
    const [total, items] = await this.prisma.$transaction([
      this.prisma.documento.count({ where }),
      this.prisma.documento.findMany({
        where,
        include: { ...incluirLista, ...incluirUbicacion },
        orderBy: [{ fechaIngreso: 'desc' }, { numeroRegistro: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return { total, page, limit, items: items.map(({ derivaciones: _d, ...doc }) => ({ ...doc, ubicacionActual: ubicacionActual({ ...doc, derivaciones: _d }) })) };
  }

  async obtener(u: UsuarioActual, id: string) {
    const doc = await this.prisma.documento.findFirst({
      where: { AND: [{ id }, this.alcance(u)] },
      include: {
        ...incluirLista,
        creadoPor: { select: { id: true, nombres: true, apellidos: true } },
        adjuntos: {
          orderBy: { creadoEn: 'asc' },
          select: { id: true, nombre: true, mime: true, tamano: true, creadoEn: true, subidoPor: { select: { nombres: true, apellidos: true } } },
        },
        derivaciones: {
          orderBy: [{ fecha: 'asc' }, { orden: 'asc' }],
          include: {
            deUsuario: { select: { id: true, nombres: true, apellidos: true } },
            aUsuario: { select: { id: true, nombres: true, apellidos: true } },
            deArea: { select: { id: true, codigo: true, nombre: true } },
            aArea: { select: { id: true, codigo: true, nombre: true } },
          },
        },
      },
    });
    if (!doc) throw new NotFoundException('No se encontró el documento');
    const historial = await this.prisma.auditLog.findMany({
      where: { entidad: 'Documento', entidadId: id },
      orderBy: { fecha: 'asc' },
      include: { usuario: { select: { nombres: true, apellidos: true } } },
    });
    const abierta = doc.derivaciones.filter((d) => ABIERTAS.includes(d.estado)).at(-1);
    return {
      ...doc,
      derivaciones: doc.derivaciones.map((d) => ({ ...d, semaforo: semaforo(d.fechaLimite, d.estado) })),
      historial,
      ubicacionActual: ubicacionActual({
        ...doc,
        derivaciones: abierta ? [{ estado: abierta.estado, aArea: abierta.aArea, aUsuario: abierta.aUsuario }] : [],
      }),
      /** Etiqueta de la carpeta física, igual que la que se rotula: oficina y año. */
      carpetaFisica: `${doc.area.codigo} ${doc.anio}`,
      /** Resoluciones y similares: aún no tienen número porque no se firmaron. */
      pendienteNumeracion: doc.origen === OrigenDocumento.EMITIDO && !doc.numeroDocumento && doc.tipoDocumento.numeraAlFirmar && doc.tipoDocumento.generaNumeracion && !doc.origenImportacion && doc.estado !== EstadoDocumento.ANULADO,
      expedienteTexto: formatearExpediente(doc.numeroExpediente, doc.anio),
    };
  }

  async crear(u: UsuarioActual, d: CrearDocumentoDto) {
    if (u.rol === RolUsuario.CONSULTA) throw new ForbiddenException('Su perfil es de solo consulta');
    if (d.origen === OrigenDocumento.EXTERNO && u.rol === RolUsuario.ESPECIALISTA) {
      throw new ForbiddenException('Los documentos externos los registra la secretaría o Mesa de Partes');
    }
    if (u.rol === RolUsuario.MESA_PARTES && d.origen !== OrigenDocumento.EXTERNO) {
      throw new ForbiddenException('Mesa de Partes solo registra documentos externos');
    }
    const areaId = (u.rol === RolUsuario.ADMIN || u.rol === RolUsuario.DIRECTOR ? d.areaId : undefined) ?? u.areaId;
    if (!areaId) throw new BadRequestException('Su usuario no tiene un área asignada; pida al administrador que la configure');
    const [area, tipo] = await Promise.all([
      this.prisma.area.findUnique({ where: { id: areaId } }),
      this.prisma.tipoDocumento.findUnique({ where: { id: d.tipoDocumentoId } }),
    ]);
    if (!area) throw new BadRequestException('El área indicada no existe');
    if (!tipo || !tipo.activo) throw new BadRequestException('El tipo de documento no es válido');
    if (d.origen === OrigenDocumento.EXTERNO && !d.remitente?.trim()) throw new BadRequestException('Indique el remitente');
    if (d.origen === OrigenDocumento.EMITIDO && !d.destinatario?.trim()) throw new BadRequestException('Indique el destinatario');
    if (u.rol === RolUsuario.MESA_PARTES && !d.derivarAAreaId) throw new BadRequestException('Indique la oficina a la que se deriva el documento');
    const destino = d.derivarAAreaId ? await this.prisma.area.findUnique({ where: { id: d.derivarAAreaId } }) : null;
    if (d.derivarAAreaId && (!destino || !destino.activo)) throw new BadRequestException('La oficina de destino no existe o está inactiva');

    const fechaIngreso = d.fechaIngreso ? parseFecha(d.fechaIngreso) : hoyLima();
    const anio = fechaIngreso.getUTCFullYear();

    if (d.origen === OrigenDocumento.EXTERNO && d.numeroDocumento?.trim() && !d.forzar) {
      const dup = await this.prisma.documento.findFirst({
        where: {
          anio,
          origen: OrigenDocumento.EXTERNO,
          estado: { not: EstadoDocumento.ANULADO },
          numeroDocumento: { equals: d.numeroDocumento.trim(), mode: 'insensitive' },
          remitente: { equals: d.remitente!.trim(), mode: 'insensitive' },
        },
        select: { id: true, numeroRegistro: true, fechaIngreso: true, asunto: true },
      });
      if (dup) {
        throw new ConflictException({
          code: 'POSIBLE_DUPLICADO',
          message: `Ya hay un documento con el mismo número y remitente (registro N° ${dup.numeroRegistro}). Si es otro trámite, confirme el registro.`,
          existente: dup,
        });
      }
    }

    const creado = await this.prisma.$transaction(async (tx) => {
      const numeroRegistro = await siguienteCorrelativo(tx, claveRegistro(d.origen, areaId, anio));
      let numeroDocumento = d.numeroDocumento?.trim() || null;
      let correlativo: number | null = null;
      if (d.origen === OrigenDocumento.EMITIDO && tipo.generaNumeracion && !numeroDocumento && !tipo.numeraAlFirmar) {
        correlativo = await siguienteCorrelativo(tx, claveDocumento(tipo.id, areaId, anio));
        numeroDocumento = formatearNumero(tipo.prefijo, correlativo, anio, area.sigla);
      }
      // Mesa de Partes asigna el N° de expediente: correlativo por año, que se reinicia cada enero
      let numeroExpediente = d.numeroExpediente?.trim() || null;
      if (area.esMesaPartes && d.origen === OrigenDocumento.EXTERNO && !numeroExpediente) {
        numeroExpediente = String(await siguienteCorrelativo(tx, claveExpediente(anio)));
      }
      const doc = await tx.documento.create({
        data: {
          origen: d.origen,
          anio,
          numeroRegistro,
          areaId,
          tipoDocumentoId: tipo.id,
          numeroDocumento,
          correlativo,
          fechaIngreso,
          fechaDocumento: d.fechaDocumento ? parseFecha(d.fechaDocumento) : null,
          fechaMesaPartes: d.fechaMesaPartes ? parseFecha(d.fechaMesaPartes) : null,
          remitente: d.remitente?.trim() || null,
          destinatario: d.destinatario?.trim() || null,
          asunto: d.asunto.trim(),
          referencia: d.referencia?.trim() || null,
          registroExterno: d.registroExterno?.trim() || null,
          numeroExpediente,
          proveido: d.proveido?.trim() || null,
          observacion: d.observacion?.trim() || null,
          prioridad: d.prioridad ?? 'NORMAL',
          estado: destino ? EstadoDocumento.DERIVADO : EstadoDocumento.REGISTRADO,
          codigoSeguimiento: await this.codigoLibre(tx),
          correoContacto: d.correoContacto?.trim().toLowerCase() || null,
          telefonoContacto: d.telefonoContacto?.trim() || null,
          creadoPorId: u.id,
        },
        include: incluirLista,
      });
      await this.audit.registrar(
        { usuarioId: u.id, accion: 'REGISTRAR', entidad: 'Documento', entidadId: doc.id, detalle: { numeroRegistro, numeroDocumento, numeroExpediente, origen: d.origen } },
        tx,
      );
      if (destino) {
        const plazo = d.plazoDias ?? 3;
        await tx.derivacion.create({
          data: {
            documentoId: doc.id,
            deUsuarioId: u.id,
            deAreaId: u.areaId,
            aAreaId: destino.id,
            indicaciones: d.indicaciones?.trim() || null,
            dispuestoPor: d.dispuestoPor?.trim() || null,
            oficioReferencia: d.oficioReferencia?.trim() || null,
            fechaLimite: sumarDias(hoyLima(), plazo),
          },
        });
        await this.audit.registrar(
          { usuarioId: u.id, accion: 'DERIVAR', entidad: 'Documento', entidadId: doc.id, detalle: { aAreaId: destino.id, aArea: destino.codigo, plazoDias: plazo, alRegistrar: true } },
          tx,
        );
      }
      return doc;
    });
    this.notif.tramite('REGISTRADO', creado);
    return creado;
  }

  async actualizar(u: UsuarioActual, id: string, d: ActualizarDocumentoDto) {
    const doc = await this.visible(u, id);
    if (doc.estado === EstadoDocumento.ANULADO) throw new BadRequestException('Un documento anulado no se puede modificar');
    if (u.rol === RolUsuario.CONSULTA) throw new ForbiddenException('Su perfil es de solo consulta');
    if (u.rol === RolUsuario.ESPECIALISTA && doc.creadoPorId !== u.id && doc.responsableId !== u.id) {
      throw new ForbiddenException('Solo puede modificar documentos suyos');
    }
    const data: Prisma.DocumentoUpdateInput = {};
    const cambios: Record<string, { antes: unknown; despues: unknown }> = {};
    const limpiar = (v?: string) => (v === undefined ? undefined : v.trim() || null);
    const campos = ['numeroDocumento', 'remitente', 'destinatario', 'referencia', 'registroExterno', 'numeroExpediente', 'proveido', 'observacion', 'correoContacto', 'telefonoContacto'] as const;
    for (const c of campos) {
      const nuevo = limpiar(d[c]);
      if (nuevo !== undefined && nuevo !== doc[c]) {
        (data as Record<string, unknown>)[c] = nuevo;
        cambios[c] = { antes: doc[c], despues: nuevo };
      }
    }
    if (d.asunto !== undefined && d.asunto.trim() !== doc.asunto) {
      data.asunto = d.asunto.trim();
      cambios.asunto = { antes: doc.asunto, despues: d.asunto.trim() };
    }
    if (d.prioridad && d.prioridad !== doc.prioridad) {
      data.prioridad = d.prioridad;
      cambios.prioridad = { antes: doc.prioridad, despues: d.prioridad };
    }
    if (d.fechaDocumento) {
      data.fechaDocumento = parseFecha(d.fechaDocumento);
      cambios.fechaDocumento = { antes: doc.fechaDocumento, despues: d.fechaDocumento };
    }
    if (d.fechaMesaPartes) {
      data.fechaMesaPartes = parseFecha(d.fechaMesaPartes);
      cambios.fechaMesaPartes = { antes: doc.fechaMesaPartes, despues: d.fechaMesaPartes };
    }
    if (!Object.keys(cambios).length) return this.obtener(u, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.documento.update({ where: { id }, data });
      await this.audit.registrar({ usuarioId: u.id, accion: 'MODIFICAR', entidad: 'Documento', entidadId: id, detalle: cambios as Prisma.InputJsonValue }, tx);
    });
    return this.obtener(u, id);
  }

  async derivar(u: UsuarioActual, id: string, d: DerivarDto) {
    const doc = await this.visible(u, id);
    if (ESTADOS_CERRADOS.includes(doc.estado)) throw new BadRequestException(`No se puede derivar un documento ${doc.estado.toLowerCase()}`);
    const puede = ROLES_GESTION.includes(u.rol) || (u.rol === RolUsuario.ESPECIALISTA && doc.responsableId === u.id);
    if (!puede) throw new ForbiddenException('No puede derivar este documento');
    if (!d.aUsuarioId && !d.aAreaId) throw new BadRequestException('Indique a quién se deriva (persona o área)');

    let aAreaId = d.aAreaId ?? null;
    if (d.aUsuarioId) {
      const dest = await this.prisma.usuario.findUnique({ where: { id: d.aUsuarioId } });
      if (!dest || !dest.activo) throw new BadRequestException('El usuario destino no existe o está inactivo');
      aAreaId = aAreaId ?? dest.areaId;
    }
    const primeraDerivacion = doc.estado === EstadoDocumento.REGISTRADO;
    const plazo = d.plazoDias ?? 3;
    await this.prisma.$transaction(async (tx) => {
      await tx.derivacion.create({
        data: {
          documentoId: id,
          deUsuarioId: u.id,
          deAreaId: u.areaId,
          aUsuarioId: d.aUsuarioId ?? null,
          aAreaId,
          indicaciones: d.indicaciones?.trim() || null,
          dispuestoPor: d.dispuestoPor?.trim() || null,
          oficioReferencia: d.oficioReferencia?.trim() || null,
          fechaLimite: sumarDias(hoyLima(), plazo),
        },
      });
      await tx.documento.update({
        where: { id },
        data: { estado: EstadoDocumento.DERIVADO, responsableId: d.aUsuarioId ?? null },
      });
      await this.audit.registrar(
        {
          usuarioId: u.id,
          accion: 'DERIVAR',
          entidad: 'Documento',
          entidadId: id,
          detalle: { aUsuarioId: d.aUsuarioId ?? null, aAreaId, indicaciones: d.indicaciones ?? null, dispuestoPor: d.dispuestoPor ?? null, oficioReferencia: d.oficioReferencia ?? null, plazoDias: plazo },
        },
        tx,
      );
    });
    if (primeraDerivacion) {
      const [full, destino] = await Promise.all([
        this.prisma.documento.findUnique({ where: { id }, include: incluirLista }),
        aAreaId ? this.prisma.area.findUnique({ where: { id: aAreaId } }) : null,
      ]);
      if (full) this.notif.tramite('DERIVADO', { ...full, area: destino ?? full.area });
    }
    return this.obtener(u, id);
  }

  /**
   * Circuito de vistos buenos: el documento pasa por varias oficinas una tras otra
   * (ej. Presupuesto → Asesoría Jurídica → Administración). Cada paso se activa cuando el anterior termina.
   */
  async iniciarCircuito(u: UsuarioActual, id: string, d: CircuitoDto) {
    const doc = await this.visible(u, id);
    if (!ROLES_CIERRE.includes(u.rol)) throw new ForbiddenException('No puede armar circuitos de vistos buenos');
    if (ESTADOS_CERRADOS.includes(doc.estado)) throw new BadRequestException(`No se puede derivar un documento ${doc.estado.toLowerCase()}`);
    if (await this.prisma.derivacion.count({ where: { documentoId: id, estado: { in: PENDIENTES_O_ESPERA } } })) {
      throw new BadRequestException('El documento ya está en trámite. Termine o devuelva las derivaciones abiertas antes de iniciar un circuito.');
    }
    const ids = d.pasos.map((p) => p.aAreaId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Una oficina no puede repetirse en el circuito');
    const areas = await this.prisma.area.findMany({ where: { id: { in: ids }, activo: true } });
    if (areas.length !== ids.length) throw new BadRequestException('Alguna oficina del circuito no existe o está inactiva');
    const plazo = d.plazoDias ?? 3;
    const base = hoyLima();
    await this.prisma.$transaction(async (tx) => {
      for (const [i, paso] of d.pasos.entries()) {
        await tx.derivacion.create({
          data: {
            documentoId: id,
            deUsuarioId: u.id,
            deAreaId: u.areaId,
            aAreaId: paso.aAreaId,
            aUsuarioId: paso.aUsuarioId ?? null,
            estado: i === 0 ? EstadoDerivacion.PENDIENTE : EstadoDerivacion.EN_ESPERA,
            esVistoBueno: true,
            orden: i + 1,
            indicaciones: d.indicaciones?.trim() || 'Visto bueno',
            dispuestoPor: d.dispuestoPor?.trim() || null,
            oficioReferencia: d.oficioReferencia?.trim() || null,
            fechaLimite: sumarDias(base, plazo),
          },
        });
      }
      await tx.documento.update({ where: { id }, data: { estado: EstadoDocumento.DERIVADO, responsableId: d.pasos[0].aUsuarioId ?? null } });
      await this.audit.registrar(
        { usuarioId: u.id, accion: 'CIRCUITO', entidad: 'Documento', entidadId: id, detalle: { pasos: d.pasos.map((p) => areas.find((a) => a.id === p.aAreaId)!.codigo), plazoDias: plazo } },
        tx,
      );
    });
    return this.obtener(u, id);
  }

  /** Activa el siguiente paso de un circuito, conservando la duración del plazo que se le dio. */
  private async activarSiguientePaso(tx: Prisma.TransactionClient, documentoId: string, usuarioId: string) {
    const siguiente = await tx.derivacion.findFirst({
      where: { documentoId, estado: EstadoDerivacion.EN_ESPERA },
      orderBy: { orden: 'asc' },
    });
    if (!siguiente) return false;
    const duracion = siguiente.fechaLimite ? Math.max(0, Math.round((siguiente.fechaLimite.getTime() - parseFecha(siguiente.fecha).getTime()) / 86400000)) : 3;
    await tx.derivacion.update({
      where: { id: siguiente.id },
      data: { estado: EstadoDerivacion.PENDIENTE, fecha: new Date(), fechaLimite: sumarDias(hoyLima(), duracion) },
    });
    await tx.documento.update({ where: { id: documentoId }, data: { estado: EstadoDocumento.DERIVADO, responsableId: siguiente.aUsuarioId ?? null } });
    await this.audit.registrar({ usuarioId, accion: 'PASO_ACTIVADO', entidad: 'Documento', entidadId: documentoId, detalle: { orden: siguiente.orden, aAreaId: siguiente.aAreaId } }, tx);
    return true;
  }

  /** Bandeja del usuario: lo que le derivaron a él o a su área y aún no se atiende. */
  async bandeja(u: UsuarioActual) {
    const items = await this.prisma.derivacion.findMany({
      where: {
        estado: { in: ABIERTAS },
        OR: [{ aUsuarioId: u.id }, ...(u.areaId ? [{ aUsuarioId: null, aAreaId: u.areaId }] : [])],
        documento: { estado: { notIn: ESTADOS_CERRADOS } },
      },
      include: {
        documento: { include: { tipoDocumento: { select: { nombre: true, prefijo: true } } } },
        deUsuario: { select: { nombres: true, apellidos: true } },
      },
      orderBy: [{ fechaLimite: 'asc' }, { fecha: 'asc' }],
    });
    return items.map((d) => ({ ...d, semaforo: semaforo(d.fechaLimite, d.estado) }));
  }

  private async derivacionPropia(u: UsuarioActual, derivacionId: string) {
    const der = await this.prisma.derivacion.findUnique({ where: { id: derivacionId }, include: { documento: true } });
    if (!der) throw new NotFoundException('No se encontró la derivación');
    const destinatario = der.aUsuarioId === u.id || (!der.aUsuarioId && !!u.areaId && der.aAreaId === u.areaId);
    if (!destinatario && u.rol !== RolUsuario.ADMIN && u.rol !== RolUsuario.DIRECTOR) {
      throw new ForbiddenException('Esta derivación no está dirigida a usted');
    }
    return der;
  }

  async recibir(u: UsuarioActual, derivacionId: string) {
    const der = await this.derivacionPropia(u, derivacionId);
    if (der.estado !== EstadoDerivacion.PENDIENTE) throw new BadRequestException('Esta derivación ya fue recibida, cerrada o aún no es su turno');
    await this.prisma.$transaction(async (tx) => {
      await tx.derivacion.update({
        where: { id: der.id },
        data: { estado: EstadoDerivacion.RECIBIDA, fechaRecepcion: new Date(), aUsuarioId: der.aUsuarioId ?? u.id },
      });
      await tx.documento.update({ where: { id: der.documentoId }, data: { estado: EstadoDocumento.EN_ATENCION, responsableId: der.aUsuarioId ?? u.id } });
      await this.audit.registrar({ usuarioId: u.id, accion: 'RECIBIR', entidad: 'Documento', entidadId: der.documentoId, detalle: { derivacionId } }, tx);
    });
    return this.obtener(u, der.documentoId);
  }

  async atender(u: UsuarioActual, derivacionId: string, respuesta: string) {
    const der = await this.derivacionPropia(u, derivacionId);
    if (!ABIERTAS.includes(der.estado)) {
      throw new BadRequestException('Esta derivación ya fue atendida o devuelta, o aún no es su turno');
    }
    let atendidoCompleto = false;
    await this.prisma.$transaction(async (tx) => {
      await tx.derivacion.update({
        where: { id: der.id },
        data: {
          estado: EstadoDerivacion.ATENDIDA,
          respuesta: respuesta.trim(),
          fechaAtencion: new Date(),
          fechaRecepcion: der.fechaRecepcion ?? new Date(),
          aUsuarioId: der.aUsuarioId ?? u.id,
        },
      });
      await this.audit.registrar({ usuarioId: u.id, accion: 'ATENDER', entidad: 'Documento', entidadId: der.documentoId, detalle: { derivacionId, respuesta, vistoBueno: der.esVistoBueno } }, tx);
      // En un circuito, terminar un paso activa el siguiente; el documento solo queda atendido al terminar el último
      if (await this.activarSiguientePaso(tx, der.documentoId, u.id)) return;
      const abiertas = await tx.derivacion.count({ where: { documentoId: der.documentoId, id: { not: der.id }, estado: { in: ABIERTAS } } });
      if (!abiertas) {
        await tx.documento.update({ where: { id: der.documentoId }, data: { estado: EstadoDocumento.ATENDIDO } });
        atendidoCompleto = true;
      }
    });
    if (atendidoCompleto) {
      const full = await this.prisma.documento.findUnique({ where: { id: der.documentoId }, include: incluirLista });
      if (full) this.notif.tramite('ATENDIDO', full);
    }
    return this.obtener(u, der.documentoId);
  }

  async devolver(u: UsuarioActual, derivacionId: string, motivo: string) {
    const der = await this.derivacionPropia(u, derivacionId);
    if (!ABIERTAS.includes(der.estado)) {
      throw new BadRequestException('Esta derivación ya fue atendida o devuelta, o aún no es su turno');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.derivacion.update({ where: { id: der.id }, data: { estado: EstadoDerivacion.DEVUELTA, respuesta: motivo.trim(), fechaAtencion: new Date() } });
      // Si se devuelve un paso del circuito, los siguientes ya no tienen sentido
      await tx.derivacion.updateMany({
        where: { documentoId: der.documentoId, estado: EstadoDerivacion.EN_ESPERA },
        data: { estado: EstadoDerivacion.DEVUELTA, respuesta: 'Circuito interrumpido: un paso anterior fue devuelto', fechaAtencion: new Date() },
      });
      const abiertas = await tx.derivacion.count({ where: { documentoId: der.documentoId, id: { not: der.id }, estado: { in: ABIERTAS } } });
      if (!abiertas) {
        await tx.documento.update({ where: { id: der.documentoId }, data: { estado: EstadoDocumento.REGISTRADO, responsableId: null } });
      }
      await this.audit.registrar({ usuarioId: u.id, accion: 'DEVOLVER', entidad: 'Documento', entidadId: der.documentoId, detalle: { derivacionId, motivo } }, tx);
    });
    return this.obtener(u, der.documentoId);
  }

  /**
   * Documentos que se numeran al firmar (resoluciones): la secretaría asigna el número cuando ya tiene la firma.
   * El número se toma del año de la firma.
   */
  async numerar(u: UsuarioActual, id: string) {
    const doc = await this.prisma.documento.findFirst({
      where: { AND: [{ id }, this.alcance(u)] },
      include: { tipoDocumento: true, area: true },
    });
    if (!doc) throw new NotFoundException('No se encontró el documento');
    if (!ROLES_CIERRE.includes(u.rol)) throw new ForbiddenException('No puede asignar números a documentos firmados');
    if (doc.origen !== OrigenDocumento.EMITIDO || !doc.tipoDocumento.numeraAlFirmar || !doc.tipoDocumento.generaNumeracion) {
      throw new BadRequestException('Este documento no se numera al firmar');
    }
    if (doc.numeroDocumento) throw new BadRequestException(`El documento ya tiene número: ${doc.numeroDocumento}`);
    if (doc.estado === EstadoDocumento.ANULADO) throw new BadRequestException('El documento está anulado');
    if (await this.prisma.derivacion.count({ where: { documentoId: id, estado: { in: PENDIENTES_O_ESPERA } } })) {
      throw new BadRequestException('Aún tiene vistos buenos o derivaciones pendientes. Numérelo cuando esté firmado.');
    }
    const anioFirma = hoyLima().getUTCFullYear();
    await this.prisma.$transaction(async (tx) => {
      const correlativo = await siguienteCorrelativo(tx, claveDocumento(doc.tipoDocumentoId, doc.areaId, anioFirma));
      const numero = formatearNumero(doc.tipoDocumento.prefijo, correlativo, anioFirma, doc.area.sigla);
      await tx.documento.update({
        where: { id },
        data: { numeroDocumento: numero, numeradoEn: new Date(), ...(anioFirma === doc.anio ? { correlativo } : {}) },
      });
      await this.audit.registrar({ usuarioId: u.id, accion: 'NUMERAR', entidad: 'Documento', entidadId: id, detalle: { numero } }, tx);
    });
    return this.obtener(u, id);
  }

  /** Avisa que el documento ya puede recogerse (o lo quita si fue un error). */
  async marcarListo(u: UsuarioActual, id: string, listo: boolean) {
    const doc = await this.visible(u, id);
    if (!ROLES_GESTION.includes(u.rol)) throw new ForbiddenException('No puede marcar documentos como listos');
    if (doc.estado === EstadoDocumento.ANULADO) throw new BadRequestException('El documento está anulado');
    if (doc.listoParaRecoger === listo) return this.obtener(u, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.documento.update({ where: { id }, data: { listoParaRecoger: listo, listoEn: listo ? new Date() : null } });
      await this.audit.registrar({ usuarioId: u.id, accion: listo ? 'LISTO' : 'LISTO_QUITADO', entidad: 'Documento', entidadId: id }, tx);
    });
    if (listo) {
      const full = await this.prisma.documento.findUnique({ where: { id }, include: incluirLista });
      if (full) this.notif.tramite('LISTO', full);
    }
    return this.obtener(u, id);
  }

  async archivar(u: UsuarioActual, id: string) {
    const doc = await this.visible(u, id);
    if (!ROLES_CIERRE.includes(u.rol)) throw new ForbiddenException('No puede archivar documentos');
    if (doc.estado !== EstadoDocumento.ATENDIDO && doc.estado !== EstadoDocumento.REGISTRADO) {
      throw new BadRequestException('Solo se archiva un documento atendido o sin derivar');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.documento.update({ where: { id }, data: { estado: EstadoDocumento.ARCHIVADO } });
      await this.audit.registrar({ usuarioId: u.id, accion: 'ARCHIVAR', entidad: 'Documento', entidadId: id }, tx);
    });
    return this.obtener(u, id);
  }

  /** Anula el documento. Su número queda registrado y no se reutiliza (trazabilidad del correlativo). */
  async anular(u: UsuarioActual, id: string, motivo: string) {
    const doc = await this.visible(u, id);
    if (!ROLES_GESTION.includes(u.rol)) throw new ForbiddenException('No puede anular documentos');
    if (doc.estado === EstadoDocumento.ANULADO) throw new BadRequestException('El documento ya está anulado');
    await this.prisma.$transaction(async (tx) => {
      await tx.derivacion.updateMany({
        where: { documentoId: id, estado: { in: PENDIENTES_O_ESPERA } },
        data: { estado: EstadoDerivacion.DEVUELTA, respuesta: 'Documento anulado', fechaAtencion: new Date() },
      });
      await tx.documento.update({ where: { id }, data: { estado: EstadoDocumento.ANULADO, anuladoMotivo: motivo.trim(), responsableId: null } });
      await this.audit.registrar({ usuarioId: u.id, accion: 'ANULAR', entidad: 'Documento', entidadId: id, detalle: { motivo } }, tx);
    });
    return this.obtener(u, id);
  }

  async exportar(u: UsuarioActual, q: ListarDocumentosQuery) {
    const docs = await this.prisma.documento.findMany({
      where: this.filtros(u, q),
      include: { ...incluirLista, ...incluirUbicacion },
      orderBy: [{ fechaIngreso: 'asc' }, { numeroRegistro: 'asc' }],
      take: 20000,
    });
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Documentos');
    ws.columns = [
      { header: 'N°', key: 'n', width: 7 },
      { header: 'Año', key: 'anio', width: 7 },
      { header: 'Fecha de ingreso', key: 'fecha', width: 16 },
      { header: 'Origen', key: 'origen', width: 11 },
      { header: 'Tipo', key: 'tipo', width: 18 },
      { header: 'N° de documento', key: 'numeroDocumento', width: 38 },
      { header: 'Remitente', key: 'remitente', width: 34 },
      { header: 'Destinatario', key: 'destinatario', width: 30 },
      { header: 'Asunto', key: 'asunto', width: 60 },
      { header: 'Referencia', key: 'referencia', width: 26 },
      { header: 'REG.', key: 'registroExterno', width: 14 },
      { header: 'EXP.', key: 'numeroExpediente', width: 14 },
      { header: 'Estado', key: 'estado', width: 13 },
      { header: 'Área', key: 'area', width: 12 },
      { header: 'Ubicación actual', key: 'ubicacion', width: 22 },
      { header: 'Responsable', key: 'responsable', width: 26 },
      { header: 'Observación', key: 'observacion', width: 36 },
    ];
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8B1E2D' } };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    for (const { derivaciones, ...d } of docs) {
      const ub = ubicacionActual({ ...d, derivaciones });
      ws.addRow({
        n: d.numeroRegistro,
        anio: d.anio,
        fecha: d.fechaIngreso,
        origen: d.origen,
        tipo: d.tipoDocumento.nombre,
        numeroDocumento: d.numeroDocumento ?? (d.origen === 'EMITIDO' ? '(se numera al firmar)' : ''),
        remitente: d.remitente,
        destinatario: d.destinatario,
        asunto: d.asunto,
        referencia: d.referencia,
        registroExterno: d.registroExterno,
        numeroExpediente: formatearExpediente(d.numeroExpediente, d.anio),
        estado: d.estado,
        area: d.area.codigo,
        ubicacion: ub.persona ? `${ub.area} · ${ub.persona}` : ub.area,
        responsable: d.responsable ? `${d.responsable.nombres} ${d.responsable.apellidos}` : '',
        observacion: d.observacion,
      });
    }
    ws.getColumn('fecha').numFmt = 'dd/mm/yyyy';
    ws.autoFilter = { from: 'A1', to: 'Q1' };
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  private async visible(u: UsuarioActual, id: string) {
    const doc = await this.prisma.documento.findFirst({ where: { AND: [{ id }, this.alcance(u)] } });
    if (!doc) throw new NotFoundException('No se encontró el documento');
    return doc;
  }
}
