# Handoff — Stockcito (control-stock-system)

Contexto para retomar en una sesión nueva de Claude Code o con otro agente. Actualizado 2026-08-04.

## Estado del repo

- Rama activa: `cambios-en-pestaña-admin`, **al día con `origin/cambios-en-pestaña-admin`** (ya no hay commits sin pushear).
- Working tree limpio salvo `NOTAS-NEGOCIO.md` (untracked, ver abajo — no es código, decidir si versionarlo).
- Esta rama está 11 commits adelante de `main` y `main` no tiene nada que esta rama no tenga — `fix/general` y el rediseño estético ya están completamente integrados acá, no hace falta mergear nada más.
- `origin/feat/panel-encargado` sigue existiendo pero su tip ya está contenido en esta rama (no tiene trabajo nuevo sin mergear) — no toquen ni la usen como base sin confirmar con el usuario primero, sigue siendo su rama.
- Los últimos commits (`cd52a75 funcionalidad de procesos añadida`, `88861a8 puliendo cambios`) los hizo el usuario manualmente fuera de las sesiones de Claude — la política de **nunca commitear sin que el usuario lo pida explícitamente** se mantuvo durante todo el trabajo asistido.

## Qué es el proyecto

React 19 + Vite 6 + TypeScript + Tailwind v4 + Express + Postgres. Control de stock multi-sucursal, SaaS autoservicio, mercado inicial Argentina (español). Roles: `admin` (panel completo, `src/pages/Dashboard.tsx`) y `encargado` (vista simple: `Mostrador.tsx` + `Remitos.tsx`, tabs en `App.tsx`). Cliente ancla real: Di Polo Pastas (franquicia de pastas).

Contexto de producto completo (personas, principios, terminología fija) vive en `PRODUCT.md` — leerlo si van a tocar UX/copy, lo carga automáticamente la skill `impeccable` pero es útil igual sin ella.

## Trabajo hecho en esta sesión (todo commiteado)

### 1. Restructuración del panel admin en pestañas
`Dashboard.tsx` pasó de una sola vista mezclada a tabs: **Alertas, Stock, Movimientos, Sucursales, Procesos**.
- Alertas: ver/resolver/crear alertas, con filtro por sucursal (`goToAlerts` / `alertsBranchFilter`) al llegar desde una tarjeta de sucursal.
- Stock: alta de productos (con proceso/materia-prima/receta, ver abajo), stock consolidado por sucursal, buscador por nombre/categoría, filtro por proceso.
- Movimientos: sin cambios de fondo, **con paginación** (20 por página, slider `<input type="range">`, ver `MOVEMENTS_PAGE_SIZE`).
- Sucursales: tarjetas (`BranchCard`) en grid, con editar/eliminar sucursal, invitar/eliminar/reenviar-invitación a encargados, scroll de stock con clase `.scroll-accent`, botón **"Vista de encargado →"**.
- Procesos: crear/editar/eliminar procesos, y lista consolidada de qué productos pertenecen a cada uno con su receta resuelta (insumo + cantidad + unidad).

### 2. "Vista de encargado" (admin actuando como encargado de una sucursal)
Motivado porque a veces el dueño atiende él mismo una sucursal. Botón en cada `BranchCard` → `ViewAsEncargado` reutiliza **los mismos componentes** `Mostrador.tsx`/`Remitos.tsx` que usa un encargado real, pasándoles un `branchId` opcional (sin ese prop, comportamiento intacto para un encargado real). Backend: `GET /api/inventory` acepta `?branch=id` para admin.

### 3. Funcionalidad de "Procesos" (fabricación / recetas / BOM)
Motivado por negocios que fabrican lo que venden (panadería, pero también aplica a talleres — ver `NOTAS-NEGOCIO.md`).
- **Schema** (`server/schema.sql`, ya actualizado para instalaciones nuevas): tabla `processes`, columnas `products.process_id` / `products.is_raw_material`, tabla `product_recipes` (insumo + cantidad, `unique(product_id, ingredient_id)`), nuevos valores en los CHECK de `stock_movements.type` (`produccion`, `consumo_produccion`) y `alerts.type` (`insumo_negativo`), trigger `apply_stock_movement()` actualizado para tratar `produccion` como entrada y `consumo_produccion` como salida.
- **Backend** (`server/index.ts`): CRUD `/api/processes`; `POST`/`PATCH /api/products` extendidos con `process_id`/`is_raw_material`/`recipe[]` (transaccional vía `saveRecipe()`); `GET /api/products` embebe `recipe` por producto; `POST /api/production` calcula insumos requeridos, si falta stock devuelve 409 con el detalle (a menos que venga `force: true`), inserta movimientos `produccion`+`consumo_produccion` en una transacción, y genera alerta `insumo_negativo` por cada insumo que quede en negativo.
- **Frontend**: `ProcessFields`/`RecipeBuilder` en `Dashboard.tsx` (compartidos entre alta y edición de producto, con progressive disclosure — si no hay procesos creados no se muestra nada), botón "Producir" (ícono engranaje) en `Mostrador.tsx` solo para productos no-materia-prima, con `ProduceModal` que si falta stock pide confirmación explícita (`confirm()` nativo — **UX consciente pedida por el usuario**: "debe permitir igual pero avisar y pedir confirmación").
- **Reglas de negocio ya endurecidas** (ver sección 4): un insumo en uso no se puede borrar; una receta no puede repetir el mismo insumo dos veces.

> ⚠️ **Migración de base de datos ya aplicada a la DB de desarrollo actual** (`postgres://postgres:1234@localhost:5432/stock_db`). Si hace falta aplicarla a otra base (otro entorno, producción, la máquina de un compañero), correr esto una sola vez — es idempotente solo si la base NO tiene ya estas tablas/columnas, no re-ejecutar sobre una base ya migrada:
>
> ```sql
> create table processes (
>   id uuid primary key default gen_random_uuid(),
>   owner_id uuid not null references users on delete cascade,
>   name text not null,
>   created_at timestamptz not null default now()
> );
>
> alter table products add column process_id uuid references processes;
> alter table products add column is_raw_material boolean not null default true;
>
> create table product_recipes (
>   id uuid primary key default gen_random_uuid(),
>   product_id uuid not null references products on delete cascade,
>   ingredient_id uuid not null references products,
>   quantity numeric not null check (quantity > 0),
>   unique (product_id, ingredient_id)
> );
>
> alter table stock_movements drop constraint stock_movements_type_check;
> alter table stock_movements add constraint stock_movements_type_check
>   check (type in ('ingreso_manual', 'egreso_manual', 'merma', 'remito_fabrica', 'produccion', 'consumo_produccion'));
>
> alter table alerts drop constraint alerts_type_check;
> alter table alerts add constraint alerts_type_check
>   check (type in ('stock_critico', 'desvio_remito', 'insumo_negativo'));
>
> create or replace function apply_stock_movement() returns trigger
> language plpgsql as $$
> declare
>   delta numeric;
>   new_stock numeric;
>   threshold numeric;
>   pname text;
> begin
>   delta := case
>     when new.type in ('ingreso_manual', 'remito_fabrica', 'produccion') then new.quantity
>     else -new.quantity
>   end;
>   insert into inventory (branch_id, product_id, current_stock)
>   values (new.branch_id, new.product_id, delta)
>   on conflict (branch_id, product_id)
>   do update set current_stock = inventory.current_stock + delta, updated_at = now()
>   returning current_stock into new_stock;
>   select min_stock_threshold, name into threshold, pname
>   from products where id = new.product_id;
>   if new_stock < threshold and not exists (
>     select 1 from alerts
>     where branch_id = new.branch_id and product_id = new.product_id
>       and type = 'stock_critico' and not resolved
>   ) then
>     insert into alerts (branch_id, product_id, type, message)
>     values (
>       new.branch_id, new.product_id, 'stock_critico',
>       format('Stock crítico de %s: quedan %s (mínimo %s)', pname, new_stock, threshold)
>     );
>   end if;
>   return new;
> end $$;
> ```
>
> Para una base **nueva**, no hace falta nada de esto: `server/schema.sql` ya está actualizado con el estado final, correrlo completo alcanza.

### 4. Fixes de robustez encontrados en revisión ("¿falta algo?" + `/impeccable critique`)
- Editar/eliminar sucursal (`PATCH`/`DELETE /api/branches/:id`), reenviar invitación / reset de password de encargado (`POST /api/team/:id/resend`), buscador de Stock consolidado, banner de error si falla la carga inicial.
- No se puede borrar un producto que es insumo activo de otra receta (`DELETE /api/products/:id` chequea `product_recipes` antes del soft-delete).
- No se puede repetir el mismo insumo dos veces en una receta (validado en frontend ocultando opciones ya usadas, y en backend como red de seguridad).
- Vista consolidada de recetas por proceso (pestaña Procesos).
- Badge de proceso/materia-prima + filtro por proceso en Stock consolidado.
- **`/impeccable critique` sobre el panel admin** (24/40, snapshot en `.impeccable/critique/2026-08-04T00-46-57Z__src-pages-dashboard-tsx.md`) encontró y se arregló:
  - P0: `alerts` iniciaba en `[]` en vez de `null` → podía mostrar "todo tranquilo" antes de que respondiera el servidor. Ahora es `Alert[] | null` con estado de carga real.
  - P1: `deleteProduct` sin `.catch()` → ahora usa el mismo patrón de manejo de error que el resto de los borrados.
  - P1: los 4 borrados (producto/sucursal/proceso/encargado) usaban `window.confirm()` nativo, rompiendo la identidad visual → ahora usan un `<ConfirmModal>` propio (`role="dialog"`, `aria-modal`, mismo estilo `.card` que el resto de la app).
  - **No resuelto todavía** (quedó fuera del alcance elegido por el usuario, sigue en el snapshot): contraste insuficiente (4.0:1, falta 4.5:1) en el token `--accent-hi`/`--on-accent` de todo botón primario; la barra de filtros de Movimientos agrupa 6 controles sin separación visual (sobrecarga cognitiva). Retomar con `/impeccable audit` y `/impeccable layout` respectivamente si se quiere seguir esa lista.

### 5. `NOTAS-NEGOCIO.md` (untracked, no es código)
Notas de una conversación exploratoria sobre pricing/monetización y comparación con competidores (Fudo, Odoo/Zoho, Katana MRP), incluyendo la idea de ampliar el mercado a talleres/fabricación a medida (no solo gastronomía). Son opiniones razonadas, no research validado — está marcado así en el propio archivo. Decidir si se versiona o se deja fuera de git.

## Cómo correr el proyecto

```
pnpm dev:server   # API Express en :3001 (node --watch, requiere .env con DATABASE_URL/JWT_SECRET)
pnpm dev          # Vite en :5173, proxya /api a :3001
```
Ambos estaban corriendo en background durante la sesión pero **quedaron detenidos** al cerrarse (confirmado — no hay nada escuchando en :5173/:3001 al momento de este handoff). Levantarlos de nuevo si se va a seguir trabajando con el navegador.

- Login de prueba: `test@test.com` / `1234` (admin, tenant con datos de seed: 3 sucursales, productos de pastas + Harina/Manteca/Criollitos de la prueba de Procesos).
- `.env` existe en el repo (gitignored, no tocar/exponer — tiene `DATABASE_URL` con password y `JWT_SECRET`).
- Verificación de tipos: `pnpm exec tsc --noEmit -p .` (frontend) y `pnpm exec tsc -p tsconfig.server.json --noEmit` (server) — ambos limpios al final de la sesión.
- **Gestor de paquetes: se migró de npm a pnpm** (ver sección "Migración a pnpm" más abajo) — usar `pnpm`, no `npm`, para todo a partir de ahora.

## Del handoff anterior (2026-07-30), sigue vigente

### El rediseño "retro pixel" (Carpi, tokens, tema claro/oscuro)
- Estética negro/carbón + naranja, mascota capybara **Carpi** con chaleco reflectante.
- Tokens en `src/index.css` (`--base`, `--surface`, `--ink`, `--accent`, etc.) vía `@theme inline`, clases `.card`/`.panel`/`.btn`/`.btn-primary`/`.btn-ghost`/`.input`. Flip claro/oscuro con `.dark` en `<html>`, seteado pre-paint en `index.html` para evitar flash.
- `src/components/Carpi.tsx`: pixel art a mano, grid 66×66 → SVG. Poses: `GRID_OPEN` (base, en uso), `GRID_PEEKING` (ojo asimétrico, contraseña visible en Login), `GRID_CLOSED` (blink, sin usar). **`GRID_COVERED` (pata tapando ojos) tiene un bug conocido sin arreglar en las filas 19-24** (corrompe la nariz/máscara) — está deshabilitado y documentado con comentarios `ponytail:` en el archivo. Si se retoma, no editar el grid a mano: usar el workflow de abajo.
- Archivos `.pixil` en la raíz son del usuario (editados en pixilart.com), ya reconstruidos dentro de `Carpi.tsx` — no tocar/borrar.

### Workflow ad-hoc para tocar Carpi (no son skills formales, reusar si hace falta)
1. Formato `.pixil` de Pixilart: JSON con `frames[].layers[].src` como PNG en base64, reverse-engineeriado (sin doc oficial).
2. Encoder/decoder PNG a mano (sin dependencias): RGBA tipo 6, `zlib.deflateSync`, CRC32 manual, con filtrado por scanline (None/Sub/Up/Average/Paeth) correctamente revertido.
3. Patching por diff, nunca a mano: cada pose se genera con `replaceRows(GRID_OPEN, {...})` calculado contra una extracción fresca del `.tsx` real vía regex — nunca retipear el grid de memoria.
4. Calibración de alineación por fuerza bruta: al reexportar un `.pixil`, probar todos los offsets `(padX, padY)` candidatos y quedarse con el que minimiza el diff de píxeles, no asumir centrado.
5. Verificación visual real con `mcp__claude-in-chrome__*`: levantar la app, loguear, comparar screenshots.

## Pendiente / no resuelto
- Bug de `GRID_COVERED` en Carpi (filas 19-24), solo evitado, no arreglado.
- Hallazgos de `/impeccable critique` no atacados: contraste de botones primarios, agrupación de la barra de filtros de Movimientos (ver sección 4 arriba).
- Ideas de `NOTAS-NEGOCIO.md` sin decidir: modelar "trabajos/pedidos" ligados a cliente para que Procesos sirva bien a fabricación a medida; generalizar causas de merma (hoy hardcodeadas para gastronomía en `MERMA_CAUSAS`, `Mostrador.tsx`); pricing segmentado Reventa vs. Fabricación.
- `NOTAS-NEGOCIO.md` sin decidir si se versiona.

## Reglas que se vinieron respetando, mantenerlas
- Nunca commitear sin pedido explícito del usuario (los commits de esta sesión los hizo él).
- No tocar `origin/feat/panel-encargado` sin confirmar — sigue siendo su rama, aunque ya no tiene nada pendiente de mergear.
- No sacar nada del `.gitignore` para compartir datos de prueba: `.env`/`.env.local` siguen ignorados, seed vía `server/seed.ts` contra el Postgres local de cada uno.
