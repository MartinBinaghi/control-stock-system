-- Unidades de medida configurables por negocio
create table units (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users on delete cascade,
  name text not null,
  symbol text,
  created_at timestamptz not null default now(),
  unique (owner_id, name)
);