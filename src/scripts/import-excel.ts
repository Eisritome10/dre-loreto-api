/**
 * Importa los registros de los Excel que hoy usa la secretaría a la base de datos.
 *
 *   npm run import:excel -- --dir "../DOCUMENTOS"
 *
 * - Es idempotente: cada fila importada guarda `origenImportacion` (archivo|hoja|fila)
 *   y las filas ya cargadas se omiten al repetir la importación.
 * - Al final deja los contadores de numeración en el máximo importado, de modo que el
 *   siguiente documento que genere el sistema continúe la serie del Excel.
 * - Los Excel contienen datos personales: no se versionan en el repositorio.
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import * as ExcelJS from 'exceljs';
import { PrismaPg } from '@prisma/adapter-pg';
import { OrigenDocumento, Prisma, PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { formatearNumero } from '../modules/documents/documents.util';

type Campo =
  | 'n' | 'fecha' | 'tipoTexto' | 'numeroDocumento' | 'remitente' | 'destinatario' | 'asunto'
  | 'referencia' | 'registroExterno' | 'numeroExpediente' | 'proveido' | 'observacion';

interface Hoja {
  archivo: string;
  hoja: (nombre: string) => boolean;
  area: string;
  origen: OrigenDocumento;
  /** Código fijo de TipoDocumento; si falta se deduce del texto del documento. */
  tipo?: string;
  /** Hojas de numeración: el N° del Excel es el correlativo oficial del tipo. */
  esNumeracion?: boolean;
  /** Primera fila de datos (1 = primera fila). */
  desde: number;
  /** Columnas (1 = A). Varias columnas en `observacion` se unen con " | ". */
  cols: Partial<Record<Campo, number | { col: number; etiqueta?: string }[]>>;
  fijos?: Partial<Record<Campo, string>>;
  /** No reserva números en la serie del área (los oficios son de la serie de otra oficina). */
  sinContador?: boolean;
}

const DGP = 'REGISTRO INTERNO E EXTRENO 2026-02.xlsx';
const NUM = 'NUMERACION DE OFICIOS 2026-02.xlsx';
const INFRA = 'nuevo excel enviado y corregido/EXTERNO 2026-carlos.xlsx';
const nombre = (re: RegExp) => (n: string) => re.test(n.trim());

const HOJAS: Hoja[] = [
  // ── Infraestructura (OGAIE) · Excel nuevo
  { archivo: INFRA, hoja: nombre(/^EXTERNO-2026$/), area: 'OGAIE-EI', origen: 'EXTERNO', desde: 3,
    cols: { n: 1, numeroExpediente: 2, fecha: 3, numeroDocumento: 4, remitente: 5, asunto: 6, destinatario: 7,
      observacion: [{ col: 8 }, { col: 9 }] } },
  { archivo: INFRA, hoja: nombre(/^OFICIO REMITIDOS POR INFRAESTRU/), area: 'OGAIE-EI', origen: 'INTERNO', tipo: 'OFICIO', desde: 3,
    cols: { n: 1, fecha: 2, remitente: 3, asunto: 4, referencia: 5, observacion: [{ col: 6, etiqueta: 'Especialista' }, { col: 7, etiqueta: 'Prov./Reg.' }] } },
  { archivo: INFRA, hoja: nombre(/^INTERNOS 2026$/), area: 'OGAIE-EI', origen: 'INTERNO', desde: 3,
    cols: { n: 1, fecha: 2, registroExterno: 3, numeroDocumento: 4, referencia: 5, destinatario: 6, remitente: 7, asunto: 8,
      observacion: [{ col: 9 }, { col: 10 }] } },
  { archivo: INFRA, hoja: nombre(/^OFICIOS REMITIDOS POR INFRAESTR/), area: 'OGAIE-EI', origen: 'EMITIDO', tipo: 'OFICIO', desde: 4,
    cols: { n: 1, fecha: 2, numeroDocumento: 3, referencia: 4, destinatario: 5, asunto: 6, registroExterno: 7 } },
  { archivo: INFRA, hoja: nombre(/^OFICIOS FIRMADOS POR GERENCIA/), area: 'OGAIE-EI', origen: 'EMITIDO', tipo: 'OFICIO', desde: 3,
    cols: { n: 1, fecha: 2, numeroDocumento: 3, referencia: 4, destinatario: 5, asunto: 6, observacion: 7 },
    fijos: { remitente: 'GERENCIA REGIONAL' }, sinContador: true },

  // ── DGP · registros de entrada
  { archivo: DGP, hoja: nombre(/^REGISTRO INTERNO/), area: 'DGP', origen: 'INTERNO', desde: 3,
    cols: { n: 1, fecha: 2, registroExterno: 3, numeroDocumento: 4, remitente: 5, asunto: 6, observacion: [{ col: 7, etiqueta: 'Descargo' }] } },
  { archivo: DGP, hoja: nombre(/^REGISTRO EXTERNO/), area: 'DGP', origen: 'EXTERNO', desde: 3,
    cols: { n: 1, fecha: 2, registroExterno: 3, numeroExpediente: 4, numeroDocumento: 5, remitente: 6, asunto: 7, observacion: [{ col: 8, etiqueta: 'Descargo' }] } },
  { archivo: DGP, hoja: nombre(/^RESOLUCIONES/), area: 'DGP', origen: 'EMITIDO', tipo: 'RESOLUCION', desde: 3,
    cols: { n: 1, fecha: 2, asunto: [{ col: 3 }, { col: 4 }], observacion: [{ col: 5, etiqueta: 'Responsable' }], destinatario: 7 } },

  // ── DGP · hojas de numeración (el N° es el correlativo oficial)
  { archivo: NUM, hoja: nombre(/^OFICIOS REMITIDOS$/), area: 'DGP', origen: 'EMITIDO', tipo: 'OFICIO', esNumeracion: true, desde: 3,
    cols: { n: 1, fecha: 2, asunto: 3, destinatario: 4, observacion: [{ col: 5, etiqueta: 'Especialista' }, { col: 6 }] } },
  { archivo: NUM, hoja: nombre(/^OFICIOS \(M\)$/), area: 'DGP', origen: 'EMITIDO', tipo: 'OFICIO_MULTIPLE', esNumeracion: true, desde: 3,
    cols: { n: 1, fecha: 2, destinatario: 3, asunto: 4, observacion: [{ col: 5, etiqueta: 'Especialista' }], referencia: 6 } },
  { archivo: NUM, hoja: nombre(/^MEMORANDOS$/), area: 'DGP', origen: 'EMITIDO', tipo: 'MEMORANDO', esNumeracion: true, desde: 3,
    cols: { n: 1, fecha: 2, destinatario: 3, asunto: 4, observacion: [{ col: 5, etiqueta: 'Especialista' }, { col: 6 }] } },
  { archivo: NUM, hoja: nombre(/^MEMORANDOS \(M\)$/), area: 'DGP', origen: 'EMITIDO', tipo: 'MEMORANDO_MULTIPLE', esNumeracion: true, desde: 3,
    cols: { n: 1, fecha: 2, destinatario: 3, asunto: 4, observacion: [{ col: 5, etiqueta: 'Especialista' }] } },
  { archivo: NUM, hoja: nombre(/^INFORMES$/), area: 'DGP', origen: 'EMITIDO', tipo: 'INFORME', esNumeracion: true, desde: 3,
    cols: { n: 1, fecha: 2, destinatario: 3, asunto: 4, observacion: [{ col: 5, etiqueta: 'Especialista' }, { col: 6 }] } },
  { archivo: NUM, hoja: nombre(/^PEDIDO DE REQUERIMIENTO$/), area: 'DGP', origen: 'EMITIDO', tipo: 'REQUERIMIENTO', esNumeracion: true, desde: 3,
    cols: { n: 1, fecha: 2, asunto: 3, destinatario: 4, observacion: [{ col: 5, etiqueta: 'Especialista' }] } },
];

// ───────────────────────── utilidades de celdas

function texto(v: ExcelJS.CellValue | undefined): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as unknown as Record<string, unknown>;
    if ('result' in o) return texto(o.result as ExcelJS.CellValue);
    if ('richText' in o) return (o.richText as { text: string }[]).map((r) => r.text).join('');
    if ('text' in o) return String(o.text);
    return '';
  }
  return String(v).replace(/\s+/g, ' ').trim();
}

function fechaDe(v: ExcelJS.CellValue | undefined): Date | null {
  if (v instanceof Date) return new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
  const t = texto(v);
  const m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  return null;
}

function entero(v: ExcelJS.CellValue | undefined): number | null {
  const t = texto(v).replace(/^0+(?=\d)/, '');
  return /^\d{1,7}$/.test(t) ? Number(t) : null;
}

function detectarTipo(t: string): string {
  if (/OFICIO\s*\(?\s*(M|MULT)/i.test(t)) return 'OFICIO_MULTIPLE';
  if (/OFICIO/i.test(t)) return 'OFICIO';
  if (/MEMORANDO\s*\(?\s*(M|MULT)/i.test(t)) return 'MEMORANDO_MULTIPLE';
  if (/MEMORANDO|MEMO\b/i.test(t)) return 'MEMORANDO';
  if (/INFORME/i.test(t)) return 'INFORME';
  if (/CARTA/i.test(t)) return 'CARTA';
  if (/SOLICITUD/i.test(t)) return 'SOLICITUD';
  if (/RESOLUC/i.test(t)) return 'RESOLUCION';
  if (/DIRECTIVA/i.test(t)) return 'DIRECTIVA';
  return 'OTRO';
}

/** Número correlativo que aparece en el texto, p. ej. "OFICIO Nº 04 -2026-..." -> 4. */
function numeroEnTexto(t: string): number | null {
  const m = t.match(/N\s*[º°ªo.]*\s*0*(\d{1,5})/i);
  return m ? Number(m[1]) : null;
}

const limpiarPrefijo = (t: string, re: RegExp) => t.replace(re, '').trim();

// ───────────────────────── importación

async function main() {
  const args = process.argv.slice(2);
  const dir = path.resolve(args[args.indexOf('--dir') + 1] || '../DOCUMENTOS');
  const soloHoja = args.includes('--only') ? args[args.indexOf('--only') + 1] : undefined;
  if (!fs.existsSync(dir)) throw new Error(`No existe la carpeta ${dir}. Use --dir "<carpeta con los Excel>"`);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const admin = await prisma.usuario.findUnique({ where: { email: (process.env.SEED_ADMIN_EMAIL ?? 'admin@drel.local').toLowerCase() } });
    if (!admin) throw new Error('Ejecute primero el seed (npm run prisma:seed): falta el usuario administrador.');

    const areas = new Map((await prisma.area.findMany()).map((a) => [a.codigo, a]));
    const tipos = new Map((await prisma.tipoDocumento.findMany()).map((t) => [t.codigo, t]));
    const usados = new Map<string, Set<number>>(); // areaId|origen|anio -> números en uso
    const maxRegistro = new Map<string, number>(); // clave contador REG
    const maxCorrelativo = new Map<string, number>(); // clave contador DOC
    const resumen: string[] = [];
    const libros = new Map<string, ExcelJS.Workbook>();

    for (const cfg of HOJAS) {
      const archivo = path.join(dir, cfg.archivo);
      if (!fs.existsSync(archivo)) {
        resumen.push(`SIN ARCHIVO  ${cfg.archivo}`);
        continue;
      }
      let wb = libros.get(archivo);
      if (!wb) {
        wb = new ExcelJS.Workbook();
        await wb.xlsx.readFile(archivo);
        libros.set(archivo, wb);
      }
      const ws = wb.worksheets.find((w) => cfg.hoja(w.name));
      if (!ws) {
        resumen.push(`SIN HOJA     ${cfg.archivo} :: ${cfg.hoja.toString()}`);
        continue;
      }
      if (soloHoja && !ws.name.includes(soloHoja)) continue;

      const area = areas.get(cfg.area)!;
      let creados = 0, existentes = 0, omitidos = 0, anioCorregido = 0, renumerados = 0, errores = 0;
      let ultimaFecha: Date | null = null;
      const tag = path.basename(cfg.archivo, '.xlsx');

      const filas: number[] = [];
      ws.eachRow({ includeEmpty: false }, (_r, i) => { if (i >= cfg.desde) filas.push(i); });

      for (const i of filas) {
        const fila = ws.getRow(i);
        const leer = (c: number) => fila.getCell(c).value;
        const get = (campo: Campo): string => {
          const def = cfg.cols[campo];
          if (!def) return cfg.fijos?.[campo] ?? '';
          if (typeof def === 'number') return texto(leer(def));
          return def
            .map((d) => { const t = texto(leer(d.col)); return t ? (d.etiqueta ? `${d.etiqueta}: ${t}` : t) : ''; })
            .filter(Boolean)
            .join(campo === 'asunto' ? ' ' : ' | ');
        };

        const nFila = cfg.cols.n ? entero(leer(cfg.cols.n as number)) : null;
        if (cfg.cols.n && nFila === null) { omitidos++; continue; } // fila separadora (solo una fecha) o sin N°
        const asunto = get('asunto');
        if (!asunto) { omitidos++; continue; } // separadores de fecha, filas vacías o numeradas sin usar

        const origenImportacion = `${tag}|${ws.name.trim()}|${i}`;
        if (await prisma.documento.findUnique({ where: { origenImportacion }, select: { id: true } })) { existentes++; continue; }

        let fecha = cfg.cols.fecha ? fechaDe(leer(cfg.cols.fecha as number)) : null;
        let nota = '';
        const numeroDocumentoTexto = get('numeroDocumento');
        if (!fecha) { fecha = ultimaFecha; if (fecha) nota = 'Fecha tomada de la fila anterior (celda vacía en el Excel)'; }
        if (!fecha) { omitidos++; continue; }
        // Todos los libros son del 2026: un año distinto (2025, 2023, 2066) es error de digitación
        if (fecha.getUTCFullYear() !== 2026) {
          nota = [nota, `Fecha corregida: el Excel decía ${fecha.toISOString().slice(0, 10)}`].filter(Boolean).join(' | ');
          fecha = new Date(Date.UTC(2026, fecha.getUTCMonth(), fecha.getUTCDate()));
          anioCorregido++;
        }
        ultimaFecha = fecha;
        const anio = fecha.getUTCFullYear();

        const tipoCodigo = cfg.tipo ?? detectarTipo(get('tipoTexto') || numeroDocumentoTexto);
        const tipo = tipos.get(tipoCodigo)!;
        const nExcel = nFila;

        // numeroRegistro: se respeta el N° del Excel si está libre; si no, el siguiente disponible
        const claveUso = `${area.id}|${cfg.origen}|${anio}`;
        const set = usados.get(claveUso) ?? usados.set(claveUso, new Set()).get(claveUso)!;
        let numeroRegistro = !cfg.esNumeracion && nExcel && !set.has(nExcel) ? nExcel : 0;
        if (!numeroRegistro) {
          numeroRegistro = (maxRegistro.get(claveUso) ?? 0) + 1;
          while (set.has(numeroRegistro)) numeroRegistro++;
          if (!cfg.esNumeracion && nExcel) renumerados++; // la hoja y fila de origen quedan en origenImportacion
        }
        set.add(numeroRegistro);
        maxRegistro.set(claveUso, Math.max(maxRegistro.get(claveUso) ?? 0, numeroRegistro));

        let numeroDocumento: string | null = numeroDocumentoTexto || null;
        let correlativo: number | null = null;
        if (cfg.esNumeracion && nExcel) {
          correlativo = nExcel;
          numeroDocumento = formatearNumero(tipo.prefijo, nExcel, anio, area.sigla);
        }
        const nCorr = correlativo ?? (tipo.generaNumeracion && cfg.origen === 'EMITIDO' && numeroDocumento ? numeroEnTexto(numeroDocumento) : null);
        if (nCorr && !cfg.sinContador) {
          const k = `DOC:${tipo.id}:${area.id}:${anio}`;
          maxCorrelativo.set(k, Math.max(maxCorrelativo.get(k) ?? 0, nCorr));
        }

        const expediente = limpiarPrefijo(get('numeroExpediente'), /^EXP\.?\s*N?[º°]?\s*/i) || null;
        const registroExterno = get('registroExterno') || null;
        const observacion = [get('observacion'), nota].filter(Boolean).join(' | ') || null;

        const data: Prisma.DocumentoUncheckedCreateInput = {
          origen: cfg.origen,
          anio,
          numeroRegistro,
          areaId: area.id,
          tipoDocumentoId: tipo.id,
          numeroDocumento,
          correlativo,
          fechaIngreso: fecha,
          remitente: get('remitente') || null,
          destinatario: get('destinatario') || null,
          asunto,
          referencia: get('referencia') || null,
          registroExterno,
          numeroExpediente: expediente,
          proveido: get('proveido') || null,
          observacion,
          // El Excel no dice si el trámite sigue abierto: lo importado es historial y no cuenta como pendiente
          estado: 'ARCHIVADO',
          origenImportacion,
          creadoPorId: admin.id,
        };
        try {
          await prisma.documento.create({ data });
          creados++;
        } catch (e) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && correlativo) {
            // correlativo repetido en el Excel: se guarda igual, sin reservar el número
            await prisma.documento.create({ data: { ...data, correlativo: null, observacion: [observacion, `Correlativo ${correlativo} repetido en el Excel`].filter(Boolean).join(' | ') } });
            creados++;
          } else {
            errores++;
            console.warn(`  fila ${i} de ${ws.name}: ${(e as Error).message.split('\n').pop()}`);
          }
        }
      }
      resumen.push(
        `${cfg.area.padEnd(9)} ${ws.name.trim().padEnd(34)} nuevos ${String(creados).padStart(5)} · ya cargados ${String(existentes).padStart(5)} · omitidos ${String(omitidos).padStart(5)}` +
          ` · año corregido ${anioCorregido} · renumerados ${renumerados}${errores ? ` · ERRORES ${errores}` : ''}`,
      );
    }

    // Los contadores continúan la serie del Excel
    for (const [clave, ultimo] of [
      ...[...maxRegistro].map(([k, v]) => [`REG:${k.split('|')[1]}:${k.split('|')[0]}:${k.split('|')[2]}`, v] as const),
      ...maxCorrelativo,
    ]) {
      await prisma.$executeRaw`INSERT INTO correlativos (clave, ultimo) VALUES (${clave}, ${ultimo})
        ON CONFLICT (clave) DO UPDATE SET ultimo = GREATEST(correlativos.ultimo, EXCLUDED.ultimo)`;
    }

    console.log('\nResultado de la importación:\n' + resumen.join('\n'));
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
