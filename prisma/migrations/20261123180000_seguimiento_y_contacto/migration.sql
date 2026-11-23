-- AlterTable
ALTER TABLE "documentos" ADD COLUMN     "codigoSeguimiento" TEXT,
ADD COLUMN     "correoContacto" TEXT,
ADD COLUMN     "listoEn" TIMESTAMP(3),
ADD COLUMN     "listoParaRecoger" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "telefonoContacto" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "documentos_codigoSeguimiento_key" ON "documentos"("codigoSeguimiento");
