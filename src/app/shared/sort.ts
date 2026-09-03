// Generic, signal-friendly table sorting helpers.

export type SortDir = 1 | -1;

/** Dates and timestamps have to be kept off the numeric path: parseFloat('2026-04-04T08:14') is
 *  2026, so every row in the same year compared equal and the sort silently did nothing. ISO
 *  strings already sort correctly as text, so routing them to localeCompare is both the fix and
 *  the right comparison. Non-ISO values keep the lenient parseFloat behaviour ('3.2d', '$42,000'). */
const ISO_DATEISH = /^\d{4}-\d{2}-\d{2}/;
function isDateish(v: unknown): boolean { return typeof v === 'string' && ISO_DATEISH.test(v); }

export function compareRows<T>(rows: T[], key: keyof T | '', dir: SortDir): T[] {
  if (!key) return rows;
  return [...rows].sort((a, b) => {
    const av = a[key] as unknown, bv = b[key] as unknown;
    const an = parseFloat(String(av)), bn = parseFloat(String(bv));
    const numeric = !isDateish(av) && !isDateish(bv) && !isNaN(an) && !isNaN(bn);
    const cmp = numeric ? an - bn : String(av).localeCompare(String(bv));
    return cmp * dir;
  });
}

export function caretFor<T>(active: keyof T | '', key: keyof T, dir: SortDir): string {
  return active === key ? (dir === 1 ? ' ▲' : ' ▼') : '';
}
