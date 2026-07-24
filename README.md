# Di Polo Pastas — Control de Stock Multi-Sucursal

PWA de control de stock para franquicia gastronómica: stock en tiempo real por sucursal, mermas, auditoría de movimientos, validación de remitos PDF y alertas con notificaciones push.

**Stack:** React + Vite + TypeScript + Tailwind CSS · Supabase (Postgres, Auth, RLS, Realtime, Edge Functions) · Web Push · PWA instalable (escritorio y mobile).

> **Estado actual y próximos pasos: ver [ESTADO.md](ESTADO.md).**

## Setup

### 1. Supabase
1. Crear proyecto en [supabase.com](https://supabase.com).
2. Ejecutar `supabase/schema.sql` completo en el SQL Editor (tablas + triggers + RLS + realtime).
3. Cargar sucursales y productos (hay seed de ejemplo comentado al final del schema).
4. En **Authentication > Users** crear las cuentas: una por sucursal (login compartido del local) y la del dueño. Luego insertar los perfiles (ver comentario en el schema): `role = 'admin'` sin sucursal, `role = 'encargado'` con su `branch_id`.

### 2. App
```bash
cp .env.example .env   # completar URL, anon key y clave pública VAPID
npm install
npm run dev
```

### 3. Notificaciones push
1. Generar claves: `npx web-push generate-vapid-keys`.
2. La pública va en `.env` (`VITE_VAPID_PUBLIC_KEY`).
3. Deploy de la función: `npx supabase functions deploy send-push` y setear secrets:
   `npx supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=...`
4. En **Database > Webhooks** crear un webhook sobre `INSERT` en `alerts` que invoque la Edge Function `send-push`.
5. En el panel admin, botón **Activar notificaciones**.

> En iPhone el push requiere la PWA instalada en pantalla de inicio (iOS 16.4+). En Android y escritorio funciona directo.

## Cómo funciona el stock

El frontend **solo inserta movimientos** en `stock_movements` (entrada, salida, merma, remito). Un trigger de Postgres actualiza `inventory` y genera alertas de stock crítico automáticamente. Para automatizar ventas a futuro, basta con insertar movimientos (nuevo tipo `'venta'` en el CHECK) desde cualquier origen — el stock y las alertas se mantienen solos.

## Remitos PDF

El parser (`src/lib/parseRemito.ts`) extrae líneas `PRODUCTO  CANTIDAD` del texto del PDF (vía pdf.js). **Está en modo genérico: ajustar la regex cuando haya un remito real de la fábrica.** Mientras tanto, el módulo permite carga manual de filas y funciona completo (comparación, incongruencias en rojo, alerta al admin, actualización de stock con el conteo físico).

## Roles

- **Admin (dueño):** dashboard con stock consolidado de todas las sucursales, consola de alertas en tiempo real, filtros de movimientos (sucursal / producto / fecha / hora), push.
- **Encargado:** pantalla mostrador (entradas, salidas, mermas con causa) y módulo remitos de su sucursal. Cada transacción exige el nombre de quien la hace (login compartido por local).
