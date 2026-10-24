create index if not exists generated_labels_company_idx on inventory.generated_labels(company_id);
create index if not exists generated_labels_lot_idx on inventory.generated_labels(lot_id);
create index if not exists generated_labels_product_idx on inventory.generated_labels(product_id);
create index if not exists lots_company_idx on inventory.lots(company_id);
create index if not exists lots_product_idx on inventory.lots(product_id);
create index if not exists pieces_company_idx on inventory.pieces(company_id);
create index if not exists pieces_product_idx on inventory.pieces(product_id);
create index if not exists transactions_artisan_idx on inventory.transactions(artisan_id);
