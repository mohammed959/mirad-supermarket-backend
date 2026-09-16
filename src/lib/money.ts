/**
 * Integer-cents helpers so monetary comparisons — delivery-pricing range
 * boundaries, the free-delivery threshold, subtotal-to-range matching —
 * never fall prey to binary floating-point representation error (e.g.
 * `49.99 !== 49.99` after arithmetic, or `0.1 + 0.2 !== 0.3`). Any place
 * that compares or chains monetary boundaries should compare cents, not
 * raw decimals.
 */

export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}

/** True when `amount` is a finite, non-negative value with at most 2 decimal places. */
export function isValidMoney(amount: unknown): amount is number {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) return false;
  const cents = amount * 100;
  return Math.abs(cents - Math.round(cents)) < 1e-6;
}
