-- Private server-side audit records. Recovery never changes piece identity or stock state.
create table inventory.barcode_recoveries (
  id text primary key,
  code text,
  status text not null check (status in ('UNIDENTIFIED','AWAITING_SCAN','CONFIRMED','CANCELLED')),
  reason text not null,
  evidence text not null default '',
  identified_reason text not null default '',
  scope text not null check (scope in ('FACTORY','OFFICE')),
  actor text not null,
  created_at text not null,
  identified_by text,
  identified_at text,
  snapshot text,
  confirmed_by text,
  confirmed_at text,
  confirmation_source text check (confirmation_source in ('camera','scanner')),
  closed_reason text,
  closed_at text,
  check (status not in ('AWAITING_SCAN','CONFIRMED') or
    (code is not null and length(evidence)>=10 and identified_by is not null and identified_at is not null and snapshot is not null)),
  check (status<>'UNIDENTIFIED' or code is null),
  check (status<>'CONFIRMED' or (confirmed_at is not null and confirmed_by is not null and confirmation_source is not null)),
  check (status<>'CANCELLED' or (closed_at is not null and closed_reason is not null and confirmed_by is not null))
);
create unique index barcode_recoveries_one_pending_code on inventory.barcode_recoveries(code) where status='AWAITING_SCAN';
create index barcode_recoveries_status_created_idx on inventory.barcode_recoveries(status,created_at desc,id desc);
create index barcode_recoveries_code_idx on inventory.barcode_recoveries(code);
alter table inventory.barcode_recoveries enable row level security;
revoke all on inventory.barcode_recoveries from public,anon,authenticated;

create function inventory.validate_recovery_change() returns trigger
language plpgsql set search_path='' as $$
begin
  if old.status in ('CONFIRMED','CANCELLED')
    or new.id is distinct from old.id or new.reason is distinct from old.reason
    or new.scope is distinct from old.scope or new.actor is distinct from old.actor
    or new.created_at is distinct from old.created_at
    or (old.status='AWAITING_SCAN' and (
      new.code is distinct from old.code or new.evidence is distinct from old.evidence
      or new.identified_reason is distinct from old.identified_reason
      or new.identified_at is distinct from old.identified_at or new.identified_by is distinct from old.identified_by
      or new.snapshot is distinct from old.snapshot or new.status not in ('CONFIRMED','CANCELLED')))
    or (old.status='UNIDENTIFIED' and new.status not in ('AWAITING_SCAN','CANCELLED'))
  then raise exception 'Recovery history cannot be rewritten'; end if;
  return new;
end;
$$;
create trigger barcode_recovery_change_guard before update on inventory.barcode_recoveries
for each row execute function inventory.validate_recovery_change();
create trigger barcode_recovery_no_delete before delete on inventory.barcode_recoveries
for each row execute function inventory.reject_change('Recovery records are permanent');
revoke all on function inventory.validate_recovery_change() from public,anon,authenticated;
