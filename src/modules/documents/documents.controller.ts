import { Body, Controller, Get, Header, Param, Patch, Post, Query, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators';
import { UsuarioActual } from '../../common/auth.types';
import {
  ActualizarDocumentoDto,
  AnularDto,
  AtenderDto,
  CircuitoDto,
  CrearDocumentoDto,
  DerivarDto,
  DevolverDto,
  ListarDocumentosQuery,
  ListoDto,
} from './documents.dto';
import { DocumentsService } from './documents.service';

@ApiTags('Documentos')
@ApiBearerAuth()
@Controller()
export class DocumentsController {
  constructor(private readonly docs: DocumentsService) {}

  @Get('documents')
  listar(@CurrentUser() u: UsuarioActual, @Query() q: ListarDocumentosQuery) {
    return this.docs.listar(u, q);
  }

  @Get('documents/export')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Header('Content-Disposition', 'attachment; filename="documentos-drel.xlsx"')
  async exportar(@CurrentUser() u: UsuarioActual, @Query() q: ListarDocumentosQuery) {
    return new StreamableFile(await this.docs.exportar(u, q));
  }

  @Get('documents/inbox')
  bandeja(@CurrentUser() u: UsuarioActual) {
    return this.docs.bandeja(u);
  }

  @Get('documents/:id')
  obtener(@CurrentUser() u: UsuarioActual, @Param('id') id: string) {
    return this.docs.obtener(u, id);
  }

  @Post('documents')
  crear(@CurrentUser() u: UsuarioActual, @Body() dto: CrearDocumentoDto) {
    return this.docs.crear(u, dto);
  }

  @Patch('documents/:id')
  actualizar(@CurrentUser() u: UsuarioActual, @Param('id') id: string, @Body() dto: ActualizarDocumentoDto) {
    return this.docs.actualizar(u, id, dto);
  }

  @Post('documents/:id/derive')
  derivar(@CurrentUser() u: UsuarioActual, @Param('id') id: string, @Body() dto: DerivarDto) {
    return this.docs.derivar(u, id, dto);
  }

  @Post('documents/:id/route')
  circuito(@CurrentUser() u: UsuarioActual, @Param('id') id: string, @Body() dto: CircuitoDto) {
    return this.docs.iniciarCircuito(u, id, dto);
  }

  @Post('documents/:id/number')
  numerar(@CurrentUser() u: UsuarioActual, @Param('id') id: string) {
    return this.docs.numerar(u, id);
  }

  @Post('documents/:id/ready')
  listo(@CurrentUser() u: UsuarioActual, @Param('id') id: string, @Body() dto: ListoDto) {
    return this.docs.marcarListo(u, id, dto.listo);
  }

  @Post('documents/:id/archive')
  archivar(@CurrentUser() u: UsuarioActual, @Param('id') id: string) {
    return this.docs.archivar(u, id);
  }

  @Post('documents/:id/annul')
  anular(@CurrentUser() u: UsuarioActual, @Param('id') id: string, @Body() dto: AnularDto) {
    return this.docs.anular(u, id, dto.motivo);
  }

  @Post('derivations/:id/receive')
  recibir(@CurrentUser() u: UsuarioActual, @Param('id') id: string) {
    return this.docs.recibir(u, id);
  }

  @Post('derivations/:id/attend')
  atender(@CurrentUser() u: UsuarioActual, @Param('id') id: string, @Body() dto: AtenderDto) {
    return this.docs.atender(u, id, dto.respuesta);
  }

  @Post('derivations/:id/return')
  devolver(@CurrentUser() u: UsuarioActual, @Param('id') id: string, @Body() dto: DevolverDto) {
    return this.docs.devolver(u, id, dto.motivo);
  }
}
