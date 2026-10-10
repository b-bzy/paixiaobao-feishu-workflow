export interface SqlQueryResult<
  Row extends Record<string, unknown> = Record<string, unknown>,
> {
  rows: Row[];
  rowCount: number | null;
}

export interface SqlExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    statement: string,
    parameters?: readonly unknown[],
  ): Promise<SqlQueryResult<Row>>;
}

export interface TransactionalSqlDatabase extends SqlExecutor {
  transaction<T>(
    callback: (transaction: SqlExecutor) => Promise<T>,
  ): Promise<T>;
}

export class ControlPlaneConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ControlPlaneConflictError";
  }
}
