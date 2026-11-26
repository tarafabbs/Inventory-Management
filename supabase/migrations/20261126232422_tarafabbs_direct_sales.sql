-- Direct sales accounting is separate from jobwork companies. Stock still uses the production ledger.
create table inventory.sales_customers (
 id text primary key, name text not null, address text not null default '',
 phone text not null default '', gst text not null default '', created_at timestamptz not null default now()
);
create table inventory.sales_products (
 id text primary key, name text not null, price bigint not null check (price>=0),
 hsn text not null default '', sku text not null default '', stock_product text references inventory.products(id)
);
create unique index sales_product_name_ci on inventory.sales_products(lower(name)) where stock_product is null;
create unique index sales_product_stock_link on inventory.sales_products(stock_product) where stock_product is not null;
create table inventory.sales_sequences (
 series text not null, year int not null, last_number int not null check(last_number between 1 and 9999999),
 primary key (series,year)
);
create table inventory.sales_documents (
 id text primary key, kind text not null check(kind in ('bill','booking','return')),
 gst boolean not null, fiscal_year int not null, number text not null unique, date date not null,
 customer text not null references inventory.sales_customers(id),
 booking_id text references inventory.sales_documents(id), revision integer not null default 1,
 body jsonb not null, stock_delta jsonb not null default '[]', total bigint not null, paid bigint not null,
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 voided_at timestamptz
);
create unique index sales_booking_redemption on inventory.sales_documents(booking_id)
 where booking_id is not null and voided_at is null;
create index sales_documents_customer on inventory.sales_documents(customer,date);
create table inventory.sales_document_revisions (
 document text not null references inventory.sales_documents(id), revision integer not null,
 operation text not null, actor_id text not null, actor text not null, saved_at timestamptz not null default clock_timestamp(),
 snapshot jsonb not null, primary key(document,revision)
);
create table inventory.sales_customer_money (
 id text primary key, customer text not null references inventory.sales_customers(id), date date not null,
 kind text not null check(kind in ('opening','payment')), amount bigint not null check(amount<>0),
 method text not null default '', notes text not null default '', actor_id text not null, actor text not null,
 created_at timestamptz not null default clock_timestamp()
);
create unique index sales_customer_one_opening on inventory.sales_customer_money(customer) where kind='opening';
create index sales_customer_money_date on inventory.sales_customer_money(customer,date);
create table inventory.sales_layout (
 singleton boolean primary key check(singleton), body jsonb not null
);
create table inventory.sales_job_advances (
 id text primary key, company text not null references inventory.companies(id),
 date date not null, amount bigint not null check(amount>0), notes text not null,
 actor text not null, created_at timestamptz not null default clock_timestamp()
);
create index sales_job_advances_company on inventory.sales_job_advances(company,date);
do $$ declare target text; begin
 foreach target in array array['sales_customers','sales_products','sales_sequences','sales_documents','sales_document_revisions','sales_customer_money','sales_layout','sales_job_advances'] loop
  execute format('alter table inventory.%I enable row level security', target);
  execute format('revoke all on inventory.%I from public,anon,authenticated', target);
 end loop;
end $$;
