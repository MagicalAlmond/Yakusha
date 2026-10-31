/**
 * Engine version matrix helpers.
 *
 * Every adapter declares the engine versions it knows about (`versions`). The
 * doctor turns a project's detected `version` into at most one check: a warning
 * when the version is outside the matrix, an info line when the version cannot
 * be read or names a supported-but-untested build, and nothing at all for a
 * version the matrix covers. Keeping the comparison here means adapters only
 * carry data and the wording stays consistent across engines.
 *
 * @module core/versions
 */

/**
 * Parse a dotted numeric version into comparable components.
 *
 * Only digits and dots are accepted: `1.7.0` parses, `v1.7.0` and `1.7-beta` do
 * not. Engines report their versions in different shapes (MZ/MV use three
 * components, RGSS uses a single family number), so the comparison pads the
 * shorter side with zeroes rather than requiring a fixed length.
 *
 * @param {unknown} value
 * @returns {number[]|null}
 */
export function parseVersion(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d+)*$/.test(trimmed)) return null;
  return trimmed.split(".").map((part) => Number(part));
}

/**
 * Compare two dotted versions.
 *
 * @param {string|number[]} left
 * @param {string|number[]} right
 * @returns {number|null} negative, zero or positive; null when either side is
 *   not a parseable version
 */
export function compareVersions(left, right) {
  const a = Array.isArray(left) ? left : parseVersion(left);
  const b = Array.isArray(right) ? right : parseVersion(right);
  if (!a || !b) return null;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const one = a[index] || 0;
    const other = b[index] || 0;
    if (one < other) return -1;
    if (one > other) return 1;
  }
  return 0;
}

/**
 * Human-readable description of one adapter's matrix.
 *
 * @param {{kind?: string, min?: string, max?: string, values?: string[], tested?: string[], reason?: string}|null|undefined} spec
 * @returns {string}
 */
export function describeVersionSpec(spec) {
  if (!spec) return "";
  if (spec.kind === "range") return spec.min + " - " + spec.max + " (tested " + spec.tested.join(", ") + ")";
  if (spec.kind === "values") return "one of " + spec.values.join(", ") + " (tested " + spec.tested.join(", ") + ")";
  return spec.reason || "";
}

/**
 * Check one detected project version against an adapter matrix.
 *
 * @param {string|null|undefined} version value from `project.version`
 * @param {{kind?: string, min?: string, max?: string, values?: string[], tested?: string[], reason?: string}|null|undefined} spec
 * @returns {{level: "info"|"warn", message: string}|null} null when the
 *   version is covered and does not need its own line
 */
export function checkVersion(version, spec) {
  if (!spec || spec.kind === "none") return null;
  const missing = version === null || version === undefined || String(version).trim().length === 0;
  if (missing) {
    return { level: "info", message: "engine version could not be determined - supported: " + describeVersionSpec(spec) };
  }
  const text = String(version).trim();
  if (spec.kind === "values") {
    if (spec.values.includes(text)) {
      if (spec.tested.includes(text)) return null;
      return { level: "info", message: "engine version " + text + " is supported but has not been tested - supported: " + describeVersionSpec(spec) };
    }
    return { level: "warn", message: "engine version " + text + " is not supported - supported: " + describeVersionSpec(spec) };
  }
  const parsed = parseVersion(text);
  if (!parsed) {
    return { level: "info", message: "engine version " + JSON.stringify(text) + " is not a recognised version number - supported: " + describeVersionSpec(spec) };
  }
  const below = compareVersions(parsed, spec.min) < 0;
  const above = compareVersions(parsed, spec.max) > 0;
  if (below || above) {
    return { level: "warn", message: "engine version " + text + " is outside the supported range - supported: " + describeVersionSpec(spec) };
  }
  return null;
}
