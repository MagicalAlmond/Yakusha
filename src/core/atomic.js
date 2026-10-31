/**
 * Write a small text file without ever leaving a half-written target behind.
 *
 * The file is created under a same-directory temporary name and then renamed
 * over the target, which is atomic on NTFS for files on the same volume. If
 * anything fails before the rename, the temporary file is removed and the
 * original target stays exactly as it was. The CLI already used this dance for
 * config files and exports; this helper gives the dictionary and the GUI's
 * credential envelope the same guarantee.
 *
 * @module core/atomic
 */

import fs from "node:fs";
import path from "node:path";

/**
 * @param {string} file target path
 * @param {string} text complete UTF-8 contents
 * @returns {void}
 */
export function writeFileAtomic(file, text) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const temp = path.join(
    dir,
    "." + path.basename(file) + "." + process.pid + "." + Math.random().toString(16).slice(2) + ".tmp"
  );
  try {
    fs.writeFileSync(temp, text, { encoding: "utf8", flag: "wx" });
    fs.renameSync(temp, file);
  } catch (error) {
    try {
      fs.unlinkSync(temp);
    } catch {
      // The temporary file may not exist; the original must stay untouched.
    }
    throw error;
  }
}
