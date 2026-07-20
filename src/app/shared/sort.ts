// Generic, signal-friendly table sorting helpers.

export type SortDir = 1 | -1;

export function compareRows<T>(rows: T[], key: keyof T | '', dir: SortDir): T[] {
  if (!key) return rows;
  return [...rows].sort((a, b) => {
    const av = a[key] as unknown, bv = b[key] as unknown;
    const an = parseFloat(String(av)), bn = parseFloat(String(bv));
    const cmp = !isNaN(an) && !isNaN(bn) ? an - bn : String(av).localeCompare(String(bv));
    return cmp * dir;
  });
}

export function caretFor<T>(active: keyof T | '', key: keyof T, dir: SortDir): string {
  return active === key ? (dir === 1 ? ' ▲' : ' ▼') : '';
}
