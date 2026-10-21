import { z } from "zod";

const caseIdPattern =
  /^(?:F0[1-8]|L(?:0[1-9]|1[0-4])|C(?:0[1-9]|1[0-6])|S(?:0[1-9]|1[0-7])|B(?:0[1-9]|10))$/u;

const workbookInputSchema = z.object({
  role: z.enum(["couponTable", "whitelist", "blacklist"]),
  recipe: z.string().min(1),
  variants: z.number().int().positive().default(1),
});

const expectedSchema = z
  .object({
    classification: z.enum(["passed", "needs_clarification", "expected_block"]),
    terminalState: z.string().min(1),
    revision: z.number().int().nonnegative(),
    secondRoundCardCount: z.number().int().nonnegative().max(1),
    userFacingCode: z.string().min(1).optional(),
    sheetRows: z.record(z.string(), z.number().int().nonnegative()).optional(),
    artifactRoles: z
      .array(z.enum(["couponTable", "whitelist", "blacklist", "screenshot"]))
      .default([]),
    nativeOaCreated: z.literal(false),
  })
  .superRefine((value, context) => {
    if (value.classification === "passed" && !value.artifactRoles.length) {
      context.addIssue({
        code: "custom",
        message: "passed case must declare at least one artifact role",
        path: ["artifactRoles"],
      });
    }
    if (value.classification !== "passed" && !value.userFacingCode) {
      context.addIssue({
        code: "custom",
        message: "abnormal case must declare a stable user-facing code",
        path: ["userFacingCode"],
      });
    }
  });

const e2eCaseSchema = z.object({
  id: z.string().regex(caseIdPattern, "case id is outside the approved matrix"),
  title: z.string().min(1),
  tags: z.array(z.string().min(1)).min(1),
  inputs: z.object({
    workbooks: z.array(workbookInputSchema).min(1),
    aiReplay: z.string().min(1).optional(),
    ownerReplies: z.array(z.record(z.string(), z.string())).default([]),
  }),
  expected: expectedSchema,
});

export type CouponThreeSourceE2eCase = z.infer<typeof e2eCaseSchema>;
export type CouponThreeSourceE2eExpected = CouponThreeSourceE2eCase["expected"];
export type E2eTerminalClassification =
  CouponThreeSourceE2eExpected["classification"];

export function validateCouponThreeSourceE2eCase(
  value: unknown,
): CouponThreeSourceE2eCase {
  return e2eCaseSchema.parse(value);
}

export function validateCouponThreeSourceE2eCatalog(
  values: readonly unknown[],
): CouponThreeSourceE2eCase[] {
  const parsed = values.map(validateCouponThreeSourceE2eCase);
  const seen = new Set<string>();
  for (const item of parsed) {
    if (seen.has(item.id)) {
      throw new Error(`duplicate E2E case id: ${item.id}`);
    }
    seen.add(item.id);
  }
  return parsed;
}

export function plannedWorkbookCount(
  cases: readonly CouponThreeSourceE2eCase[],
): number {
  return cases.reduce(
    (total, item) =>
      total +
      item.inputs.workbooks.reduce(
        (caseTotal, workbook) => caseTotal + workbook.variants,
        0,
      ),
    0,
  );
}
