-- New inventory identities are compact handwritten codes (1-4 letters/numbers).
-- Existing permanent codes are intentionally left untouched.

alter table inventory.generated_labels
  drop constraint if exists generated_labels_handwritten_code_check;

alter table inventory.generated_labels
  add constraint generated_labels_handwritten_code_check
  check (code ~ '^[0-9A-Z]{1,4}$');

alter table inventory.pieces
  drop constraint if exists pieces_handwritten_code_check;

alter table inventory.pieces
  add constraint pieces_handwritten_code_check
  check (code ~ '^[0-9A-Z]{1,4}$');

-- The old sequence encoded values into four characters. Restarting only the
-- allocator lets the new numeric format begin at 1; it does not update a row.
select setval('inventory.piece_code_seq', 0, true);

create or replace function inventory.next_piece_code()
returns text
language plpgsql
set search_path = ''
as $$
declare
  value bigint;
  code text;
begin
  loop
    value := nextval('inventory.piece_code_seq');
    if value < 1 then
      continue;
    end if;
    if value > 9999 then
      raise exception using
        message = 'The one-to-four character inventory code space is exhausted',
        errcode = '22003';
    end if;

    code := value::text;
    if not exists (select 1 from inventory.pieces p where p.code = code)
       and not exists (select 1 from inventory.generated_labels g where g.code = code) then
      return code;
    end if;
  end loop;
end;
$$;

comment on function inventory.next_piece_code() is
  'Allocates a permanent 1-4 digit handwritten inventory code without modifying existing codes.';
