/**
 * The one place the version number comes from.
 *
 * package.json is the single source of truth. The CLI's --version, the library
 * facade and the plugin the installer renders all read it from here, so a
 * release only has to bump one file.
 *
 * @module version
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_FILE = path.join(HERE, "..", "package.json");

/**
 * The package version, read once at load time.
 *
 * @type {string}
 */
export const VERSION = JSON.parse(fs.readFileSync(PACKAGE_FILE, "utf8")).version;
