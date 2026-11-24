alter table inventory.companies
  add column if not exists address text not null default '',
  add column if not exists notes text not null default '';

comment on column inventory.companies.address is 'Editable postal or business address shown in the company profile.';
comment on column inventory.companies.notes is 'Internal company-profile notes. Stock identity continues to use the immutable company id.';
