import { Prisma } from '@prisma/client';

/** Fecha de hoy en Lima (UTC-5) como Date a medianoche UTC, apta para columnas @db.Date. */
export function hoyLima(): Date {
  const d = new Date(Date.now() - 5 * 3600 * 1000);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function parseFecha(s: string | Date): Date {
  if (s instanceof Date) return new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()));
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function sumarDias(base: Date, dias: number): Date {
  return new Date(base.getTime() + dias * 24 * 3600 * 1000);
}

/**
 * Incrementa y devuelve un contador de forma atómica (INSERT ... ON CONFLICT).
 * Dos usuarios que piden número al mismo tiempo nunca reciben el mismo.
 */
export async function siguienteCorrelativo(tx: Prisma.TransactionClient, clave: string): Promise<number> {
  const rows = await tx.$queryRaw<{ ultimo: number }[]>`
    INSERT INTO correlativos (clave, ultimo) VALUES (${clave}, 1)
    ON CONFLICT (clave) DO UPDATE SET ultimo = correlativos.ultimo + 1
    RETURNING ultimo`;
  return Number(rows[0].ultimo);
}

export const claveRegistro = (origen: string, areaId: string, anio: number) => `REG:${origen}:${areaId}:${anio}`;
export const claveDocumento = (tipoId: string, areaId: string, anio: number) => `DOC:${tipoId}:${areaId}:${anio}`;

export function formatearNumero(prefijo: string, n: number, anio: number, sigla: string) {
  return `${prefijo} N° ${String(n).padStart(3, '0')}-${anio}-${sigla}`;
}

export type Semaforo = 'SIN_PLAZO' | 'EN_PLAZO' | 'POR_VENCER' | 'VENCIDO';

/** Verde / amarillo / rojo para el plazo de atención de una derivación. */
export function semaforo(fechaLimite: Date | null, estado: string): Semaforo {
  if (!fechaLimite || estado === 'ATENDIDA' || estado === 'DEVUELTA') return 'SIN_PLAZO';
  const dias = Math.round((fechaLimite.getTime() - hoyLima().getTime()) / (24 * 3600 * 1000));
  if (dias < 0) return 'VENCIDO';
  if (dias <= 1) return 'POR_VENCER';
  return 'EN_PLAZO';
}
