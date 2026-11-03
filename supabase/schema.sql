-- ============================================================================
--  Stockroom — inventory management schema
--  Run this once in the Supabase SQL editor (or via the Supabase MCP).
--  Safe to re-run: tables, indexes, functions and policies use IF NOT EXISTS
--  / CREATE OR REPLACE / DROP ... IF EXISTS.
-- ============================================================================

-- ---------------------------------------------------------------- products
create table if not exists public.products (
  id            uuid primary key default gen_random_uuid(),
  sku           text not null unique,
  name          text not null,
  category      text not null default 'General',
  unit_price    numeric(12, 2) not null default 0 check (unit_price >= 0),
  quantity      integer not null default 0 check (quantity >= 0),
  reorder_level integer not null default 5 check (reorder_level >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.products is
  'Catalogue of products and their current stock level.';

-- --------------------------------------------------------- stock movements
-- Append-only ledger. The trigger below is the only thing that changes
-- products.quantity, so every stock change has a matching ledger row.
create table if not exists public.stock_movements (
  id         bigint generated always as identity primary key,
  product_id uuid not null references public.products(id) on delete cascade,
  kind       text not null check (kind in ('in', 'out')),
  quantity   integer not null check (quantity > 0),
  note       text,
  created_at timestamptz not null default now()
);

comment on table public.stock_movements is
  'Append-only log of stock received (in) and issued (out).';

-- ----------------------------------------------------------------- indexes
create index if not exists products_category_idx
  on public.products (category);

create index if not exists products_stock_idx
  on public.products (quantity, reorder_level);

create index if not exists stock_movements_product_idx
  on public.stock_movements (product_id, created_at desc);

create index if not exists stock_movements_created_idx
  on public.stock_movements (created_at desc);

-- ------------------------------------------------------------- updated_at
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists products_touch on public.products;
create trigger products_touch
before update on public.products
for each row execute function public.touch_updated_at();

-- --------------------------------------------- apply movements atomically
-- Locks the product row, refuses to issue more than is on hand, then moves
-- the quantity. Doing this in the database keeps two simultaneous stock-out
-- clicks from both succeeding against the same units.
create or replace function public.apply_stock_movement()
returns trigger
language plpgsql
as $$
declare
  available integer;
begin
  select quantity into available
    from public.products
   where id = new.product_id
   for update;

  if available is null then
    raise exception 'Product % does not exist', new.product_id;
  end if;

  if new.kind = 'out' and new.quantity > available then
    raise exception 'Only % unit(s) in stock', available;
  end if;

  update public.products
     set quantity = quantity
       + case when new.kind = 'in' then new.quantity else -new.quantity end,
         updated_at = now()
   where id = new.product_id;

  return new;
end;
$$;

drop trigger if exists stock_movements_apply on public.stock_movements;
create trigger stock_movements_apply
after insert on public.stock_movements
for each row execute function public.apply_stock_movement();

-- -------------------------------------------------------------------- RLS
alter table public.products enable row level security;
alter table public.stock_movements enable row level security;

drop policy if exists "products readable" on public.products;
create policy "products readable" on public.products
  for select to anon, authenticated using (true);

drop policy if exists "products insertable" on public.products;
create policy "products insertable" on public.products
  for insert to anon, authenticated with check (true);

drop policy if exists "products updatable" on public.products;
create policy "products updatable" on public.products
  for update to anon, authenticated using (true) with check (true);

drop policy if exists "products deletable" on public.products;
create policy "products deletable" on public.products
  for delete to anon, authenticated using (true);

drop policy if exists "movements readable" on public.stock_movements;
create policy "movements readable" on public.stock_movements
  for select to anon, authenticated using (true);

drop policy if exists "movements insertable" on public.stock_movements;
create policy "movements insertable" on public.stock_movements
  for insert to anon, authenticated with check (true);

-- ----------------------------------------------------------------- grants
grant select, insert, update, delete on public.products to anon, authenticated;
grant select, insert on public.stock_movements to anon, authenticated;
grant usage, select on sequence public.stock_movements_id_seq to anon, authenticated;

-- ============================================================================
--  Demo data (runs only when the table is empty)
--  Opening quantities are deliberately set so that the seeded movements land
--  on the stock levels shown in the app.
-- ============================================================================
insert into public.products (sku, name, category, unit_price, quantity, reorder_level)
select * from (values
  ('SKU-1001', 'Wireless Mouse',        'Electronics', 24.99,  47, 10),
  ('SKU-1002', 'Mechanical Keyboard',   'Electronics', 79.50,  11, 12),
  ('SKU-1003', 'USB-C Hub 7-in-1',      'Electronics', 34.00,  15,  8),
  ('SKU-1004', 'A4 Paper (500 sheets)', 'Office',       6.75,   5, 20),
  ('SKU-1005', 'Gel Pen (Box of 12)',   'Office',       4.25, 132, 30),
  ('SKU-1006', 'Desk Lamp',             'Home',        29.90,   4,  5),
  ('SKU-1007', 'Office Chair',          'Furniture',  189.00,   4,  4),
  ('SKU-1008', 'Whiteboard Marker',     'Office',       2.10,  50, 25)
) as v(sku, name, category, unit_price, quantity, reorder_level)
where not exists (select 1 from public.products);

insert into public.stock_movements (product_id, kind, quantity, note, created_at)
select p.id, m.kind, m.quantity, m.note, now() - m.ago::interval
from (values
  ('SKU-1001', 'out',  5, 'Order #1041 - Acme Ltd',       '2 days'),
  ('SKU-1002', 'out',  3, 'Order #1042 - Kigali Office',  '1 day 6 hours'),
  ('SKU-1004', 'out',  2, 'Issued to front desk',         '1 day'),
  ('SKU-1005', 'out', 12, 'Order #1043 - Bright School',  '20 hours'),
  ('SKU-1006', 'out',  4, 'Sold - last units',            '8 hours'),
  ('SKU-1007', 'in',   2, 'Supplier delivery',            '5 hours'),
  ('SKU-1008', 'in',  25, 'Monthly restock',              '2 hours')
) as m(sku, kind, quantity, note, ago)
join public.products p on p.sku = m.sku
where not exists (select 1 from public.stock_movements);
