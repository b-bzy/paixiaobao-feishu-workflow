import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  requireControlPlaneDatabaseUrl,
  requireControlPlaneTestDatabaseUrl,
  runControlPlaneMigrations,
} from "./lib/control-plane-migration-runner.mjs";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function createFakePool({ existing = new Map(), failOnSql } = {}) {
  const queries = [];
  const client = {
    query: vi.fn(async (sql, parameters = []) => {
      queries.push({ sql, parameters });
      if (sql === failOnSql) throw new Error("synthetic migration failure");
      if (sql.startsWith("SELECT sha256")) {
        const digest = existing.get(parameters[0]);
        return digest
          ? { rowCount: 1, rows: [{ sha256: digest }] }
          : { rowCount: 0, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    }),
    release: vi.fn(),
  };
  const pool = {
    connect: vi.fn(async () => client),
    end: vi.fn(async () => undefined),
  };

  return { client, createPool: vi.fn(() => pool), pool, queries };
}

function migrationDependencies({ existing, failOnSql } = {}) {
  const fake = createFakePool({ existing, failOnSql });
  const source = new Map([
    ["0002_second.sql", "SELECT 2;"],
    ["0001_first.sql", "SELECT 1;"],
    ["notes.txt", "not a migration"],
  ]);

  return {
    ...fake,
    input: {
      databaseUrl: "postgresql://test.example/control_plane",
      migrationsDirectory: "/migrations",
      createPool: fake.createPool,
      readDirectory: vi.fn(async () => [...source.keys()]),
      readMigration: vi.fn(async (path) => {
        const file = path.split("/").at(-1);
        return source.get(file);
      }),
      logger: vi.fn(),
    },
    source,
  };
}

describe("control-plane migration runner", () => {
  it("separates production and test database environment variables", () => {
    expect(() => requireControlPlaneDatabaseUrl({})).toThrow(
      "DATABASE_URL must be a PostgreSQL connection URL",
    );
    expect(() =>
      requireControlPlaneTestDatabaseUrl({
        DATABASE_URL: "postgresql://production.example/live",
      }),
    ).toThrow("CONTROL_PLANE_TEST_DATABASE_URL must be a PostgreSQL connection URL");

    expect(
      requireControlPlaneDatabaseUrl({
        DATABASE_URL: "postgresql://production.example/live",
        CONTROL_PLANE_TEST_DATABASE_URL: "postgresql://test.example/control_plane",
      }),
    ).toBe("postgresql://production.example/live");
    expect(
      requireControlPlaneTestDatabaseUrl({
        DATABASE_URL: "postgresql://production.example/live",
        CONTROL_PLANE_TEST_DATABASE_URL: "postgresql://test.example/control_plane",
      }),
    ).toBe("postgresql://test.example/control_plane");
  });

  it("does not let either CLI fall back to the other database variable", () => {
    const inheritedEnvironment = { PATH: process.env.PATH };
    const testCli = spawnSync(
      process.execPath,
      ["scripts/migrate-control-plane-test.mjs"],
      {
        cwd: process.cwd(),
        env: {
          ...inheritedEnvironment,
          DATABASE_URL: "postgresql://production.invalid/live",
        },
        encoding: "utf8",
      },
    );
    const productionCli = spawnSync(
      process.execPath,
      ["scripts/migrate-control-plane.mjs"],
      {
        cwd: process.cwd(),
        env: {
          ...inheritedEnvironment,
          CONTROL_PLANE_TEST_DATABASE_URL: "postgresql://test.invalid/control",
        },
        encoding: "utf8",
      },
    );

    expect(testCli.status).not.toBe(0);
    expect(`${testCli.stdout}${testCli.stderr}`).toContain(
      "CONTROL_PLANE_TEST_DATABASE_URL must be a PostgreSQL connection URL",
    );
    expect(`${testCli.stdout}${testCli.stderr}`).not.toContain(
      "postgresql://production.invalid/live",
    );
    expect(productionCli.status).not.toBe(0);
    expect(`${productionCli.stdout}${productionCli.stderr}`).toContain(
      "DATABASE_URL must be a PostgreSQL connection URL",
    );
    expect(`${productionCli.stdout}${productionCli.stderr}`).not.toContain(
      "postgresql://test.invalid/control",
    );
  });

  it("rejects an invalid URL before it constructs a database pool", async () => {
    const createPool = vi.fn();

    await expect(
      runControlPlaneMigrations({
        databaseUrl: "not-a-database-url",
        migrationsDirectory: "/migrations",
        createPool,
        readDirectory: vi.fn(),
        readMigration: vi.fn(),
        logger: vi.fn(),
      }),
    ).rejects.toThrow("databaseUrl must be a PostgreSQL connection URL");

    expect(createPool).not.toHaveBeenCalled();
  });

  it("applies only sorted SQL migrations and returns safe counts", async () => {
    const { client, createPool, input, pool, queries } = migrationDependencies();

    await expect(runControlPlaneMigrations(input)).resolves.toEqual({
      applied: ["0001_first.sql", "0002_second.sql"],
      alreadyApplied: [],
    });

    expect(createPool).toHaveBeenCalledWith({
      connectionString: "postgresql://test.example/control_plane",
      max: 1,
    });
    expect(queries.map(({ sql }) => sql)).toContain("SELECT 1;");
    expect(queries.map(({ sql }) => sql)).toContain("SELECT 2;");
    expect(
      queries.map(({ sql }) => sql).indexOf("SELECT 1;"),
    ).toBeLessThan(queries.map(({ sql }) => sql).indexOf("SELECT 2;"));
    expect(client.query).toHaveBeenCalledWith("BEGIN");
    expect(client.query).toHaveBeenCalledWith("COMMIT");
    expect(client.release).toHaveBeenCalledOnce();
    expect(pool.end).toHaveBeenCalledOnce();
  });

  it("does not reapply a migration with the same recorded digest", async () => {
    const { client, input } = migrationDependencies({
      existing: new Map([
        ["0001_first.sql", sha256("SELECT 1;")],
        ["0002_second.sql", sha256("SELECT 2;")],
      ]),
    });

    await expect(runControlPlaneMigrations(input)).resolves.toEqual({
      applied: [],
      alreadyApplied: ["0001_first.sql", "0002_second.sql"],
    });

    expect(client.query).not.toHaveBeenCalledWith("BEGIN");
  });

  it("rejects an applied migration whose checked-in SQL changed and still cleans up", async () => {
    const { client, input, pool } = migrationDependencies({
      existing: new Map([["0001_first.sql", "different-digest"]]),
    });

    await expect(runControlPlaneMigrations(input)).rejects.toThrow(
      "Applied migration 0001_first.sql differs from the checked-in SQL",
    );

    expect(client.query).not.toHaveBeenCalledWith("BEGIN");
    expect(client.release).toHaveBeenCalledOnce();
    expect(pool.end).toHaveBeenCalledOnce();
  });

  it("rolls back a failed migration and always releases database resources", async () => {
    const { client, input, pool } = migrationDependencies({
      failOnSql: "SELECT 2;",
    });

    await expect(runControlPlaneMigrations(input)).rejects.toThrow(
      "synthetic migration failure",
    );

    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
    expect(client.release).toHaveBeenCalledOnce();
    expect(pool.end).toHaveBeenCalledOnce();
  });
});
