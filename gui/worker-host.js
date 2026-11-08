/**
 * Run one GUI command on a worker thread.
 *
 * The Electron main process must stay responsive while `translate` streams
 * batches and while `scan` walks a large archive. `gui/worker.js` hosts the
 * command; this module owns the message protocol:
 *
 *   main -> worker   workerData { command, args, flags }
 *   main -> worker   { type: "cancel" }            (translate only)
 *   worker -> main   { type: "progress", progress }
 *   worker -> main   { type: "warning", line }
 *   worker -> main   { type: "result", envelope }
 *
 * Exactly one result envelope reaches the caller, even when the worker crashes
 * or exits early. Cancellation stays cooperative: the worker owns an
 * AbortController and the runner stops between batches, so an in-flight
 * dictionary write is never torn by process termination.
 *
 * @module gui/worker-host
 */

import { Worker } from "node:worker_threads";

import { buildErrorEnvelope } from "../src/cli/envelope.js";

const WORKER_URL = new URL("./worker.js", import.meta.url);

/**
 * @param {string} command one of {@link module:gui/commands.GUI_COMMANDS}
 * @param {string[]} args
 * @param {{flags?: Record<string, unknown>, onProgress?: Function|null, onWarning?: Function|null, signal?: AbortSignal|null}} [opts]
 * @returns {Promise<Record<string, unknown>>} the CLI-identical JSON envelope
 */
export function runGuiCommandInWorker(command, args, opts = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let worker = null;

    const finish = (envelope) => {
      if (settled) return;
      settled = true;
      if (opts.signal) opts.signal.removeEventListener("abort", onAbort);
      if (worker) {
        // The worker has posted everything it will post; release the thread.
        worker.terminate().catch(() => {});
      }
      resolve(envelope);
    };

    const fail = (message, code = "E_INTERNAL") => {
      finish(buildErrorEnvelope(command, code, message));
    };

    try {
      worker = new Worker(WORKER_URL, {
        workerData: { command, args, flags: opts.flags || {} },
      });
    } catch (error) {
      fail("the GUI worker could not be started: " + (error && error.message ? error.message : error), "E_INTERNAL");
      return;
    }

    function onAbort() {
      try {
        worker.postMessage({ type: "cancel" });
      } catch {
        // The worker is already gone; its exit handler answers.
      }
    }

    if (opts.signal) {
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener("abort", onAbort, { once: true });
    }

    worker.on("message", (message) => {
      if (!message || typeof message !== "object") return;
      if (message.type === "progress") {
        if (opts.onProgress) opts.onProgress(message.progress);
        return;
      }
      if (message.type === "warning") {
        if (opts.onWarning) opts.onWarning(String(message.line));
        return;
      }
      if (message.type === "result") finish(message.envelope);
    });
    worker.on("error", (error) => fail("the GUI worker failed: " + (error && error.message ? error.message : error)));
    worker.on("exit", (code) => {
      if (!settled) fail("the GUI worker exited before returning a result (exit code " + code + ")");
    });
  });
}
