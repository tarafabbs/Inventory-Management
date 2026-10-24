import { readdir, readFile } from "node:fs/promises";
import postgres from "postgres";

const url = process.env.SUPABASE_DATABASE_URL;
if (!url) throw new Error("SUPABASE_DATABASE_URL is required.");

const sql = postgres(url, {
  max: 1,
  prepare: false,
  ssl: "require",
  connection: { application_name: "ims-inventory-migrations" },
});

try {
  await sql.unsafe(`
    create schema if not exists inventory;
    create table if not exists inventory._app_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    );
  `);

  const files = (await readdir(new URL("../supabase/migrations/", import.meta.url)))
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort();

  for (const name of files) {
    const [applied] = await sql`
      select name from inventory._app_migrations where name = ${name}
    `;
    if (applied) continue;

    const [existingInventory] = await sql`
      select to_regclass('inventory.companies') as table_name
    `;
    if (name === "20261024161403_inventory_schema.sql" && existingInventory.table_name) {
      await sql`insert into inventory._app_migrations (name) values (${name})`;
      continue;
    }

    const source = await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
    await sql.begin(async (transaction) => {
      await transaction.unsafe(source);
      await transaction`
        insert into inventory._app_migrations (name) values (${name})
      `;
    });
    console.log(`Applied ${name}`);
  }
} finally {
  await sql.end();
}
