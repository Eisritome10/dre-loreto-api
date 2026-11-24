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
docker compose up -d postgres mailpit backup # PostgreSQL en localhost:5433, correo de pruebas en :8025 y respaldo diario
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
| `mesa.partes@drel.local` | MESA_PARTES | MESA-PARTES |

## Perfiles y permisos

| Perfil | Qué ve | Qué puede hacer |
|---|---|---|
| ADMIN | Todo | Todo, más usuarios, áreas y tipos de documento |
| DIRECTOR | Todo | Registrar, derivar, archivar, anular, reportes y auditoría |
| MESA_PARTES | Su área y lo derivado a ella | Registrar solo documentos externos (genera el expediente) y derivarlos a la oficina; anular; marcar listo para recoger |
| SECRETARIA | Su área y lo derivado a ella | Registrar (incluye externos), derivar, circuitos de vistos buenos, numerar al firmar, archivar, anular |
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

## Cómo recoge el sistema lo dicho en la entrevista

Del documento *Entrevista PETI DREL* (trámite documentario, oficina de Infraestructura):

### Mesa de Partes

Mesa de Partes recibe los documentos externos, **asigna el N° de expediente** y los deriva a la oficina competente. El perfil `MESA_PARTES` (área `MESA-PARTES`) hace las dos cosas en un solo paso: registra, el sistema genera el expediente (correlativo por año, que se reinicia cada enero) y lo deriva con plazo, jefatura que dispuso y oficio. Así el cargo con el código de seguimiento se entrega desde el primer día, y la oficina destino lo ve en su bandeja. El expediente se muestra como `1234/2026` y se puede buscar así.

> Si Mesa de Partes sigue usando su sistema actual, las oficinas pueden escribir a mano el N° de expediente que ella asignó; solo se genera automáticamente cuando el documento se registra en el área Mesa de Partes.

### Dónde está el documento

El listado y el detalle muestran la **ubicación actual** (oficina y persona, o *por recibir*). La consulta pública muestra solo el nombre de la oficina. Cada derivación guarda **quién la dispuso** (proveído de la jefatura) y el **oficio que la formaliza**. La *fecha de ingreso* es la de llegada a la oficina, como en la práctica actual, y se puede anotar aparte la fecha en que Mesa de Partes lo recibió.

### Resoluciones: vistos buenos y numeración al firmar

- **Circuito de vistos buenos** (`POST /documents/:id/route`): el documento pasa por varias oficinas una tras otra (ej. Presupuesto → Asesoría Jurídica → Administración). Cada paso se activa cuando el anterior da su visto bueno; si uno lo devuelve, el circuito se detiene.
- **Numeración al firmar**: los tipos con `numeraAlFirmar` (las resoluciones) nacen sin número. Cuando la directora firma, la secretaría usa *Firmada: asignar número* (`POST /documents/:id/number`) y recibe el siguiente correlativo del año de la firma. No se puede numerar con vistos buenos pendientes ni dos veces.

### Documentos escaneados

Cada trámite admite hasta 20 archivos PDF, JPG o PNG de hasta 10 MB (`POST /documents/:id/attachments`, campo `archivo`). Se valida el contenido real del archivo, no solo su extensión; la descarga exige sesión y que el usuario pueda ver el documento. Se guardan en `UPLOADS_DIR` (en Docker, el volumen `uploads_data`).

### Carpeta física

Cada documento muestra su **etiqueta de carpeta** (oficina y año, p. ej. `OGAIE-EI 2026`), igual a la que se rotula en el archivo físico, y el cargo la imprime.

### Respaldo y restauración

El servicio `backup` del `compose.yml` hace un **respaldo diario** de la base en `./backups` (7 diarios, 4 semanales y 6 mensuales). Copia manual y restauración:

```bash
docker compose exec backup /backup.sh
gunzip -c backups/last/dre_loreto-latest.sql.gz | docker compose exec -T postgres psql -U postgres -d dre_loreto_restaurada
```

(cree antes la base destino con `CREATE DATABASE`). Los documentos escaneados están en el volumen `uploads_data`; respáldelo con la misma frecuencia. Verificado: una restauración devuelve los mismos registros que la base original.

### Cortes de energía e internet

Es una aplicación web, por lo que necesita red y electricidad. Para el trabajo diario se recomienda instalarla **en un servidor dentro de la red de la DREL** (funciona aunque se caiga el internet externo) con un **UPS**. Solo los avisos por correo necesitan internet y, si fallan, el trámite continúa. El trabajo sin conexión queda para una versión futura.

## Sesión de prueba con usuarios

```bash
npm run prueba:verificar    # servicios, usuarios de prueba y datos listos
npm run prueba:preparar     # deja 3 documentos en la bandeja de Infraestructura (derivados por Mesa de Partes)
npm run prueba:reiniciar    # borra lo de la prueba y vuelve a cargar los Excel (~50 s)
npm run numeracion          # lista las series; con --area/--tipo/--anio/--ultimo ajusta el último número usado
```

La guía con los escenarios, el cuestionario y los criterios de aceptación está en `DOCUMENTOS/Guia_Prueba_Usuaria_Infraestructura.docx` del proyecto (no se versiona aquí). Usuarios de prueba adicionales: `especialista.infra@drel.local` (ESPECIALISTA de Infraestructura).

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

- Avisos por WhatsApp o SMS (hoy solo correo).
- Portal con cuenta para quienes presentan trámites con frecuencia (UGEL, instituciones educativas).
- Plazos en días hábiles y feriados.
- Firma digital.
