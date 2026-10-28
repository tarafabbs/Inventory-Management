import postgres from "postgres";

type BoundValue = string | number | boolean | Date | Uint8Array | null;
type SqlClient = ReturnType<typeof postgres>;
type Queryable = Pick<SqlClient, "unsafe">;

let client: SqlClient | undefined;

const inventoryTables = [
  "barcode_recoveries",
  "artisans",
  "companies",
  "exceptions",
  "generated_labels",
  "ground_staff",
  "guards",
  "lots",
  "observations",
  "piece_events",
  "pieces",
  "print_jobs",
  "products",
  "requests",
  "settings",
  "stock_checks",
  "transaction_items",
  "transactions",
  "users",
];

function connection() {
  const url = process.env.SUPABASE_DATABASE_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!url) {
    throw new Error("A Supabase PostgreSQL connection URL is not configured.");
  }

  client ??= postgres(url, {
    max: 2,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
    ssl: "require",
    connection: {
      application_name: "ims-tara-maa-inventory",
    },
  });

  return client;
}

function postgresSql(source: string) {
  let parameter = 0;
  let sql = source;

  for (const table of inventoryTables) {
    sql = sql.replace(
      new RegExp(`\\b(FROM|JOIN|INTO|UPDATE|DELETE\\s+FROM)\\s+${table}\\b`, "gi"),
      (match, keyword: string) => `${keyword} inventory.${table}`,
    );
  }

  return sql.replace(/\?/g, () => `$${++parameter}`);
}

class PreparedStatement {
  constructor(
    private readonly source: string,
    private readonly args: BoundValue[] = [],
  ) {}

  bind(...args: BoundValue[]) {
    return new PreparedStatement(this.source, args);
  }

  async execute(db: Queryable = connection()) {
    return db.unsafe(postgresSql(this.source), this.args);
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const rows = await this.execute();
    return (rows[0] as T | undefined) ?? null;
  }

  async all<T = Record<string, unknown>>() {
    const rows = await this.execute();
    return { results: rows as unknown as T[] };
  }

  async run() {
    const result = await this.execute();
    return { success: true, meta: result };
  }
}

export type LedgerDatabase = ReturnType<typeof ledgerDatabase>;

export function ledgerDatabase() {
  return {
    prepare(source: string) {
      return new PreparedStatement(source);
    },
    async batch(statements: PreparedStatement[]) {
      return connection().begin(async (transaction) => {
        const results = [];
        for (const statement of statements) {
          results.push(await statement.execute(transaction));
        }
        return results;
      });
    },
  };
}

export const db = ledgerDatabase();
