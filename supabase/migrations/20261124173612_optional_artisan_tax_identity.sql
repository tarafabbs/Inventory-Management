alter table inventory.artisans
  add column gst_no text not null default '',
  add column pan_no text not null default '',
  add column aadhaar_no text not null default '';
alter table inventory.artisans
  add constraint artisan_gst_format check (gst_no='' or gst_no ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$'),
  add constraint artisan_pan_format check (pan_no='' or pan_no ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  add constraint artisan_aadhaar_format check (aadhaar_no='' or aadhaar_no ~ '^[2-9][0-9]{11}$');
