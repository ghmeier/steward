const SUFFIXES = ["M", "B", "T"];

export function withThousandsSeparators(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatMagnitude(magnitude: number): string {
  const fixed = magnitude.toFixed(1);
  if (Number(fixed) < 1e6) {
    const [whole = "0", fraction = "0"] = fixed.split(".");
    return `${withThousandsSeparators(whole)}.${fraction}`;
  }
  let scaled = magnitude / 1e6;
  for (const suffix of SUFFIXES) {
    const rounded = Number(scaled.toPrecision(3));
    // Rounding can carry a value like 999.9 up to 1000, which belongs to the next suffix.
    if (rounded < 1000) {
      const decimals = rounded < 10 ? 2 : rounded < 100 ? 1 : 0;
      return `${rounded.toFixed(decimals)}${suffix}`;
    }
    scaled /= 1000;
  }
  return magnitude.toExponential(2).replace("e+", "e");
}

export function formatAmount(value: number): string {
  const body = formatMagnitude(Math.abs(value));
  return value < 0 && body !== "0.0" ? `-${body}` : body;
}
