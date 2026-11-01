// Math.pow, Math.log and friends are implementation-defined and may differ in the last bit
// between engines, which would break replay determinism. Multiplication is exactly rounded
// under IEEE 754, so repeated squaring gives the same bits everywhere.
export function powInt(base: number, exponent: number): number {
  if (!Number.isInteger(exponent)) {
    throw new Error(`powInt exponent must be an integer, got ${exponent}`);
  }
  if (exponent < 0) return 1 / powInt(base, -exponent);

  let result = 1;
  let square = base;
  let remaining = exponent;
  while (remaining > 0) {
    if (remaining % 2 === 1) result *= square;
    remaining = Math.floor(remaining / 2);
    if (remaining > 0) square *= square;
  }
  return result;
}

export function normalizeZero(value: number): number {
  return value === 0 ? 0 : value;
}

export function clampFinite(value: number, maxValue: number): number {
  if (Number.isNaN(value)) throw new Error("clampFinite received NaN");
  return normalizeZero(Math.min(maxValue, Math.max(-maxValue, value)));
}

export type AbsorbedAdditionLog = Record<
  string,
  { count: number; firstTick: number }
>;

export type AddContext = {
  tick: number;
  maxValue: number;
  absorbed: AbsorbedAdditionLog | null;
};

export function add(
  resources: Record<string, number>,
  resource: string,
  delta: number,
  context: AddContext,
): void {
  const current = resources[resource] ?? 0;
  const next = clampFinite(current + delta, context.maxValue);
  resources[resource] = next;

  // A value pinned at the clamp also leaves the stored number unchanged, but that is
  // saturation, not floating-point absorption, so it is not logged.
  const pinned = next === context.maxValue || next === -context.maxValue;
  if (delta === 0 || next !== current || pinned || context.absorbed === null) {
    return;
  }

  const entry = context.absorbed[resource];
  if (entry) entry.count += 1;
  else context.absorbed[resource] = { count: 1, firstTick: context.tick };
}
