create schema if not exists inventory;

revoke all on schema inventory from public, anon, authenticated;

set search_path to inventory, public;

create table companies (
  id text primary key,
  name text not null,
  prefix text not null unique,
  ownership text not null,
  contact text not null default '',
  active integer not null default 1 check (active in (0, 1)),
  sequence integer not null default 0 check (sequence >= 0)
);

create table products (
  id text primary key,
  name text not null,
  material text not null default '',
  weave text not null default '',
  color text not null default '',
  design text not null default '',
  active integer not null default 1 check (active in (0, 1))
);

create table artisans (
  id text primary key,
  name text not null,
  contact text not null default '',
  address text not null default '',
  active integer not null default 1 check (active in (0, 1)),
  work_type text not null default '',
  work_description text not null default ''
);

create table ground_staff (
  id text primary key,
  name text not null,
  contact text not null default '',
  active integer not null default 1 check (active in (0, 1))
);

create table users (
  id text primary key,
  email text not null unique,
  name text not null,
  role text not null check (role in ('Admin', 'Supervisor', 'Operator', 'Viewer')),
  active integer not null default 1 check (active in (0, 1)),
  created_at text not null
);

create table lots (
  id text primary key,
  number text not null unique,
  company_id text not null references companies(id),
  product_id text not null references products(id),
  ownership text not null,
  received_at text not null,
  reference text not null default '',
  stated integer not null,
  accepted integer not null,
  damaged integer not null,
  rejected integer not null,
  reason text not null default '',
  notes text not null default '',
  status text not null,
  actor text not null,
  created_at text not null
);

create table generated_labels (
  id text primary key,
  code text not null unique,
  company_id text not null references companies(id),
  product_id text not null references products(id),
  lot_id text not null references lots(id),
  ownership text not null,
  state text not null default 'PENDING',
  created_at text not null,
  registered_at text
);

create table pieces (
  id text primary key,
  code text not null unique,
  company_id text not null references companies(id),
  product_id text not null references products(id),
  lot_id text not null references lots(id),
  ownership text not null,
  holder text not null,
  artisan_id text references artisans(id),
  ground_staff_id text references ground_staff(id),
  condition text not null,
  label_confirmed_at text,
  version integer not null default 1,
  created_at text not null
);

create table transactions (
  id text primary key,
  number text not null unique,
  type text not null,
  artisan_id text references artisans(id),
  status text not null,
  reason text not null default '',
  actor text not null,
  created_at text not null,
  original_id text,
  snapshot text not null,
  created_by text
);

create table transaction_items (
  id text primary key,
  transaction_id text not null references transactions(id),
  piece_id text not null references pieces(id),
  before_state text not null,
  after_state text not null,
  unique (transaction_id, piece_id)
);

create table piece_events (
  id text primary key,
  piece_id text not null references pieces(id),
  type text not null,
  transaction_id text,
  actor text not null,
  created_at text not null,
  reason text not null default '',
  before_state text,
  after_state text not null
);

create table exceptions (
  id text primary key,
  title text not null,
  detail text not null,
  status text not null,
  actor text not null,
  created_at text not null,
  resolution text
);

create table guards (
  id text primary key,
  ok integer not null
);

create table requests (
  id text primary key,
  actor text not null,
  operation text not null,
  result text not null
);

create table settings (
  key text primary key,
  value text not null
);

create table stock_checks (
  id text primary key,
  name text not null,
  scope text not null,
  expected text not null,
  status text not null,
  actor text not null,
  created_at text not null,
  closed_at text
);

create table observations (
  id text primary key,
  check_id text not null references stock_checks(id),
  code text not null,
  result text not null,
  created_at text not null,
  unique (check_id, code)
);

create table print_jobs (
  id text primary key,
  codes text not null,
  reason text not null,
  actor text not null,
  created_at text not null,
  status text not null,
  verified integer not null default 0 check (verified in (0, 1))
);

create index piece_lot_idx on pieces(lot_id);
create index piece_artisan_idx on pieces(artisan_id);
create index piece_ground_staff_idx on pieces(ground_staff_id);
create index event_piece_idx on piece_events(piece_id, created_at);

create function inventory.reject_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using message = TG_ARGV[0], errcode = '23514';
end;
$$;

create function inventory.validate_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.ok <> 1 then
    raise exception using message = 'stale state guards', errcode = '23514';
  end if;
  return new;
end;
$$;

create function inventory.validate_company_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.prefix is distinct from old.prefix or new.ownership is distinct from old.ownership then
    raise exception using message = 'Company prefix and ownership are immutable', errcode = '23514';
  end if;
  if new.sequence < old.sequence then
    raise exception using message = 'Sequence cannot decrease', errcode = '23514';
  end if;
  return new;
end;
$$;

create function inventory.validate_generated_label_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if row(new.id, new.code, new.company_id, new.product_id, new.lot_id, new.ownership)
     is distinct from row(old.id, old.code, old.company_id, old.product_id, old.lot_id, old.ownership) then
    raise exception using message = 'Generated barcode identity and source are immutable', errcode = '23514';
  end if;
  return new;
end;
$$;

create function inventory.validate_piece()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if TG_OP = 'UPDATE' and
     row(new.id, new.code, new.company_id, new.product_id, new.lot_id, new.ownership)
     is distinct from row(old.id, old.code, old.company_id, old.product_id, old.lot_id, old.ownership) then
    raise exception using message = 'Piece identity and original source are immutable', errcode = '23514';
  end if;

  if new.holder not in ('IN_HOUSE', 'WITH_ARTISAN', 'GROUND_STAFF', 'EXCEPTION', 'RETURNED_TO_SOURCE')
     or (new.holder = 'WITH_ARTISAN' and new.artisan_id is null)
     or (new.holder <> 'WITH_ARTISAN' and new.artisan_id is not null)
     or (new.holder = 'GROUND_STAFF' and new.ground_staff_id is null)
     or (new.holder <> 'GROUND_STAFF' and new.ground_staff_id is not null)
     or new.condition not in ('PENDING_LABEL_CONFIRMATION', 'AVAILABLE', 'ACCEPTED_WORK', 'NEEDS_REWORK', 'DAMAGED', 'DISPUTED', 'REPRINTING', 'FINISHING', 'FINISHED')
     or (new.condition <> 'PENDING_LABEL_CONFIRMATION' and new.label_confirmed_at is null)
     or (TG_OP = 'UPDATE' and old.holder = 'RETURNED_TO_SOURCE' and new.holder <> 'RETURNED_TO_SOURCE')
     or (new.condition = 'REPRINTING' and new.holder <> 'WITH_ARTISAN')
     or (new.condition = 'FINISHING' and new.holder <> 'GROUND_STAFF')
     or (new.condition = 'FINISHED' and new.holder <> 'IN_HOUSE') then
    raise exception using message = 'Invalid warehouse custody, stage or completed source return', errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger guard_valid before insert on guards
for each row execute function inventory.validate_guard();

create trigger company_change_guard before update on companies
for each row execute function inventory.validate_company_change();

create trigger company_no_delete before delete on companies
for each row execute function inventory.reject_change('Company prefixes are reserved forever; archive instead');

create trigger generated_label_change_guard before update on generated_labels
for each row execute function inventory.validate_generated_label_change();

create trigger generated_label_no_delete before delete on generated_labels
for each row execute function inventory.reject_change('Generated barcode records cannot be deleted');

create trigger piece_state_guard before insert or update on pieces
for each row execute function inventory.validate_piece();

create trigger piece_no_delete before delete on pieces
for each row execute function inventory.reject_change('Pieces cannot be deleted');

create trigger event_no_update before update on piece_events
for each row execute function inventory.reject_change('History is append only');

create trigger event_no_delete before delete on piece_events
for each row execute function inventory.reject_change('History is append only');

do $$
declare
  table_name text;
begin
  for table_name in
    select tablename from pg_tables where schemaname = 'inventory'
  loop
    execute format('alter table inventory.%I enable row level security', table_name);
    execute format('revoke all on table inventory.%I from anon, authenticated', table_name);
  end loop;
end;
$$;

revoke execute on all functions in schema inventory from public, anon, authenticated;
alter default privileges in schema inventory revoke all on tables from public, anon, authenticated;
alter default privileges in schema inventory revoke execute on functions from public, anon, authenticated;
