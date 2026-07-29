-- ============================================================
-- Stockcito — Control de Stock Multi-Sucursal
-- PostgreSQL 14+. Ejecutar completo:
--   psql -U postgres -d stock_db -f server/schema.sql
-- (crear antes la base: createdb stock_db)
-- ============================================================

-- ---------- Tablas ----------

-- Multi-tenant: cada admin que se registra es un negocio aislado. branches,
-- products y users cuelgan del admin dueño (owner_id); el resto de las tablas
-- se filtran vía branch_id en la API.

create table branches (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,  -- FK a users al final (referencia circular)
  name text not null,
  address text,
  created_at timestamptz not null default now()
);

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text,  -- null hasta que el trabajador acepta la invitación
  name text not null,
  role text not null check (role in ('admin', 'encargado')),
  owner_id uuid references users on delete cascade,  -- admin dueño (null si es admin)
  branch_id uuid references branches,  -- null si es admin
  verified boolean not null default false,
  token text unique,  -- verificación de email (admin) o invitación (encargado)
  created_at timestamptz not null default now()
);

alter table branches add foreign key (owner_id) references users on delete cascade;

create table products (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users on delete cascade,
  name text not null,
  category text,
  unit text not null default 'unidad',
  min_stock_threshold numeric not null default 0,
  created_at timestamptz not null default now()
);

create table inventory (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches,
  product_id uuid not null references products,
  current_stock numeric not null default 0,
  updated_at timestamptz not null default now(),
  unique (branch_id, product_id)
);

create table stock_movements (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches,
  product_id uuid not null references products,
  -- TEXT + CHECK (no enum): agregar 'venta' a futuro es solo recrear el constraint
  type text not null check (type in ('ingreso_manual', 'egreso_manual', 'merma', 'remito_fabrica')),
  quantity numeric not null check (quantity > 0),
  manager_name text not null check (length(trim(manager_name)) > 0),
  reason text,
  created_at timestamptz not null default now()
);

create table remitos (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches,
  pdf_name text not null,
  status text not null check (status in ('correcto', 'con_incongruencia')),
  manager_name text not null,
  created_at timestamptz not null default now()
);

create table remito_items (
  id uuid primary key default gen_random_uuid(),
  remito_id uuid not null references remitos on delete cascade,
  product_id uuid not null references products,
  expected_qty numeric not null,
  actual_qty numeric not null,
  discrepancy_qty numeric not null
);

create table alerts (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches,
  product_id uuid not null references products,
  type text not null check (type in ('stock_critico', 'desvio_remito')),
  message text not null,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users on delete cascade,
  subscription jsonb not null,
  created_at timestamptz not null default now()
);

-- ---------- Trigger: el stock es consecuencia de los movimientos ----------
-- La API SOLO inserta en stock_movements; inventory y las alertas de
-- stock crítico se mantienen acá. Cualquier automatización futura (ventas
-- desde POS) solo tiene que insertar movimientos.

create function apply_stock_movement() returns trigger
language plpgsql as $$
declare
  delta numeric;
  new_stock numeric;
  threshold numeric;
  pname text;
begin
  delta := case
    when new.type in ('ingreso_manual', 'remito_fabrica') then new.quantity
    else -new.quantity  -- egreso_manual, merma (y futura 'venta')
  end;

  insert into inventory (branch_id, product_id, current_stock)
  values (new.branch_id, new.product_id, delta)
  on conflict (branch_id, product_id)
  do update set current_stock = inventory.current_stock + delta, updated_at = now()
  returning current_stock into new_stock;

  select min_stock_threshold, name into threshold, pname
  from products where id = new.product_id;

  -- una sola alerta activa por producto+sucursal: sin esto, cada movimiento
  -- bajo el umbral suma otra alerta casi idéntica y el panel se llena de ruido
  if new_stock < threshold and not exists (
    select 1 from alerts
    where branch_id = new.branch_id and product_id = new.product_id
      and type = 'stock_critico' and not resolved
  ) then
    insert into alerts (branch_id, product_id, type, message)
    values (
      new.branch_id, new.product_id, 'stock_critico',
      format('Stock crítico de %s: quedan %s (mínimo %s)', pname, new_stock, threshold)
    );
  end if;

  return new;
end $$;

create trigger trg_apply_stock_movement
  after insert on stock_movements
  for each row execute function apply_stock_movement();

-- ---------- Notificación de alertas ----------
-- Cada alerta nueva se publica por LISTEN/NOTIFY; el servidor Node escucha
-- el canal 'alerts' y reparte SSE al dashboard + Web Push. Se entrega recién
-- al commit, así los desvíos de remito salen solo si la transacción cierra.

create function notify_alert() returns trigger
language plpgsql as $$
begin
  perform pg_notify('alerts', row_to_json(new)::text);
  return new;
end $$;

create trigger trg_notify_alert
  after insert on alerts
  for each row execute function notify_alert();

-- Permisos por rol/sucursal: los aplica la API (server/index.ts).
-- stock_movements no tiene update/delete en la API: es historial de auditoría.

-- ============================================================
-- SETUP
-- ============================================================
-- No hay seed: el alta es autoservicio desde la app —
--   1. Registrarse en /  (crea un admin, verifica el email).
--   2. Como admin: crear sucursales y productos, e invitar trabajadores
--      por email a cada sucursal.
-- Para crear un admin ya verificado sin email (o resetear una contraseña):
--   node server/create-user.ts <email> <password>
