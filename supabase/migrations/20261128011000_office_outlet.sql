-- The outlet has its own customers, documents and employee accounts.
-- Production stock remains in the shared quantity ledger.
alter table inventory.users drop constraint if exists users_role_check;
alter table inventory.users add constraint users_role_check check (
 role in ('Admin','Management','Office Manager','Assistant Manager','Office Staff','Production Manager',
          'Supervisor','Operator','Receiving','Issue','Inspection','Viewer')
);

create sequence inventory.office_employee_codes start 1;
create table inventory.office_employees (
 id uuid primary key default gen_random_uuid(),
 user_id text unique references inventory.users(id),
 employee_code text not null unique default ('TF-' || lpad(nextval('inventory.office_employee_codes')::text,5,'0')),
 role text not null check(role in ('Office Manager','Assistant Manager','Office Staff','Production Manager')),
 manager_id uuid references inventory.office_employees(id),
 name text not null, dob date, phone text not null default '', joining_date date not null,
 photo text not null default '', salary bigint not null default 0 check(salary>=0),
 half_month boolean not null default false,
 conversion_target integer not null default 0 check(conversion_target>=0),
 retention_target integer not null default 0 check(retention_target>=0),
 active boolean not null default true,
 created_at timestamptz not null default clock_timestamp()
);
create index office_employees_manager on inventory.office_employees(manager_id);

create table inventory.office_leads (
 id uuid primary key default gen_random_uuid(),
 name text not null, business_name text not null default '', phone text not null,
 whatsapp text not null default '', address text not null default '', gst text not null default '',
 created_by text not null references inventory.users(id),
 created_on date not null default ((now() at time zone 'Asia/Kolkata')::date),
 follow_up_date date, notes text not null default '',
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp()
);
create index office_leads_phone on inventory.office_leads(phone);
create index office_leads_followup on inventory.office_leads(follow_up_date);

create table inventory.office_products (
 id uuid primary key default gen_random_uuid(), name text not null,
 stock_product text references inventory.products(id),
 price bigint not null default 0 check(price>=0), hsn text not null default '', sku text not null default '',
 approximate_profit bigint not null default 0 check(approximate_profit>=0),
 incentive_class text not null default 'normal' check(incentive_class in ('normal','low','excluded')),
 low_incentive bigint not null default 0 check(low_incentive>=0),
 active boolean not null default true
);
create unique index office_product_name on inventory.office_products(lower(name)) where stock_product is null;
create index office_product_stock_link on inventory.office_products(stock_product) where stock_product is not null;

create table inventory.office_bill_layout (
 singleton boolean primary key default true check(singleton), body jsonb not null
);
create table inventory.office_bill_sequences (
 series text not null, fiscal_year integer not null, last_number integer not null,
 primary key(series,fiscal_year)
);
create table inventory.office_documents (
 id uuid primary key default gen_random_uuid(), kind text not null check(kind in ('bill','return')),
 number text not null unique, date date not null, customer uuid not null references inventory.office_leads(id),
 actor_id text not null references inventory.users(id), gst boolean not null default false,
 body jsonb not null, stock_delta jsonb not null default '[]'::jsonb,
 total bigint not null, paid bigint not null default 0, revision integer not null default 1,
 status text not null default 'open' check(status in ('open','settled')),
 original_bill uuid references inventory.office_documents(id),
 return_reason text not null default '',
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(), voided_at timestamptz
);
create index office_documents_customer on inventory.office_documents(customer,date desc);
create index office_documents_actor on inventory.office_documents(actor_id,date desc);
create table inventory.office_document_revisions (
 document uuid not null references inventory.office_documents(id), revision integer not null,
 operation text not null, actor_id text not null references inventory.users(id),
 snapshot jsonb not null, created_at timestamptz not null default clock_timestamp(),
 primary key(document,revision)
);
create table inventory.office_customer_money (
 id uuid primary key default gen_random_uuid(), customer uuid not null references inventory.office_leads(id),
 date date not null, amount bigint not null check(amount<>0),
 kind text not null check(kind in ('opening','payment','refund')),
 method text not null default '', notes text not null default '', actor_id text not null references inventory.users(id),
 created_at timestamptz not null default clock_timestamp()
);
create unique index office_customer_one_opening on inventory.office_customer_money(customer) where kind='opening';

create table inventory.office_advances (
 id uuid primary key default gen_random_uuid(), employee uuid not null references inventory.office_employees(id),
 date date not null, amount bigint not null check(amount>0), adjusted bigint not null default 0 check(adjusted>=0),
 notes text not null default '', approved_by text not null references inventory.users(id),
 created_at timestamptz not null default clock_timestamp(), check(adjusted<=amount)
);
create table inventory.office_salary_cycles (
 id uuid primary key default gen_random_uuid(), employee uuid not null references inventory.office_employees(id),
 period_start date not null, period_end date not null, salary bigint not null check(salary>=0),
 incentive bigint not null default 0, paid bigint not null default 0 check(paid>=0),
 advance_adjusted bigint not null default 0 check(advance_adjusted>=0),
 created_at timestamptz not null default clock_timestamp(),
 unique(employee,period_start,period_end)
);
create table inventory.office_salary_payments (
 id uuid primary key default gen_random_uuid(), cycle uuid not null references inventory.office_salary_cycles(id),
 amount bigint not null check(amount>0), advance_adjusted bigint not null default 0 check(advance_adjusted>=0),
 date date not null, actor_id text not null references inventory.users(id),
 created_at timestamptz not null default clock_timestamp()
);
create table inventory.office_incentive_rules (
 singleton boolean primary key default true check(singleton), body jsonb not null
);

do $$ declare target text; begin
 foreach target in array array[
  'office_employees','office_leads','office_products','office_bill_layout','office_bill_sequences',
  'office_documents','office_document_revisions','office_customer_money','office_advances',
  'office_salary_cycles','office_salary_payments','office_incentive_rules'
 ] loop
  execute format('alter table inventory.%I enable row level security',target);
  execute format('revoke all on inventory.%I from public,anon,authenticated',target);
 end loop;
end $$;
