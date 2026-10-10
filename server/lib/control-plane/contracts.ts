export const inboundDeliverySchemaVersion = "feishu-delivery-v1";

export type InboundDeliverySource = "managed-bridge" | "https-callback";
export type InboundDeliveryChatType = "p2p" | "group" | "unknown";

export interface InboundDeliveryV1 {
  schemaVersion: typeof inboundDeliverySchemaVersion;
  source: InboundDeliverySource;
  appId: string;
  tenantId?: string;
  stableDeliveryId: string;
  eventType: string;
  actorOpenId?: string;
  messageId?: string;
  callbackId?: string;
  /**
   * Authenticated transport metadata, not a UI hint. Command intake only accepts
   * a persisted `p2p` value and never treats the deployment readiness flag as a
   * substitute for this per-delivery proof.
   */
  chatType: InboundDeliveryChatType;
  /** Feishu chat identifier retained for correlation; no command may infer direct-chat status from it. */
  chatId?: string;
  receivedAt: string;
  payload: Record<string, unknown>;
  payloadSha256: string;
  correlationId: string;
}

export type WorkflowJobState =
  | "ready"
  | "leased"
  | "succeeded"
  | "retry"
  | "dead_letter";

export interface WorkflowJob {
  id: string;
  kind: string;
  semanticKey: string;
  payload: Record<string, unknown>;
  state: WorkflowJobState;
  attempts: number;
  availableAt: string;
  leaseToken?: string;
  leaseExpiresAt?: string;
}

export type CouponTaskRoute = "three_source" | "p1_excel" | "legacy_oa";
export type CouponTaskState =
  | "Collecting"
  | "Recognizing"
  | "NeedsClarification"
  | "AwaitingSourceConfirmation"
  | "GeneratingArtifacts"
  | "AwaitingFinalConfirmation"
  | "DraftOnlyConfirmed"
  | "Submitting"
  | "Submitted"
  | "CreatedNeedsReview"
  | "SubmissionUnknown"
  | "RetryableFailure"
  | "Canceled";

export interface CouponTaskSnapshot {
  taskId: string;
  ownerOpenId: string;
  route: CouponTaskRoute;
  state: CouponTaskState;
  revision: number;
  version: number;
}

export type CouponArtifactRole =
  | "sourceCouponTable"
  | "sourceWhitelist"
  | "sourceBlacklist"
  | "standardCouponTable"
  | "standardWhitelist"
  | "standardBlacklist"
  | "standardCouponScreenshot";

export interface CouponArtifactManifest {
  taskId: string;
  revision: number;
  role: CouponArtifactRole;
  objectKey: string;
  fileName: string;
  bytes: number;
  sha256: string;
  templateId?: string;
  templateVersion?: string;
  sourceArtifactSha256?: string;
  renderRange?: string;
}

export interface IngressReceiver {
  accept(input: InboundDeliveryV1): Promise<{
    receiptId: string;
    duplicate: boolean;
  }>;
}

export interface WorkflowJobRepository {
  claim(input: {
    workerId: string;
    limit: number;
    leaseMs: number;
  }): Promise<WorkflowJob[]>;
  complete(input: { jobId: string; leaseToken: string }): Promise<void>;
  retryOrDeadLetter(input: {
    jobId: string;
    leaseToken: string;
    retryAt?: string;
    errorCode: string;
    errorMessage: string;
  }): Promise<void>;
}
