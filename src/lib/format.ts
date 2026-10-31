/**
 * Date, month and money formatting. Hand-rolled on UTC so the server and the
 * browser print the same text; toLocale* with no time zone is how a page ends
 * up with a hydration mismatch.
 */

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "2026-09-12" -> "12 Sep 2026". Anything that is not a date comes back as given. */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS_SHORT[Number(m[2]) - 1]} ${m[1]}`;
}

/** ISO timestamp -> "12 Sep 2026, 14:03 UTC". */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${fmtDate(d.toISOString())}, ${hh}:${mm} UTC`;
}

/** A Date -> "YYYY-MM" in UTC. */
export function yearMonth(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** "2026-10" -> "2026-09". */
export function monthBefore(ym: string): string {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** "2026-09" -> "September 2026". */
export function monthLabel(ym: string): string {
  return `${MONTHS_LONG[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
}

/** "september" -> 9, "sept" -> 9, anything else -> null. */
export function monthNumber(name: string): number | null {
  const n = name.trim().toLowerCase();
  if (n.length < 3) return null;
  const i = MONTHS_LONG.findIndex((m) => m.toLowerCase() === n || m.toLowerCase().slice(0, 3) === n.slice(0, 3));
  return i === -1 ? null : i + 1;
}

/** "YYYY-MM-DD" of a Date, in UTC. */
export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * 1234000 USD -> "$1,234,000"; 96000 EUR -> "EUR 96,000"; a negative amount
 * goes in parentheses, "($1,200)", which is how a ledger shows one. Whole
 * units: nothing on these pages is shown in cents.
 */
export function fmtMoney(amount: number, currency: string): string {
  const whole = Math.round(Math.abs(amount)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const text = currency === "USD" ? `$${whole}` : `${currency} ${whole}`;
  return amount < 0 ? `(${text})` : text;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
