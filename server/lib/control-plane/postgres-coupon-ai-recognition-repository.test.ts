import { describe, expect, it } from "vitest";
import { PostgresCouponAiRecognitionRepository } from "./postgres-coupon-ai-recognition-repository";
import type { SqlExecutor, TransactionalSqlDatabase } from "./sql";

class RecordingDatabase implements TransactionalSqlDatabase {
  readonly calls: Array<{
    statement: string;
    parameters?: readonly unknown[];
  }> = [];
  transactions = 0;

  constructor(
    private readonly results: Array<{
      rows?: Record<string, unknown>[];
      rowCount?: number | null;
    }>,
  ) {}

  async transaction<T>(
    callback: (transaction: SqlExecutor) => Promise<T>,
  ): Promise<T> {
    this.transactions += 1;
    return callback(this);
  }

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    statement: string,
    parameters?: readonly unknown[],
  ) {
    this.calls.push({ statement, parameters });
    const result = this.results.shift();
    if (!result) throw new Error("Unexpected SQL query");
    return {
      rows: (result.rows ?? []) as Row[],
      rowCount: result.rowCount ?? result.rows?.length ?? 0,
    };
  }
}

function row() {
  return {
    id: "run-1",
    semantic_key: "draft:1:couponTable:hash:model:prompt",
    pilot_record_id: "record-1",
    business_task_id: "CTS-1",
    owner_open_id: "ou_owner",
    revision: 1,
    source_slot: "couponTable",
    source_reference: { messageId: "message-1", fileKey: "file-1" },
    source_sha256: "a".repeat(64),
    source_file_name: "coupon.xlsx",
    provider: "deepseek",
    model: "deepseek-chat",
    prompt_version: "coupon-three-source-p0-ai-v1",
    status: "pending",
  };
}

describe("PostgresCouponAiRecognitionRepository", () => {
  it("persists recognition state before activating its effect", async () => {
    const database = new RecordingDatabase([
      { rows: [row()], rowCount: 1 },
      { rowCount: 1 },
    ]);
    const ids = ["run-1", "effect-1"];
    const repository = new PostgresCouponAiRecognitionRepository(database, {
      id: () => ids.shift() ?? "unexpected",
    });
    const run = await repository.prepare({
      semanticKey: "draft:1:couponTable:hash:model:prompt",
      pilotRecordId: "record-1",
      businessTaskId: "CTS-1",
      ownerOpenId: "ou_owner",
      revision: 1,
      sourceSlot: "couponTable",
      sourceReference: { messageId: "message-1", fileKey: "file-1" },
      sourceSha256: "a".repeat(64),
      sourceFileName: "coupon.xlsx",
      model: "deepseek-chat",
      promptVersion: "coupon-three-source-p0-ai-v1",
    });
    expect(run.id).toBe("run-1");
    expect(database.transactions).toBe(1);
    expect(database.calls).toHaveLength(1);

    await repository.activate(run);
    expect(database.calls).toHaveLength(2);
    expect(database.calls[1].statement).toContain("NULL");
    expect(database.calls[1].statement).toContain("effect_receipts");
    expect(database.calls[1].statement).toContain("ON CONFLICT");
  });

  it("reuses the existing semantic run and effect intent", async () => {
    const database = new RecordingDatabase([
      { rows: [], rowCount: 0 },
      { rows: [row()], rowCount: 1 },
      { rowCount: 0 },
    ]);
    const repository = new PostgresCouponAiRecognitionRepository(database, {
      id: () => "new-id",
    });
    const run = await repository.prepare({
      semanticKey: "draft:1:couponTable:hash:model:prompt",
      pilotRecordId: "record-1",
      businessTaskId: "CTS-1",
      ownerOpenId: "ou_owner",
      revision: 1,
      sourceSlot: "couponTable",
      sourceReference: {},
      sourceSha256: "a".repeat(64),
      sourceFileName: "coupon.xlsx",
      model: "deepseek-chat",
      promptVersion: "coupon-three-source-p0-ai-v1",
    });
    expect(run.id).toBe("run-1");
    expect(database.calls).toHaveLength(2);
    await repository.activate(run);
    expect(database.calls).toHaveLength(3);
  });
});
