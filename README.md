# Di Polo Pastas — Control de Stock Multi-Sucursal

PWA de control de stock para franquicia gastronómica: stock en tiempo real por sucursal, mermas, auditoría de movimientos, validación de remitos PDF y alertas con notificaciones push.

**Stack:** React + Vite + TypeScript + Tailwind CSS · Backend propio en Node (Express) + PostgreSQL · SSE para alertas en vivo · Web Push · PWA instalable (escritorio y mobile).

El backend es autocontenido: corre contra cualquier PostgreSQL (local, servidor propio o nube). Sin dependencia de ningún proveedor.

> **Estado actual y próximos pasos: ver [ESTADO.md](ESTADO.md).**

## Setup

### 1. Base de datos
Requiere PostgreSQL 14+ instalado (local o remoto):
```bash
createdb dipolo
psql -U postgres -d dipolo -f server/schema.sql
```
Cargar sucursales y productos (hay seed de ejemplo comentado al final del schema).

### 2. Servidor + usuarios
```bash
cp .env.example .env   # completar DATABASE_URL y JWT_SECRET
npm install
node server/create-user.ts dueno@dipolo.com clave123 admin
node server/create-user.ts centro@dipolo.com clave123 encargado <uuid-sucursal>
npm run dev:server     # API en http://localhost:3001
```
Una cuenta por sucursal (login compartido del local) y la del dueño.

### 3. Frontend (desarrollo)
```bash
npm run dev            # Vite en http://localhost:5173, proxya /api al 3001
```

### 4. Producción
```bash
npm run build          # typecheck (app + server) + build a dist/
npm start              # Express sirve la API y dist/ en el mismo puerto
```
HTTPS es requisito para PWA y push — poner un reverse proxy (Caddy/nginx/etc.) adelante.

### 5. Notificaciones push (opcional)
1. Generar claves: `npx web-push generate-vapid-keys`.
2. Completar `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y `VAPID_SUBJECT` en `.env` y reiniciar el servidor.
3. En el panel admin, botón **Activar notificaciones**.

> En iPhone el push requiere la PWA instalada en pantalla de inicio (iOS 16.4+). En Android y escritorio funciona directo.

## Cómo funciona el stock

La API **solo inserta movimientos** en `stock_movements` (entrada, salida, merma, remito). Un trigger de Postgres actualiza `inventory` y genera alertas de stock crítico automáticamente. Otro trigger publica cada alerta por `NOTIFY`; el servidor Node la escucha y la reparte por SSE al dashboard y por Web Push. Para automatizar ventas a futuro, basta con insertar movimientos (nuevo tipo `'venta'` en el CHECK) desde cualquier origen — el stock y las alertas se mantienen solos.

Los permisos por rol/sucursal se aplican en la API (`server/index.ts`): el encargado solo ve y escribe su sucursal; `stock_movements` no tiene update/delete (auditoría).

## Remitos PDF

El parser (`src/lib/parseRemito.ts`) extrae líneas `PRODUCTO  CANTIDAD` del texto del PDF (vía pdf.js, en el navegador). **Está en modo genérico: ajustar la regex cuando haya un remito real de la fábrica.** Mientras tanto, el módulo permite carga manual de filas y funciona completo (comparación, incongruencias en rojo, alerta al admin, actualización de stock con el conteo físico).

## Roles

- **Admin (dueño):** dashboard con stock consolidado de todas las sucursales, consola de alertas en tiempo real, filtros de movimientos (sucursal / producto / fecha / hora), push.
- **Encargado:** pantalla mostrador (entradas, salidas, mermas con causa) y módulo remitos de su sucursal. Cada transacción exige el nombre de quien la hace (login compartido por local).
