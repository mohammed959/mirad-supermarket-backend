/**
 * Server-side mirror of the frontend's Saudi mobile normalization
 * (`frontend/src/lib/phone.ts`). The client already sends E.164
 * (`+966XXXXXXXXX`), but the backend must not simply trust that — every
 * write and every lookup that keys off a phone number has to agree on one
 * canonical form, or the active-account uniqueness rule (see the `User`
 * model's `mobileActive` generated column) can be silently bypassed by two
 * differently-formatted strings that represent the same real number.
 */

const SAUDI_COUNTRY_CODE = '966';

/**
 * Normalize a raw mobile number to `+966XXXXXXXXX`. Idempotent — already
 * normalized input passes through unchanged. Falls back to `+<digits>` for
 * non-Saudi-looking input rather than throwing, so it stays safe to call on
 * any existing stored value.
 */
export function normalizeMobile(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  let national: string;
  if (digits.startsWith(SAUDI_COUNTRY_CODE)) {
    national = digits.slice(SAUDI_COUNTRY_CODE.length);
  } else if (digits.startsWith('0')) {
    national = digits.slice(1);
  } else {
    national = digits;
  }
  return `+${SAUDI_COUNTRY_CODE}${national}`;
}
