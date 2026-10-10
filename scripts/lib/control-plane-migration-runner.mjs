import { createHash } from "node:crypto";
import { join } from "node:path";

const migrationPattern = /^\d+_.+\.sql$/u;

function requirePostgresUrl(environment, name) {
  const value = environment[name]?.trim();
  if (!value || !/^postgres(?:ql)?:\/\//iu.test(value)) {
    throw new Error(`${name} must be a PostgreSQL connection URL`);
  }
  return value;
}

export function requireControlPlaneDatabaseUrl(environment) {
  return requirePostgresUrl(environment, "DATABASE_URL");
}

export function requireControlPlaneTestDatabaseUrl(environment) {
  return requirePostgresUrl(environment, "CONTROL_PLANE_TEST_DATABASE_URL");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertMigrationDatabaseUrl(databaseUrl) {
  if (!databaseUrl || !/^postgres(?:ql)?:\/\//iu.test(databaseUrl)) {
    throw new Error("databaseUrl must be a PostgreSQL connection URL");
  }
}

function log(logger, message) {
  if (typeof logger === "function") logger(message);
}

export async function runControlPlaneMigrations({
  databaseUrl,
  migrationsDirectory,
  createPool,
  readDirectory,
  readMigration,
  logger,
}) {
  assertMigrationDatabaseUrl(databaseUrl);

  const pool = createPool({ connectionString: databaseUrl, max: 1 });
  let client;
  const applied = [];
  const alreadyApplied = [];

  try {
    client = await pool.connect();
    await client.query(`
      CREATE TABLE IF NOT EXISTS control_plane_schema_migrations (
        filename text PRIMARY KEY,
        sha256 text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const files = (await readDirectory(migrationsDirectory))
      .filter((file) => migrationPattern.test(file))
      .sort();

    for (const file of files) {
      const sql = await readMigration(join(migrationsDirectory, file), "utf8");
      const digest = sha256(sql);
      const existing = await client.query(
        "SELECT sha256 FROM control_plane_schema_migrations WHERE filename = $1",
        [file],
      );
      if (existing.rowCount) {
        if (existing.rows[0]?.sha256 !== digest) {
          throw new Error(
            `Applied migration ${file} differs from the checked-in SQL; create a new migration instead`,
          );
        }
        alreadyApplied.push(file);
        log(logger, `[control-plane:migrate] already applied ${file}`);
        continue;
      }

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO control_plane_schema_migrations (filename, sha256) VALUES ($1, $2)",
          [file, digest],
        );
        await client.query("COMMIT");
        applied.push(file);
        log(logger, `[control-plane:migrate] applied ${file}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }

    return { applied, alreadyApplied };
  } finally {
    client?.release();
    await pool.end();
  }
}
