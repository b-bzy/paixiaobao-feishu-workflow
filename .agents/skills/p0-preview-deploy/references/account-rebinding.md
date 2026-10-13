# Rebind Feishu or Vercel accounts

Use this runbook only when the user explicitly asks to change the Feishu
identity/App/tenant or the Vercel account/team/project used by the P0 Preview.
It is not part of an ordinary deployment. Do not copy secrets between accounts,
create replacement cloud resources, delete the old setup, or enable native OA
without separate authorization.

## Identify what changed

These identities are independent:

| Change | What it affects | What it does not automatically change |
| --- | --- | --- |
| Feishu human login only | User OAuth operations in the selected `lark-cli` profile | The Bot App, long-connection bot identity, Vercel project, or server App credentials |
| Feishu App or tenant | Bot identity, App ID/secret, event subscriptions, scopes, Open IDs, Base/Drive/OA resources | Vercel ownership or deployment protection |
| Vercel account or team | CLI authentication and the owner of the linked project | Feishu App, tenant resources, or local `lark-cli` profile |
| Vercel project | Preview environment variables, deployment protection, project ID and deployments | Values stored in the old project; they are not transferred automatically |

The bridge consumes events as `bot`. Merely signing a different human into
Feishu does not move the Bot to a different App or tenant.

## Safe preparation

1. Run `pnpm p0:preview:status`. If a registered bridge or worker is running,
   run `pnpm p0:preview:down` and require a clean stop before rebinding.
2. Record only non-secret mappings: the current `lark-cli` profile name,
   Feishu brand, Vercel user/team slug, and project name. Never print App
   secrets, tokens, database URLs, bypass values, Open IDs, or full config.
3. Keep the old profile, project, and secrets intact until the replacement has
   passed identity, revision, and manual Feishu checks.
4. Confirm that native submit remains disabled. Account migration never grants
   permission to change the OA kill switch, allowlists, Production, or approval
   routing.

## Change only the Feishu human login

Use a named profile so the previous login remains recoverable. Inspect first:

```bash
lark-cli profile list
lark-cli whoami --profile <profile> --as bot
lark-cli auth status --profile <profile> --verify
```

Only when the user requests a different human OAuth identity, start a scoped
device login for the intended profile. Request only domains needed by the
approved test instead of all domains. This is interactive and must not be
claimed complete until the user finishes authorization and `auth status
--verify` succeeds.

Changing the human login alone does not require updating `FEISHU_APP_ID`,
`FEISHU_APP_SECRET`, bridge HMAC keys, or Vercel variables. The P0 consumer
continues to use the profile's Bot App.

## Change the Feishu App or tenant

Treat this as a new isolated test binding, not a login refresh.

1. Create a new named `lark-cli` profile. Supply the App secret only through
   stdin; never place it in an argument, file committed to Git, chat, or logs:

   ```bash
   lark-cli profile add --name <profile> --app-id <app-id> \
     --app-secret-stdin --brand feishu
   ```

2. With explicit authorization, make that profile active because the bridge
   invokes `lark-cli event consume ... --as bot` without a profile argument:

   ```bash
   lark-cli profile use <profile>
   lark-cli whoami --as bot
   lark-cli doctor
   ```

3. In the new Feishu App, verify the required Bot capability, event
   subscriptions for `im.message.receive_v1` and `card.action.trigger`, the
   minimum approved scopes, released test version, and test-chat membership.
   Do not widen permissions just to make a check pass.
4. Recreate or explicitly remap tenant-scoped facts. Open IDs, Base App/table
   IDs, Drive folder/file tokens, approval definitions, and allowlists from the
   old App or tenant must not be assumed valid in the new one.
5. Update the target Vercel Preview branch variables for the new App and its
   approved P0 resources. At minimum review `FEISHU_APP_ID`,
   `FEISHU_APP_SECRET`, all `FEISHU_COUPON_*_ALLOWED_OPEN_IDS`, and the
   three-source Base/Drive/table/folder variables. Keep native submit disabled.
6. Create a new bridge key ID/shared secret pair for the new binding and store
   the same pair in the branch-scoped Vercel Preview configuration and local
   `.local/p0-preview.env`. Do not reuse the Feishu App secret as the bridge
   secret.

If only the App changes while the Vercel project stays the same, the Vercel
account does not need to be relinked.

## Change the Vercel account, team, or project

Vercel authentication and project linking are global/external writes. Obtain
explicit authorization before logging out, logging in, switching teams, or
rewriting `.vercel/project.json`.

1. Authenticate the intended account using the interactive CLI or a token
   supplied from an approved secret store. Never put a token in documentation,
   chat, shell history, or `.local/p0-preview.env`:

   ```bash
   pnpm dlx vercel@latest whoami
   pnpm dlx vercel@latest login
   pnpm dlx vercel@latest whoami
   ```

   Run `logout` only when the user explicitly wants to remove the current
   machine-wide login. For a team change within the same account, use `vercel
   switch <team-slug>` instead of logging out.

2. Decide whether the target is an existing approved project or a new project.
   Do not silently create one. The P0 tool requires the linked project name to
   remain `aihuishou-feishu-workflow`.
3. Relink explicitly and then inspect the resulting non-secret mapping:

   ```bash
   pnpm dlx vercel@latest link --yes \
     --team <team-id-or-slug> --project aihuishou-feishu-workflow
   pnpm dlx vercel@latest whoami
   ```

4. Recreate the target project's branch-scoped Preview variables for
   `p0-three-source-direct-http`. Environment variables, databases, object
   storage bindings, Deployment Protection, Automation Bypass credentials, and
   Git integration are project-owned and do not transfer with `vercel link`.
   Use the approved password manager/source of truth; never pull old secrets
   into a file for copying.
5. Generate a new Automation Bypass value in the target project and update only
   `VERCEL_AUTOMATION_BYPASS_SECRET` in the mode-`0600` local config. If the
   bridge HMAC or worker token is rotated, update both the target Preview and
   `.local/p0-preview.env` atomically.

## Verify the replacement binding

Do not delete or disable the previous binding yet.

1. Confirm the expected Bot App/profile with `lark-cli whoami --as bot` and
   confirm the intended Vercel user/team/project without printing identifiers
   or secrets in the report.
2. On a clean `p0-three-source-direct-http` checkout, run
   `pnpm p0:preview:check`.
3. With deployment authorization, run `pnpm p0:preview:deploy`. The protected
   identity endpoint must return the exact local full Git SHA.
4. With authorization to start Feishu testing, run `pnpm p0:preview:up`, then
   `pnpm p0:preview:status`. Exactly one bridge and one worker must be online.
5. Perform one allowlisted, draft-only manual Feishu test. A healthy deployment
   is not proof of a successful Feishu E2E or OA result.

## Roll back

If any identity, permission, protection, resource, or revision check fails,
stop with `pnpm p0:preview:down`. Switch back to the preserved `lark-cli`
profile and relink the prior approved Vercel project only with explicit
authorization. Restore local secrets from the password manager, not from logs
or generated files. Never delete the failed or old cloud binding as part of
rollback unless the user separately authorizes deletion.
