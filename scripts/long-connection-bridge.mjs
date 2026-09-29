import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";

if (
  process.env.HTTP_PROXY ||
  process.env.HTTPS_PROXY ||
  process.env.ALL_PROXY
) {
  setGlobalDispatcher(new EnvHttpProxyAgent());
}

const target =
  process.env.FEISHU_PROCESS_URL ??
  "https://aihuishou-feishu-workflow.vercel.app/api/feishu/process";

const consumers = [
  {
    key: "im.message.receive_v1",
    toPayload(event) {
      return {
        header: { event_type: event.type },
        event: {
          sender: { sender_id: { open_id: event.sender_id } },
          message: {
            message_id: event.message_id ?? event.id,
            message_type: event.message_type,
            content: JSON.stringify({ text: event.content }),
          },
        },
      };
    },
  },
  {
    key: "card.action.trigger",
    toPayload(event) {
      return {
        action: {
          name: event.action_name,
          value: event.action_value,
          form_value: event.form_value,
        },
        operator: { open_id: event.operator_id },
      };
    },
  },
];

const children = [];
let shuttingDown = false;
let forwarding = Promise.resolve();

async function forward(key, event, toPayload) {
  const response = await fetch(target, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(toPayload(event)),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${key} forward failed (${response.status}): ${body}`);
  }
  console.log(`[bridge] handled ${key}: ${body}`);
}

function startConsumer({ key, toPayload }) {
  const child = spawn(
    "lark-cli",
    ["event", "consume", key, "--as", "bot"],
    {
      env: {
        ...process.env,
        LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1",
        LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  children.push(child);

  createInterface({ input: child.stdout }).on("line", (line) => {
    let event;
    try {
      event = JSON.parse(line);
    } catch (error) {
      console.error(`[bridge] invalid ${key} event:`, error);
      return;
    }
    console.log(
      `[bridge] received ${key}: id=${event.message_id ?? event.id ?? "missing"} type=${event.message_type ?? "unknown"}`,
    );
    forwarding = forwarding
      .then(() => forward(key, event, toPayload))
      .catch((error) => console.error("[bridge]", error));
  });

  createInterface({ input: child.stderr }).on("line", (line) => {
    console.error(`[${key}] ${line}`);
  });

  child.on("exit", (code, signal) => {
    if (!shuttingDown) {
      console.error(
        `[bridge] ${key} stopped unexpectedly (code=${code}, signal=${signal})`,
      );
      shutdown(1);
    }
  });
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(exitCode), 500);
}

process.on("SIGINT", () => shutdown());
process.on("SIGTERM", () => shutdown());

console.log(`[bridge] forwarding Feishu events to ${target}`);
for (const consumer of consumers) startConsumer(consumer);
