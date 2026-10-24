import { createClient, type Client, type InStatement } from "@libsql/client";

type BoundValue = string | number | bigint | ArrayBuffer | null;

const url = process.env.TURSO_DATABASE_URL || "file:local.db";
const authToken = process.env.TURSO_AUTH_TOKEN || undefined;

export const client = createClient({ url, authToken });

class PreparedStatement {
  constructor(
    private readonly db: Client,
    private readonly sql: string,
    private readonly args: BoundValue[] = [],
  ) {}

  bind(...args: BoundValue[]) {
    return new PreparedStatement(this.db, this.sql, args);
  }

  toStatement(): InStatement {
    return { sql: this.sql, args: this.args };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const result = await this.db.execute(this.toStatement());
    return (result.rows[0] as T | undefined) ?? null;
  }

  async all<T = Record<string, unknown>>() {
    const result = await this.db.execute(this.toStatement());
    return { results: result.rows as unknown as T[] };
  }

  async run() {
    const result = await this.db.execute(this.toStatement());
    return { success: true, meta: result };
  }
}

export type LedgerDatabase = ReturnType<typeof ledgerDatabase>;

export function ledgerDatabase() {
  return {
    prepare(sql: string) {
      return new PreparedStatement(client, sql);
    },
    async batch(statements: PreparedStatement[]) {
      return client.batch(
        statements.map((statement) => statement.toStatement()),
        "write",
      );
    },
  };
}

export const db = ledgerDatabase();

