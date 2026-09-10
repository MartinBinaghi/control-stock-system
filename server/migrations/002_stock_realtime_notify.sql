-- server/migrations/002_stock_realtime_notify.sql
-- Descripción: apply_stock_movement() ahora publica cada movimiento y el stock
-- resultante por el canal Postgres 'stock_rt'. El servidor Node lo escucha
-- (junto con 'alerts') y lo reparte por WebSocket a /api/realtime.
-- Solo cambia el cuerpo de la función; el trigger trg_apply_stock_movement
-- sigue apuntando a ella.

create or replace function apply_stock_movement() returns trigger
language plpgsql as $$
declare
  delta numeric;
  new_stock numeric;
  threshold numeric;
  pname text;
begin
  delta := case
    when new.type in ('ingreso_manual', 'remito_fabrica', 'produccion') then new.quantity
    else -new.quantity  -- egreso_manual, merma, consumo_produccion (y futura 'venta')
  end;

  insert into inventory (branch_id, product_id, current_stock)
  values (new.branch_id, new.product_id, delta)
  on conflict (branch_id, product_id)
  do update set current_stock = inventory.current_stock + delta, updated_at = now()
  returning current_stock into new_stock;

  select min_stock_threshold, name into threshold, pname
  from products where id = new.product_id;

  -- una sola alerta activa por producto+sucursal
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

  -- realtime: se entrega al commit, igual que las alertas
  perform pg_notify('stock_rt', json_build_object(
    'kind', 'movement', 'row', row_to_json(new)
  )::text);
  perform pg_notify('stock_rt', json_build_object(
    'kind', 'inventory',
    'branch_id', new.branch_id,
    'product_id', new.product_id,
    'current_stock', new_stock
  )::text);

  return new;
end $$;
