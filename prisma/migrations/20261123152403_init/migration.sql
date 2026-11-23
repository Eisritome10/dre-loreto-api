-- CreateEnum
CREATE TYPE "RolUsuario" AS ENUM ('ADMIN', 'SECRETARIA', 'DIRECTOR', 'ESPECIALISTA', 'CONSULTA');

-- CreateEnum
CREATE TYPE "OrigenDocumento" AS ENUM ('EXTERNO', 'INTERNO', 'EMITIDO');

-- CreateEnum
CREATE TYPE "EstadoDocumento" AS ENUM ('REGISTRADO', 'DERIVADO', 'EN_ATENCION', 'ATENDIDO', 'ARCHIVADO', 'ANULADO');

-- CreateEnum
CREATE TYPE "PrioridadDocumento" AS ENUM ('NORMAL', 'URGENTE');

-- CreateEnum
CREATE TYPE "EstadoDerivacion" AS ENUM ('PENDIENTE', 'RECIBIDA', 'ATENDIDA', 'DEVUELTA');

-- CreateTable
CREATE TABLE "areas" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "sigla" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuarios" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "nombres" TEXT NOT NULL,
    "apellidos" TEXT NOT NULL,
    "rol" "RolUsuario" NOT NULL,
    "areaId" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "debeCambiarPassword" BOOLEAN NOT NULL DEFAULT false,
    "ultimoAcceso" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tipos_documento" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "prefijo" TEXT NOT NULL,
    "generaNumeracion" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tipos_documento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "correlativos" (
    "clave" TEXT NOT NULL,
    "ultimo" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "correlativos_pkey" PRIMARY KEY ("clave")
);

-- CreateTable
CREATE TABLE "documentos" (
    "id" TEXT NOT NULL,
    "origen" "OrigenDocumento" NOT NULL,
    "anio" INTEGER NOT NULL,
    "numeroRegistro" INTEGER NOT NULL,
    "areaId" TEXT NOT NULL,
    "tipoDocumentoId" TEXT NOT NULL,
    "numeroDocumento" TEXT,
    "correlativo" INTEGER,
    "fechaIngreso" DATE NOT NULL,
    "fechaDocumento" DATE,
    "remitente" TEXT,
    "destinatario" TEXT,
    "asunto" TEXT NOT NULL,
    "referencia" TEXT,
    "registroExterno" TEXT,
    "numeroExpediente" TEXT,
    "proveido" TEXT,
    "observacion" TEXT,
    "estado" "EstadoDocumento" NOT NULL DEFAULT 'REGISTRADO',
    "prioridad" "PrioridadDocumento" NOT NULL DEFAULT 'NORMAL',
    "responsableId" TEXT,
    "anuladoMotivo" TEXT,
    "origenImportacion" TEXT,
    "creadoPorId" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "derivaciones" (
    "id" TEXT NOT NULL,
    "documentoId" TEXT NOT NULL,
    "deUsuarioId" TEXT NOT NULL,
    "deAreaId" TEXT,
    "aAreaId" TEXT,
    "aUsuarioId" TEXT,
    "indicaciones" TEXT,
    "estado" "EstadoDerivacion" NOT NULL DEFAULT 'PENDIENTE',
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fechaLimite" DATE,
    "fechaRecepcion" TIMESTAMP(3),
    "fechaAtencion" TIMESTAMP(3),
    "respuesta" TEXT,

    CONSTRAINT "derivaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auditoria" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT,
    "accion" TEXT NOT NULL,
    "entidad" TEXT NOT NULL,
    "entidadId" TEXT NOT NULL,
    "detalle" JSONB,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "areas_codigo_key" ON "areas"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");

-- CreateIndex
CREATE INDEX "usuarios_areaId_idx" ON "usuarios"("areaId");

-- CreateIndex
CREATE UNIQUE INDEX "tipos_documento_codigo_key" ON "tipos_documento"("codigo");

-- CreateIndex
CREATE INDEX "documentos_fechaIngreso_idx" ON "documentos"("fechaIngreso");

-- CreateIndex
CREATE INDEX "documentos_estado_idx" ON "documentos"("estado");

-- CreateIndex
CREATE INDEX "documentos_numeroExpediente_idx" ON "documentos"("numeroExpediente");

-- CreateIndex
CREATE INDEX "documentos_responsableId_idx" ON "documentos"("responsableId");

-- CreateIndex
CREATE UNIQUE INDEX "documentos_areaId_origen_anio_numeroRegistro_key" ON "documentos"("areaId", "origen", "anio", "numeroRegistro");

-- CreateIndex
CREATE UNIQUE INDEX "documentos_tipoDocumentoId_areaId_anio_correlativo_key" ON "documentos"("tipoDocumentoId", "areaId", "anio", "correlativo");

-- CreateIndex
CREATE UNIQUE INDEX "documentos_origenImportacion_key" ON "documentos"("origenImportacion");

-- CreateIndex
CREATE INDEX "derivaciones_documentoId_idx" ON "derivaciones"("documentoId");

-- CreateIndex
CREATE INDEX "derivaciones_aUsuarioId_estado_idx" ON "derivaciones"("aUsuarioId", "estado");

-- CreateIndex
CREATE INDEX "derivaciones_aAreaId_estado_idx" ON "derivaciones"("aAreaId", "estado");

-- CreateIndex
CREATE INDEX "auditoria_entidad_entidadId_idx" ON "auditoria"("entidad", "entidadId");

-- CreateIndex
CREATE INDEX "auditoria_fecha_idx" ON "auditoria"("fecha");

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documentos" ADD CONSTRAINT "documentos_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "areas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documentos" ADD CONSTRAINT "documentos_tipoDocumentoId_fkey" FOREIGN KEY ("tipoDocumentoId") REFERENCES "tipos_documento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documentos" ADD CONSTRAINT "documentos_responsableId_fkey" FOREIGN KEY ("responsableId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documentos" ADD CONSTRAINT "documentos_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "derivaciones" ADD CONSTRAINT "derivaciones_documentoId_fkey" FOREIGN KEY ("documentoId") REFERENCES "documentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "derivaciones" ADD CONSTRAINT "derivaciones_deUsuarioId_fkey" FOREIGN KEY ("deUsuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "derivaciones" ADD CONSTRAINT "derivaciones_aUsuarioId_fkey" FOREIGN KEY ("aUsuarioId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "derivaciones" ADD CONSTRAINT "derivaciones_deAreaId_fkey" FOREIGN KEY ("deAreaId") REFERENCES "areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "derivaciones" ADD CONSTRAINT "derivaciones_aAreaId_fkey" FOREIGN KEY ("aAreaId") REFERENCES "areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auditoria" ADD CONSTRAINT "auditoria_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
