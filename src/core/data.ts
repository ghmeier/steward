// Keys are ordered by UTF-16 code unit (plain `<`, never locale-aware) so no platform can
// reorder them. The canonical serializer depends on this: the save file and the state hash are
// the same string, so any ordering that varied by platform would change both.
export function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function sortedKeys(value: object): string[] {
  return Object.keys(value).sort(compareKeys);
}

export function sortedValues<T>(value: Record<string, T>): T[] {
  return Object.entries(value)
    .sort(([a], [b]) => compareKeys(a, b))
    .map(([, entry]) => entry);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
