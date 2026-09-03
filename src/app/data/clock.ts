// The demo clock, in its own module on purpose.
//
// case-fields.ts and case-pool.ts import each other, and the bundler resolves that cycle by
// emitting case-pool FIRST — so anything case-pool reads from case-fields at module-init time is
// still undefined. That was survivable while "today" was a frozen literal only used later; the
// moment the pool started building its dates from it, `new Date(undefined)` produced an Invalid
// Date and the whole app rendered blank.
//
// A leaf module with no imports of its own cannot be caught in that cycle: it always initialises
// first, whatever order the bundler picks. Everything that needs "now" reads it from here.

function startOfToday(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Shared "now" for every lookback and date calculation in the app. The demo runs against the real
 *  clock: every generated date — submissions, care-plan reviews, audit events, archive segments —
 *  is an offset from this, so the dataset moves with the day and never opens stale. */
export const TODAY = startOfToday();

/** yyyy-mm-dd, for export filenames and anywhere a date needs stamping. */
export const TODAY_ISO = `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, '0')}-${String(TODAY.getDate()).padStart(2, '0')}`;

/** "Thursday, September 3, 2026" — the long form in the dashboard header. */
export const TODAY_LONG = TODAY.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
