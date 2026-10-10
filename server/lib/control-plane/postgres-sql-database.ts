import { Pool } from "pg";
import type {
  SqlExecutor,
  SqlQueryResult,
  TransactionalSqlDatabase,
} from "./sql";

interface PgQueryable {
  query<Row extends Record<string, unknown>>(
    statement: string,
    parameters?: readonly unknown[],
  ): Promise<{ rows: Row[]; rowCount: number | null }>;
}

interface PgPoolLike extends PgQueryable {
  connect(): Promise<PgClientLike>;
  end?(): Promise<void>;
}

interface PgClientLike extends PgQueryable {
  release(): void;
}

class PostgresSqlExecutor implements SqlExecutor {
  constructor(private readonly connection: PgQueryable) {}

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    statement: string,
    parameters?: readonly unknown[],
  ): Promise<SqlQueryResult<Row>> {
    const result = await this.connection.query<Row>(statement, parameters);
    return { rows: result.rows, rowCount: result.rowCount };
  }
}

/** PostgreSQL transaction adapter used by the durable control-plane repositories. */
export class PostgresSqlDatabase
  extends PostgresSqlExecutor
  implements TransactionalSqlDatabase
{
  constructor(private readonly pool: PgPoolLike) {
    super(pool);
  }

  async transaction<T>(
    callback: (transaction: SqlExecutor) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await callback(new PostgresSqlExecutor(client));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original transaction error; the pool connection is released below.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end?.();
  }
}

let singleton: PostgresSqlDatabase | undefined;

function databaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value || !/^postgres(?:ql)?:\/\//iu.test(value)) {
    throw new Error("DATABASE_URL must be a PostgreSQL connection URL");
  }
  return value;
}

function maxConnections(): number {
  const value = process.env.CONTROL_PLANE_DATABASE_MAX_CONNECTIONS?.trim();
  if (!value) return 5;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 20) {
    throw new Error(
      "CONTROL_PLANE_DATABASE_MAX_CONNECTIONS must be an integer between 1 and 20",
    );
  }
  return parsed;
}

export function getControlPlaneDatabase(): PostgresSqlDatabase {
  if (!singleton) {
    singleton = new PostgresSqlDatabase(
      new Pool({
        connectionString: databaseUrl(),
        max: maxConnections(),
        idleTimeoutMillis: 30_000,
      }),
    );
  }
  return singleton;
}

export async function resetControlPlaneDatabaseForTests(): Promise<void> {
  const database = singleton;
  singleton = undefined;
  await database?.close();
}

export type { PgPoolLike, PgClientLike };
