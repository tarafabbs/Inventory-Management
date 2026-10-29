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
    raise exception using message = 'Generated barcode identity and saved purchase source are immutable', errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function inventory.validate_piece()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if TG_OP = 'UPDATE'
     and coalesce(current_setting('ims.admin_data_control', true), '') <> 'on'
     and (
       row(new.id, new.code, new.company_id, new.product_id, new.lot_id, new.ownership, new.journey)
         is distinct from row(old.id, old.code, old.company_id, old.product_id, old.lot_id, old.ownership, old.journey)
       or (old.thanwala_id is not null and new.thanwala_id is distinct from old.thanwala_id)
     ) then
    raise exception using message = 'Piece identity, journey and saved purchase source are immutable', errcode = '23514';
  end if;

  if new.holder not in ('IN_HOUSE', 'WITH_ARTISAN', 'GROUND_STAFF', 'EXCEPTION', 'RETURNED_TO_SOURCE', 'JOBWORK_COMPANY', 'OFFICE_PENDING', 'OFFICE_STOCK', 'SOLD', 'FACTORY_RETURN_PENDING')
     or (new.holder = 'WITH_ARTISAN' and new.artisan_id is null)
     or (new.holder <> 'WITH_ARTISAN' and new.artisan_id is not null)
     or (new.holder = 'GROUND_STAFF' and new.ground_staff_id is null)
     or (new.holder <> 'GROUND_STAFF' and new.ground_staff_id is not null)
     or new.condition not in ('PENDING_LABEL_CONFIRMATION', 'AVAILABLE', 'ACCEPTED_WORK', 'NEEDS_REWORK', 'DAMAGED', 'DISPUTED', 'REPRINTING', 'FINISHING', 'FINISHED')
     or (new.condition <> 'PENDING_LABEL_CONFIRMATION' and new.label_confirmed_at is null)
     or (TG_OP = 'UPDATE' and old.holder = 'RETURNED_TO_SOURCE' and new.holder <> 'RETURNED_TO_SOURCE')
     or (new.condition = 'REPRINTING' and new.holder <> 'WITH_ARTISAN')
     or (new.condition = 'FINISHING' and new.holder <> 'GROUND_STAFF')
     or (new.condition = 'FINISHED' and new.holder not in ('IN_HOUSE', 'JOBWORK_COMPANY', 'OFFICE_PENDING', 'OFFICE_STOCK', 'SOLD'))
     or (new.holder = 'JOBWORK_COMPANY' and new.ownership <> 'EXTERNAL')
     or (new.holder in ('OFFICE_PENDING', 'OFFICE_STOCK', 'SOLD', 'FACTORY_RETURN_PENDING') and new.ownership <> 'OWN' and new.journey <> 'OFFICE')
     or (new.holder = 'FACTORY_RETURN_PENDING' and new.condition <> 'DISPUTED')
     or (new.journey = 'OFFICE' and new.holder not in ('OFFICE_PENDING', 'OFFICE_STOCK', 'SOLD'))
     or (new.journey = 'OFFICE' and new.condition not in ('PENDING_LABEL_CONFIRMATION', 'FINISHED', 'DISPUTED')) then
    raise exception using message = 'Invalid factory or office custody state for this journey', errcode = '23514';
  end if;
  return new;
end;
$$;
