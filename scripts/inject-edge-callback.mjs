import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const outputDir = join(process.cwd(), ".vercel", "output");
const configPath = join(outputDir, "config.json");

try {
  await readFile(configPath, "utf8");
} catch {
  process.exit(0);
}

const functionDir = join(
  outputDir,
  "functions",
  "api",
  "feishu",
  "events.func",
);
await mkdir(functionDir, { recursive: true });

await writeFile(
  join(functionDir, ".vc-config.json"),
  JSON.stringify(
    {
      runtime: "edge",
      entrypoint: "index.js",
      regions: "all",
    },
    null,
    2,
  ),
);

await writeFile(
  join(functionDir, "index.js"),
  `export default async function handler(request, context) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const body = await request.text();
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    return Response.json({ code: 1, message: "Invalid JSON" }, { status: 400 });
  }

  if (payload && typeof payload.challenge === "string") {
    return Response.json({ challenge: payload.challenge });
  }

  const target = new URL("/api/feishu/process", request.url);
  const processing = fetch(target, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  }).then(async (response) => {
    if (!response.ok) {
      console.error("Feishu background processing failed", response.status, await response.text());
    }
  });

  context.waitUntil(processing);
  return Response.json({ code: 0 });
}
`,
);
