-- Additive artisan money ledger. Stock and company money remain unchanged.
create table inventory.artisan_money (
 id uuid primary key default gen_random_uuid(),
 artisan text not null references inventory.artisans(id),
 event_id uuid references inventory.production_events(id),
 entry_date date not null,
 kind text not null check(kind in ('opening','charge','payment','refund','adjustment','reversal','stock_correction')),
 amount bigint not null check(amount<>0 and amount between -1000000000000 and 1000000000000),
 reference text not null default '',notes text not null default '',
 actor_id text not null,actor text not null,actor_role text not null,
 reversal_of uuid unique references inventory.artisan_money(id),
 created_at timestamptz not null default clock_timestamp(),
 check((kind='reversal')=(reversal_of is not null))
);
create index artisan_money_statement on inventory.artisan_money(artisan,entry_date,created_at,id);
create index artisan_money_event on inventory.artisan_money(event_id) where event_id is not null;
create unique index artisan_money_one_opening on inventory.artisan_money(artisan) where kind='opening';
alter table inventory.artisan_money enable row level security;
revoke all on inventory.artisan_money from public,anon,authenticated;
