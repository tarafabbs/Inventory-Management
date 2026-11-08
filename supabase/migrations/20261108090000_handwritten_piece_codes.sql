set search_path to inventory, public;

-- Four-character handwritten codes use only characters that stay distinct on a
-- small tag. 0, 1, I, L and O are intentionally excluded.
create sequence if not exists inventory.piece_code_seq
  as bigint
  minvalue 0
  start with 0
  increment by 1
  no cycle;

create or replace function inventory.next_piece_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  base constant integer := length(alphabet);
  value bigint := nextval('inventory.piece_code_seq');
  code text := '';
  position integer;
begin
  if value >= base::bigint * base * base * base then
    raise exception using
      message = 'The four-character inventory code space is exhausted',
      errcode = '22003';
  end if;

  for position in 1..4 loop
    code := substr(alphabet, (value % base)::integer + 1, 1) || code;
    value := value / base;
  end loop;
  return code;
end;
$$;

-- Convert every existing permanent identity once. Generated-label and piece
-- rows that share an identity receive the same new code.
create temporary table handwritten_code_map on commit drop as
select old_code, inventory.next_piece_code() as new_code
from (
  select code as old_code from inventory.generated_labels
  union
  select code as old_code from inventory.pieces
) existing
order by old_code;

select set_config('ims.admin_data_control', 'on', true);

-- The temporary prefix prevents a pre-existing four-character value from
-- colliding while all identities are moved in one transaction.
update inventory.generated_labels target
set code = '~' || mapping.new_code
from handwritten_code_map mapping
where target.code = mapping.old_code;

update inventory.pieces target
set code = '~' || mapping.new_code
from handwritten_code_map mapping
where target.code = mapping.old_code;

update inventory.barcode_recoveries target
set code = '~' || mapping.new_code
from handwritten_code_map mapping
where target.code = mapping.old_code;

update inventory.observations target
set code = '~' || mapping.new_code
from handwritten_code_map mapping
where target.code = mapping.old_code;

update inventory.generated_labels set code = substr(code, 2) where code like '~%';
update inventory.pieces set code = substr(code, 2) where code like '~%';
update inventory.barcode_recoveries set code = substr(code, 2) where code like '~%';
update inventory.observations set code = substr(code, 2) where code like '~%';

alter table inventory.barcode_recoveries
  drop constraint if exists barcode_recoveries_confirmation_source_check;

-- Recovery confirmation is now manual-only. Existing camera/scanner values are
-- normalized so the application and database enforce the same workflow.
update inventory.barcode_recoveries
set confirmation_source = 'manual'
where confirmation_source is not null;

alter table inventory.barcode_recoveries
  add constraint barcode_recoveries_confirmation_source_manual_check
  check (confirmation_source is null or confirmation_source = 'manual');

-- Keep saved history and stock-check snapshots readable with the new code.
with converted as (
  select target.id,
    jsonb_agg(
      case when mapping.new_code is null then entry
        else jsonb_set(entry, '{code}', to_jsonb(mapping.new_code), false)
      end order by ordinal
    ) as value
  from inventory.transactions target
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(target.snapshot::jsonb) = 'array'
      then target.snapshot::jsonb else '[]'::jsonb end
  ) with ordinality as items(entry, ordinal)
  left join handwritten_code_map mapping on mapping.old_code = entry->>'code'
  group by target.id
)
update inventory.transactions target
set snapshot = converted.value::text
from converted
where target.id = converted.id
  and converted.value is not null;

update inventory.transaction_items target
set before_state = coalesce((
      select jsonb_set(target.before_state::jsonb, '{code}', to_jsonb(mapping.new_code), false)::text
      from handwritten_code_map mapping
      where mapping.old_code = target.before_state::jsonb->>'code'
    ), target.before_state),
    after_state = coalesce((
      select jsonb_set(target.after_state::jsonb, '{code}', to_jsonb(mapping.new_code), false)::text
      from handwritten_code_map mapping
      where mapping.old_code = target.after_state::jsonb->>'code'
    ), target.after_state)
where exists (
  select 1 from handwritten_code_map mapping
  where mapping.old_code in (target.before_state::jsonb->>'code', target.after_state::jsonb->>'code')
);

update inventory.piece_events target
set before_state = coalesce((
      select jsonb_set(target.before_state::jsonb, '{code}', to_jsonb(mapping.new_code), false)::text
      from handwritten_code_map mapping
      where target.before_state is not null
        and mapping.old_code = target.before_state::jsonb->>'code'
    ), target.before_state),
    after_state = coalesce((
      select jsonb_set(target.after_state::jsonb, '{code}', to_jsonb(mapping.new_code), false)::text
      from handwritten_code_map mapping
      where mapping.old_code = target.after_state::jsonb->>'code'
    ), target.after_state)
where exists (
  select 1 from handwritten_code_map mapping
  where mapping.old_code in (target.before_state::jsonb->>'code', target.after_state::jsonb->>'code')
);

update inventory.barcode_recoveries target
set snapshot = coalesce((
  select jsonb_set(target.snapshot::jsonb, '{code}', to_jsonb(mapping.new_code), false)::text
  from handwritten_code_map mapping
  where target.snapshot is not null
    and jsonb_typeof(target.snapshot::jsonb) = 'object'
    and mapping.old_code = target.snapshot::jsonb->>'code'
), target.snapshot)
where target.snapshot is not null
  and jsonb_typeof(target.snapshot::jsonb) = 'object';

with converted as (
  select target.id,
    jsonb_agg(
      case when mapping.new_code is null then entry
        else jsonb_set(entry, '{code}', to_jsonb(mapping.new_code), false)
      end order by ordinal
    ) as value
  from inventory.stock_checks target
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(target.expected::jsonb) = 'array'
      then target.expected::jsonb else '[]'::jsonb end
  ) with ordinality as items(entry, ordinal)
  left join handwritten_code_map mapping on mapping.old_code = entry->>'code'
  group by target.id
)
update inventory.stock_checks target
set expected = converted.value::text
from converted
where target.id = converted.id
  and converted.value is not null;

with converted as (
  select target.id,
    jsonb_agg(to_jsonb(coalesce(mapping.new_code, entry)) order by ordinal) as value
  from inventory.print_jobs target
  cross join lateral jsonb_array_elements_text(target.codes::jsonb)
    with ordinality as items(entry, ordinal)
  left join handwritten_code_map mapping on mapping.old_code = entry
  group by target.id
)
update inventory.print_jobs target
set codes = converted.value::text
from converted
where target.id = converted.id
  and converted.value is not null;

alter table inventory.generated_labels
  add constraint generated_labels_handwritten_code_check
  check (code ~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$');

alter table inventory.pieces
  add constraint pieces_handwritten_code_check
  check (code ~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$');

comment on column inventory.generated_labels.code is
  'Permanent four-character code written by hand on the physical tag.';
comment on column inventory.pieces.code is
  'Permanent four-character code written by hand on the physical tag.';

create or replace function inventory.validate_generated_label_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('ims.admin_data_control', true), '') <> 'on'
     and (
       row(new.id, new.code, new.company_id, new.product_id, new.lot_id, new.ownership)
         is distinct from row(old.id, old.code, old.company_id, old.product_id, old.lot_id, old.ownership)
       or (old.thanwala_id is not null and new.thanwala_id is distinct from old.thanwala_id)
     ) then
    raise exception using message = 'Generated code identity and saved purchase source are immutable', errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function inventory.next_piece_code() from public, anon, authenticated;
