import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RolUsuario } from '@prisma/client';
import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { UsuarioActual } from '../../common/auth.types';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DocumentsService } from '../documents/documents.service';

export const MAX_BYTES = 10 * 1024 * 1024;
const MAX_POR_DOCUMENTO = 20;

/** Se valida el contenido real (firma del archivo), no solo la extensión que declara el navegador. */
function tipoReal(b: Buffer): { mime: string; ext: string } | null {
  if (b.subarray(0, 4).toString('latin1') === '%PDF') return { mime: 'application/pdf', ext: '.pdf' };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', ext: '.jpg' };
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: '.png' };
  return null;
}

@Injectable()
export class AttachmentsService {
  private readonly dir: string;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly docs: DocumentsService,
  ) {
    this.dir = path.resolve(config.get<string>('UPLOADS_DIR') ?? './uploads');
  }

  private async documentoVisible(u: UsuarioActual, id: string) {
    const doc = await this.prisma.documento.findFirst({ where: { AND: [{ id }, this.docs.alcance(u)] }, select: { id: true, estado: true } });
    if (!doc) throw new NotFoundException('No se encontró el documento');
    return doc;
  }

  async subir(u: UsuarioActual, documentoId: string, archivo: Express.Multer.File | undefined) {
    if (u.rol === RolUsuario.CONSULTA) throw new ForbiddenException('Su perfil es de solo consulta');
    if (!archivo) throw new BadRequestException('Seleccione el archivo que desea adjuntar');
    const doc = await this.documentoVisible(u, documentoId);
    if (doc.estado === 'ANULADO') throw new BadRequestException('El documento está anulado');
    const tipo = tipoReal(archivo.buffer);
    if (!tipo) throw new BadRequestException('Solo se aceptan archivos PDF, JPG o PNG');
    if ((await this.prisma.adjunto.count({ where: { documentoId } })) >= MAX_POR_DOCUMENTO) {
      throw new BadRequestException(`Un documento admite hasta ${MAX_POR_DOCUMENTO} archivos`);
    }
    const nombreOriginal = Buffer.from(archivo.originalname, 'latin1').toString('utf8').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 150) || `documento${tipo.ext}`;
    const carpeta = path.join(this.dir, String(new Date().getUTCFullYear()));
    const guardado = `${randomUUID()}${tipo.ext}`;
    await fs.mkdir(carpeta, { recursive: true });
    await fs.writeFile(path.join(carpeta, guardado), archivo.buffer);
    const adj = await this.prisma.adjunto.create({
      data: {
        documentoId,
        nombre: nombreOriginal,
        mime: tipo.mime,
        tamano: archivo.size,
        archivo: path.posix.join(String(new Date().getUTCFullYear()), guardado),
        subidoPorId: u.id,
      },
      select: { id: true, nombre: true, mime: true, tamano: true, creadoEn: true },
    });
    await this.audit.registrar({ usuarioId: u.id, accion: 'ADJUNTAR', entidad: 'Documento', entidadId: documentoId, detalle: { nombre: nombreOriginal, tamano: archivo.size } });
    return adj;
  }

  async descargar(u: UsuarioActual, id: string) {
    const adj = await this.prisma.adjunto.findUnique({ where: { id } });
    if (!adj) throw new NotFoundException('No se encontró el archivo');
    await this.documentoVisible(u, adj.documentoId);
    const ruta = path.join(this.dir, adj.archivo);
    if (!ruta.startsWith(this.dir + path.sep)) throw new NotFoundException('No se encontró el archivo');
    try {
      return { adj, buffer: await fs.readFile(ruta) };
    } catch {
      throw new NotFoundException('El archivo ya no está disponible en el almacenamiento');
    }
  }

  async eliminar(u: UsuarioActual, id: string) {
    const adj = await this.prisma.adjunto.findUnique({ where: { id } });
    if (!adj) throw new NotFoundException('No se encontró el archivo');
    await this.documentoVisible(u, adj.documentoId);
    const puede = ([RolUsuario.ADMIN, RolUsuario.SECRETARIA, RolUsuario.DIRECTOR, RolUsuario.MESA_PARTES] as RolUsuario[]).includes(u.rol) || adj.subidoPorId === u.id;
    if (!puede) throw new ForbiddenException('No puede eliminar este archivo');
    await this.prisma.adjunto.delete({ where: { id } });
    await fs.rm(path.join(this.dir, adj.archivo), { force: true });
    await this.audit.registrar({ usuarioId: u.id, accion: 'ELIMINAR_ADJUNTO', entidad: 'Documento', entidadId: adj.documentoId, detalle: { nombre: adj.nombre } });
    return { ok: true };
  }
}
