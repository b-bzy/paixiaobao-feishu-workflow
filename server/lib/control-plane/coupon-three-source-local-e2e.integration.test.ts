import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { buildE2eWorkbook } from "../coupon-oa/three-source/e2e/workbook-fixture-builder";
import { runOfflineThreeSourceWorkflow } from "../coupon-oa/three-source/offline";
import {
  confirmCouponThreeSourceNoBlacklist,
  confirmCouponThreeSourceSources,
  createCouponThreeSourceTask,
  replaceCouponThreeSourceSource,
  saveCouponThreeSourceArtifacts,
} from "../coupon-oa/three-source/task";
import { PostgresCouponThreeSourceTaskRepository } from "./postgres-coupon-three-source-task-repository";
import { PostgresSqlDatabase } from "./postgres-sql-database";
import {
  ensureLocalE2eBucket,
  S3CanonicalObjectStore,
} from "./s3-canonical-object-store";

const databaseUrl = process.env.CONTROL_PLANE_TEST_DATABASE_URL;
const objectStoreEndpoint = process.env.OBJECT_STORE_TEST_ENDPOINT;
const integrationDescribe =
  databaseUrl && objectStoreEndpoint ? describe : describe.skip;
const templatesDirectory = join(
  process.cwd(),
  "docs/oa-ticket-reimbursement-materials/reference/templates",
);
const xlsxContentType =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

integrationDescribe("coupon three-source PostgreSQL and MinIO E2E", () => {
  it("persists revisioned task state and immutable generated artifacts without Feishu", async () => {
    if (!databaseUrl || !objectStoreEndpoint) {
      throw new Error("durable E2E environment is incomplete");
    }
    const schema = `coupon_e2e_${randomUUID().replaceAll("-", "")}`;
    const adminPool = new Pool({ connectionString: databaseUrl, max: 2 });
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    const migrationClient = await adminPool.connect();
    try {
      await migrationClient.query(`SET search_path TO "${schema}"`);
      const migrationDirectory = resolve(
        process.cwd(),
        "infra/postgres/migrations",
      );
      for (const migration of (await readdir(migrationDirectory))
        .filter((file) => /^\d+_.+\.sql$/u.test(file))
        .sort()) {
        await migrationClient.query(
          await readFile(resolve(migrationDirectory, migration), "utf8"),
        );
      }
    } finally {
      migrationClient.release();
    }

    const database = new PostgresSqlDatabase(
      new Pool({
        connectionString: databaseUrl,
        max: 4,
        options: `-c search_path=${schema}`,
      }),
    );
    const bucket = process.env.OBJECT_STORE_TEST_BUCKET ?? "coupon-e2e-local";
    const s3 = new S3Client({
      endpoint: objectStoreEndpoint,
      region: process.env.OBJECT_STORE_TEST_REGION ?? "us-east-1",
      forcePathStyle: process.env.OBJECT_STORE_TEST_FORCE_PATH_STYLE === "true",
      credentials: {
        accessKeyId: process.env.OBJECT_STORE_TEST_ACCESS_KEY_ID ?? "",
        secretAccessKey: process.env.OBJECT_STORE_TEST_SECRET_ACCESS_KEY ?? "",
      },
    });
    const storedKeys: string[] = [];

    try {
      await ensureLocalE2eBucket(s3, bucket);
      const store = new S3CanonicalObjectStore({ client: s3, bucket });
      const [coupon, whitelist, templates] = await Promise.all([
        buildE2eWorkbook({ recipe: "standard:coupon", variant: 1 }),
        buildE2eWorkbook({ recipe: "standard:whitelist", variant: 1 }),
        Promise.all([
          readFile(join(templatesDirectory, "配券信息表-常规满减券.xlsx")),
          readFile(
            join(templatesDirectory, "商品明细白名单-多券档SKU-v1.xlsx"),
          ),
          readFile(
            join(templatesDirectory, "商品明细黑名单-多券档SKU-v1.xlsx"),
          ),
        ]),
      ]);
      const workflow = await runOfflineThreeSourceWorkflow({
        ownerId: "ou_local_durable_e2e",
        revision: 4,
        couponTable: { fileName: coupon.fileName, bytes: coupon.bytes },
        whitelist: {
          fileName: whitelist.fileName,
          bytes: whitelist.bytes,
        },
        noBlacklistConfirmed: true,
        templates: {
          regularFullReductionTemplateBytes: templates[0],
          whitelistTemplateBytes: templates[1],
          blacklistTemplateBytes: templates[2],
        },
        activityPointPercent: 5,
      });

      const repository = new PostgresCouponThreeSourceTaskRepository(database);
      let task = createCouponThreeSourceTask({
        taskId: `CTS-${randomUUID()}`,
        ownerOpenId: "ou_local_durable_e2e",
      });
      await repository.create(task);
      const sourceInputs = [
        { role: "couponTable" as const, workbook: coupon },
        { role: "whitelist" as const, workbook: whitelist },
      ];
      for (const [index, sourceInput] of sourceInputs.entries()) {
        const key = `local-e2e/${task.taskId}/sources/${sourceInput.role}.xlsx`;
        storedKeys.push(key);
        await store.putImmutable({
          key,
          bytes: sourceInput.workbook.bytes,
          sha256: sourceInput.workbook.sha256,
          contentType: sourceInput.workbook.contentType,
        });
        const previousRevision = task.revision;
        task = replaceCouponThreeSourceSource({
          task,
          ownerOpenId: task.ownerOpenId,
          expectedRevision: previousRevision,
          source: {
            role: sourceInput.role,
            messageId: `synthetic-message-${index + 1}`,
            fileKey: key,
            fileName: sourceInput.workbook.fileName,
            bytes: sourceInput.workbook.bytes.byteLength,
            sha256: sourceInput.workbook.sha256,
          },
        });
        task = await repository.replace({
          task,
          expectedRevision: previousRevision,
          operationId: `replace-source-${index + 1}`,
        });
      }
      const beforeBlacklistRevision = task.revision;
      task = confirmCouponThreeSourceNoBlacklist({
        task,
        ownerOpenId: task.ownerOpenId,
        expectedRevision: beforeBlacklistRevision,
      });
      task = await repository.replace({
        task,
        expectedRevision: beforeBlacklistRevision,
        operationId: "confirm-no-blacklist",
      });
      task = confirmCouponThreeSourceSources({
        task,
        ownerOpenId: task.ownerOpenId,
        expectedRevision: task.revision,
        snapshotHash: workflow.confirmation.snapshotHash,
      });
      task = await repository.replace({
        task,
        expectedRevision: task.revision,
        operationId: "confirm-sources",
      });

      const taskArtifacts = [];
      for (const [index, artifact] of workflow.artifacts.entries()) {
        const key = `local-e2e/${task.taskId}/revision-${task.revision}/${artifact.fileName}`;
        storedKeys.push(key);
        await store.putImmutable({
          key,
          bytes: artifact.bytes,
          sha256: artifact.sha256,
          contentType: xlsxContentType,
        });
        await store.putImmutable({
          key,
          bytes: artifact.bytes,
          sha256: artifact.sha256,
          contentType: xlsxContentType,
        });
        await expect(store.get(key)).resolves.toMatchObject({
          key,
          sha256: artifact.sha256,
          contentType: xlsxContentType,
        });
        taskArtifacts.push({
          artifactId: `artifact-${index + 1}`,
          order: index,
          role: artifact.role,
          fileName: artifact.fileName,
          bytes: artifact.bytes.byteLength,
          sha256: artifact.sha256,
        });
      }
      task = saveCouponThreeSourceArtifacts({
        task,
        ownerOpenId: task.ownerOpenId,
        expectedRevision: task.revision,
        requiresCalcImage: false,
        artifacts: taskArtifacts,
      });
      const persisted = await repository.replace({
        task,
        expectedRevision: task.revision,
        operationId: "freeze-artifacts",
      });
      await expect(
        repository.replace({
          task,
          expectedRevision: task.revision,
          operationId: "freeze-artifacts",
        }),
      ).resolves.toEqual(persisted);
      await expect(repository.getById(task.taskId)).resolves.toMatchObject({
        status: "AwaitingFinalConfirmation",
        revision: 4,
        artifacts: expect.arrayContaining([
          expect.objectContaining({ role: "couponTable" }),
          expect.objectContaining({ role: "productWhitelist" }),
        ]),
      });
    } finally {
      await Promise.all(
        storedKeys.map((Key) =>
          s3.send(new DeleteObjectCommand({ Bucket: bucket, Key })),
        ),
      );
      s3.destroy();
      await database.close();
      await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await adminPool.end();
    }
  }, 30_000);
});
