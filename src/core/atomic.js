/**
 * Replace files without ever leaving a half-written target behind.
 *
 * Both helpers use a same-directory temporary name and rename it over the
 * target, which is atomic on NTFS for files on the same volume. If anything
 * fails before the rename, the temporary file is removed and the original
 * target stays exactly as it was. The CLI already used this dance for config
 * files and exports; these helpers give dictionaries, GUI credentials and the
 * installed native components the same guarantee.
 *
 * @module core/atomic
 */

import fs from "node:fs";
import path from "node:path";

/** @param {string} file target path */
function temporaryPath(file) {
  return path.join(
    path.dirname(file),
    "." + path.basename(file) + "." + process.pid + "." + Math.random().toString(16).slice(2) + ".tmp"
  );
}

/**
 * @param {string} file target path
 * @param {string} text complete UTF-8 contents
 * @returns {void}
 */
export function writeFileAtomic(file, text) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const temp = temporaryPath(file);
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

/**
 * Replace a binary file through the same temporary-name-and-rename dance.
 *
 * @param {string} file target path
 * @param {Buffer|Uint8Array} bytes complete contents
 * @returns {void}
 */
export function writeBytesAtomic(file, bytes) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const temp = temporaryPath(file);
  try {
    fs.writeFileSync(temp, bytes, { flag: "wx" });
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

/**
 * Copy a file into place without writing through a pre-existing hard link or
 * symbol link at the destination. Renaming a fresh copy over the target
 * replaces the directory entry instead of truncating whatever it pointed at.
 *
 * @param {string} source existing file to copy
 * @param {string} file target path
 * @returns {void}
 */
export function copyFileAtomic(source, file) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const temp = temporaryPath(file);
  try {
    fs.copyFileSync(source, temp, fs.constants.COPYFILE_EXCL);
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
