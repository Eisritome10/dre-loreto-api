/**
 * Crea usuarios reales desde un CSV (no se versiona: contiene datos personales).
 *
 *   npm run import:users -- --file usuarios.csv
 *
 * Columnas: email,nombres,apellidos,rol,area[,password]
 *   rol  = ADMIN | SECRETARIA | DIRECTOR | ESPECIALISTA | CONSULTA
 *   area = código del área (DGP, OGAIE-EI, ...)
 * Si no se indica contraseña se genera una temporal. Todos deben cambiarla al ingresar.
 * Los usuarios que ya existen se omiten.
 */
import 'dotenv/config';
import * as fs from 'fs';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, RolUsuario } from '@prisma/client';
import { Pool } from 'pg';

async function main() {
  const args = process.argv.slice(2);
  const file = args[args.indexOf('--file') + 1];
  if (!file || !fs.existsSync(file)) throw new Error('Indique el archivo: npm run import:users -- --file usuarios.csv');

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    const areas = new Map((await prisma.area.findMany()).map((a) => [a.codigo, a.id]));
    const filas = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
    const separador = filas[0].includes(';') ? ';' : ',';
    const [cab, ...datos] = filas.map((l) => l.split(separador).map((c) => c.trim()));
    const col = (f: string[], n: string) => f[cab.indexOf(n)] ?? '';
    const entregar: string[] = [];

    for (const f of datos) {
      const email = col(f, 'email').toLowerCase();
      const rol = col(f, 'rol').toUpperCase() as RolUsuario;
      const area = col(f, 'area').toUpperCase();
      if (!email || !col(f, 'nombres')) continue;
      if (!Object.values(RolUsuario).includes(rol)) { console.warn(`OMITIDO ${email}: rol "${rol}" no válido`); continue; }
      if (area && !areas.has(area)) { console.warn(`OMITIDO ${email}: el área "${area}" no existe`); continue; }
      if (await prisma.usuario.findUnique({ where: { email } })) { console.log(`ya existe  ${email}`); continue; }
      const password = col(f, 'password') || `Tmp${randomBytes(4).toString('hex')}9`;
      await prisma.usuario.create({
        data: {
          email,
          nombres: col(f, 'nombres'),
          apellidos: col(f, 'apellidos'),
          rol,
          areaId: area ? areas.get(area)! : null,
          passwordHash: await bcrypt.hash(password, 10),
          debeCambiarPassword: true,
        },
      });
      console.log(`creado     ${email} (${rol}${area ? ` · ${area}` : ''})`);
      if (!col(f, 'password')) entregar.push(`${email}  ${password}`);
    }
    if (entregar.length) console.log('\nContraseñas temporales (entréguelas y no las guarde):\n' + entregar.join('\n'));
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
