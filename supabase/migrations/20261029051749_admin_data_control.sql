-- Admin-only data control with a hard five-hour recovery window.
-- The inventory schema is private and these functions are only called by the
-- authenticated server after it verifies the current user's Admin role.

create table if not exists inventory.admin_recovery_batches (
  id text primary key,
  action text not null check (action in ('EDIT_RECORD', 'DELETE_RECORD', 'DELETE_ALL')),
  target_table text,
  target_id text,
  description text not null,
  snapshot jsonb,
  after_data jsonb,
  change_data jsonb,
  record_count integer not null default 0 check (record_count >= 0),
  actor_id text not null,
  actor text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '5 hours'),
  undone_at timestamptz,
  undone_by text,
  purged_at timestamptz,
  check (expires_at = created_at + interval '5 hours')
);

create index if not exists admin_recovery_batches_created_idx
  on inventory.admin_recovery_batches(created_at desc);
create index if not exists admin_recovery_batches_active_idx
  on inventory.admin_recovery_batches(expires_at)
  where snapshot is not null and undone_at is null;

alter table inventory.admin_recovery_batches enable row level security;
revoke all on inventory.admin_recovery_batches from public, anon, authenticated;

create or replace function inventory.admin_data_table_allowed(p_table text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_table = any(array[
    'companies', 'products', 'artisans', 'ground_staff', 'users', 'lots',
    'generated_labels', 'pieces', 'transactions', 'transaction_items',
    'piece_events', 'exceptions', 'stock_checks', 'observations', 'print_jobs',
    'barcode_recoveries'
  ]::text[]);
$$;

create or replace function inventory.admin_purge_expired_recoveries()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  purged integer;
begin
  update inventory.admin_recovery_batches
  set snapshot = null,
      after_data = null,
      change_data = null,
      purged_at = clock_timestamp()
  where expires_at <= clock_timestamp()
    and snapshot is not null;
  get diagnostics purged = row_count;
  return purged;
end;
$$;

create or replace function inventory.admin_edit_record(
  p_batch_id text,
  p_table text,
  p_record_id text,
  p_patch jsonb,
  p_actor_id text,
  p_actor text
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  before_row jsonb;
  after_row jsonb;
  merged_row jsonb;
  columns_sql text;
  unknown_key text;
begin
  perform inventory.admin_purge_expired_recoveries();
  if not inventory.admin_data_table_allowed(p_table) then
    raise exception 'This data table is not available for Admin editing';
  end if;
  if p_record_id is null or jsonb_typeof(p_patch) is distinct from 'object' then
    raise exception 'A record and JSON object are required';
  end if;

  select key into unknown_key
  from jsonb_object_keys(p_patch) as supplied(key)
  where key = 'id'
     or not exists (
       select 1 from information_schema.columns c
       where c.table_schema = 'inventory'
         and c.table_name = p_table
         and c.column_name = supplied.key
     )
  limit 1;
  if unknown_key is not null then
    raise exception 'Field % cannot be edited', unknown_key;
  end if;

  execute format('select to_jsonb(t) from inventory.%I t where id = $1 for update', p_table)
    into before_row using p_record_id;
  if before_row is null then raise exception 'Record not found'; end if;

  merged_row := before_row || p_patch;
  if p_table = 'users' and p_record_id = p_actor_id
     and (coalesce(merged_row->>'role', '') <> 'Admin' or coalesce((merged_row->>'active')::integer, 0) <> 1) then
    raise exception 'You cannot deactivate or demote your current Admin account';
  end if;

  select string_agg(format('%I', c.column_name), ', ' order by c.ordinal_position)
  into columns_sql
  from information_schema.columns c
  where c.table_schema = 'inventory'
    and c.table_name = p_table
    and c.column_name <> 'id';

  insert into inventory.admin_recovery_batches(
    id, action, target_table, target_id, description, snapshot, change_data,
    record_count, actor_id, actor
  ) values (
    p_batch_id, 'EDIT_RECORD', p_table, p_record_id,
    format('Edited %s · %s', replace(p_table, '_', ' '), p_record_id),
    jsonb_build_object('record', before_row), p_patch, 1, p_actor_id, p_actor
  );

  perform set_config('ims.admin_data_control', 'on', true);
  execute format(
    'update inventory.%1$I set (%2$s) = (select %2$s from jsonb_populate_record(null::inventory.%1$I, $2)) where id = $1',
    p_table, columns_sql
  ) using p_record_id, merged_row;

  execute format('select to_jsonb(t) from inventory.%I t where id = $1', p_table)
    into after_row using p_record_id;
  update inventory.admin_recovery_batches set after_data = after_row where id = p_batch_id;
end;
$$;

create or replace function inventory.admin_delete_record(
  p_batch_id text,
  p_table text,
  p_record_id text,
  p_actor_id text,
  p_actor text
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  before_row jsonb;
  active_admins integer;
begin
  perform inventory.admin_purge_expired_recoveries();
  if not inventory.admin_data_table_allowed(p_table) then
    raise exception 'This data table is not available for Admin deletion';
  end if;
  if p_table = 'users' and p_record_id = p_actor_id then
    raise exception 'You cannot delete your current Admin account';
  end if;

  execute format('select to_jsonb(t) from inventory.%I t where id = $1 for update', p_table)
    into before_row using p_record_id;
  if before_row is null then raise exception 'Record not found'; end if;

  if p_table = 'users' and before_row->>'role' = 'Admin' and coalesce((before_row->>'active')::integer, 0) = 1 then
    select count(*) into active_admins from inventory.users where role = 'Admin' and active = 1;
    if active_admins <= 1 then raise exception 'The last active Admin account cannot be deleted'; end if;
  end if;

  insert into inventory.admin_recovery_batches(
    id, action, target_table, target_id, description, snapshot,
    record_count, actor_id, actor
  ) values (
    p_batch_id, 'DELETE_RECORD', p_table, p_record_id,
    format('Deleted %s · %s', replace(p_table, '_', ' '), p_record_id),
    jsonb_build_object('record', before_row), 1, p_actor_id, p_actor
  );

  perform set_config('ims.admin_data_control', 'on', true);
  execute format('delete from inventory.%I where id = $1', p_table) using p_record_id;
end;
$$;

create or replace function inventory.admin_delete_all(
  p_batch_id text,
  p_actor_id text,
  p_actor text,
  p_confirmation text
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  saved jsonb;
  saved_count integer;
begin
  perform inventory.admin_purge_expired_recoveries();
  if p_confirmation <> 'DELETE ALL INVENTORY DATA' then
    raise exception 'Type DELETE ALL INVENTORY DATA to confirm';
  end if;

  select jsonb_build_object(
    'companies', coalesce((select jsonb_agg(to_jsonb(t)) from inventory.companies t), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(to_jsonb(t)) from inventory.products t), '[]'::jsonb),
    'artisans', coalesce((select jsonb_agg(to_jsonb(t)) from inventory.artisans t), '[]'::jsonb),
    'ground_staff', coalesce((select jsonb_agg(to_jsonb(t)) from inventory.ground_staff t), '[]'::jsonb),
    'lots', coalesce((select jsonb_agg(to_jsonb(t)) from inventory.lots t), '[]'::jsonb),
    'generated_labels', coalesce((select jsonb_agg(to_jsonb(t)) from inventory.generated_labels t), '[]'::jsonb),
    'pieces', coalesce((select jsonb_agg(to_jsonb(t)) from inventory.pieces t), '[]'::jsonb),
    'transactions', coalesce((select jsonb_agg(to_jsonb(t)) from inventory.transactions t), '[]'::jsonb),
    'transaction_items', coalesce((select jsonb_agg(to_jsonb(t)) from inventory.transaction_items t), '[]'::jsonb),
    'piece_events', coalesce((select jsonb_agg(to_jsonb(t)) from inventory.piece_events t), '[]'::jsonb),
    'exceptions', coalesce((select jsonb_agg(to_jsonb(t)) from inventory.exceptions t), '[]'::jsonb),
    'stock_checks', coalesce((select jsonb_agg(to_jsonb(t)) from inventory.stock_checks t), '[]'::jsonb),
    'observations', coalesce((select jsonb_agg(to_jsonb(t)) from inventory.observations t), '[]'::jsonb),
    'print_jobs', coalesce((select jsonb_agg(to_jsonb(t)) from inventory.print_jobs t), '[]'::jsonb),
    'barcode_recoveries', coalesce((select jsonb_agg(to_jsonb(t)) from inventory.barcode_recoveries t), '[]'::jsonb)
  ) into saved;

  select coalesce(sum(jsonb_array_length(value)), 0)::integer
  into saved_count from jsonb_each(saved);

  insert into inventory.admin_recovery_batches(
    id, action, description, snapshot, record_count, actor_id, actor
  ) values (
    p_batch_id, 'DELETE_ALL', 'Deleted all inventory and operational data',
    saved, saved_count, p_actor_id, p_actor
  );

  perform set_config('ims.admin_data_control', 'on', true);
  delete from inventory.observations;
  delete from inventory.stock_checks;
  delete from inventory.transaction_items;
  delete from inventory.piece_events;
  delete from inventory.generated_labels;
  delete from inventory.pieces;
  delete from inventory.transactions;
  delete from inventory.lots;
  delete from inventory.barcode_recoveries;
  delete from inventory.print_jobs;
  delete from inventory.exceptions;
  delete from inventory.artisans;
  delete from inventory.ground_staff;
  delete from inventory.companies;
  delete from inventory.products;
  delete from inventory.guards;
  delete from inventory.requests;
end;
$$;

create or replace function inventory.admin_undo_data_change(
  p_batch_id text,
  p_actor_id text,
  p_actor text
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  batch inventory.admin_recovery_batches%rowtype;
  columns_sql text;
  current_row jsonb;
  restored_count integer;
  table_name text;
  table_order text[] := array[
    'companies', 'products', 'artisans', 'ground_staff', 'lots',
    'generated_labels', 'pieces', 'transactions', 'transaction_items',
    'piece_events', 'exceptions', 'stock_checks', 'observations', 'print_jobs',
    'barcode_recoveries'
  ];
begin
  perform inventory.admin_purge_expired_recoveries();
  select * into batch from inventory.admin_recovery_batches where id = p_batch_id for update;
  if batch.id is null then raise exception 'Recovery record not found'; end if;
  if batch.undone_at is not null then raise exception 'This change has already been undone'; end if;
  if batch.expires_at <= clock_timestamp() or batch.snapshot is null then
    raise exception 'The five-hour Undo window has expired';
  end if;

  perform set_config('ims.admin_data_control', 'on', true);

  if batch.action = 'EDIT_RECORD' then
    execute format('select to_jsonb(t) from inventory.%I t where id = $1 for update', batch.target_table)
      into current_row using batch.target_id;
    if current_row is distinct from batch.after_data then
      raise exception 'This record changed after the Admin edit. Undo the newer change first';
    end if;
    select string_agg(format('%I', c.column_name), ', ' order by c.ordinal_position)
    into columns_sql
    from information_schema.columns c
    where c.table_schema = 'inventory'
      and c.table_name = batch.target_table
      and c.column_name <> 'id';
    execute format(
      'update inventory.%1$I set (%2$s) = (select %2$s from jsonb_populate_record(null::inventory.%1$I, $2)) where id = $1',
      batch.target_table, columns_sql
    ) using batch.target_id, batch.snapshot->'record';
  elsif batch.action = 'DELETE_RECORD' then
    execute format(
      'insert into inventory.%1$I select * from jsonb_populate_record(null::inventory.%1$I, $1)',
      batch.target_table
    ) using batch.snapshot->'record';
  elsif batch.action = 'DELETE_ALL' then
    foreach table_name in array table_order loop
      execute format(
        'insert into inventory.%1$I select * from jsonb_populate_recordset(null::inventory.%1$I, $1)',
        table_name
      ) using batch.snapshot->table_name;
    end loop;
  else
    raise exception 'Unknown recovery action';
  end if;

  update inventory.admin_recovery_batches
  set undone_at = clock_timestamp(),
      undone_by = p_actor,
      snapshot = null,
      after_data = null,
      change_data = null,
      purged_at = clock_timestamp()
  where id = p_batch_id;
end;
$$;

-- Existing immutable-history guards remain the default. The short-lived local
-- setting is only enabled inside the audited Admin functions above.
create or replace function inventory.reject_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('ims.admin_data_control', true) = 'on' then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  raise exception using message = TG_ARGV[0], errcode = '23514';
end;
$$;

create or replace function inventory.validate_company_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('ims.admin_data_control', true), '') <> 'on'
     and (new.prefix is distinct from old.prefix or new.ownership is distinct from old.ownership) then
    raise exception using message = 'Company prefix and ownership are immutable', errcode = '23514';
  end if;
  if new.sequence < old.sequence and coalesce(current_setting('ims.admin_data_control', true), '') <> 'on' then
    raise exception using message = 'Sequence cannot decrease', errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function inventory.validate_generated_label_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('ims.admin_data_control', true), '') <> 'on'
     and row(new.id, new.code, new.company_id, new.product_id, new.lot_id, new.ownership)
       is distinct from row(old.id, old.code, old.company_id, old.product_id, old.lot_id, old.ownership) then
    raise exception using message = 'Generated barcode identity and source are immutable', errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function inventory.validate_recovery_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('ims.admin_data_control', true) = 'on' then return new; end if;
  if old.status in ('CONFIRMED','CANCELLED')
    or new.id is distinct from old.id or new.reason is distinct from old.reason
    or new.scope is distinct from old.scope or new.actor is distinct from old.actor
    or new.created_at is distinct from old.created_at
    or (old.status='AWAITING_SCAN' and (
      new.code is distinct from old.code or new.evidence is distinct from old.evidence
      or new.identified_reason is distinct from old.identified_reason
      or new.identified_at is distinct from old.identified_at or new.identified_by is distinct from old.identified_by
      or new.snapshot is distinct from old.snapshot or new.status not in ('CONFIRMED','CANCELLED')))
    or (old.status='UNIDENTIFIED' and new.status not in ('AWAITING_SCAN','CANCELLED'))
  then raise exception 'Recovery history cannot be rewritten'; end if;
  return new;
end;
$$;

-- Preserve all normal piece state validation while allowing the Admin editor to
-- correct immutable identity/source fields under a recovery batch.
create or replace function inventory.validate_piece()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if TG_OP = 'UPDATE'
     and coalesce(current_setting('ims.admin_data_control', true), '') <> 'on'
     and row(new.id, new.code, new.company_id, new.product_id, new.lot_id, new.ownership, new.journey)
       is distinct from row(old.id, old.code, old.company_id, old.product_id, old.lot_id, old.ownership, old.journey) then
    raise exception using message = 'Piece identity, journey and original source are immutable', errcode = '23514';
  end if;

  if new.holder not in ('IN_HOUSE', 'WITH_ARTISAN', 'GROUND_STAFF', 'EXCEPTION', 'RETURNED_TO_SOURCE', 'JOBWORK_COMPANY', 'OFFICE_PENDING', 'OFFICE_STOCK', 'SOLD', 'FACTORY_RETURN_PENDING')
     or (new.holder = 'WITH_ARTISAN' and new.artisan_id is null)
     or (new.holder <> 'WITH_ARTISAN' and new.artisan_id is not null)
     or (new.holder = 'GROUND_STAFF' and new.ground_staff_id is null)
     or (new.holder <> 'GROUND_STAFF' and new.ground_staff_id is not null)
     or new.condition not in ('PENDING_LABEL_CONFIRMATION', 'AVAILABLE', 'ACCEPTED_WORK', 'NEEDS_REWORK', 'DAMAGED', 'DISPUTED', 'REPRINTING', 'FINISHING', 'FINISHED')
     or (new.condition <> 'PENDING_LABEL_CONFIRMATION' and new.label_confirmed_at is null)
     or (TG_OP = 'UPDATE' and old.holder = 'RETURNED_TO_SOURCE' and new.holder <> 'RETURNED_TO_SOURCE')
     or (new.condition = 'REPRINTING' and new.holder <> 'WITH_ARTISAN')
     or (new.condition = 'FINISHING' and new.holder <> 'GROUND_STAFF')
     or (new.condition = 'FINISHED' and new.holder not in ('IN_HOUSE', 'JOBWORK_COMPANY', 'OFFICE_PENDING', 'OFFICE_STOCK', 'SOLD'))
     or (new.holder = 'JOBWORK_COMPANY' and new.ownership <> 'EXTERNAL')
     or (new.holder in ('OFFICE_PENDING', 'OFFICE_STOCK', 'SOLD', 'FACTORY_RETURN_PENDING') and new.ownership <> 'OWN' and new.journey <> 'OFFICE')
     or (new.holder = 'FACTORY_RETURN_PENDING' and new.condition <> 'DISPUTED')
     or (new.journey = 'OFFICE' and new.holder not in ('OFFICE_PENDING', 'OFFICE_STOCK', 'SOLD'))
     or (new.journey = 'OFFICE' and new.condition not in ('PENDING_LABEL_CONFIRMATION', 'FINISHED', 'DISPUTED')) then
    raise exception using message = 'Invalid factory or office custody state for this journey', errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function inventory.admin_data_table_allowed(text) from public, anon, authenticated;
revoke execute on function inventory.admin_purge_expired_recoveries() from public, anon, authenticated;
revoke execute on function inventory.admin_edit_record(text, text, text, jsonb, text, text) from public, anon, authenticated;
revoke execute on function inventory.admin_delete_record(text, text, text, text, text) from public, anon, authenticated;
revoke execute on function inventory.admin_delete_all(text, text, text, text) from public, anon, authenticated;
revoke execute on function inventory.admin_undo_data_change(text, text, text) from public, anon, authenticated;
