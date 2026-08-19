// Scheduling & Adherence for the Appeals roster — same generalized weekOffset-parametrized shift/
// adherence generator as CM's cm-schedule.ts (kept as a parallel file rather than a shared one
// since Appeals' roster shape — name/role, no discipline/team — is different enough that forcing
// a shared abstraction would cost more than it saves for a 3-person roster).
export interface AppealsReviewerMeta { name: string; role: string; }
export const APPEALS_REVIEWERS: AppealsReviewerMeta[] = [
  { name: 'C. Lawson', role: 'Appeals RN' },
  { name: 'T. Rivera', role: 'Appeals RN' },
  { name: 'Dr. M. Webb', role: 'Medical Director' },
];

export type SchedulePeriod = 'daily' | 'weekly' | 'rolling4' | 'monthly';
export type ShiftType = 'Day' | 'Evening' | 'Off' | 'PTO';
export interface ReviewerShiftDay { day: string; date: string; type: ShiftType; start: string | null; end: string | null; }
export interface ReviewerWeekSchedule { reviewer: string; role: string; days: ReviewerShiftDay[]; }

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SHIFT_HOURS: Record<'Day' | 'Evening', { start: string; end: string }> = {
  Day: { start: '08:00', end: '17:00' },
  Evening: { start: '12:00', end: '21:00' },
};

// Fixed "now" for this demo — Friday, July 17, 2026, same as case-fields.ts's TODAY (not imported
// directly to avoid coupling this standalone Appeals file to the UM/CM case data module).
const TODAY = new Date(2026, 6, 17);

function seedMod(n: number): number { return ((n % 100) + 100) % 100; }
function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }
function addDays(base: Date, days: number): Date { const d = new Date(base); d.setDate(d.getDate() + days); return d; }
function mondayOf(d: Date): Date { const day = d.getDay(); return addDays(d, day === 0 ? -6 : 1 - day); }
const WEEK_START = mondayOf(TODAY);

export function buildWeekScheduleAt(weekOffset: number): ReviewerWeekSchedule[] {
  const weekStart = addDays(WEEK_START, weekOffset * 7);
  return APPEALS_REVIEWERS.map((rv, ri) => {
    const shiftType: 'Day' | 'Evening' = ri % 2 === 0 ? 'Day' : 'Evening';
    const days: ReviewerShiftDay[] = DAYS.map((day, di) => {
      const date = isoDate(addDays(weekStart, di));
      const isWeekend = di >= 5;
      const ptoSeed = seedMod(ri * 17 + weekOffset * 41 + di * 7 + 3);
      const isPto = !isWeekend && ptoSeed < 6;
      const type: ShiftType = isWeekend ? 'Off' : isPto ? 'PTO' : shiftType;
      const hours = type === 'Day' || type === 'Evening' ? SHIFT_HOURS[type] : null;
      return { day, date, type, start: hours?.start ?? null, end: hours?.end ?? null };
    });
    return { reviewer: rv.name, role: rv.role, days };
  });
}
export function buildWeekSchedules(): ReviewerWeekSchedule[] { return buildWeekScheduleAt(0); }

export type AdherenceStatus = 'On Time' | 'Late Start' | 'Early Leave' | 'Absence' | 'Overtime';
export interface ReviewerAdherenceDay {
  reviewer: string; role: string; day: string; date: string;
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

export function buildAdherenceRecords(schedules: ReviewerWeekSchedule[], weekOffset = 0): ReviewerAdherenceDay[] {
  const out: ReviewerAdherenceDay[] = [];
  schedules.forEach((sched, ri) => {
    sched.days.forEach((d, di) => {
      if (d.type !== 'Day' && d.type !== 'Evening') return;
      const seed = seedMod(ri * 23 + weekOffset * 53 + di * 11 + 9);
      const startMin = clockToMinutes(d.start!);
      const endMin = clockToMinutes(d.end!);
      let status: AdherenceStatus = 'On Time';
      let actualStart: string | null = d.start, actualEnd: string | null = d.end, varianceMin = 0;
      if (seed < 4) { status = 'Absence'; actualStart = null; actualEnd = null; }
      else if (seed < 11) { const late = 8 + (seed % 20); status = 'Late Start'; actualStart = minutesToClock(startMin + late); varianceMin = late; }
      else if (seed < 17) { const early = 8 + (seed % 18); status = 'Early Leave'; actualEnd = minutesToClock(endMin - early); varianceMin = -early; }
      else if (seed < 21) { const over = 10 + (seed % 25); status = 'Overtime'; actualEnd = minutesToClock(endMin + over); varianceMin = over; }
      out.push({
        reviewer: sched.reviewer, role: sched.role, day: d.day, date: d.date,
        scheduledStart: d.start!, scheduledEnd: d.end!, actualStart, actualEnd, status, varianceMin,
      });
    });
  });
  return out;
}

export const APPEALS_WEEK_SCHEDULES = buildWeekSchedules();
export const APPEALS_ADHERENCE = buildAdherenceRecords(APPEALS_WEEK_SCHEDULES, 0);

export interface ReviewerWeekBlock { weekOffset: number; weekStart: string; schedules: ReviewerWeekSchedule[]; adherence: ReviewerAdherenceDay[]; }
export function buildWeekBlocks(count: number, endOffset = 0): ReviewerWeekBlock[] {
  const out: ReviewerWeekBlock[] = [];
  for (let w = count - 1; w >= 0; w--) {
    const offset = endOffset - w;
    const schedules = buildWeekScheduleAt(offset);
    out.push({ weekOffset: offset, weekStart: isoDate(addDays(WEEK_START, offset * 7)), schedules, adherence: buildAdherenceRecords(schedules, offset) });
  }
  return out;
}
export const APPEALS_ROLLING_4_WEEKS = buildWeekBlocks(4);
export const APPEALS_MONTHLY_WEEKS = buildWeekBlocks(5);
export const APPEALS_UPCOMING_WEEKS = buildWeekBlocks(3, 2);

export interface ReviewerPtoBalance { reviewer: string; role: string; accruedDays: number; usedDays: number; remainingDays: number; }
const PTO_ANNUAL_GRANT = 20;
export function buildPtoBalances(): ReviewerPtoBalance[] {
  const startOfYear = new Date(TODAY.getFullYear(), 0, 1);
  const dayOfYear = Math.round((TODAY.getTime() - startOfYear.getTime()) / 86400000);
  const accruedDays = Math.round((dayOfYear / 365) * PTO_ANNUAL_GRANT);
  return APPEALS_REVIEWERS.map((rv, ri) => {
    const usedSeed = (ri * 31 + 19) % 100;
    const usedFraction = 0.1 + (usedSeed % 55) / 100;
    const usedDays = Math.min(accruedDays, Math.round(accruedDays * usedFraction));
    return { reviewer: rv.name, role: rv.role, accruedDays, usedDays, remainingDays: accruedDays - usedDays };
  });
}
export const APPEALS_PTO_BALANCES = buildPtoBalances();
export const APPEALS_TODAY_ISO = isoDate(TODAY);
export const APPEALS_WEEK_START = WEEK_START;
export { isoDate as appealsIsoDate, addDays as appealsAddDays };
