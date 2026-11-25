export const EPS = 1e-9;
export const METERS_PER_YARD = 0.9144;
export const CM_PER_INCH = 2.54;

export function round(value: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round((value + Math.sign(value) * Number.EPSILON) * f) / f;
}

export function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

export function avg(values: number[]): number {
  return values.length ? sum(values) / values.length : NaN;
}
