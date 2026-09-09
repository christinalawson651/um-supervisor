// Care-management "programs" — CHF, COPD, CKD, etc. These are a distinct concept from both a
// case's care plan (one plan per case) and a case's discipline-label `program` field on
// CmCaseRec: a program here is a highly configurable, opt-in offering that can be layered onto
// ANY case regardless of primary diagnosis or care plan template, a member can be enrolled in
// zero, one, or several concurrently, and enrollment/disenrollment is its own independent
// lifecycle — not tied to the case closing or the care plan closing. That's why disenrollment needs
// its own metric rather than reusing carePlanStatus/carePlanClosedDate.
import { TODAY } from './case-fields';
import { CmCaseRec, CM_CASE_POOL, SCENARIO_JADE_ID, SCENARIO_WILLIS_ID } from './cm-case-pool';

// The specialised Medicaid programmes lead, because they are what a state contract is actually
// awarded and audited against — EPSDT periodicity, foster-care coordination, children with complex
// needs, SMI, LTSS. The chronic-condition and SDOH programmes stay because the overlap is the
// point: a foster child carries EPSDT AND behavioural health, a member with SMI carries SUD, and a
// plan is asked how it manages a person in several at once rather than how it runs one.
export type CareProgramName =
  | 'Pediatric EPSDT'
  | 'Foster Care Coordination'
  | 'Children with Complex Needs'
  | 'Serious Mental Illness (SMI)'
  | 'LTSS / HCBS'
  | 'Behavioral Health / SUD'
  | 'High-Risk Maternity'
  | 'SDOH / Community Resource Support';

export const CARE_PROGRAMS: CareProgramName[] = [
  'Pediatric EPSDT', 'Foster Care Coordination', 'Children with Complex Needs',
  'Serious Mental Illness (SMI)', 'LTSS / HCBS', 'Behavioral Health / SUD',
  'High-Risk Maternity', 'SDOH / Community Resource Support',
];

/** Which programmes are physical-health, behavioural-health, or both. The agenda asks how PH and
 *  BH needs are managed together; a taxonomy that cannot say which is which cannot answer it. */
export type ProgramDomain = 'PH' | 'BH' | 'PH + BH';
export const PROGRAM_DOMAIN: Record<CareProgramName, ProgramDomain> = {
  'Pediatric EPSDT': 'PH + BH',
  'Foster Care Coordination': 'PH + BH',
  'Children with Complex Needs': 'PH + BH',
  'Serious Mental Illness (SMI)': 'BH',
  'LTSS / HCBS': 'PH',
  'Behavioral Health / SUD': 'BH',
  'High-Risk Maternity': 'PH',
  'SDOH / Community Resource Support': 'PH + BH',
};

/** How a member reaches a programme. Auto-enrolment from a rule is the answer to "how are members
 *  identified and assigned", and it matters for oversight that the three are distinguishable: a
 *  rule that fires wrongly is a different problem from a care manager referring wrongly. */
export type EnrollmentRoute = 'Auto — eligibility rule' | 'Auto — claims/utilization trigger' | 'Referral — internal' | 'Referral — external agency' | 'Manual — care manager';
export const ENROLLMENT_ROUTES: EnrollmentRoute[] = [
  'Auto — eligibility rule', 'Auto — claims/utilization trigger',
  'Referral — internal', 'Referral — external agency', 'Manual — care manager',
];

export type ProgramDisenrollReason =
  | 'Goals Met' | 'Member Declined' | 'Lost to Follow-Up' | 'Transferred to Another Program' | 'Ineligible — Coverage Change';

export const PROGRAM_DISENROLL_REASONS: ProgramDisenrollReason[] = [
  'Goals Met', 'Member Declined', 'Lost to Follow-Up', 'Transferred to Another Program', 'Ineligible — Coverage Change',
];

export interface CmProgramEnrollment {
  memberId: string;
  program: CareProgramName;
  enrolledDate: string;                 // ISO
  status: 'Active' | 'Disenrolled';
  endDate: string | null;               // set only when status === 'Disenrolled'
  disenrollReason: ProgramDisenrollReason | null;
  /** How the member got here. An auto-enrolment that fired on a rule and a care manager's manual
   *  add are the same row otherwise, and they are not the same thing to review. */
  route: EnrollmentRoute;
}

function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }
function addDays(base: Date, days: number): Date { const d = new Date(base); d.setDate(d.getDate() + days); return d; }

function reasonFor(seed: number): ProgramDisenrollReason {
  if (seed < 40) return 'Goals Met';
  if (seed < 60) return 'Member Declined';
  if (seed < 80) return 'Lost to Follow-Up';
  if (seed < 90) return 'Transferred to Another Program';
  return 'Ineligible — Coverage Change';
}

// How many programs a given case carries: mostly 1, a solid minority carry 2, a smaller group
// carry 3, and a meaningful slice carry none — this is what makes "unenrolled" a real, distinct
// population rather than everyone being in something.
function slotCountFor(i: number): number {
  const seed = (i * 13 + 7) % 100;
  if (seed < 30) return 0;
  if (seed < 65) return 1;
  if (seed < 88) return 2;
  return 3;
}

/** Which programmes a member is even eligible for. Enrolment used to be a positional walk over the
 *  whole list, so a 71-year-old with heart failure could land in Pediatric EPSDT — invisible while
 *  the programme was called CHF, and indefensible the moment it was called EPSDT and somebody
 *  drilled in. Age is the gate the real programmes actually use. */
/** The programme a specialised caseload exists to run. */
const ANCHOR_BY_MANAGER: Record<string, CareProgramName | undefined> = {
  'Jessica Mendez, RN': 'Pediatric EPSDT',
  'K. Malone, LCSW': 'Foster Care Coordination',
};

function eligibleProgramsFor(c: CmCaseRec): CareProgramName[] {
  return c.pediatric
    ? ['Pediatric EPSDT', 'Foster Care Coordination', 'Children with Complex Needs',
       'Behavioral Health / SUD', 'SDOH / Community Resource Support']
    : ['Serious Mental Illness (SMI)', 'LTSS / HCBS', 'Behavioral Health / SUD',
       'High-Risk Maternity', 'SDOH / Community Resource Support'];
}

export function buildProgramEnrollments(cases: CmCaseRec[]): CmProgramEnrollment[] {
  const out: CmProgramEnrollment[] = [];
  cases.forEach((c, i) => {
    const eligible = eligibleProgramsFor(c);
    const count = Math.min(slotCountFor(i), eligible.length);
    const used = new Set<number>();
    // A specialised care manager IS the programme: everyone on the EPSDT nurse's caseload is in
    // EPSDT, everyone on the foster-care social worker's is in foster care. Leaving that to the
    // seeding gave a programme five members while its own case manager carried fifteen, which is
    // not a caseload anyone would recognise.
    const anchor = ANCHOR_BY_MANAGER[c.careManager];
    if (anchor && eligible.includes(anchor)) {
      const ai = eligible.indexOf(anchor);
      used.add(ai);
      out.push({
        memberId: c.memberId, program: anchor,
        enrolledDate: isoDate(addDays(TODAY, -((i * 29 + 11) % 400))),
        status: 'Active', endDate: null, disenrollReason: null,
        route: anchor === 'Foster Care Coordination' ? 'Referral — external agency' : 'Auto — eligibility rule',
      });
    }
    for (let k = 0; k < count; k++) {
      let idx = (i * 17 + k * 23 + 5) % eligible.length;
      let guard = 0;
      while (used.has(idx) && guard < eligible.length) { idx = (idx + 3) % eligible.length; guard++; }
      used.add(idx);
      const program = eligible[idx];

      const enrolledDaysAgo = (i * 29 + k * 53 + 11) % 540; // up to ~18 months of enrollment history
      const enrolledDate = isoDate(addDays(TODAY, -enrolledDaysAgo));

      const disenrollSeed = (i * 37 + k * 41 + 9) % 100;
      const isDisenrolled = disenrollSeed < 28 && enrolledDaysAgo > 10;
      let status: 'Active' | 'Disenrolled' = 'Active';
      let endDate: string | null = null;
      let disenrollReason: ProgramDisenrollReason | null = null;
      if (isDisenrolled) {
        status = 'Disenrolled';
        const durationSeed = (i * 61 + k * 7 + 3) % 100;
        const durationDays = Math.max(7, Math.round(enrolledDaysAgo * (0.25 + durationSeed / 150)));
        endDate = isoDate(addDays(TODAY, -Math.max(0, enrolledDaysAgo - Math.min(durationDays, enrolledDaysAgo - 1))));
        disenrollReason = reasonFor((i * 71 + k * 13 + 17) % 100);
      }
      // Route follows the programme's nature: the paediatric and LTSS programmes are driven off
      // eligibility rules, foster care always arrives as an external referral from child welfare,
      // and the rest are a mix of utilisation triggers and clinician judgement.
      const routeSeed = (i * 29 + k * 11) % 100;
      const route: EnrollmentRoute =
        program === 'Foster Care Coordination' ? 'Referral — external agency'
        : program === 'Pediatric EPSDT' ? 'Auto — eligibility rule'
        : program === 'LTSS / HCBS' ? (routeSeed < 70 ? 'Auto — eligibility rule' : 'Referral — external agency')
        : routeSeed < 34 ? 'Auto — claims/utilization trigger'
        : routeSeed < 62 ? 'Referral — internal'
        : routeSeed < 84 ? 'Manual — care manager'
        : 'Auto — eligibility rule';
      out.push({ memberId: c.memberId, program, enrolledDate, status, endDate, disenrollReason, route });
    }
  });
  return out;
}

// Enrollment membership (who's in what, and when they joined/left) is stable for the session —
// only the case's care manager/queue/status fields ever mutate — so this can be built once here,
// the same treatment CM_CASE_POOL itself gets in cm-case-pool.ts.
/** The specification members carry the programmes the specification says they do, replacing
 *  whatever the generator happened to give them. Willis carries two on purpose: a foster child
 *  with a trauma history is in foster-care coordination AND behavioural health at the same time,
 *  and "how do you manage someone in several programmes at once" is a question on the agenda. */
function withScenarioEnrollments(rows: CmProgramEnrollment[]): CmProgramEnrollment[] {
  const kept = rows.filter((r) => r.memberId !== SCENARIO_JADE_ID && r.memberId !== SCENARIO_WILLIS_ID);
  const on = (back: number) => isoDate(addDays(TODAY, -back));
  return [
    ...kept,
    { memberId: SCENARIO_JADE_ID, program: 'Pediatric EPSDT', enrolledDate: '2026-09-04',
      status: 'Active', endDate: null, disenrollReason: null, route: 'Auto — eligibility rule' },
    { memberId: SCENARIO_WILLIS_ID, program: 'Foster Care Coordination', enrolledDate: on(21),
      status: 'Active', endDate: null, disenrollReason: null, route: 'Referral — external agency' },
    { memberId: SCENARIO_WILLIS_ID, program: 'Behavioral Health / SUD', enrolledDate: on(13),
      status: 'Active', endDate: null, disenrollReason: null, route: 'Referral — internal' },
    { memberId: SCENARIO_WILLIS_ID, program: 'Pediatric EPSDT', enrolledDate: on(20),
      status: 'Active', endDate: null, disenrollReason: null, route: 'Auto — eligibility rule' },
  ];
}

export const CM_PROGRAM_ENROLLMENTS: CmProgramEnrollment[] = withScenarioEnrollments(buildProgramEnrollments(CM_CASE_POOL));
