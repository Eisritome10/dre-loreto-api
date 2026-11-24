import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, RolUsuario } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const BASE = 'GRL-GGR-GREL';

const AREAS: { codigo: string; nombre: string; sigla: string; esMesaPartes?: boolean }[] = [
  { codigo: 'MESA-PARTES', nombre: 'Mesa de Partes', sigla: `${BASE}-MP`, esMesaPartes: true },
  { codigo: 'DGP', nombre: 'Dirección General Pedagógica', sigla: `${BASE}-DGP` },
  { codigo: 'OGAIE-EI', nombre: 'OGAIE - Equipo de Infraestructura', sigla: `${BASE}-OGAIE/EI` },
  { codigo: 'OGAIE', nombre: 'Oficina de Gestión Administrativa, Infraestructura y Equipamiento', sigla: `${BASE}-OGAIE` },
  { codigo: 'GERENCIA', nombre: 'Gerencia Regional de Educación', sigla: `${BASE}-G` },
  { codigo: 'DGI', nombre: 'Dirección de Gestión Institucional', sigla: `${BASE}-DGI` },
  { codigo: 'OAJ', nombre: 'Oficina de Asesoría Jurídica', sigla: `${BASE}-OAJ` },
  { codigo: 'UPER', nombre: 'Unidad de Personal', sigla: `${BASE}-UPER` },
  // Oficinas citadas en la entrevista; las siglas son provisionales hasta recibir el documento oficial
  { codigo: 'DIRECCION', nombre: 'Dirección Regional de Educación', sigla: `GRL-GGR-DREL-D` },
  { codigo: 'PRESUPUESTO', nombre: 'Oficina de Presupuesto', sigla: `${BASE}-OPP` },
  { codigo: 'ADMINISTRACION', nombre: 'Oficina de Administración', sigla: `${BASE}-ADM` },
  { codigo: 'CPAD', nombre: 'Comisión Permanente de Procesos Administrativos Disciplinarios', sigla: `${BASE}-DGP-CPAD` },
];

const TIPOS = [
  { codigo: 'OFICIO', nombre: 'Oficio', prefijo: 'OFICIO', generaNumeracion: true },
  { codigo: 'OFICIO_MULTIPLE', nombre: 'Oficio múltiple', prefijo: 'OFICIO (M)', generaNumeracion: true },
  { codigo: 'MEMORANDO', nombre: 'Memorando', prefijo: 'MEMORANDO', generaNumeracion: true },
  { codigo: 'MEMORANDO_MULTIPLE', nombre: 'Memorando múltiple', prefijo: 'MEMORANDO (M)', generaNumeracion: true },
  { codigo: 'INFORME', nombre: 'Informe', prefijo: 'INFORME', generaNumeracion: true },
  { codigo: 'CARTA', nombre: 'Carta', prefijo: 'CARTA', generaNumeracion: true },
  { codigo: 'RESOLUCION', nombre: 'Resolución', prefijo: 'RESOLUCIÓN DIRECTORAL', generaNumeracion: true, numeraAlFirmar: true },
  { codigo: 'REQUERIMIENTO', nombre: 'Pedido de requerimiento', prefijo: 'REQUERIMIENTO', generaNumeracion: true },
  { codigo: 'DIRECTIVA', nombre: 'Directiva', prefijo: 'DIRECTIVA', generaNumeracion: true },
  { codigo: 'SOLICITUD', nombre: 'Solicitud', prefijo: 'SOLICITUD', generaNumeracion: false },
  { codigo: 'OTRO', nombre: 'Otro documento', prefijo: 'DOCUMENTO', generaNumeracion: false },
];

async function main() {
  for (const a of AREAS) {
    await prisma.area.upsert({ where: { codigo: a.codigo }, update: a.esMesaPartes ? { esMesaPartes: true } : {}, create: a });
  }
  for (const t of TIPOS) {
    await prisma.tipoDocumento.upsert({ where: { codigo: t.codigo }, update: {}, create: t });
  }

  const areas = Object.fromEntries((await prisma.area.findMany()).map((a) => [a.codigo, a.id]));

  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? 'admin@drel.local').toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (adminPassword && !(await prisma.usuario.findUnique({ where: { email: adminEmail } }))) {
    await prisma.usuario.create({
      data: {
        email: adminEmail,
        nombres: 'Administrador',
        apellidos: 'Sistema',
        rol: RolUsuario.ADMIN,
        areaId: areas['DGP'],
        passwordHash: await bcrypt.hash(adminPassword, 10),
      },
    });
    console.log(`Usuario administrador creado: ${adminEmail}`);
  }

  // Usuarios de prueba: solo si SEED_DEMO_USERS=true (entorno local).
  if (process.env.SEED_DEMO_USERS === 'true' && process.env.SEED_DEMO_PASSWORD) {
    const passwordHash = await bcrypt.hash(process.env.SEED_DEMO_PASSWORD, 10);
    const demo = [
      { email: 'secretaria@drel.local', nombres: 'Secretaria', apellidos: 'DGP', rol: RolUsuario.SECRETARIA, area: 'DGP' },
      { email: 'director@drel.local', nombres: 'Director', apellidos: 'DGP', rol: RolUsuario.DIRECTOR, area: 'DGP' },
      { email: 'especialista@drel.local', nombres: 'Especialista', apellidos: 'DGP', rol: RolUsuario.ESPECIALISTA, area: 'DGP' },
      { email: 'consulta@drel.local', nombres: 'Consulta', apellidos: 'DGP', rol: RolUsuario.CONSULTA, area: 'DGP' },
      { email: 'especialista.infra@drel.local', nombres: 'Especialista', apellidos: 'Infraestructura', rol: RolUsuario.ESPECIALISTA, area: 'OGAIE-EI' },
      { email: 'mesa.partes@drel.local', nombres: 'Mesa de Partes', apellidos: 'DREL', rol: RolUsuario.MESA_PARTES, area: 'MESA-PARTES' },
      { email: 'secretaria.infra@drel.local', nombres: 'Secretaria', apellidos: 'Infraestructura', rol: RolUsuario.SECRETARIA, area: 'OGAIE-EI' },
    ];
    for (const d of demo) {
      await prisma.usuario.upsert({
        where: { email: d.email },
        update: {},
        create: { email: d.email, nombres: d.nombres, apellidos: d.apellidos, rol: d.rol, areaId: areas[d.area], passwordHash },
      });
    }
    console.log('Usuarios de prueba listos (ver .env.example).');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
