import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

import { runControlPlaneMigrations } from "./lib/control-plane-migration-runner.mjs";

const targetBranch = "p0-three-source-direct-http";
const databaseUrl = process.env.DATABASE_URL?.trim();
const shouldMigrate =
  process.env.VERCEL_ENV === "preview" &&
  process.env.VERCEL_GIT_COMMIT_REF === targetBranch &&
  /^postgres(?:ql)?:\/\//iu.test(databaseUrl ?? "");

if (!shouldMigrate) {
  console.log("[control-plane:migrate] skipped outside the P0 Preview branch");
} else {
  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  await runControlPlaneMigrations({
    databaseUrl,
    migrationsDirectory: join(
      scriptDirectory,
      "..",
      "infra",
      "postgres",
      "migrations",
    ),
    createPool: (options) => new Pool(options),
    readDirectory: readdir,
    readMigration: readFile,
    logger: (message) => console.log(message),
  });
}
