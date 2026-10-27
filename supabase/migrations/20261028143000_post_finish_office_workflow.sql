set search_path to inventory, public;

alter table users drop constraint if exists users_role_check;
alter table users add constraint users_role_check
check (role in ('Admin', 'Supervisor', 'Operator', 'Receiving', 'Issue', 'Inspection', 'Office Staff', 'Viewer'));

create or replace function inventory.validate_piece()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if TG_OP = 'UPDATE' and
     row(new.id, new.code, new.company_id, new.product_id, new.lot_id, new.ownership)
     is distinct from row(old.id, old.code, old.company_id, old.product_id, old.lot_id, old.ownership) then
    raise exception using message = 'Piece identity and original source are immutable', errcode = '23514';
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
     or (new.holder in ('OFFICE_PENDING', 'OFFICE_STOCK', 'SOLD', 'FACTORY_RETURN_PENDING') and new.ownership <> 'OWN')
     or (new.holder = 'FACTORY_RETURN_PENDING' and new.condition <> 'DISPUTED') then
    raise exception using message = 'Invalid warehouse, company or office custody state', errcode = '23514';
  end if;

  return new;
end;
$$;

create index if not exists pieces_holder_condition_idx on pieces(holder, condition);
