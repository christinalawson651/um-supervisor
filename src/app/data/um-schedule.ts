// Scheduling & Adherence for the UM nurse roster — same generalized weekOffset-parametrized
// shift/adherence generator as CM's cm-schedule.ts and Appeals' appeals-schedule.ts. Kept as its
// own parallel file (not shared) since each roster's shape differs enough (CM: discipline+team,
// Appeals: role only, UM: team only) that a forced-shared abstraction would cost more than it saves.
//
// The roster here (name+team) is a static snapshot, independent of DashboardData.nurses()'s live
// signal — same "don't couple deterministic generation to mutable session state" reasoning as
// CARE_MANAGERS/APPEALS_REVIEWERS. Adding/renaming a nurse here has no effect on case assignment
// (that's driven by case-pool.ts's own NURSES list).
export interface UmNurseMeta { name: string; team: string; }
export const UM_NURSE_ROSTER: UmNurseMeta[] = [
  { name: 'Maria Gonzalez, RN', team: 'Inpatient Review' },
  { name: 'Andrew Mitchell, RN', team: 'Inpatient Review' },
  { name: 'Jessica Williams, RN', team: 'Outpatient Review' },
  { name: 'Sarah Mitchell, RN', team: 'Outpatient Review' },
  { name: 'Rachel Foster, RN', team: 'Outpatient Review' },
  { name: 'Emily Chen, RN', team: 'Complex & Concurrent' },
  { name: 'Robert Kim, RN', team: 'Complex & Concurrent' },
];

export type SchedulePeriod = 'daily' | 'weekly' | 'rolling4' | 'monthly';
export type ShiftType = 'Day' | 'Evening' | 'Off' | 'PTO';
export interface NurseShiftDay { day: string; date: string; type: ShiftType; start: string | null; end: string | null; }
export interface NurseWeekSchedule { nurse: string; team: string; days: NurseShiftDay[]; }

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SHIFT_HOURS: Record<'Day' | 'Evening', { start: string; end: string }> = {
  Day: { start: '08:00', end: '17:00' },
  Evening: { start: '12:00', end: '21:00' },
};

// Fixed "now" for this demo — Friday, July 17, 2026, same as case-fields.ts's TODAY (not imported
// directly to avoid coupling this standalone Scheduling file to the wider case-pool module graph).
const TODAY = new Date(2026, 6, 17);

function seedMod(n: number): number { return ((n % 100) + 100) % 100; }
function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }
function addDays(base: Date, days: number): Date { const d = new Date(base); d.setDate(d.getDate() + days); return d; }
function mondayOf(d: Date): Date { const day = d.getDay(); return addDays(d, day === 0 ? -6 : 1 - day); }
const WEEK_START = mondayOf(TODAY);

export function buildWeekScheduleAt(weekOffset: number): NurseWeekSchedule[] {
  const weekStart = addDays(WEEK_START, weekOffset * 7);
  return UM_NURSE_ROSTER.map((nu, ni) => {
    const shiftType: 'Day' | 'Evening' = ni % 2 === 0 ? 'Day' : 'Evening';
    const days: NurseShiftDay[] = DAYS.map((day, di) => {
      const date = isoDate(addDays(weekStart, di));
      const isWeekend = di >= 5;
      const ptoSeed = seedMod(ni * 17 + weekOffset * 41 + di * 7 + 3);
      const isPto = !isWeekend && ptoSeed < 6;
      const type: ShiftType = isWeekend ? 'Off' : isPto ? 'PTO' : shiftType;
      const hours = type === 'Day' || type === 'Evening' ? SHIFT_HOURS[type] : null;
      return { day, date, type, start: hours?.start ?? null, end: hours?.end ?? null };
    });
    return { nurse: nu.name, team: nu.team, days };
  });
}
export function buildWeekSchedules(): NurseWeekSchedule[] { return buildWeekScheduleAt(0); }

export type AdherenceStatus = 'On Time' | 'Late Start' | 'Early Leave' | 'Absence' | 'Overtime';
export interface NurseAdherenceDay {
  nurse: string; team: string; day: string; date: string;
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

export function buildAdherenceRecords(schedules: NurseWeekSchedule[], weekOffset = 0): NurseAdherenceDay[] {
  const out: NurseAdherenceDay[] = [];
  schedules.forEach((sched, ni) => {
    sched.days.forEach((d, di) => {
      if (d.type !== 'Day' && d.type !== 'Evening') return;
      const seed = seedMod(ni * 23 + weekOffset * 53 + di * 11 + 9);
      const startMin = clockToMinutes(d.start!);
      const endMin = clockToMinutes(d.end!);
      let status: AdherenceStatus = 'On Time';
      let actualStart: string | null = d.start, actualEnd: string | null = d.end, varianceMin = 0;
      if (seed < 4) { status = 'Absence'; actualStart = null; actualEnd = null; }
      else if (seed < 11) { const late = 8 + (seed % 20); status = 'Late Start'; actualStart = minutesToClock(startMin + late); varianceMin = late; }
      else if (seed < 17) { const early = 8 + (seed % 18); status = 'Early Leave'; actualEnd = minutesToClock(endMin - early); varianceMin = -early; }
      else if (seed < 21) { const over = 10 + (seed % 25); status = 'Overtime'; actualEnd = minutesToClock(endMin + over); varianceMin = over; }
      out.push({
        nurse: sched.nurse, team: sched.team, day: d.day, date: d.date,
        scheduledStart: d.start!, scheduledEnd: d.end!, actualStart, actualEnd, status, varianceMin,
      });
    });
  });
  return out;
}

export const UM_WEEK_SCHEDULES = buildWeekSchedules();
export const UM_ADHERENCE = buildAdherenceRecords(UM_WEEK_SCHEDULES, 0);

export interface NurseWeekBlock { weekOffset: number; weekStart: string; schedules: NurseWeekSchedule[]; adherence: NurseAdherenceDay[]; }
export function buildWeekBlocks(count: number, endOffset = 0): NurseWeekBlock[] {
  const out: NurseWeekBlock[] = [];
  for (let w = count - 1; w >= 0; w--) {
    const offset = endOffset - w;
    const schedules = buildWeekScheduleAt(offset);
    out.push({ weekOffset: offset, weekStart: isoDate(addDays(WEEK_START, offset * 7)), schedules, adherence: buildAdherenceRecords(schedules, offset) });
  }
  return out;
}
export const UM_ROLLING_4_WEEKS = buildWeekBlocks(4);
export const UM_MONTHLY_WEEKS = buildWeekBlocks(5);
export const UM_UPCOMING_WEEKS = buildWeekBlocks(3, 2);

export interface NursePtoBalance { nurse: string; team: string; accruedDays: number; usedDays: number; remainingDays: number; }
const PTO_ANNUAL_GRANT = 20;
export function buildPtoBalances(): NursePtoBalance[] {
  const startOfYear = new Date(TODAY.getFullYear(), 0, 1);
  const dayOfYear = Math.round((TODAY.getTime() - startOfYear.getTime()) / 86400000);
  const accruedDays = Math.round((dayOfYear / 365) * PTO_ANNUAL_GRANT);
  return UM_NURSE_ROSTER.map((nu, ni) => {
    const usedSeed = (ni * 31 + 19) % 100;
    const usedFraction = 0.1 + (usedSeed % 55) / 100;
    const usedDays = Math.min(accruedDays, Math.round(accruedDays * usedFraction));
    return { nurse: nu.name, team: nu.team, accruedDays, usedDays, remainingDays: accruedDays - usedDays };
  });
}
export const UM_PTO_BALANCES = buildPtoBalances();
export const UM_TODAY_ISO = isoDate(TODAY);
export const UM_WEEK_START = WEEK_START;
export { isoDate as umIsoDate, addDays as umAddDays };
