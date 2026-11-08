set search_path to inventory, public;

insert into companies (id, name, prefix, ownership, contact, active, sequence)
values (
  'system-tarafabbs-own',
  'TaraFabbs Own Product',
  'TFOWNDEFAULT',
  'OWN',
  'Internal source used when the optional own brand / purchasing company is not specified.',
  1,
  0
)
on conflict (id) do update
set name = excluded.name,
    ownership = excluded.ownership,
    active = 1;
