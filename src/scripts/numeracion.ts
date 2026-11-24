/**
 * Consulta o ajusta el último número usado de cada serie (oficios, memorandos, expedientes…).
 * Sirve cuando el Excel y el sistema no coinciden y hay que continuar desde el número correcto.
 *
 *   npm run numeracion                                            lista las series
 *   npm run numeracion -- --area OGAIE-EI --tipo OFICIO --anio 2026 --ultimo 1609
 *   npm run numeracion -- --expediente 2026 --ultimo 1500         serie de expedientes de Mesa de Partes
 *
 * El siguiente documento que se genere recibirá el número `ultimo + 1`.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    const ultimo = arg('ultimo');
    if (ultimo !== undefined) {
      const n = Number(ultimo);
      if (!Number.isInteger(n) || n < 0) throw new Error('--ultimo debe ser un número entero');
      let clave: string;
      if (arg('expediente')) {
        clave = `EXP:${Number(arg('expediente'))}`;
      } else {
        const [area, tipo] = await Promise.all([
          prisma.area.findUnique({ where: { codigo: (arg('area') ?? '').toUpperCase() } }),
          prisma.tipoDocumento.findUnique({ where: { codigo: (arg('tipo') ?? '').toUpperCase() } }),
        ]);
        if (!area || !tipo || !arg('anio')) throw new Error('Indique --area, --tipo y --anio (códigos como en las pantallas de Áreas y Tipos de documento)');
        clave = `DOC:${tipo.id}:${area.id}:${Number(arg('anio'))}`;
      }
      const antes = await prisma.correlativo.findUnique({ where: { clave } });
      await prisma.correlativo.upsert({ where: { clave }, update: { ultimo: n }, create: { clave, ultimo: n } });
      console.log(`Serie actualizada: último número usado ${antes?.ultimo ?? '(sin uso)'} → ${n}. El siguiente será ${n + 1}.`);
      return;
    }
    const [series, areas, tipos] = await Promise.all([prisma.correlativo.findMany({ orderBy: { clave: 'asc' } }), prisma.area.findMany(), prisma.tipoDocumento.findMany()]);
    const area = (id: string) => areas.find((a) => a.id === id)?.codigo ?? id;
    const tipo = (id: string) => tipos.find((t) => t.id === id)?.codigo ?? id;
    console.log('Serie'.padEnd(52) + 'Último usado');
    for (const s of series) {
      const [t, a, b, c] = s.clave.split(':');
      const nombre = t === 'DOC' ? `Documento ${tipo(a)} · ${area(b)} · ${c}` : t === 'REG' ? `Registro ${a} · ${area(b)} · ${c}` : `Expediente de Mesa de Partes · ${a}`;
      console.log(nombre.padEnd(52) + s.ultimo);
    }
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
