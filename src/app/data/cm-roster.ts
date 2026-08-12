// Display-only fields for the individual Care Management Roster view (what one care manager sees
// when they log in) — derived deterministically from CmCaseRec so the roster always agrees with
// the supervisor-side numbers, without bloating the shared case-pool schema with page-only fields.
import { CmCaseRec } from './cm-case-pool';
import { TODAY } from './case-fields';

export interface RosterRow {
  case: CmCaseRec;
  priorityLabel: string;
  priorityTone: 'red' | 'amber' | 'gray';
  overdueDays: number;
  dueLabel: string;   // 'Xd overdue' | 'Due today' | 'Due tomorrow' | ''
  isNew: boolean;     // received within the last 7 days
  todoCount: number;
  caseNumber: number;
  lastUpdate: string; // ISO date
  adt: boolean;       // has an open admission/discharge/transfer alert
}

const NEXT_TASK: Record<string, string> = {
  'New Referral': 'Schedule intake call',
  'Assessment Scheduled': 'Complete initial assessment',
  'Care Plan Development': 'Finalize care plan',
  'Active Monitoring': 'Monthly check-in call',
  'Care Plan Review Due': 'Review & update care plan',
};

function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }
function addDays(base: Date, days: number): Date { const d = new Date(base); d.setDate(d.getDate() + days); return d; }
function daysBetween(iso: string, from: Date): number { return Math.round((new Date(`${iso}T00:00:00`).getTime() - from.getTime()) / 86400000); }

export function buildRosterRow(c: CmCaseRec, idx: number): RosterRow {
  const daysUntilDue = daysBetween(c.slaDueDate, TODAY);
  const overdueDays = daysUntilDue < 0 ? -daysUntilDue : 0;
  const dueLabel = overdueDays > 0 ? `${overdueDays}d overdue` : daysUntilDue === 0 ? 'Due today' : daysUntilDue === 1 ? 'Due tomorrow' : '';
  const isNew = TODAY.getTime() - new Date(`${c.received}T00:00:00`).getTime() <= 7 * 86400000;
  const seed = (idx * 41 + 7) % 100;
  return {
    case: c,
    priorityLabel: NEXT_TASK[c.stage] ?? 'Follow up',
    priorityTone: overdueDays > 0 ? 'red' : dueLabel ? 'amber' : 'gray',
    overdueDays, dueLabel, isNew,
    todoCount: seed % 6,
    caseNumber: 1 + (seed % 15),
    lastUpdate: isoDate(addDays(TODAY, -(seed % 5))),
    adt: seed % 8 === 0,
  };
}

export function buildRosterRows(cases: CmCaseRec[]): RosterRow[] {
  return cases.map((c, i) => buildRosterRow(c, i));
}
