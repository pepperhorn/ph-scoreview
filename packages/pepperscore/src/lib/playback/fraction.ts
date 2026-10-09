/** Exact rational numbers for sub-bar positions ("0", "3", "5/2"). */
export type Fraction = { n: number; d: number };

const gcd = (a: number, b: number): number => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a || 1; };

export function fraction(n: number, d = 1): Fraction {
  if (!Number.isInteger(n) || !Number.isInteger(d) || d === 0) throw new Error(`Invalid fraction ${n}/${d}`);
  if (d < 0) { n = -n; d = -d; }
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}

/** The closest rational with a bounded denominator (continued fractions); exact for tuplet-sized values. */
export function fromNumber(value: number, maxDenominator = 30240): Fraction {
  if (!Number.isFinite(value)) throw new Error(`Invalid beat ${value}`);
  const sign = value < 0 ? -1 : 1;
  let x = Math.abs(value);
  let [h0, h1, k0, k1] = [0, 1, 1, 0];
  for (let i = 0; i < 64; i++) {
    const a = Math.floor(x);
    const h2 = a * h1 + h0, k2 = a * k1 + k0;
    if (k2 > maxDenominator) break;
    [h0, h1, k0, k1] = [h1, h2, k1, k2];
    const rest = x - a;
    if (rest < 1e-12 || Math.abs(h1 / k1 - Math.abs(value)) < 1e-12) break;
    x = 1 / rest;
  }
  return fraction(sign * h1, k1 || 1);
}

/** Parses "5/2", "3", "2.5" or "-1/4"; undefined for anything else. */
export function parseFraction(text: unknown): Fraction | undefined {
  if (typeof text !== 'string') return undefined;
  const rational = /^\s*(-?\d{1,9})(?:\s*\/\s*(\d{1,9}))?\s*$/.exec(text);
  if (rational) return rational[2] === undefined ? fraction(Number(rational[1])) : Number(rational[2]) > 0 ? fraction(Number(rational[1]), Number(rational[2])) : undefined;
  const decimal = /^\s*(-?\d{1,9})\.(\d{1,6})\s*$/.exec(text);
  if (decimal) { const scale = 10 ** decimal[2].length; return fraction(Number(decimal[1]) * scale + Math.sign(Number(decimal[1] + '1')) * Number(decimal[2]), scale); }
  return undefined;
}

export const addFraction = (a: Fraction, b: Fraction) => fraction(a.n * b.d + b.n * a.d, a.d * b.d);
export const subFraction = (a: Fraction, b: Fraction) => fraction(a.n * b.d - b.n * a.d, a.d * b.d);
export const compareFraction = (a: Fraction, b: Fraction) => Math.sign(a.n * b.d - b.n * a.d);
export const fractionValue = (a: Fraction) => a.n / a.d;
export const formatFraction = (a: Fraction) => a.d === 1 ? String(a.n) : `${a.n}/${a.d}`;
export const ZERO: Fraction = { n: 0, d: 1 };
