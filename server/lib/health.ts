export function getServiceStatus() {
  return {
    service: "aihuishou-feishu-workflow",
    status: "ok",
    scope: "expense-approval-poc",
  } as const;
}
