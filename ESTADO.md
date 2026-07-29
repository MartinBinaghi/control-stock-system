# Estado del proyecto — 28/07/2026

**Stockcito** — sistema de control de stock multi-sucursal (origen: Di Polo Pastas; la marca provisoria "Stockcito" se adoptó el 28/07 al volverse producto genérico).
Decisiones de diseño y contexto: ver `control-stock-propuesta.md` (propuesta original) y `README.md` (setup).

**Cambio de arquitectura (27/07):** se eliminó la dependencia de Supabase. Ahora hay un backend propio en Node (Express) contra PostgreSQL — funciona 100% con una base local. Soporte de nube = apuntar `DATABASE_URL` a cualquier Postgres hosteado.

**Cambio de modelo de usuarios (28/07):** la app pasó a ser **multi-negocio con autoservicio**. Registro público → email de verificación → cuenta admin. Cada admin es un tenant aislado: crea sucursales y productos e invita trabajadores por email (el link les pide elegir contraseña). Todo se filtra por el admin dueño (`owner_id` en `branches`/`products`/`users`; el resto vía `branch_id`), incluidas las alertas SSE y el push. Los movimientos se firman automáticamente con el nombre del usuario logueado (ya no se tipea `manager_name`). Emails por SMTP configurable en `.env` (nodemailer); sin SMTP, los links salen por consola.

## ✅ Hecho (código completo, build y tests pasan)

| Pieza | Archivo | Estado |
|---|---|---|
| Schema DB: 10 tablas + trigger de stock + NOTIFY de alertas | `server/schema.sql` | Escrito, **falta ejecutarlo en un Postgres real** |
| API: auth JWT, permisos por rol/sucursal, transacción de remitos | `server/index.ts` | Listo |
| Hash de contraseñas (scrypt, stdlib) | `server/auth.ts` | Listo (test pasa) |
| Alta de usuarios por CLI | `server/create-user.ts` | Listo |
| Alertas en vivo: Postgres NOTIFY → SSE al dashboard | `server/index.ts` + `Dashboard.tsx` | Listo |
| Web Push desde el propio servidor | `server/index.ts` + `src/sw.ts` | Listo (falta generar claves VAPID) |
| Cliente API del frontend | `src/lib/api.ts` | Listo |
| Login / Mostrador / Remitos / Dashboard | `src/pages/` | Listos, migrados a la API propia |
| Parser de remitos + matching sin acentos | `src/lib/parseRemito.ts` | Stub genérico funcional |
| PWA instalable (manifest, íconos, standalone) | `vite.config.ts`, `public/icons/` | Listo |
| Tests | `tests/` | Pasan (`node tests/auth.test.ts`, `node tests/parseRemito.test.ts`) |

Verificado: `npm run build` (typecheck estricto de app y servidor + build + SW), los dos tests, y smoke test de la API (levanta, rechaza sin token, y sobrevive con la DB caída).

## Concepto clave para entender el código

**Nadie escribe el stock a mano.** La API solo inserta filas en `stock_movements`; un trigger de Postgres (`apply_stock_movement`) actualiza `inventory` y crea alertas de `stock_critico` bajo el umbral. Otro trigger publica cada alerta nueva por `NOTIFY 'alerts'`; el servidor escucha ese canal y la reparte por SSE (dashboard admin) y Web Push. Los desvíos de remito se insertan en la transacción del endpoint `/api/remitos`.

La futura automatización de ventas (pedida por el cliente) es solo: agregar `'venta'` al CHECK de `stock_movements.type` e insertar movimientos desde donde sea — stock y alertas se mantienen solos.

Los permisos que antes hacía RLS ahora viven en `server/index.ts` (wrapper `authed`): encargado limitado a su `branch_id`, admin todo, movimientos sin update/delete (auditoría).

## 🔜 Por hacer (en orden)

1. ~~**Base real**~~ ✅ hecho (28/07): base `stock_db` en el PostgreSQL 18 local, schema corrido, `.env` configurado, y datos de prueba cargados con `node server/seed.ts test@test.com` (admin `test@test.com`/`test1234`; encargados `lucia|carlos|sofia@dipolo.com`/`1234`).
2. **Prueba end-to-end**: `npm run dev:server` + `npm run dev` → probar: registro + verificación (link por consola, sin SMTP), crear sucursal/producto, invitar trabajador, aceptar invitación, y aislamiento entre dos admins distintos.
3. **Push**: `npx web-push generate-vapid-keys` → claves al `.env` → reiniciar servidor → activar notificaciones en el panel y forzar una alerta con la app cerrada.
4. **Parser de remitos**: conseguir un **PDF real de la fábrica** y ajustar la regex de `src/lib/parseRemito.ts` (hoy asume líneas `PRODUCTO  CANTIDAD`). Actualizar `tests/parseRemito.test.ts` con texto del PDF real. Mientras tanto el módulo funciona con carga manual de filas.
5. **Deploy**: `npm run build && npm start` en el servidor elegido (el mismo Express sirve API + frontend), con reverse proxy HTTPS adelante (requisito de PWA y push). Instalar la PWA en los locales — en iPhone el push requiere agregarla a pantalla de inicio (iOS 16.4+).

## Fuera de alcance de esta fase (decidido con el cliente)

- Integración/import de ventas desde POS (el diseño ya lo soporta, ver arriba).
- OCR de remitos escaneados (los remitos son PDF digitales de formato fijo).
- Soporte de Supabase u otro proveedor gestionado: al ser Postgres vanilla, es solo cambiar `DATABASE_URL`.

## Comandos

```bash
npm install
npm run dev:server                 # API (requiere .env + Postgres)
npm run dev                        # frontend con proxy a la API
npm run build                      # typecheck app + server, build a dist/
npm start                          # producción: API + frontend juntos
node server/create-user.ts <email> <pass>   # admin verificado sin email / reset de contraseña
node server/seed.ts <email-admin>  # datos de prueba (sucursales, productos, encargados, movimientos)
node tests/auth.test.ts            # test de hash/verificación de contraseñas
node tests/parseRemito.test.ts     # test del parser
```
