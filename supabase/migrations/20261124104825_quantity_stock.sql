-- Quantity movements are independent of permanent piece identities. The views
-- include existing workshop pieces as opening stock without copying or deleting them.
create table inventory.quantity_movements (
  id uuid primary key default gen_random_uuid(),
  company_id text not null references inventory.companies(id),
  product_id text not null references inventory.products(id),
  artisan_id text references inventory.artisans(id),
  thanwala_id text references inventory.thanwalas(id),
  kind text not null check (kind in (
    'receipt', 'accept_pending', 'issue', 'issue_edit', 'receive', 'receive_repair', 'receive_dispute',
    'mark_repair', 'send_repair', 'receive_repaired', 'mark_dispute', 'raw_dispute',
    'repair_dispute', 'resolve_dispute', 'dispute_return', 'dispatch'
  )),
  from_stage text check (from_stage in ('raw', 'artisan', 'ready', 'repair', 'repair_artisan', 'disputed', 'pending')),
  to_stage text not null check (to_stage in ('raw', 'artisan', 'ready', 'repair', 'repair_artisan', 'disputed', 'dispute_returned', 'delivered')),
  quantity integer not null check (quantity between -1000000 and 1000000 and quantity <> 0),
  original_id uuid references inventory.quantity_movements(id),
  previous_quantity integer,
  new_quantity integer,
  received_on date,
  reference text not null default '',
  notes text not null default '',
  actor_id text not null,
  actor text not null,
  created_at timestamptz not null default clock_timestamp(),
  check (from_stage is distinct from to_stage),
  check ((kind = 'receipt') = (from_stage is null)),
  check ((kind = 'receipt') = (received_on is not null)),
  check ((artisan_id is not null) = (
    coalesce(from_stage in ('artisan', 'repair_artisan'), false) or to_stage in ('artisan', 'repair_artisan')
  )),
  check (
    (kind <> 'issue_edit' and quantity > 0 and original_id is null and previous_quantity is null and new_quantity is null)
    or (kind = 'issue_edit' and original_id is not null and previous_quantity is not null
        and new_quantity is not null and previous_quantity > 0 and new_quantity > 0
        and quantity = new_quantity - previous_quantity)
  )
);

create index quantity_movement_stock_idx on inventory.quantity_movements(company_id, product_id);
create index quantity_movement_product_idx on inventory.quantity_movements(product_id);
create index quantity_movement_artisan_idx on inventory.quantity_movements(artisan_id) where artisan_id is not null;
create index quantity_movement_thanwala_idx on inventory.quantity_movements(thanwala_id) where thanwala_id is not null;
create index quantity_movement_original_idx on inventory.quantity_movements(original_id, created_at desc) where original_id is not null;
create index quantity_movement_history_idx on inventory.quantity_movements(created_at desc, id);
alter table inventory.quantity_movements enable row level security;
revoke all on inventory.quantity_movements from public, anon, authenticated;

create view inventory.quantity_balances with (security_invoker = true) as
with legacy as (
  select company_id, product_id, artisan_id,
    case
      when holder = 'RETURNED_TO_SOURCE' then 'dispute_returned'
      when holder = 'JOBWORK_COMPANY' then 'delivered'
      when holder in ('OFFICE_PENDING','OFFICE_STOCK','SOLD') then 'office'
      when holder = 'FACTORY_RETURN_PENDING' then 'review'
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
  from inventory.pieces where journey = 'WORKSHOP'
), deltas as (
  select company_id, product_id, case when stage in ('artisan', 'repair_artisan') then artisan_id end as artisan_id,
    stage, 1 as quantity from legacy
  union all
  select g.company_id, g.product_id, null, 'pending', 1
  from inventory.generated_labels g join inventory.lots l on l.id = g.lot_id
  where l.journey = 'WORKSHOP' and g.state = 'PENDING'
    and not exists (select 1 from inventory.pieces p where p.code = g.code)
  union all
  select m.company_id, m.product_id, case when d.stage in ('artisan', 'repair_artisan') then m.artisan_id end,
    d.stage, d.quantity
  from inventory.quantity_movements m
  cross join lateral (values (m.from_stage, -m.quantity), (m.to_stage, m.quantity)) as d(stage, quantity)
  where d.stage is not null
)
select company_id, product_id, artisan_id, stage, sum(quantity) as quantity
from deltas group by company_id, product_id, artisan_id, stage;

create view inventory.quantity_totals with (security_invoker = true) as
select company_id, product_id, sum(received) as received, sum(issued) as issued,
  sum(artist_returns) as artist_returns
from (
  select company_id, product_id, accepted as received, 0 as issued, 0 as artist_returns
  from inventory.lots where journey = 'WORKSHOP' and status <> 'DRAFT'
  union all
  select p.company_id, p.product_id, 0, (t.type = 'HANDOFF')::int, (t.type = 'RETURN')::int
  from inventory.transaction_items i
  join inventory.transactions t on t.id = i.transaction_id
  join inventory.pieces p on p.id = i.piece_id
  where p.journey = 'WORKSHOP' and t.status = 'CONFIRMED' and t.type in ('HANDOFF','RETURN')
  union all
  select company_id, product_id, case when kind = 'receipt' then quantity else 0 end,
    case when kind in ('issue','issue_edit') then quantity else 0 end,
    case when kind in ('receive','receive_repair','receive_dispute') then quantity else 0 end
  from inventory.quantity_movements
) entries group by company_id, product_id;

revoke all on inventory.quantity_balances, inventory.quantity_totals from public, anon, authenticated;
