const legacyTickMarker = "/api/internal/control-plane/tick";
const guardedWorkerMarker = "scripts/run-p0-control-plane-worker.mjs";
const guardedWorkerCommand = new RegExp(
  `^(?:\\S*/)?node(?:\\s+--\\S+)*\\s+${guardedWorkerMarker.replaceAll("/", "\\/")}(?:\\s|$)`,
  "u",
);

function processLine(line) {
  const match = line.trim().match(/^(\d+)\s+(.*)$/u);
  if (!match) return undefined;
  return { pid: Number(match[1]), command: match[2] };
}

export function conflictingP0WorkerProcesses(
  processList,
  ignoredPids = [],
) {
  const ignored = new Set(ignoredPids);
  return processList
    .split("\n")
    .map(processLine)
    .filter((process) => {
      if (!process || ignored.has(process.pid)) return false;
      return (
        (process.command.includes("curl") &&
          process.command.includes(legacyTickMarker)) ||
        guardedWorkerCommand.test(process.command)
      );
    })
    .map((process) => process.pid);
}

export function assertExclusiveP0Worker({
  processList,
  currentPid = process.pid,
  parentPid = process.ppid,
}) {
  const conflicts = conflictingP0WorkerProcesses(processList, [
    currentPid,
    parentPid,
  ]);
  if (conflicts.length) {
    throw new Error(
      `Refusing to start while another P0 worker or legacy tick loop is running (pid=${conflicts.join(",")})`,
    );
  }
}
