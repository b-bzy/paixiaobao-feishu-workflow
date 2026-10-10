import { describe, expect, it } from "vitest";
import {
  type PgClientLike,
  type PgPoolLike,
  PostgresSqlDatabase,
} from "./postgres-sql-database";

function poolFixture(): {
  pool: PgPoolLike;
  statements: string[];
  releaseCount: () => number;
} {
  const statements: string[] = [];
  let released = 0;
  const query: PgClientLike["query"] = async <
    Row extends Record<string, unknown>,
  >(
    statement: string,
  ) => {
    statements.push(statement);
    return { rows: [] as Row[], rowCount: 0 };
  };
  const client: PgClientLike = {
    query,
    release: () => {
      released += 1;
    },
  };
  return {
    pool: {
      query,
      connect: async () => client,
    },
    statements,
    releaseCount: () => released,
  };
}

describe("PostgresSqlDatabase", () => {
  it("commits and releases after a successful transaction", async () => {
    const fixture = poolFixture();
    const database = new PostgresSqlDatabase(fixture.pool);

    await expect(
      database.transaction(async (transaction) => {
        await transaction.query("SELECT 1");
        return "done";
      }),
    ).resolves.toBe("done");
    expect(fixture.statements).toEqual(["BEGIN", "SELECT 1", "COMMIT"]);
    expect(fixture.releaseCount()).toBe(1);
  });

  it("rolls back and preserves the application error", async () => {
    const fixture = poolFixture();
    const database = new PostgresSqlDatabase(fixture.pool);

    await expect(
      database.transaction(async () => {
        throw new Error("application failure");
      }),
    ).rejects.toThrow("application failure");
    expect(fixture.statements).toEqual(["BEGIN", "ROLLBACK"]);
    expect(fixture.releaseCount()).toBe(1);
  });
});
