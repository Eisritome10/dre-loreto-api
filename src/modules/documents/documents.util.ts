import { randomBytes } from 'crypto';
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
/** Contador de expedientes de Mesa de Partes: uno solo por año para toda la institución. */
export const claveExpediente = (anio: number) => `EXP:${anio}`;
export const claveDocumento = (tipoId: string, areaId: string, anio: number) => `DOC:${tipoId}:${areaId}:${anio}`;

/** El expediente se muestra como correlativo/año (ej. 1234/2026); si no es un número puro se deja tal cual. */
export function formatearExpediente(numero: string | null | undefined, anio: number): string | null {
  if (!numero) return null;
  return /^\d+$/.test(numero) ? `${numero}/${anio}` : numero;
}

export function formatearNumero(prefijo: string, n: number, anio: number, sigla: string) {
  return `${prefijo} N° ${String(n).padStart(3, '0')}-${anio}-${sigla}`;
}

export type Semaforo = 'SIN_PLAZO' | 'EN_PLAZO' | 'POR_VENCER' | 'VENCIDO';

/** Verde / amarillo / rojo para el plazo de atención de una derivación. */
export function semaforo(fechaLimite: Date | null, estado: string): Semaforo {
  if (!fechaLimite || estado === 'ATENDIDA' || estado === 'DEVUELTA' || estado === 'EN_ESPERA') return 'SIN_PLAZO';
  const dias = Math.round((fechaLimite.getTime() - hoyLima().getTime()) / (24 * 3600 * 1000));
  if (dias < 0) return 'VENCIDO';
  if (dias <= 1) return 'POR_VENCER';
  return 'EN_PLAZO';
}

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0/O ni 1/I para que no se confundan al dictar o leer

/** Código de seguimiento de 8 caracteres (XXXX-XXXX): ~850 mil millones de combinaciones. */
export function generarCodigoSeguimiento(): string {
  const bytes = randomBytes(8);
  const c = Array.from(bytes, (b) => ALFABETO[b % ALFABETO.length]).join('');
  return `${c.slice(0, 4)}-${c.slice(4)}`;
}

/** Acepta el código con o sin guion, espacios o minúsculas. */
export function normalizarCodigo(s: string): string | null {
  const limpio = s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return limpio.length === 8 ? `${limpio.slice(0, 4)}-${limpio.slice(4)}` : null;
}
