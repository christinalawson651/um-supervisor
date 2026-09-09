// Compliance by specialty — the three things a delegated care-management programme is actually
// held to, measured per specialty rather than per line of business.
//
// LOB answers "which regulator's clock applies". Specialty answers "which team is meeting it", and
// they are different questions with different owners: a Medicaid compliance rate mixes a foster
// care social worker and a medication-management pharmacist into one number that neither of them
// can act on. The existing Regulatory Compliance panel keeps the LOB cut; this adds the cut a
// supervisor can actually assign work from.
//
// The three measures are deliberately distinct rather than three views of the same field:
//
//   TAT COMPLIANCE      — timeliness. Did the assessment and the individualised care plan land
//                         inside the window the member's programme requires.
//   DOCUMENTATION       — completeness. Is the chart itself defensible: consent on file and
//                         unexpired, assessment recorded, care plan carrying goals and
//                         interventions rather than an empty shell.
//   TO-DO COMPLETION    — follow-through. Of the tasks raised on this case, how many were closed
//                         by the date they were due.
//
// A case can pass any one and fail the others, which is the point: a chart can be timely and
// empty, or complete and late, and a single "compliance %" hides both.
import { TODAY } from './case-fields';
import { CmCaseRec, CM_CASE_POOL, CARE_MANAGERS, SCENARIO_JADE_ID, SCENARIO_WILLIS_ID } from './cm-case-pool';
import { consentAtRisk } from './cm-intake';
import { cmRegCompliant } from './cm-audit';

function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }
function addDays(base: Date, days: number): Date { const d = new Date(base); d.setDate(d.getDate() + days); return d; }
const TODAY_ISO = isoDate(TODAY);

export type TodoCategory = 'Outreach' | 'Assessment' | 'Care Plan' | 'Care Gap' | 'ICT' | 'Documentation';
export type TodoStatus = 'Complete' | 'Open' | 'Overdue';

export interface CmTodo {
  memberId: string;
  title: string;
  category: TodoCategory;
  dueDate: string;
  completedDate: string | null;
  status: TodoStatus;
}

/** Specialty is the care manager's discipline — it is what a caseload is organised around and what
 *  a supervisor reassigns against. */
export function specialtyOf(c: CmCaseRec): string {
  return CARE_MANAGERS.find((m) => m.name === c.careManager)?.discipline ?? 'Unassigned';
}
export const SPECIALTIES: string[] = [...new Set(CARE_MANAGERS.map((m) => m.discipline))];

const TODO_TEMPLATES: [string, TodoCategory][] = [
  ['Initial outreach call', 'Outreach'],
  ['Complete Health Risk Assessment (HRA)', 'Assessment'],
  ['Care plan review', 'Care Plan'],
  ['Close open care gap', 'Care Gap'],
  ['Document contact note', 'Documentation'],
  ['Schedule care follow-up', 'Outreach'],
];

function buildTodos(cases: CmCaseRec[]): CmTodo[] {
  const out: CmTodo[] = [];
  cases.forEach((c, i) => {
    if (c.memberId === SCENARIO_JADE_ID || c.memberId === SCENARIO_WILLIS_ID) return;  // seeded below
    const n = 2 + (i * 7) % 3;
    for (let k = 0; k < n; k++) {
      const [title, category] = TODO_TEMPLATES[(i * 5 + k * 3) % TODO_TEMPLATES.length];
      const dueDate = isoDate(addDays(TODAY, ((i * 13 + k * 29) % 60) - 40));
      const seed = (i * 31 + k * 17) % 100;
      // Most tasks close on time. A minority run late and a smaller minority are still open past
      // their date — which is what makes follow-through a measure rather than a formality.
      const status: TodoStatus = dueDate > TODAY_ISO ? (seed < 74 ? 'Complete' : 'Open')
        : seed < 74 ? 'Complete' : 'Overdue';
      out.push({
        memberId: c.memberId, title, category, dueDate,
        completedDate: status === 'Complete' ? isoDate(addDays(new Date(`${dueDate}T00:00:00`), -(seed % 4))) : null,
        status,
      });
    }
  });

  // The two workflow-specification members carry the to-dos their tenant record actually shows.
  out.push(
    { memberId: SCENARIO_JADE_ID, title: 'Care Plan Review: Pediatric EPSDT — RSV Risk Care Plan (AI Assist)',
      category: 'Care Plan', dueDate: '2026-09-12', completedDate: null, status: 'Open' },
    { memberId: SCENARIO_JADE_ID, title: 'Schedule care follow-up', category: 'Outreach',
      dueDate: '2026-09-15', completedDate: null, status: 'Open' },
    { memberId: SCENARIO_JADE_ID, title: 'Complete Health Risk Assessment (HRA)', category: 'Assessment',
      dueDate: '2026-09-18', completedDate: null, status: 'Open' },
    { memberId: SCENARIO_JADE_ID, title: 'Family outreach — Synagis denial, appeal rights and RSV prevention',
      category: 'Outreach', dueDate: '2026-09-12', completedDate: null, status: 'Open' },
    // Willis carries a genuinely overdue task. Shown as overdue rather than quietly closed: the
    // tenant has it six days past due, and a compliance view that rounds that away is worthless.
    { memberId: SCENARIO_WILLIS_ID, title: 'Outreach To-Do', category: 'Outreach',
      dueDate: '2026-09-03', completedDate: null, status: 'Overdue' },
    { memberId: SCENARIO_WILLIS_ID, title: 'ICT Meeting: Follow Up', category: 'ICT',
      dueDate: '2026-11-04', completedDate: null, status: 'Open' },
    { memberId: SCENARIO_WILLIS_ID, title: 'Referral outreach — foster placement / caseworker',
      category: 'Outreach', dueDate: '2026-09-06', completedDate: '2026-09-06', status: 'Complete' },
    { memberId: SCENARIO_WILLIS_ID, title: 'Document trauma-informed contact note', category: 'Documentation',
      dueDate: '2026-09-05', completedDate: '2026-09-04', status: 'Complete' },
  );
  return out;
}

export const CM_TODOS: CmTodo[] = buildTodos(CM_CASE_POOL);
export function todosFor(memberId: string): CmTodo[] { return CM_TODOS.filter((t) => t.memberId === memberId); }

/** Completeness of the chart itself, as distinct from its timeliness. Four elements, each a real
 *  field on the record rather than a score invented for the panel. */
export interface DocCheck { label: string; met: boolean }
export function documentationChecks(c: CmCaseRec): DocCheck[] {
  return [
    { label: 'Consent on file and unexpired', met: !!c.consentType && !consentAtRisk(c) },
    { label: 'Assessment type recorded', met: !!c.assessmentType },
    { label: 'Care plan open with a review date', met: c.carePlanStatus === 'Open' && !!c.carePlanReviewDate },
    { label: 'Care plan carries goals', met: (c.goals?.length ?? 0) > 0 },
  ];
}
export function documentationCompliant(c: CmCaseRec): boolean {
  return documentationChecks(c).every((d) => d.met);
}

export interface SpecialtyCompliance {
  specialty: string;
  members: number;
  tatCompliant: number; tatPct: number;
  docCompliant: number; docPct: number;
  todosTotal: number; todosComplete: number; todosOverdue: number; todoPct: number;
  /** All three met — the only figure that answers "is this caseload actually in good order". */
  allThree: number; allThreePct: number;
}

function pct(n: number, d: number): number { return d ? Math.round((n / d) * 100) : 0; }

export function specialtyCompliance(cases: CmCaseRec[] = CM_CASE_POOL): SpecialtyCompliance[] {
  return SPECIALTIES.map((specialty) => {
    const mine = cases.filter((c) => specialtyOf(c) === specialty);
    const ids = new Set(mine.map((c) => c.memberId));
    const todos = CM_TODOS.filter((t) => ids.has(t.memberId));
    const tat = mine.filter((c) => cmRegCompliant(c));
    const doc = mine.filter((c) => documentationCompliant(c));
    const complete = todos.filter((t) => t.status === 'Complete');
    const memberTodoOk = (c: CmCaseRec) => {
      const mineTodos = CM_TODOS.filter((t) => t.memberId === c.memberId);
      return mineTodos.length === 0 || mineTodos.every((t) => t.status !== 'Overdue');
    };
    const all = mine.filter((c) => cmRegCompliant(c) && documentationCompliant(c) && memberTodoOk(c));
    return {
      specialty,
      members: mine.length,
      tatCompliant: tat.length, tatPct: pct(tat.length, mine.length),
      docCompliant: doc.length, docPct: pct(doc.length, mine.length),
      todosTotal: todos.length, todosComplete: complete.length,
      todosOverdue: todos.filter((t) => t.status === 'Overdue').length,
      todoPct: pct(complete.length, todos.length),
      allThree: all.length, allThreePct: pct(all.length, mine.length),
    };
  }).filter((r) => r.members > 0)
    .sort((a, b) => a.allThreePct - b.allThreePct);
}

/** Per-member detail behind a specialty row. */
export interface MemberCompliance {
  memberId: string; member: string; careManager: string; specialty: string; lob: string;
  tat: boolean; doc: boolean; docMissing: string[];
  todosTotal: number; todosComplete: number; todosOverdue: number;
}
export function memberCompliance(cases: CmCaseRec[]): MemberCompliance[] {
  return cases.map((c) => {
    const checks = documentationChecks(c);
    const todos = CM_TODOS.filter((t) => t.memberId === c.memberId);
    return {
      memberId: c.memberId, member: c.member, careManager: c.careManager,
      specialty: specialtyOf(c), lob: c.lob,
      tat: cmRegCompliant(c),
      doc: checks.every((d) => d.met),
      docMissing: checks.filter((d) => !d.met).map((d) => d.label),
      todosTotal: todos.length,
      todosComplete: todos.filter((t) => t.status === 'Complete').length,
      todosOverdue: todos.filter((t) => t.status === 'Overdue').length,
    };
  });
}
