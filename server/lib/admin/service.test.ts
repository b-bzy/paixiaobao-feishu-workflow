import { describe, expect, it, vi } from "vitest";

vi.mock("../feishu/base-store", () => ({
  listExpenseTemplates: vi.fn(),
  listWorkflowInstances: vi.fn(),
  publishExpenseTemplate: vi.fn(),
  saveExpenseTemplateDraft: vi.fn(),
}));

import {
  listExpenseTemplates,
  listWorkflowInstances,
} from "../feishu/base-store";
import { getAdminOverview } from "./service";

describe("administrator overview", () => {
  it("aggregates Base-backed templates and instances", async () => {
    vi.mocked(listExpenseTemplates).mockResolvedValue([
      { status: "Published" },
      { status: "Draft" },
    ] as never);
    vi.mocked(listWorkflowInstances).mockResolvedValue([
      { status: "Pending", submittedAt: "2026-09-28T10:00:00.000Z" },
      { status: "Approved", submittedAt: "2026-09-28T09:00:00.000Z" },
      { status: "Rejected", submittedAt: "2026-09-28T08:00:00.000Z" },
    ] as never);

    await expect(getAdminOverview()).resolves.toMatchObject({
      templates: { total: 2, published: 1, drafts: 1 },
      instances: { total: 3, pending: 1, approved: 1, rejected: 1 },
    });
  });
});
