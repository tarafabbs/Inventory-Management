alter table inventory.users drop constraint users_role_check;
alter table inventory.users add constraint users_role_check check (
  role in ('Admin','Management','Office Manager','Assistant Manager','Supervisor','Operator','Receiving','Issue','Inspection','Office Staff','Viewer')
);
create unique index inventory_users_google_email_ci_idx on inventory.users(lower(email));

create table inventory.change_audit (
  id uuid primary key default gen_random_uuid(),
  actor_id text not null,
  actor text not null,
  actor_role text not null,
  action text not null,
  target_label text not null,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default clock_timestamp()
);
create index change_audit_recent_idx on inventory.change_audit(created_at desc);
alter table inventory.change_audit enable row level security;
revoke all on inventory.change_audit from public, anon, authenticated;

alter table inventory.quantity_movements
  drop constraint quantity_movements_kind_check,
  drop constraint quantity_movements_from_stage_check,
  drop constraint quantity_movements_to_stage_check,
  drop constraint quantity_movements_check1,
  drop constraint quantity_movements_check2,
  add column actor_role text,
  add constraint quantity_movements_kind_check check (kind in (
    'receipt','accept_pending','issue','issue_edit','receive','receive_repair','receive_dispute',
    'mark_repair','send_repair','receive_repaired','mark_dispute','raw_dispute','repair_dispute',
    'resolve_dispute','dispute_return','dispatch','send_office','receive_factory_return',
    'office_receive','office_vendor_receipt','office_accept_pending','office_sell',
    'office_dispute_return','office_customer_return'
  )),
  add constraint quantity_movements_from_stage_check check (from_stage in (
    'raw','artisan','ready','repair','repair_artisan','disputed','pending',
    'office_pending','office_vendor_pending','office_stock','office_sold','factory_return_pending'
  )),
  add constraint quantity_movements_to_stage_check check (to_stage in (
    'raw','artisan','ready','repair','repair_artisan','disputed','dispute_returned','delivered',
    'office_pending','office_stock','office_sold','factory_return_pending'
  )),
  add constraint quantity_movements_receipt_source check ((kind in ('receipt','office_vendor_receipt')) = (from_stage is null)),
  add constraint quantity_movements_receipt_date check ((kind in ('receipt','office_vendor_receipt')) = (received_on is not null));

create or replace view inventory.quantity_balances with (security_invoker = true) as
with legacy as (
  select company_id, product_id, artisan_id,
    case
      when holder = 'OFFICE_PENDING' and journey = 'OFFICE' then 'office_vendor_pending'
      when holder = 'OFFICE_PENDING' then 'office_pending'
      when holder = 'OFFICE_STOCK' then 'office_stock'
      when holder = 'SOLD' then 'office_sold'
      when holder = 'FACTORY_RETURN_PENDING' then 'factory_return_pending'
      when holder = 'RETURNED_TO_SOURCE' then 'dispute_returned'
      when holder = 'JOBWORK_COMPANY' then 'delivered'
      when holder = 'EXCEPTION' then 'review'
      when condition = 'PENDING_LABEL_CONFIRMATION' then 'pending'
      when holder = 'WITH_ARTISAN' and condition = 'REPRINTING' then 'repair_artisan'
      when holder = 'WITH_ARTISAN' then 'artisan'
      when condition in ('DAMAGED','DISPUTED') then 'disputed'
      when condition in ('NEEDS_REWORK','FINISHING') then 'repair'
      when condition in ('ACCEPTED_WORK','FINISHED') then 'ready'
      when holder = 'IN_HOUSE' and condition = 'AVAILABLE' then 'raw'
      else 'review'
    end as stage
  from inventory.pieces
  where holder in ('OFFICE_PENDING','OFFICE_STOCK','SOLD','FACTORY_RETURN_PENDING')
     or (journey='WORKSHOP' and not exists (
       select 1 from inventory.settings where key='quantity_legacy_opening' and value='disabled'
     ))
), deltas as (
  select company_id, product_id, case when stage in ('artisan','repair_artisan') then artisan_id end as artisan_id,
    stage, 1 as quantity from legacy
  union all
  select g.company_id, g.product_id, null, 'pending', 1
  from inventory.generated_labels g join inventory.lots l on l.id=g.lot_id
  where l.journey='WORKSHOP' and g.state='PENDING'
    and not exists (select 1 from inventory.settings where key='quantity_legacy_opening' and value='disabled')
    and not exists (select 1 from inventory.pieces p where p.code=g.code)
  union all
  select m.company_id, m.product_id, case when d.stage in ('artisan','repair_artisan') then m.artisan_id end,
    d.stage, d.quantity
  from inventory.quantity_movements m
  cross join lateral (values (m.from_stage,-m.quantity),(m.to_stage,m.quantity)) d(stage,quantity)
  where d.stage is not null
)
select company_id,product_id,artisan_id,stage,sum(quantity) as quantity
from deltas group by company_id,product_id,artisan_id,stage;

create function inventory.assert_quantity_balances()
returns void language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from inventory.quantity_balances where quantity < 0) then
    raise exception 'This stock record has later movements. Correct those movements before editing or deleting it.';
  end if;
end;
$$;
revoke execute on function inventory.assert_quantity_balances() from public, anon, authenticated;

-- General corrections remain available to Management. Destructive operations and
-- restoration of deleted data require the Owner. Quantity records enter the same recovery window.
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
    'barcode_recoveries', 'quantity_movements'
  ]::text[]);
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
  if not exists (select 1 from inventory.users where id=p_actor_id and active=1
      and (role='Admin' or (role='Management' and p_table <> 'users'))) then
    raise exception 'This account cannot edit the selected dataset.';
  end if;
  if p_table='quantity_movements' then
    raise exception 'Use the quantity History screen for stock corrections.';
  end if;
  lock table inventory.quantity_movements in share row exclusive mode;
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
  perform inventory.assert_quantity_balances();
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
  if p_table='users' then
    lock table inventory.users in share row exclusive mode;
  end if;
  if not exists (select 1 from inventory.users where id=p_actor_id and role='Admin' and active=1) then
    raise exception 'Only the Owner can perform this action.';
  end if;
  lock table inventory.quantity_movements in share row exclusive mode;
  perform inventory.admin_purge_expired_recoveries();
  if not inventory.admin_data_table_allowed(p_table) then
    raise exception 'This data table is not available for Admin deletion';
  end if;
  if p_table = 'users' and p_record_id = p_actor_id then
    raise exception 'You cannot delete your current Admin account';
  end if;

  execute format('select to_jsonb(t) from inventory.%I t where id::text = $1 for update', p_table)
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
  execute format('delete from inventory.%I where id::text = $1', p_table) using p_record_id;
  perform inventory.assert_quantity_balances();
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
  if not exists (select 1 from inventory.users where id=p_actor_id and role='Admin' and active=1) then
    raise exception 'Only the Owner can perform this action.';
  end if;
  lock table inventory.quantity_movements in share row exclusive mode;
  perform inventory.admin_purge_expired_recoveries();
  if p_confirmation is distinct from 'DELETE ALL INVENTORY DATA' then
    raise exception 'Type DELETE ALL INVENTORY DATA to confirm';
  end if;

  select jsonb_build_object(
    'quantity_movements', coalesce((select jsonb_agg(to_jsonb(t)) from inventory.quantity_movements t), '[]'::jsonb),
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
  delete from inventory.quantity_movements;
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
    'barcode_recoveries', 'quantity_movements'
  ];
begin
  lock table inventory.quantity_movements in share row exclusive mode;
  perform inventory.admin_purge_expired_recoveries();
  select * into batch from inventory.admin_recovery_batches where id = p_batch_id for update;
  if batch.id is null then raise exception 'Recovery record not found'; end if;
  if batch.target_table='users' then
    lock table inventory.users in share row exclusive mode;
  end if;
  if not exists (select 1 from inventory.users where id=p_actor_id and active=1
      and (role='Admin' or (role='Management' and batch.action='EDIT_RECORD'
        and batch.actor_id=p_actor_id and batch.target_table <> 'users'))) then
    raise exception 'This account cannot restore the selected action.';
  end if;
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

  perform inventory.assert_quantity_balances();
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
