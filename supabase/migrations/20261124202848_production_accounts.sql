-- Additive cutover. Existing tables and history remain unchanged.
create table inventory.production_events (
 id uuid primary key default gen_random_uuid(),kind text not null,company text not null default '',event_date date not null,
 reference text not null default '',notes text not null default '',actor_id text not null,actor text not null,actor_role text not null,
 payload jsonb not null,delta jsonb not null default '[]',created_at timestamptz not null default clock_timestamp()
);
create index production_events_company_date on inventory.production_events(company,event_date desc,created_at desc);
create index production_events_history on inventory.production_events(created_at desc,id);
create index production_events_payload on inventory.production_events using gin(payload);
create table inventory.production_balances (
 key text primary key,company text not null references inventory.companies(id),product text not null references inventory.products(id),
 pool text not null check(pool in ('normal','company_return')),stage text not null check(stage in ('raw','ready','hold','artist','reprint','damaged','delivered','raw_returned','office_pending','office_stock','office_sold','office_return')),
 artisan text not null default '',arts text not null default '',work text not null default '',quantity integer not null check(quantity>=0),since timestamptz not null default clock_timestamp(),
 check((stage in ('artist','reprint'))=(artisan<>'')),check(stage in ('artist','reprint') or work='')
);
create index production_balances_company on inventory.production_balances(company,product);
create index production_balances_artist on inventory.production_balances(artisan) where artisan<>'';
create table inventory.production_money (
 id uuid primary key default gen_random_uuid(),event_id uuid not null references inventory.production_events(id),company text not null references inventory.companies(id),amount bigint not null,kind text not null
);
create index production_money_company on inventory.production_money(company);
create index production_money_event on inventory.production_money(event_id);
create table inventory.production_documents (
 id uuid primary key references inventory.production_events(id),kind text not null check(kind in ('damage','order')),company text not null references inventory.companies(id),
 quantity integer not null check(quantity>0),settled integer not null default 0 check(settled>=0 and settled<=quantity),amount bigint not null default 0,settled_amount bigint not null default 0,voided_at timestamptz,payload jsonb not null,created_at timestamptz not null default clock_timestamp()
);
create index production_documents_company on inventory.production_documents(company);
create table inventory.production_requests(id text primary key,actor_id text not null,fingerprint text not null,result jsonb not null,created_at timestamptz not null default clock_timestamp());
alter table inventory.artisans add column work_types text[] not null default '{}';
update inventory.artisans set work_types=array[work_type] where work_type<>'';
do $$ declare t text; begin foreach t in array array['production_events','production_balances','production_money','production_documents','production_requests'] loop execute format('alter table inventory.%I enable row level security',t);execute format('revoke all on inventory.%I from public,anon,authenticated',t);end loop;end $$;
-- Import current aggregate stock exactly once. Reset-disabled legacy stock stays excluded.
with mapped as (
 select company_id as company,product_id as product,'normal'::text as pool,
 case stage when 'artisan' then 'artist' when 'repair_artisan' then 'reprint' when 'repair' then 'hold' when 'disputed' then 'hold' when 'dispute_returned' then 'raw_returned' when 'factory_return_pending' then 'office_return' when 'office_vendor_pending' then 'office_stock' when 'pending' then 'hold' when 'review' then 'hold' else stage end as stage,
 case when stage in ('artisan','repair_artisan') then coalesce(artisan_id,'') else '' end as artisan,
 case when stage in ('artisan','repair_artisan') then 'Legacy work — review' else '' end as work,
 sum(quantity)::integer as quantity from inventory.quantity_balances where quantity<>0 group by company_id,product_id,stage,artisan_id
), aggregated as(select company,product,pool,stage,artisan,work,sum(quantity)::integer as quantity from mapped group by company,product,pool,stage,artisan,work)
insert into inventory.production_balances(key,company,product,pool,stage,artisan,arts,work,quantity)
select concat('[',to_json(company)::text,',',to_json(product)::text,',"normal",',to_json(stage)::text,',',to_json(artisan)::text,',"",',to_json(work)::text,']'),company,product,pool,stage,artisan,'',work,quantity from aggregated where quantity>0;
insert into inventory.production_events(kind,event_date,notes,actor_id,actor,actor_role,payload,delta)
values('migration',current_date,'Existing quantity balances preserved; historical records remain in the archive.','system','System','System','{}','[]');
insert into inventory.settings(key,value) values('production_v2','enabled');

create view inventory.production_effective_events with (security_invoker=true) as
select e.*,case when e.kind='correct' then e.payload->>'correctionKind' else e.kind end as effective_kind
from inventory.production_events e
where e.kind not in ('delete','migration') and not exists (
 select 1 from inventory.production_events r where r.kind in ('correct','delete') and r.payload->>'document'=e.id::text
);
revoke all on inventory.production_effective_events from public,anon,authenticated;
create unique index production_account_dimensions on inventory.production_balances(company,product,pool,stage,artisan,arts,work);
-- Prevent a stale open tab from writing into the retired quantity ledger after cutover.
create function inventory.protect_retired_quantity_ledger() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if exists(select 1 from inventory.settings where key='production_v2' and value='enabled') then
  raise exception 'Previous quantity history is read-only. Refresh and use Stock Management.';
 end if;
 return coalesce(new,old);
end $$;
revoke all on function inventory.protect_retired_quantity_ledger() from public,anon,authenticated;
create trigger protect_retired_quantity_ledger before insert or update or delete on inventory.quantity_movements for each row execute function inventory.protect_retired_quantity_ledger();
create function inventory.protect_pending_artisan() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.active=0 and exists(select 1 from inventory.production_balances where artisan=new.id and quantity>0) then
  raise exception 'This artist still has pending quantity. Receive or correct it before archiving.';
 end if;
 return new;
end $$;
revoke all on function inventory.protect_pending_artisan() from public,anon,authenticated;
create trigger protect_pending_artisan before update of active on inventory.artisans for each row execute function inventory.protect_pending_artisan();
