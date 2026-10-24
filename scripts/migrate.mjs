import { readFile, readdir } from "node:fs/promises";
import { createClient } from "@libsql/client";

const client = createClient({ url: process.env.TURSO_DATABASE_URL || "file:local.db", authToken: process.env.TURSO_AUTH_TOKEN || undefined });
await client.execute("CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL)");

const files = (await readdir(new URL("../drizzle/", import.meta.url))).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
for (const name of files) {
  const applied = await client.execute({ sql: "SELECT name FROM _migrations WHERE name = ?", args: [name] });
  if (applied.rows.length) continue;
  const source = await readFile(new URL(`../drizzle/${name}`, import.meta.url), "utf8");
  const statements = source.split("--> statement-breakpoint").map((statement) => statement.trim()).filter(Boolean).map((sql) => ({ sql, args: [] }));
  statements.push({ sql: "INSERT INTO _migrations(name, applied_at) VALUES (?, ?)", args: [name, new Date().toISOString()] });
  await client.batch(statements, "write");
  console.log(`Applied ${name}`);
}
client.close();

