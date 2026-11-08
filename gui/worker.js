/**
 * Worker-thread entry for one GUI command.
 *
 * This file is the only place the Electron GUI imports
 * {@link module:gui/handlers} and therefore the CLI runner. It owns an
 * AbortController so `gui:cancel` can stop a translate run cooperatively
 * between batches instead of killing the thread mid-write.
 *
 * @module gui/worker
 */

import { parentPort, workerData } from "node:worker_threads";

import { buildErrorEnvelope } from "../src/cli/envelope.js";
import { runGuiCommand } from "./handlers.js";

const { command, args, flags } = workerData || {};
const controller = new AbortController();

parentPort.on("message", (message) => {
  if (message && message.type === "cancel") controller.abort();
});

let envelope;
try {
  envelope = await runGuiCommand(command, Array.isArray(args) ? args : [], {
    flags: flags && typeof flags === "object" ? flags : {},
    onProgress: (progress) => parentPort.postMessage({ type: "progress", progress }),
    onWarning: (line) => parentPort.postMessage({ type: "warning", line: String(line) }),
    signal: controller.signal,
  });
} catch (error) {
  envelope = buildErrorEnvelope(
    command,
    "E_INTERNAL",
    "the GUI worker command threw: " + (error && error.message ? error.message : error),
  );
}
parentPort.postMessage({ type: "result", envelope });
parentPort.close();
