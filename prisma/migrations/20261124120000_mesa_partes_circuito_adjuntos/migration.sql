-- AlterEnum
ALTER TYPE "RolUsuario" ADD VALUE 'MESA_PARTES';
ALTER TYPE "EstadoDerivacion" ADD VALUE 'EN_ESPERA';

-- AlterTable
ALTER TABLE "areas" ADD COLUMN "esMesaPartes" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "tipos_documento" ADD COLUMN "numeraAlFirmar" BOOLEAN NOT NULL DEFAULT false;
-- Las resoluciones se numeran cuando la directora ya firmó
UPDATE "tipos_documento" SET "numeraAlFirmar" = true WHERE "codigo" = 'RESOLUCION';

ALTER TABLE "documentos" ADD COLUMN "fechaMesaPartes" DATE,
ADD COLUMN "numeradoEn" TIMESTAMP(3);

ALTER TABLE "derivaciones" ADD COLUMN "dispuestoPor" TEXT,
ADD COLUMN "oficioReferencia" TEXT,
ADD COLUMN "orden" INTEGER,
ADD COLUMN "esVistoBueno" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "adjuntos" (
    "id" TEXT NOT NULL,
    "documentoId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "tamano" INTEGER NOT NULL,
    "archivo" TEXT NOT NULL,
    "subidoPorId" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "adjuntos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "adjuntos_documentoId_idx" ON "adjuntos"("documentoId");

-- AddForeignKey
ALTER TABLE "adjuntos" ADD CONSTRAINT "adjuntos_documentoId_fkey" FOREIGN KEY ("documentoId") REFERENCES "documentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "adjuntos" ADD CONSTRAINT "adjuntos_subidoPorId_fkey" FOREIGN KEY ("subidoPorId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
