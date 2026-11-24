import { Controller, Delete, Get, Param, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators';
import { UsuarioActual } from '../../common/auth.types';
import { AttachmentsService, MAX_BYTES } from './attachments.service';

@ApiTags('Adjuntos')
@ApiBearerAuth()
@Controller()
export class AttachmentsController {
  constructor(private readonly adjuntos: AttachmentsService) {}

  /** Documento escaneado (PDF, JPG o PNG, hasta 10 MB). Campo multipart: `archivo`. */
  @Post('documents/:id/attachments')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('archivo', { limits: { fileSize: MAX_BYTES, files: 1 } }))
  subir(@CurrentUser() u: UsuarioActual, @Param('id') id: string, @UploadedFile() archivo?: Express.Multer.File) {
    return this.adjuntos.subir(u, id, archivo);
  }

  @Get('attachments/:id/download')
  async descargar(@CurrentUser() u: UsuarioActual, @Param('id') id: string, @Res() res: Response) {
    const { adj, buffer } = await this.adjuntos.descargar(u, id);
    res.set({
      'Content-Type': adj.mime,
      'Content-Length': String(buffer.length),
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(adj.nombre)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    res.send(buffer);
  }

  @Delete('attachments/:id')
  eliminar(@CurrentUser() u: UsuarioActual, @Param('id') id: string) {
    return this.adjuntos.eliminar(u, id);
  }
}
