# Estado del proyecto — 23/07/2026

Sistema de control de stock multi-sucursal para Di Polo Pastas (franquicia de pastas).
Decisiones de diseño y contexto completo: ver `control-stock-propuesta.md` (propuesta original) y `README.md` (setup).

## ✅ Hecho (código completo, build pasa)

| Pieza | Archivo | Estado |
|---|---|---|
| Schema DB: 9 tablas + RLS + trigger de stock | `supabase/schema.sql` | Escrito, **no ejecutado aún en Supabase** |
| Login (cuenta compartida por sucursal) | `src/pages/Login.tsx` | Listo |
| Routing por rol (admin / encargado) | `src/App.tsx` | Listo |
| Mostrador: entradas, salidas, mermas con causa | `src/pages/Mostrador.tsx` | Listo |
| Remitos: PDF → tabla comparativa → alertas | `src/pages/Remitos.tsx` | Listo (parser genérico, ver pendientes) |
| Parser de remitos + matching sin acentos | `src/lib/parseRemito.ts` | Stub genérico funcional |
| Dashboard admin: stock consolidado, alertas Realtime, filtros | `src/pages/Dashboard.tsx` | Listo |
| Notificaciones push (SW + Edge Function) | `src/sw.ts`, `supabase/functions/send-push/index.ts` | Escrito, falta deploy/config |
| PWA instalable (manifest, íconos, standalone) | `vite.config.ts`, `public/icons/` | Listo |
| Test del parser | `tests/parseRemito.test.ts` | Pasa (`node tests/parseRemito.test.ts`) |

Verificado: `npm run build` (typecheck estricto + build + SW) y el test del parser pasan.

## Concepto clave para entender el código

**El frontend nunca escribe el stock.** Solo inserta filas en `stock_movements`; un trigger de Postgres (`apply_stock_movement` en el schema) actualiza `inventory` y crea alertas de `stock_critico` si queda bajo el umbral. Las alertas de `desvio_remito` las inserta el módulo de remitos. Un webhook sobre `alerts` dispara la Edge Function que manda el push.

Esto significa que la futura automatización de ventas (pedida por el cliente) es solo: agregar `'venta'` al CHECK de `stock_movements.type` e insertar movimientos desde donde sea — stock y alertas se mantienen solos.

## 🔜 Por hacer (en orden)

1. **Backend real**: crear proyecto en Supabase → correr `supabase/schema.sql` completo en el SQL Editor → cargar sucursales y productos (seed comentado al final del schema) → crear usuarios en Authentication (uno por sucursal + admin) e insertar sus `profiles`.
2. **Conectar la app**: `cp .env.example .env` y completar `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` → `npm install && npm run dev` → probar login, mostrador y dashboard contra datos reales.
3. **Push** (README sección 3): `npx web-push generate-vapid-keys` → pública al `.env`, par completo como secrets → `npx supabase functions deploy send-push` → Database Webhook en INSERT sobre `alerts` → probar con la app cerrada.
4. **Parser de remitos**: conseguir un **PDF real de la fábrica** y ajustar la regex de `src/lib/parseRemito.ts` (hoy asume líneas `PRODUCTO  CANTIDAD`). Actualizar `tests/parseRemito.test.ts` con texto del PDF real. Mientras tanto el módulo funciona con carga manual de filas.
5. **Prueba end-to-end de RLS**: logueado como encargado, verificar que no se ven datos de otra sucursal.
6. **Deploy del frontend** (Vercel/Netlify/etc. — HTTPS es requisito para PWA y push) e instalación de la PWA en los locales. Ojo: en iPhone el push requiere la PWA agregada a pantalla de inicio (iOS 16.4+).

## Fuera de alcance de esta fase (decidido con el cliente)

- Integración/import de ventas desde POS (el diseño ya lo soporta, ver arriba).
- OCR de remitos escaneados (los remitos son PDF digitales de formato fijo).

## Comandos

```bash
npm install
npm run dev                        # desarrollo (requiere .env)
npm run build                      # typecheck + build producción
node tests/parseRemito.test.ts     # test del parser
```
