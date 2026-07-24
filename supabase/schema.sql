-- ============================================================
-- Di Polo Pastas — Control de Stock Multi-Sucursal
-- Ejecutar completo en el SQL Editor de Supabase.
-- ============================================================

-- ---------- Tablas ----------

create table branches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  created_at timestamptz not null default now()
);

create table profiles (
  id uuid primary key references auth.users on delete cascade,
  email text not null,
  role text not null check (role in ('admin', 'encargado')),
  branch_id uuid references branches,  -- null si es admin
  created_at timestamptz not null default now()
);

create table products (
  id uuid primary key default gen_random_uuid(),
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
  profile_id uuid not null references profiles on delete cascade,
  subscription jsonb not null,
  created_at timestamptz not null default now()
);

-- ---------- Helpers de RLS ----------
-- security definer para evitar recursión de RLS al leer profiles

create function is_admin() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where id = auth.uid() and role = 'admin') $$;

create function my_branch() returns uuid
language sql stable security definer set search_path = public as
$$ select branch_id from profiles where id = auth.uid() $$;

-- ---------- Trigger: el stock es consecuencia de los movimientos ----------
-- El frontend SOLO inserta en stock_movements; inventory y las alertas de
-- stock crítico se mantienen acá. Cualquier automatización futura (ventas
-- desde POS) solo tiene que insertar movimientos.

create function apply_stock_movement() returns trigger
language plpgsql security definer set search_path = public as $$
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

  if new_stock < threshold then
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

-- ---------- Row Level Security ----------
-- Admin: todo. Encargado: solo su sucursal.
-- stock_movements sin update/delete para nadie: es el historial de auditoría.

alter table branches enable row level security;
alter table profiles enable row level security;
alter table products enable row level security;
alter table inventory enable row level security;
alter table stock_movements enable row level security;
alter table remitos enable row level security;
alter table remito_items enable row level security;
alter table alerts enable row level security;
alter table push_subscriptions enable row level security;

-- branches: todos los autenticados leen (necesitan el nombre de su sucursal); solo admin escribe
create policy branches_select on branches for select to authenticated using (true);
create policy branches_admin on branches for all to authenticated using (is_admin()) with check (is_admin());

-- profiles: cada uno ve el suyo; admin ve y administra todos
create policy profiles_own on profiles for select to authenticated using (id = auth.uid());
create policy profiles_admin on profiles for all to authenticated using (is_admin()) with check (is_admin());

-- products: catálogo global legible; solo admin escribe
create policy products_select on products for select to authenticated using (true);
create policy products_admin on products for all to authenticated using (is_admin()) with check (is_admin());

-- inventory: lectura por sucursal; la escritura la hace solo el trigger (security definer).
create policy inventory_select on inventory for select to authenticated
  using (is_admin() or branch_id = my_branch());

-- stock_movements: lectura por sucursal; insert solo en la propia sucursal (o admin)
create policy movements_select on stock_movements for select to authenticated
  using (is_admin() or branch_id = my_branch());
create policy movements_insert on stock_movements for insert to authenticated
  with check (is_admin() or branch_id = my_branch());

-- remitos / remito_items
create policy remitos_select on remitos for select to authenticated
  using (is_admin() or branch_id = my_branch());
create policy remitos_insert on remitos for insert to authenticated
  with check (is_admin() or branch_id = my_branch());
create policy remito_items_select on remito_items for select to authenticated
  using (is_admin() or exists (select 1 from remitos r where r.id = remito_id and r.branch_id = my_branch()));
create policy remito_items_insert on remito_items for insert to authenticated
  with check (is_admin() or exists (select 1 from remitos r where r.id = remito_id and r.branch_id = my_branch()));

-- alerts: encargado ve y crea las de su sucursal (desvio_remito); admin todo (incluye resolver)
create policy alerts_select on alerts for select to authenticated
  using (is_admin() or branch_id = my_branch());
create policy alerts_insert on alerts for insert to authenticated
  with check (is_admin() or branch_id = my_branch());
create policy alerts_admin_update on alerts for update to authenticated
  using (is_admin()) with check (is_admin());

-- push_subscriptions: cada perfil administra las suyas
create policy push_own on push_subscriptions for all to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- ---------- Realtime solo en alerts ----------
alter publication supabase_realtime add table alerts;

-- ============================================================
-- SEED / SETUP MANUAL (editar y descomentar)
-- ============================================================
-- 1. Sucursales y productos de ejemplo:
-- insert into branches (name, address) values
--   ('Sucursal Centro', 'Av. Principal 123'),
--   ('Sucursal Norte', 'Calle 45 678');
-- insert into products (name, category, unit, min_stock_threshold) values
--   ('Ravioles de ricota', 'Pastas rellenas', 'plancha', 10),
--   ('Ñoquis de papa', 'Pastas', 'kg', 5),
--   ('Tallarines al huevo', 'Pastas', 'kg', 5),
--   ('Salsa fileto', 'Salsas', 'unidad', 8);
--
-- 2. Usuarios: crearlos en Authentication > Users del dashboard de Supabase
--    (una cuenta por sucursal + la del dueño), y luego vincular el perfil:
-- insert into profiles (id, email, role, branch_id) values
--   ('<uuid-del-usuario-admin>', 'dueno@dipolo.com', 'admin', null),
--   ('<uuid-usuario-centro>', 'centro@dipolo.com', 'encargado', '<uuid-sucursal-centro>');
--
-- 3. Push: configurar un Database Webhook (Database > Webhooks) sobre INSERT
--    en la tabla alerts que invoque la Edge Function send-push.
