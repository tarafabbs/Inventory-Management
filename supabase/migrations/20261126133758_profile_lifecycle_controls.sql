-- Profiles are retained by ID so stock, financial ledgers and history never lose their links.
alter table inventory.companies add column profile_status text not null default 'active'
 check (profile_status in ('active','paused','archived','deleted'));
alter table inventory.artisans add column profile_status text not null default 'active'
 check (profile_status in ('active','paused','archived','deleted'));
update inventory.companies set profile_status='paused' where active=0;
update inventory.artisans set profile_status='paused' where active=0;
comment on column inventory.companies.profile_status is 'Owner-managed lifecycle. Delete is reversible and preserves all linked history.';
comment on column inventory.artisans.profile_status is 'Owner-managed lifecycle. Inactive profiles may settle existing stock and money.';

-- Owner lifecycle changes retain outstanding stock and permit its later receipt.
-- Keep the legacy guard for callers that change active without a lifecycle status.
create or replace function inventory.protect_pending_artisan() returns trigger
 language plpgsql security invoker set search_path='' as $$
begin
 if new.active=0 and new.profile_status='active' and exists(
  select 1 from inventory.production_balances where artisan=new.id and quantity>0
 ) then
  raise exception 'Use Owner profile status controls to pause or archive an artisan with pending stock.';
 end if;
 return new;
end $$;
revoke all on function inventory.protect_pending_artisan() from public,anon,authenticated;
