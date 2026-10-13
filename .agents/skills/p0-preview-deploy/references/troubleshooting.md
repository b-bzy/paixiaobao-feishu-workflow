# Troubleshooting

## Dirty working tree

The tool refuses to deploy an unreproducible checkout. Inspect `git status`, preserve all user changes, and obtain explicit commit authorization before committing. Never reset or discard files to bypass the Gate.

## Deployment URL is not unique

Treat the Vercel CLI run as failed. Do not copy a URL from progress logs or reuse an old state URL. Check Vercel authentication/project linkage, then run a new explicitly authorized deployment.

## Protection or identity failure

Do not recreate `.vercel/vercel-protection-relay.mjs` and do not put the bypass secret in a query string. Verify that the local bypass value matches an active project Automation Bypass secret. A rotated value requires a new deployment. A SHA mismatch always blocks startup.

## Duplicate or partial runner startup

Run `pnpm p0:preview:status`. If the recorded PID and command fingerprint match, use `pnpm p0:preview:down`. The tool refuses to signal a reused or unrelated PID. Do not manually start another bridge, worker, relay, or `curl` tick loop.

## What success means

`deploy` success proves only that a protected Preview with the expected SHA is reachable. `up` success proves only that one local bridge and one worker are alive. The business result still requires the user’s manual Feishu E2E and must end at the isolated OA test draft, not native OA.
