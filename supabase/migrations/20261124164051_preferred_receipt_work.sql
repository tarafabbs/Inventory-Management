alter table inventory.quantity_movements add column preferred_work text not null default '' check (length(preferred_work)<=300 and (preferred_work='' or kind='receipt'));
