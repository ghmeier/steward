/**
 * Seeded random number generation. The generator is xoshiro128** with four
 * uint32 words, written with only Math.imul, shifts, bitwise operators and
 * `>>> 0` so every engine produces identical output. Streams are plain arrays
 * so they save to and load from JSON unchanged. There is deliberately no
 * float draw: floats invite platform-dependent rounding.
 */
export type RngState = [number, number, number, number];

const UINT32_RANGE = 4294967296;

function rotateLeft(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

/** One step of splitmix32 (Tommy Ettinger's 32-bit variant); advances `state` and returns the output. */
function splitmix32(state: number): { state: number; output: number } {
  const next = (state + 0x9e3779b9) | 0;
  let t = next ^ (next >>> 16);
  t = Math.imul(t, 0x21f0aaad);
  t ^= t >>> 15;
  t = Math.imul(t, 0x735a2d97);
  t ^= t >>> 15;
  return { state: next, output: t >>> 0 };
}

/**
 * Derives an independent stream from the posting seed and a system name.
 *
 * The hash is FNV-1a (32-bit, offset basis 0x811c9dc5, prime 0x01000193)
 * absorbing the four bytes of the seed (little-endian) and then each UTF-16
 * code unit of the name as two bytes (low, high). Absorbing the seed before
 * the name keeps (seed, name) pairs from colliding by simple xor symmetry.
 * The hash seeds splitmix32, which emits the four state words.
 */
export function seedStream(seed: number, streamName: string): RngState {
  if (!Number.isInteger(seed) || seed < 0 || seed >= UINT32_RANGE) {
    throw new RangeError(`seed must be a uint32, got ${seed}`);
  }
  let hash = 0x811c9dc5;
  const absorb = (byte: number): void => {
    hash = Math.imul(hash ^ (byte & 0xff), 0x01000193);
  };
  for (let shift = 0; shift < 32; shift += 8) {
    absorb(seed >>> shift);
  }
  for (let i = 0; i < streamName.length; i++) {
    const unit = streamName.charCodeAt(i);
    absorb(unit);
    absorb(unit >>> 8);
  }

  let mixer = hash | 0;
  const words: number[] = [];
  for (let i = 0; i < 4; i++) {
    const step = splitmix32(mixer);
    mixer = step.state;
    words.push(step.output);
  }
  const [a = 0, b = 0, c = 0, d = 0] = words;
  // xoshiro never leaves the all-zero state, so it must not be a starting point.
  if ((a | b | c | d) === 0) {
    return [1, 0, 0, 0];
  }
  return [a, b, c, d];
}

/** Advances the stream in place and returns the next uint32. */
export function nextU32(stream: RngState): number {
  const [s0, s1, s2, s3] = stream;
  const result = Math.imul(rotateLeft(Math.imul(s1, 5), 7), 9) >>> 0;
  const t = s1 << 9;
  const n2 = s2 ^ s0;
  const n3 = s3 ^ s1;
  const n1 = s1 ^ n2;
  const n0 = s0 ^ n3;
  stream[0] = n0 >>> 0;
  stream[1] = n1 >>> 0;
  stream[2] = (n2 ^ t) >>> 0;
  stream[3] = rotateLeft(n3, 11);
  return result;
}

/** Ticks until a scheduled event, in [minTicks, maxTicks]; the caller adds the current tick. */
export function drawDelay(
  stream: RngState,
  range: Readonly<{ minTicks: number; maxTicks: number }>,
): number {
  return range.minTicks + intBelow(stream, range.maxTicks - range.minTicks + 1);
}

/** Uniform integer in [0, n) using rejection sampling to avoid modulo bias. */
export function intBelow(stream: RngState, n: number): number {
  if (!Number.isInteger(n) || n < 1 || n > UINT32_RANGE) {
    throw new RangeError(`n must be an integer in [1, 2^32], got ${n}`);
  }
  if (n === UINT32_RANGE) {
    return nextU32(stream);
  }
  // Largest multiple of n that fits in 2^32; draws at or above it are rejected.
  const limit = UINT32_RANGE - (UINT32_RANGE % n);
  let value = nextU32(stream);
  while (value >= limit) {
    value = nextU32(stream);
  }
  return value % n;
}

/** True with probability perMille / 1000. */
export function chance(stream: RngState, perMille: number): boolean {
  if (!Number.isInteger(perMille) || perMille < 0 || perMille > 1000) {
    throw new RangeError(
      `perMille must be an integer in [0, 1000], got ${perMille}`,
    );
  }
  return intBelow(stream, 1000) < perMille;
}
