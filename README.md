# dre-loreto-api

API del **Sistema de Trámite Documentario de la DRE Loreto**, parte del proyecto de Responsabilidad Social Organizacional (RSO) *"Transformación digital inclusiva"* de la Gerencia de Sistemas de Información.

Reemplaza el control en Excel de la secretaría (registro externo e interno, numeración de oficios, memorandos, informes, requerimientos y resoluciones) por un sistema con numeración sin duplicados, derivación a especialistas, plazos, historial y reportes.

Stack: NestJS 12 · Prisma 7 · PostgreSQL 17 · JWT · Docker. Frontend: [dre-loreto-frontend](https://github.com/Eisritome10/dre-loreto-frontend).

## Qué resuelve (del levantamiento de requerimientos)

| Problema en el Excel | Cómo lo resuelve el sistema |
|---|---|
| Dos especialistas toman el mismo número de oficio | Correlativo atómico por tipo, área y año (`INSERT … ON CONFLICT`) |
| El mismo oficio registrado varias veces | Aviso de posible duplicado (mismo N° de documento y remitente); se puede confirmar si es otro trámite |
| Fechas con el año equivocado | La fecha por defecto es la de hoy (Lima) y el año se deduce de ella |
| Firma física de recepción del especialista | Recepción digital con fecha y hora (`/derivations/:id/receive`) |
| No se sabe en qué estado está un trámite | Estados, historial completo y consulta pública sin datos personales |
| El usuario llama para saber en qué va su trámite | Código de seguimiento, consulta pública, aviso de "listo para recoger" y avisos por correo |
| Un documento anulado deja huecos en la serie | Anulación con motivo: el número queda registrado y no se reutiliza |
| Reportes manuales para el Director | `/dashboard/summary` y exportación a Excel con los mismos filtros del listado |

## Requisitos

- Node.js 22 o superior
- Docker Desktop

## Puesta en marcha (solo local)

```bash
cp .env.example .env
npm install
docker compose up -d postgres mailpit # PostgreSQL en localhost:5433 y correo de pruebas en http://localhost:8025
npx prisma migrate deploy            # crea las tablas
npm run prisma:seed                  # áreas, tipos de documento y usuarios de prueba
npm run start:dev                    # API en http://localhost:3000/api/v1
```

Documentación interactiva (Swagger): <http://localhost:3000/api/docs>

También se puede levantar todo en contenedores (aplica migraciones y seed al iniciar):

```bash
docker compose up -d --build
```

### Usuarios de prueba

El seed crea un administrador y, con `SEED_DEMO_USERS=true`, un usuario por perfil. Los correos y las contraseñas de prueba están en [`.env.example`](.env.example) (`SEED_ADMIN_*` y `SEED_DEMO_PASSWORD`). **Son solo para el entorno local**: cambie los valores y ponga `SEED_DEMO_USERS=false` en cualquier otro entorno.

| Correo | Perfil | Área |
|---|---|---|
| `admin@drel.local` | ADMIN | DGP |
| `secretaria@drel.local` | SECRETARIA | DGP |
| `director@drel.local` | DIRECTOR | DGP |
| `especialista@drel.local` | ESPECIALISTA | DGP |
| `consulta@drel.local` | CONSULTA | DGP |
| `secretaria.infra@drel.local` | SECRETARIA | OGAIE-EI (Infraestructura) |

## Perfiles y permisos

| Perfil | Qué ve | Qué puede hacer |
|---|---|---|
| ADMIN | Todo | Todo, más usuarios, áreas y tipos de documento |
| DIRECTOR | Todo | Registrar, derivar, archivar, anular, reportes y auditoría |
| SECRETARIA | Su área y lo derivado a ella | Registrar (incluye externos), derivar, archivar, anular |
| ESPECIALISTA | Lo que se le asignó o creó | Recibir, atender, devolver, derivar lo suyo y pedir número de documentos emitidos |
| CONSULTA | Su área | Solo lectura |

## Modelo de datos

- **Documento**: `origen` (`EXTERNO` entra desde otra entidad, `INTERNO` circula entre áreas, `EMITIDO` lo elabora el área y se numera), tipo, número de documento, remitente, destinatario, asunto, referencia, `REG.` y `EXP.` externos, estado y responsable.
- **Derivación**: de usuario/área a usuario/área, con indicaciones, plazo (semáforo verde/amarillo/rojo), recepción, atención y respuesta.
- **Correlativo**: contador atómico por clave (`REG:origen:área:año` y `DOC:tipo:área:año`).
- **Estados**: `REGISTRADO → DERIVADO → EN_ATENCION → ATENDIDO → ARCHIVADO` y `ANULADO`.
- **Auditoría**: quién hizo qué y cuándo (registrar, modificar con el antes y el después, derivar, recibir, atender, anular…).

## Importar los Excel actuales

```bash
npm run import:excel -- --dir "../DOCUMENTOS"
```

Lee los libros de la secretaría de la DGP y el Excel corregido de Infraestructura (`nuevo excel enviado y corregido/EXTERNO 2026-carlos.xlsx`) y los carga como documentos.

- Es **idempotente**: cada fila guarda su hoja y fila de origen (`origenImportacion`) y no se vuelve a cargar.
- Corrige fechas con año distinto de 2026 y deja la nota en la observación.
- Al terminar actualiza los contadores, así que el siguiente número que genere el sistema continúa la serie del Excel.
- Los Excel contienen datos personales: **no se versionan** en este repositorio.

## Cargar los usuarios reales

Copie `usuarios.ejemplo.csv` a `usuarios.csv` (está en `.gitignore`), reemplace las filas por el personal real y ejecute:

```bash
npm run import:users -- --file usuarios.csv
```

Si no se indica contraseña, se genera una temporal que se muestra una sola vez; cada persona debe cambiarla al ingresar. Los usuarios existentes se omiten.

## Seguimiento del trámite para el usuario externo

El usuario que presenta un trámite **no necesita cuenta**: se le entrega un cargo con un *código de seguimiento* (8 caracteres, p. ej. `K7M2-9PQX`, sin 0/O/1/I para evitar confusiones).

1. **Cargo de recepción**: al registrar un documento externo, el sistema genera el código y la interfaz muestra el cargo imprimible con un QR.
2. **Consulta pública**: `GET /api/v1/public/consulta?codigo=K7M2-9PQX`, sin sesión. Devuelve estado, tipo, asunto, área y recorrido, pero **nunca** remitente, destinatario ni nombres de funcionarios. El código tiene unas 850 mil millones de combinaciones y la consulta está limitada a 15 intentos por minuto por IP, de modo que no se pueden recorrer trámites ajenos.
3. **Listo para recoger**: la secretaría marca el documento (`POST /documents/:id/ready`) y la consulta pública lo muestra como *"Listo para recoger"*, con el área donde recogerlo.
4. **Avisos por correo** (opcionales): si al registrar se dejó un correo, el sistema avisa cuando el trámite se registra, se deriva por primera vez, se atiende y cuando está listo para recoger. Los correos llevan solo el estado y el enlace a la consulta, sin remitente ni asunto. Un fallo de envío no interrumpe el trámite.

En local, **Mailpit** (incluido en `compose.yml`) captura los correos y los muestra en <http://localhost:8025>, sin enviar nada a nadie. En producción se configuran `MAIL_HOST`, `MAIL_PORT`, `MAIL_USER`, `MAIL_PASS` y `MAIL_FROM` con el servidor de correo institucional.

Los documentos importados de los Excel no tienen código de seguimiento (nunca se entregó un cargo con código).

## Scripts

| Comando | Descripción |
|---|---|
| `npm run start:dev` | API con recarga |
| `npm run build` / `npm start` | Compilar / ejecutar |
| `npm test` | Pruebas unitarias |
| `npm run lint` | Verificación de tipos (`tsc --noEmit`) |
| `npm run prisma:migrate` | Nueva migración en desarrollo |
| `npm run prisma:seed` | Catálogos y usuarios iniciales (idempotente) |
| `npm run import:excel` | Importación de los Excel |
| `npm run import:users` | Alta de usuarios desde un CSV |

## Pendiente (siguientes versiones)

- Adjuntar el documento escaneado (PDF) a cada registro.
- Avisos por WhatsApp o SMS (hoy solo correo).
- Portal con cuenta para quienes presentan trámites con frecuencia (UGEL, instituciones educativas).
- Plazos en días hábiles y feriados.
- Firma digital.
