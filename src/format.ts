const NZ_TZ = "Pacific/Auckland";

const nzd = new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" });

/** Formats a number as NZ dollars, e.g. -1234.5 -> "-$1,234.50". */
export function formatNzd(amount: number): string {
  return nzd.format(amount);
}

/**
 * Normalises an NZ bank account number to `BB-bbbb-AAAAAAA-SSS?` form.
 * Accepts dashes, spaces or no separators. Returns null if invalid.
 */
export function normaliseAccountNumber(input: string): string | null {
  const digits = input.replace(/[\s-]/g, "");
  if (!/^\d{15,16}$/.test(digits)) return null;
  return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6, 13)}-${digits.slice(13)}`;
}

/** Offset of Pacific/Auckland from UTC on a given calendar date, as "+13:00". */
function nzOffset(date: string): string {
  const probe = new Date(`${date}T12:00:00Z`);
  const part = new Intl.DateTimeFormat("en-NZ", { timeZone: NZ_TZ, timeZoneName: "longOffset" })
    .formatToParts(probe)
    .find((p) => p.type === "timeZoneName")?.value;
  const m = part?.match(/GMT([+-]\d{2}:\d{2})/);
  return m ? m[1] : "+12:00";
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Converts a user-supplied date or timestamp into an ISO timestamp for Akahu.
 * Bare dates (YYYY-MM-DD) are read as NZ local midnight. With `inclusiveEnd`,
 * a bare date is pushed to the following midnight so the whole day is covered
 * (Akahu's `end` is exclusive).
 */
export function toAkahuTimestamp(input: string, inclusiveEnd = false): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const day = inclusiveEnd ? addDays(input, 1) : input;
    return new Date(`${day}T00:00:00${nzOffset(day)}`).toISOString();
  }
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${input}`);
  return d.toISOString();
}

/** Today's date in New Zealand as YYYY-MM-DD. */
export function nzToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: NZ_TZ }).format(now);
}

/** YYYY-MM for an ISO timestamp, in NZ time. */
export function nzMonth(iso: string): string {
  return nzToday(new Date(iso)).slice(0, 7);
}

export function nzDaysAgo(days: number, now = new Date()): string {
  return addDays(nzToday(now), -days);
}
