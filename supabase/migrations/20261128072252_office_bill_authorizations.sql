alter table inventory.office_employees
  add column signature text not null default '',
  add column next_salary_date date;

create table inventory.office_bill_access_requests (
  id uuid primary key default gen_random_uuid(),
  document uuid not null references inventory.office_documents(id),
  requester_id text not null references inventory.users(id),
  action text not null check (action in ('edit','delete')),
  status text not null default 'pending' check (status in ('pending','approved','denied','used')),
  reason text not null default '',
  decided_by text references inventory.users(id),
  requested_at timestamptz not null default clock_timestamp(),
  decided_at timestamptz,
  used_at timestamptz
);
create unique index office_bill_access_one_pending
  on inventory.office_bill_access_requests(document,requester_id,action)
  where status='pending';
create index office_bill_access_owner_queue
  on inventory.office_bill_access_requests(status,requested_at desc);
create index office_bill_access_requester
  on inventory.office_bill_access_requests(requester_id,requested_at desc);

alter table inventory.office_bill_access_requests enable row level security;
revoke all on inventory.office_bill_access_requests from public, anon, authenticated;
