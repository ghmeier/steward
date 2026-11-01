import { sortedKeys } from "./data";

function fail(path: string, reason: string): never {
  throw new Error(`cannot serialize ${path}: ${reason}`);
}

function render(value: unknown, path: string, indent: string): string {
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(path, `${value} is not finite`);
    if (Object.is(value, -0)) fail(path, "negative zero");
    return JSON.stringify(value);
  }
  if (value === null) fail(path, "null");
  if (value === undefined) fail(path, "undefined");
  if (typeof value !== "object") fail(path, `${typeof value} is not data`);

  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      fail(path, "array subclass");
    }
    if (value.length === 0) return "[]";
    const items = [];
    for (let i = 0; i < value.length; i++) {
      if (!Object.hasOwn(value, i)) fail(`${path}[${i}]`, "sparse array hole");
      items.push(`${inner}${render(value[i], `${path}[${i}]`, inner)}`);
    }
    return `[\n${items.join(",\n")}\n${indent}]`;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail(path, "not a plain object");
  }
  const keys = sortedKeys(value);
  if (keys.length === 0) return "{}";
  const entries = keys.map(
    (key) =>
      `${inner}${JSON.stringify(key)}: ${render(
        (value as Record<string, unknown>)[key],
        `${path}.${key}`,
        inner,
      )}`,
  );
  return `{\n${entries.join(",\n")}\n${indent}}`;
}

// The save file and the state hash are both this exact string, so a byte-identical
// save, load, save round trip proves the hash input is stable too. Keys follow `compareKeys`,
// and anything JSON would silently drop or alter throws instead of being saved wrong.
export function canonicalStringify(value: unknown): string {
  return `${render(value, "$", "")}\n`;
}
