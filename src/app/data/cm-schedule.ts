// Scheduling & Adherence — a care manager's weekly shift pattern plus simulated clock-in/out
// against it, generalized across arbitrary weeks (not just "this week") so Daily/Weekly/Rolling
// 4 Weeks/Monthly views can all pull from the same generator. Kept in its own file (same split as
// cm-intake.ts/cm-roster.ts) rather than growing cm-case-pool.ts further, since this is a distinct
// concern (staffing calendar, not caseload).
import { CARE_MANAGERS } from './cm-case-pool';
import { TODAY } from './case-fields';

export type SchedulePeriod = 'daily' | 'weekly' | 'rolling4' | 'monthly';
export type ShiftType = 'Day' | 'Evening' | 'Off' | 'PTO';
export interface CmShiftDay { day: string; date: string; type: ShiftType; start: string | null; end: string | null; }
export interface CmWeekSchedule { cm: string; discipline: string; days: CmShiftDay[]; }

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SHIFT_HOURS: Record<'Day' | 'Evening', { start: string; end: string }> = {
  Day: { start: '08:00', end: '17:00' },
  Evening: { start: '12:00', end: '21:00' },
};

// JS's % can return negative results for a negative dividend (e.g. -20 % 100 === -20, not 80) —
// buildWeekBlocks() below passes negative weekOffsets for past weeks, so every seed formula that
// multiplies weekOffset must go through this to stay in [0, 100).
function seedMod(n: number): number { return ((n % 100) + 100) % 100; }
function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }
function addDays(base: Date, days: number): Date { const d = new Date(base); d.setDate(d.getDate() + days); return d; }
// TODAY is a fixed Friday (see case-fields.ts) — step back to that week's Monday so weekOffset 0
// always means "this week," same "fixed demo now" treatment every other CM panel uses.
function mondayOf(d: Date): Date { const day = d.getDay(); return addDays(d, day === 0 ? -6 : 1 - day); }
const WEEK_START = mondayOf(TODAY);

/** One care manager's shift pattern for the week starting `weekOffset` weeks from this week
 *  (negative = past weeks) — 5-on/2-off (Sat/Sun), Day or Evening shift by CM index parity, with a
 *  real minority (~6%) of workdays pre-planned as PTO. The weekOffset term in ptoSeed decorrelates
 *  week-to-week so a rolling view doesn't just repeat one week's pattern four times. */
export function buildWeekScheduleAt(weekOffset: number): CmWeekSchedule[] {
  const weekStart = addDays(WEEK_START, weekOffset * 7);
  return CARE_MANAGERS.map((cm, ci) => {
    const shiftType: 'Day' | 'Evening' = ci % 2 === 0 ? 'Day' : 'Evening';
    const days: CmShiftDay[] = DAYS.map((day, di) => {
      const date = isoDate(addDays(weekStart, di));
      const isWeekend = di >= 5;
      const ptoSeed = seedMod(ci * 17 + weekOffset * 41 + di * 7 + 3);
      const isPto = !isWeekend && ptoSeed < 6;
      const type: ShiftType = isWeekend ? 'Off' : isPto ? 'PTO' : shiftType;
      const hours = type === 'Day' || type === 'Evening' ? SHIFT_HOURS[type] : null;
      return { day, date, type, start: hours?.start ?? null, end: hours?.end ?? null };
    });
    return { cm: cm.name, discipline: cm.discipline, days };
  });
}
export function buildWeekSchedules(): CmWeekSchedule[] { return buildWeekScheduleAt(0); }

export type AdherenceStatus = 'On Time' | 'Late Start' | 'Early Leave' | 'Absence' | 'Overtime';
export interface CmAdherenceDay {
  cm: string; discipline: string; day: string; date: string;
  scheduledStart: string; scheduledEnd: string;
  actualStart: string | null; actualEnd: string | null;
  status: AdherenceStatus; varianceMin: number;
}

function clockToMinutes(clock: string): number { const [h, m] = clock.split(':').map(Number); return h * 60 + m; }
function minutesToClock(mins: number): string {
  const wrapped = ((mins % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60), m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Simulated clock-in/out against one week's scheduled workdays — a real minority of shifts show a
 *  variance (late start / early leave / no-show / overtime); the rest are on time, matching this
 *  app's "flag rates are a minority" convention. `weekOffset` decorrelates the exception pattern
 *  across weeks the same way it does for PTO above. */
export function buildAdherenceRecords(schedules: CmWeekSchedule[], weekOffset = 0): CmAdherenceDay[] {
  const out: CmAdherenceDay[] = [];
  schedules.forEach((sched, ci) => {
    sched.days.forEach((d, di) => {
      if (d.type !== 'Day' && d.type !== 'Evening') return; // Off/PTO days have nothing to measure
      const seed = seedMod(ci * 23 + weekOffset * 53 + di * 11 + 9);
      const startMin = clockToMinutes(d.start!);
      const endMin = clockToMinutes(d.end!);
      let status: AdherenceStatus = 'On Time';
      let actualStart: string | null = d.start, actualEnd: string | null = d.end, varianceMin = 0;
      if (seed < 4) { status = 'Absence'; actualStart = null; actualEnd = null; }
      else if (seed < 11) { const late = 8 + (seed % 20); status = 'Late Start'; actualStart = minutesToClock(startMin + late); varianceMin = late; }
      else if (seed < 17) { const early = 8 + (seed % 18); status = 'Early Leave'; actualEnd = minutesToClock(endMin - early); varianceMin = -early; }
      else if (seed < 21) { const over = 10 + (seed % 25); status = 'Overtime'; actualEnd = minutesToClock(endMin + over); varianceMin = over; }
      out.push({
        cm: sched.cm, discipline: sched.discipline, day: d.day, date: d.date,
        scheduledStart: d.start!, scheduledEnd: d.end!, actualStart, actualEnd, status, varianceMin,
      });
    });
  });
  return out;
}

export const CM_WEEK_SCHEDULES = buildWeekSchedules();
export const CM_ADHERENCE = buildAdherenceRecords(CM_WEEK_SCHEDULES, 0);

// ---- Rolling windows — Daily/Weekly/Rolling-4-Weeks/Monthly all read from the same per-week
// generator above, just over a different number of weeks. "Monthly" is a rolling ~5-week window
// (not calendar-month-exact) — close enough for a staffing-planning view without the edge-case
// complexity of aligning to actual month boundaries. ----
export interface CmWeekBlock { weekOffset: number; weekStart: string; schedules: CmWeekSchedule[]; adherence: CmAdherenceDay[]; }
export function buildWeekBlocks(count: number, endOffset = 0): CmWeekBlock[] {
  const out: CmWeekBlock[] = [];
  for (let w = count - 1; w >= 0; w--) {
    const offset = endOffset - w;
    const schedules = buildWeekScheduleAt(offset);
    out.push({ weekOffset: offset, weekStart: isoDate(addDays(WEEK_START, offset * 7)), schedules, adherence: buildAdherenceRecords(schedules, offset) });
  }
  return out;
}
export const CM_ROLLING_4_WEEKS = buildWeekBlocks(4);
export const CM_MONTHLY_WEEKS = buildWeekBlocks(5);
// Forward-looking window (this week + next 2) for "who's on PTO soon" — the rolling/monthly
// windows above look backward from today, this one deliberately looks ahead instead.
export const CM_UPCOMING_WEEKS = buildWeekBlocks(3, 2);

// ---- PTO balances — accrual prorated by day-of-year against a standard 20-day annual grant, with
// a deterministic minority already having used a larger share (so "who's running low" is a real,
// visible signal rather than every teammate looking identical). ----
export interface CmPtoBalance { cm: string; discipline: string; accruedDays: number; usedDays: number; remainingDays: number; }
const PTO_ANNUAL_GRANT = 20;
export function buildPtoBalances(): CmPtoBalance[] {
  const startOfYear = new Date(TODAY.getFullYear(), 0, 1);
  const dayOfYear = Math.round((TODAY.getTime() - startOfYear.getTime()) / 86400000);
  const accruedDays = Math.round((dayOfYear / 365) * PTO_ANNUAL_GRANT);
  return CARE_MANAGERS.map((cm, ci) => {
    const usedSeed = (ci * 31 + 19) % 100;
    const usedFraction = 0.1 + (usedSeed % 55) / 100; // ~10%-65% of accrued used so far
    const usedDays = Math.min(accruedDays, Math.round(accruedDays * usedFraction));
    return { cm: cm.name, discipline: cm.discipline, accruedDays, usedDays, remainingDays: accruedDays - usedDays };
  });
}
export const CM_PTO_BALANCES = buildPtoBalances();
