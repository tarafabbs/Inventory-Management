-- Shared artwork names, independent of whether any artisan has selected them yet.
create table inventory.art_styles (
 id uuid primary key default gen_random_uuid(),
 name text not null check (name=btrim(name) and char_length(name) between 1 and 120),
 active integer not null default 1 check (active in (0,1)),
 created_by text not null default 'migration',
 created_at timestamptz not null default clock_timestamp()
);
create unique index art_styles_name_ci on inventory.art_styles(lower(name));
alter table inventory.art_styles enable row level security;
revoke all on inventory.art_styles from public,anon,authenticated;
insert into inventory.art_styles(name) select name from (values
 ('Free Hand Paint'),
 ('Kalamkari'),
 ('Batik Paint'),
 ('Eco Print'),
 ('Momchitra'),
 ('Alcohol Paint'),
 ('Block Print'),
 ('Screen Print'),
 ('Block Batik Print'),
 ('Mix Dye'),
 ('Sibori Dye'),
 ('Pigment Block'),
 ('Cotton Batik'),
 ('Others')
) names(name) on conflict do nothing;
insert into inventory.art_styles(name)
 select distinct btrim(w) from inventory.artisans a cross join lateral unnest(coalesce(a.work_types,array[]::text[])||array[a.work_type]) w
 where char_length(btrim(w)) between 1 and 120
 on conflict do nothing;
