# One-time configuration

The daily commands inherit branch-scoped Preview variables already stored in Vercel. Do not add them again for ordinary deployments.

Create `.local/p0-preview.env`, set its mode to `0600`, and supply these values from the approved password manager or secret store:

```dotenv
FEISHU_BRIDGE_KEY_ID=<preview bridge key id>
FEISHU_BRIDGE_SHARED_SECRET=<32+ character preview bridge secret>
CONTROL_PLANE_TICK_TOKEN=<preview worker token>
VERCEL_AUTOMATION_BYPASS_SECRET=<Vercel automation bypass secret>
```

Never paste real values into chat, source files, screenshots, shell arguments, documentation, or test fixtures. The script reads this file without evaluating shell substitutions.

Vercel Preview must already contain the test App/OA/Base/Drive/database/DeepSeek configuration for branch `p0-three-source-direct-http`. Native submit must remain disabled. Ordinary `deploy` does not edit environment variables or Gates.

The generated `.local/p0-preview-state.json` is non-secret and ignored by Git. Do not hand-edit its deployment URL, Git SHA, or PIDs.
