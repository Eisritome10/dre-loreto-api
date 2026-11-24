/**
 * Apoyo para la sesión de prueba con usuarios (solo entorno local).
 *
 *   npm run prueba:verificar    comprueba que todo esté listo (servicios, usuarios, datos)
 *   npm run prueba:preparar     deja 3 documentos en la bandeja de Infraestructura, derivados por Mesa de Partes
 *   npm run prueba:reiniciar    borra lo registrado durante la prueba y vuelve a cargar los Excel
 *
 * Usa los usuarios de prueba del seed (SEED_DEMO_PASSWORD del .env).
 */
import 'dotenv/config';
import { spawnSync } from 'child_process';
import * as path from 'path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';

const API = process.env.API_URL ?? `http://localhost:${process.env.PORT ?? 3000}/api/v1`;
const WEB = process.env.WEB_URL ?? 'http://localhost:8080';
const MAIL = process.env.MAILPIT_URL ?? 'http://localhost:8025';
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? '';
const USUARIOS = ['mesa.partes', 'secretaria.infra', 'especialista.infra', 'director', 'secretaria', 'especialista'].map((u) => `${u}@drel.local`);

const ok = (t: string) => console.log(`  ✓ ${t}`);
let faltas = 0;
const falla = (t: string) => {
  faltas++;
  console.log(`  ✗ ${t}`);
};

async function http(url: string, init?: RequestInit) {
  try {
    return await fetch(url, init);
  } catch {
    return null;
  }
}

async function login(email: string): Promise<string | null> {
  const r = await http(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
  if (!r?.ok) return null;
  return ((await r.json()) as { accessToken: string }).accessToken;
}

async function api<T>(token: string, ruta: string, body?: unknown): Promise<T> {
  const r = await fetch(`${API}${ruta}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${ruta}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return (await r.json()) as T;
}

async function verificar() {
  console.log('Servicios');
  (await http(`${API}/../docs`))?.ok ? ok(`API ${API}`) : falla(`API no responde en ${API}`);
  (await http(WEB))?.ok ? ok(`Interfaz ${WEB}`) : falla(`La interfaz no responde en ${WEB} (docker compose up -d --build en dre-loreto-frontend)`);
  (await http(`${MAIL}/api/v1/info`))?.ok ? ok(`Correo de pruebas ${MAIL}`) : falla(`Mailpit no responde en ${MAIL} (docker compose up -d mailpit)`);

  console.log('Usuarios de prueba');
  if (!PASSWORD) falla('Falta SEED_DEMO_PASSWORD en el .env');
  for (const u of USUARIOS) (await login(u)) ? ok(u) : falla(`${u} no puede ingresar (ejecute npm run prisma:seed con SEED_DEMO_USERS=true)`);

  console.log('Datos');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    const infra = await prisma.documento.count({ where: { area: { codigo: 'OGAIE-EI' } } });
    infra > 1000 ? ok(`${infra.toLocaleString('es-PE')} documentos de Infraestructura importados del Excel`) : falla('Faltan los documentos importados (npm run import:excel -- --dir "../DOCUMENTOS")');
    const buscado = await prisma.documento.count({ where: { area: { codigo: 'OGAIE-EI' }, numeroExpediente: '16975' } });
    buscado ? ok('Documento de la tarea de búsqueda (IE 60778, aforo) disponible') : falla('Falta el documento de la tarea de búsqueda');
    const sucios = await prisma.documento.count({ where: { origenImportacion: null } });
    sucios === 0 ? ok('Sin documentos de pruebas anteriores') : console.log(`  · Hay ${sucios} documentos creados fuera de la importación. Use npm run prueba:reiniciar para empezar limpio.`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
  console.log(faltas ? `\n${faltas} cosa(s) por corregir antes de la sesión.` : '\nTodo listo para la sesión.');
  process.exitCode = faltas ? 1 : 0;
}

async function preparar() {
  const mesa = await login('mesa.partes@drel.local');
  if (!mesa) throw new Error('Mesa de Partes no puede ingresar: revise el seed y SEED_DEMO_PASSWORD');
  const tipos = await api<{ id: string; codigo: string }[]>(mesa, '/document-types');
  const areas = await api<{ id: string; codigo: string }[]>(mesa, '/areas');
  const solicitud = tipos.find((t) => t.codigo === 'SOLICITUD')!.id;
  const infra = areas.find((a) => a.codigo === 'OGAIE-EI')!.id;

  const casos = [
    { remitente: 'IE N° 60999 (EJEMPLO DE PRUEBA)', asunto: 'SOLICITA INSPECCION TECNICA POR FILTRACION EN EL TECHO', plazoDias: 1, urgente: true, correoContacto: 'director.ie.prueba@ejemplo.pe' },
    { remitente: 'UGEL EJEMPLO DE PRUEBA', asunto: 'REMITE INFORME DE AFORO DE LA IE N° 60999 PARA REVISION', plazoDias: 3 },
    { remitente: 'MUNICIPALIDAD DISTRITAL DE EJEMPLO', asunto: 'SOLICITA INFORMACION SOBRE EL PROGRAMA DE MANTENIMIENTO 2026', plazoDias: 5 },
  ];
  console.log('Documentos derivados a Infraestructura por Mesa de Partes:');
  for (const c of casos) {
    const d = await api<{ numeroExpediente: string; anio: number; codigoSeguimiento: string }>(mesa, '/documents', {
      origen: 'EXTERNO',
      tipoDocumentoId: solicitud,
      remitente: c.remitente,
      asunto: c.asunto,
      prioridad: c.urgente ? 'URGENTE' : 'NORMAL',
      correoContacto: c.correoContacto,
      derivarAAreaId: infra,
      plazoDias: c.plazoDias,
      indicaciones: 'Atender y responder',
      dispuestoPor: 'Jefatura de Infraestructura (prueba)',
    });
    console.log(`  · EXP ${d.numeroExpediente}/${d.anio}  código ${d.codigoSeguimiento}  ${c.asunto.slice(0, 50)}`);
  }
  console.log('\nLa bandeja de secretaria.infra@drel.local tiene 3 documentos (uno urgente y por vencer).');
}

async function reiniciar() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    console.log('Borrando documentos, numeración y auditoría…');
    await prisma.documento.deleteMany();
    await prisma.correlativo.deleteMany();
    await prisma.auditLog.deleteMany({ where: { entidad: 'Documento' } });
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
  console.log('Cargando de nuevo los Excel (unos 50 segundos)…');
  const r = spawnSync('npx', ['ts-node', 'src/scripts/import-excel.ts', '--dir', JSON.stringify(path.resolve(process.argv[3] ?? '../DOCUMENTOS'))], { stdio: 'inherit', shell: true });
  process.exitCode = r.status ?? 1;
}

const accion = process.argv[2];
const acciones: Record<string, () => Promise<void>> = { verificar, preparar, reiniciar };
if (!acciones[accion]) {
  console.error('Uso: npm run prueba:verificar | prueba:preparar | prueba:reiniciar');
  process.exit(1);
}
acciones[accion]().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
