import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import type { OfflineArtifact } from "../types";

export interface ArtifactAssertionResult {
  role: "couponTable" | "whitelist" | "blacklist";
  fileName: string;
  sha256: string;
  sheetNames: string[];
  rowCount: number;
  readBackVerified: true;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function publicRole(
  role: OfflineArtifact["role"],
): ArtifactAssertionResult["role"] {
  if (role === "productWhitelist") return "whitelist";
  if (role === "productBlacklist") return "blacklist";
  return "couponTable";
}

export async function assertGeneratedCouponArtifacts(
  artifacts: readonly OfflineArtifact[],
): Promise<ArtifactAssertionResult[]> {
  const roles = new Set<string>();
  const results: ArtifactAssertionResult[] = [];
  for (const artifact of artifacts) {
    if (roles.has(artifact.role)) {
      throw new Error(`duplicate generated artifact role: ${artifact.role}`);
    }
    roles.add(artifact.role);
    if (sha256(artifact.bytes) !== artifact.sha256) {
      throw new Error(`generated artifact hash mismatch: ${artifact.role}`);
    }
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(artifact.bytes as unknown as ExcelJS.Buffer);
    if (!workbook.worksheets.length) {
      throw new Error(`generated artifact has no Sheet: ${artifact.role}`);
    }
    const observedRows = workbook.worksheets.reduce(
      (total, sheet) => total + Math.max(0, sheet.actualRowCount - 1),
      0,
    );
    if (artifact.rowCount < 0 || observedRows < 0) {
      throw new Error(
        `generated artifact row count is invalid: ${artifact.role}`,
      );
    }
    results.push({
      role: publicRole(artifact.role),
      fileName: artifact.fileName,
      sha256: artifact.sha256,
      sheetNames: workbook.worksheets.map((sheet) => sheet.name),
      rowCount: artifact.rowCount,
      readBackVerified: true,
    });
  }
  return results;
}
