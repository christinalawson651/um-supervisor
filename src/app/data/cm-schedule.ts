// Scheduling & Adherence — a care manager's weekly shift pattern plus simulated clock-in/out
// against it. Kept in its own file (same split as cm-intake.ts/cm-roster.ts) rather than growing
// cm-case-pool.ts further, since this is a distinct concern (staffing calendar, not caseload).
import { CARE_MANAGERS } from './cm-case-pool';
import { TODAY } from './case-fields';

export type ShiftType = 'Day' | 'Evening' | 'Off' | 'PTO';
export interface CmShiftDay { day: string; date: string; type: ShiftType; start: string | null; end: string | null; }
export interface CmWeekSchedule { cm: string; discipline: string; days: CmShiftDay[]; }

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SHIFT_HOURS: Record<'Day' | 'Evening', { start: string; end: string }> = {
  Day: { start: '08:00', end: '17:00' },
  Evening: { start: '12:00', end: '21:00' },
};

function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }
function addDays(base: Date, days: number): Date { const d = new Date(base); d.setDate(d.getDate() + days); return d; }
// TODAY is a fixed Friday (see case-fields.ts) — step back to that week's Monday so the schedule/
// adherence views always show "this week," same "fixed demo now" treatment every other CM panel uses.
function mondayOf(d: Date): Date { const day = d.getDay(); return addDays(d, day === 0 ? -6 : 1 - day); }
const WEEK_START = mondayOf(TODAY);

/** Deterministic weekly shift pattern per care manager — 5-on/2-off (Sat/Sun), Day or Evening shift
 *  by CM index parity, with a real minority (~6%) of workdays pre-planned as PTO so the grid isn't
 *  a flat identical block for every teammate. */
export function buildWeekSchedules(): CmWeekSchedule[] {
  return CARE_MANAGERS.map((cm, ci) => {
    const shiftType: 'Day' | 'Evening' = ci % 2 === 0 ? 'Day' : 'Evening';
    const days: CmShiftDay[] = DAYS.map((day, di) => {
      const date = isoDate(addDays(WEEK_START, di));
      const isWeekend = di >= 5;
      const ptoSeed = (ci * 17 + di * 7 + 3) % 100;
      const isPto = !isWeekend && ptoSeed < 6;
      const type: ShiftType = isWeekend ? 'Off' : isPto ? 'PTO' : shiftType;
      const hours = type === 'Day' || type === 'Evening' ? SHIFT_HOURS[type] : null;
      return { day, date, type, start: hours?.start ?? null, end: hours?.end ?? null };
    });
    return { cm: cm.name, discipline: cm.discipline, days };
  });
}

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

/** Simulated clock-in/out against each scheduled workday this week — a real minority of shifts
 *  show a variance (late start / early leave / no-show / overtime); the rest are on time, matching
 *  this app's "flag rates are a minority" convention used everywhere else in the CM data model. */
export function buildAdherenceRecords(schedules: CmWeekSchedule[]): CmAdherenceDay[] {
  const out: CmAdherenceDay[] = [];
  schedules.forEach((sched, ci) => {
    sched.days.forEach((d, di) => {
      if (d.type !== 'Day' && d.type !== 'Evening') return; // Off/PTO days have nothing to measure
      const seed = (ci * 23 + di * 11 + 9) % 100;
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
export const CM_ADHERENCE = buildAdherenceRecords(CM_WEEK_SCHEDULES);
