import { EstadoDocumento, OrigenDocumento, PrioridadDocumento } from '@prisma/client';
import { IsBoolean, IsDateString, IsEmail, IsEnum, IsInt, IsOptional, IsString, Matches, Max, Min, MinLength } from 'class-validator';

const TELEFONO = /^[0-9+ ()-]{6,20}$/;

export class CrearDocumentoDto {
  @IsEnum(OrigenDocumento) origen: OrigenDocumento;
  @IsString() tipoDocumentoId: string;
  /** Solo ADMIN y DIRECTOR pueden registrar en otra área; el resto usa la suya. */
  @IsOptional() @IsString() areaId?: string;
  @IsOptional() @IsDateString() fechaIngreso?: string;
  @IsOptional() @IsDateString() fechaDocumento?: string;
  @IsOptional() @IsString() numeroDocumento?: string;
  @IsOptional() @IsString() remitente?: string;
  @IsOptional() @IsString() destinatario?: string;
  @IsString() @MinLength(3, { message: 'El asunto es obligatorio' }) asunto: string;
  @IsOptional() @IsString() referencia?: string;
  @IsOptional() @IsString() registroExterno?: string;
  @IsOptional() @IsString() numeroExpediente?: string;
  @IsOptional() @IsString() proveido?: string;
  @IsOptional() @IsString() observacion?: string;
  @IsOptional() @IsEnum(PrioridadDocumento) prioridad?: PrioridadDocumento;
  /** Contacto para avisar al usuario externo cuando su trámite avance. */
  @IsOptional() @IsEmail({}, { message: 'El correo de contacto no es válido' }) correoContacto?: string;
  @IsOptional() @Matches(TELEFONO, { message: 'El celular solo puede tener números, espacios y + - ( )' }) telefonoContacto?: string;
  /** Confirma que se registre aunque exista un documento externo igual. */
  @IsOptional() @IsBoolean() forzar?: boolean;
}

export class ActualizarDocumentoDto {
  @IsOptional() @IsDateString() fechaDocumento?: string;
  @IsOptional() @IsString() numeroDocumento?: string;
  @IsOptional() @IsString() remitente?: string;
  @IsOptional() @IsString() destinatario?: string;
  @IsOptional() @IsString() @MinLength(3) asunto?: string;
  @IsOptional() @IsString() referencia?: string;
  @IsOptional() @IsString() registroExterno?: string;
  @IsOptional() @IsString() numeroExpediente?: string;
  @IsOptional() @IsString() proveido?: string;
  @IsOptional() @IsString() observacion?: string;
  @IsOptional() @IsEnum(PrioridadDocumento) prioridad?: PrioridadDocumento;
  @IsOptional() @IsEmail({}, { message: 'El correo de contacto no es válido' }) correoContacto?: string;
  @IsOptional() @Matches(TELEFONO, { message: 'El celular solo puede tener números, espacios y + - ( )' }) telefonoContacto?: string;
}

export class ListarDocumentosQuery {
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsEnum(EstadoDocumento) estado?: EstadoDocumento;
  @IsOptional() @IsEnum(OrigenDocumento) origen?: OrigenDocumento;
  @IsOptional() @IsEnum(PrioridadDocumento) prioridad?: PrioridadDocumento;
  @IsOptional() @IsString() tipoDocumentoId?: string;
  @IsOptional() @IsString() areaId?: string;
  @IsOptional() @IsString() responsableId?: string;
  @IsOptional() @IsDateString() desde?: string;
  @IsOptional() @IsDateString() hasta?: string;
  @IsOptional() @IsInt() @Min(2000) @Max(2100) anio?: number;
  @IsOptional() @IsInt() @Min(1) page?: number;
  @IsOptional() @IsInt() @Min(1) @Max(100) limit?: number;
}

export class DerivarDto {
  @IsOptional() @IsString() aUsuarioId?: string;
  @IsOptional() @IsString() aAreaId?: string;
  @IsOptional() @IsString() indicaciones?: string;
  /** Días calendario para atender. Por defecto 3. */
  @IsOptional() @IsInt() @Min(0) @Max(60) plazoDias?: number;
}

export class AtenderDto {
  @IsString() @MinLength(3, { message: 'Escriba brevemente cómo se atendió' }) respuesta: string;
}

export class DevolverDto {
  @IsString() @MinLength(3, { message: 'Indique el motivo de la devolución' }) motivo: string;
}

export class ListoDto {
  @IsBoolean() listo: boolean;
}

export class AnularDto {
  @IsString() @MinLength(5, { message: 'Indique el motivo de la anulación (mínimo 5 caracteres)' }) motivo: string;
}
