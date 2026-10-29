create table inventory.thanwalas (
  id text primary key,
  name text not null,
  contact text not null default '',
  address text not null default '',
  active integer not null default 1 check (active in (0, 1)),
  created_at text not null
);

alter table inventory.lots
  add column thanwala_id text references inventory.thanwalas(id);
alter table inventory.generated_labels
  add column thanwala_id text references inventory.thanwalas(id);
alter table inventory.pieces
  add column thanwala_id text references inventory.thanwalas(id);

create index lots_thanwala_idx on inventory.lots(thanwala_id);
create index generated_labels_thanwala_idx on inventory.generated_labels(thanwala_id);
create index pieces_thanwala_idx on inventory.pieces(thanwala_id);

alter table inventory.thanwalas enable row level security;
revoke all on inventory.thanwalas from public, anon, authenticated;

create or replace function inventory.validate_generated_label_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('ims.admin_data_control', true), '') <> 'on'
     and row(new.id, new.code, new.company_id, new.product_id, new.lot_id, new.ownership, new.thanwala_id)
       is distinct from row(old.id, old.code, old.company_id, old.product_id, old.lot_id, old.ownership, old.thanwala_id) then
    raise exception using message = 'Generated barcode identity and purchase source are immutable', errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function inventory.validate_piece()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if TG_OP = 'UPDATE'
     and coalesce(current_setting('ims.admin_data_control', true), '') <> 'on'
     and row(new.id, new.code, new.company_id, new.product_id, new.lot_id, new.ownership, new.journey, new.thanwala_id)
       is distinct from row(old.id, old.code, old.company_id, old.product_id, old.lot_id, old.ownership, old.journey, old.thanwala_id) then
    raise exception using message = 'Piece identity, journey and original purchase source are immutable', errcode = '23514';
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

create or replace function inventory.admin_data_table_allowed(p_table text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_table = any(array[
    'companies', 'products', 'artisans', 'thanwalas', 'ground_staff', 'users', 'lots',
    'generated_labels', 'pieces', 'transactions', 'transaction_items',
    'piece_events', 'exceptions', 'stock_checks', 'observations', 'print_jobs',
    'barcode_recoveries'
  ]::text[]);
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
    'thanwalas', coalesce((select jsonb_agg(to_jsonb(t)) from inventory.thanwalas t), '[]'::jsonb),
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
  delete from inventory.thanwalas;
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
  table_name text;
  table_order text[] := array[
    'companies', 'products', 'artisans', 'thanwalas', 'ground_staff', 'lots',
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

revoke execute on function inventory.admin_data_table_allowed(text) from public, anon, authenticated;
revoke execute on function inventory.admin_delete_all(text, text, text, text) from public, anon, authenticated;
revoke execute on function inventory.admin_undo_data_change(text, text, text) from public, anon, authenticated;
