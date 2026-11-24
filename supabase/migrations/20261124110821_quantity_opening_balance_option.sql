-- Set quantity_legacy_opening to disabled to start with an empty opening balance.
-- The original bills, piece codes, and audit history stay available for reconciliation.
-- Explicit quantity entries always count in the workshop ledger.
create or replace view inventory.quantity_balances with (security_invoker = true) as
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
    and not exists (select 1 from inventory.settings where key = 'quantity_legacy_opening' and value = 'disabled')
), deltas as (
  select company_id, product_id, case when stage in ('artisan', 'repair_artisan') then artisan_id end as artisan_id,
    stage, 1 as quantity from legacy
  union all
  select g.company_id, g.product_id, null, 'pending', 1
  from inventory.generated_labels g join inventory.lots l on l.id = g.lot_id
  where l.journey = 'WORKSHOP' and g.state = 'PENDING'
    and not exists (select 1 from inventory.settings where key = 'quantity_legacy_opening' and value = 'disabled')
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

create or replace view inventory.quantity_totals with (security_invoker = true) as
select company_id, product_id, sum(received) as received, sum(issued) as issued,
  sum(artist_returns) as artist_returns
from (
  select company_id, product_id, accepted as received, 0 as issued, 0 as artist_returns
  from inventory.lots where journey = 'WORKSHOP' and status <> 'DRAFT'
    and not exists (select 1 from inventory.settings where key = 'quantity_legacy_opening' and value = 'disabled')
  union all
  select p.company_id, p.product_id, 0, (t.type = 'HANDOFF')::int, (t.type = 'RETURN')::int
  from inventory.transaction_items i
  join inventory.transactions t on t.id = i.transaction_id
  join inventory.pieces p on p.id = i.piece_id
  where p.journey = 'WORKSHOP' and t.status = 'CONFIRMED' and t.type in ('HANDOFF','RETURN')
    and not exists (select 1 from inventory.settings where key = 'quantity_legacy_opening' and value = 'disabled')
  union all
  select company_id, product_id, case when kind = 'receipt' then quantity else 0 end,
    case when kind in ('issue','issue_edit') then quantity else 0 end,
    case when kind in ('receive','receive_repair','receive_dispute') then quantity else 0 end
  from inventory.quantity_movements
) entries group by company_id, product_id;

revoke all on inventory.quantity_balances, inventory.quantity_totals from public, anon, authenticated;
