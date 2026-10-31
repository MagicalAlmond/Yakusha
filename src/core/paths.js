/**
 * Refuse to write or delete outside a project root.
 *
 * Installers create directories that may not exist yet, so the target itself
 * cannot be realpath'd. Resolve the nearest existing ancestor through realpath
 * instead and append the missing segments: a symlink or junction anywhere on
 * the way is then resolved before the containment check, and a target that
 * ultimately lives outside the root is rejected before anything touches disk.
 *
 * @module core/paths
 */

import fs from "node:fs";
import path from "node:path";

/**
 * @param {{ root: string }} project
 * @param {string} target
 * @returns {void}
 * @throws {Error} E_IO when the project root cannot be resolved or the target escapes it
 */
export function assertInsideRoot(project, target) {
  let root;
  try {
    root = fs.realpathSync(project.root);
  } catch (error) {
    const failure = new Error("cannot resolve the project root " + project.root + " (" + ((error && error.code) || "realpath failed") + ")");
    failure.code = "E_IO";
    throw failure;
  }
  const absolute = path.resolve(target);
  const missing = [];
  let probe = absolute;
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) break;
    missing.unshift(path.basename(probe));
    probe = parent;
  }
  const base = fs.realpathSync(probe);
  const resolved = path.join(base, ...missing);
  const relative = path.relative(root, resolved);
  const escapes = relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative);
  if (escapes) {
    const error = new Error("refusing to write outside the project root: " + target);
    error.code = "E_IO";
    throw error;
  }
}
