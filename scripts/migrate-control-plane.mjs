import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

import {
  requireControlPlaneDatabaseUrl,
  runControlPlaneMigrations,
} from "./lib/control-plane-migration-runner.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = join(
  scriptDirectory,
  "..",
  "infra",
  "postgres",
  "migrations",
);

await runControlPlaneMigrations({
  databaseUrl: requireControlPlaneDatabaseUrl(process.env),
  migrationsDirectory,
  createPool: (options) => new Pool(options),
  readDirectory: readdir,
  readMigration: readFile,
  logger: (message) => console.log(message),
});
