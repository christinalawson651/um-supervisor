// Care-management "programs" — CHF, COPD, CKD, etc. These are a distinct concept from both a
// case's care plan (one plan per case) and a case's discipline-label `program` field on
// CmCaseRec: a program here is a highly configurable, opt-in offering that can be layered onto
// ANY case regardless of primary diagnosis or care plan template, a member can be enrolled in
// zero, one, or several concurrently, and enrollment/disenrollment is its own independent
// lifecycle — not tied to the case closing or the care plan closing. That's why disenrollment needs
// its own metric rather than reusing carePlanStatus/carePlanClosedDate.
import { TODAY } from './case-fields';
import { CmCaseRec, CM_CASE_POOL } from './cm-case-pool';

export type CareProgramName =
  | 'CHF'
  | 'COPD'
  | 'CKD'
  | 'Behavioral Health / SUD'
  | 'High-Risk Maternity'
  | 'SDOH / Community Resource Support'
  | 'Weight & Nutrition Management'
  | 'Smoking Cessation';

export const CARE_PROGRAMS: CareProgramName[] = [
  'CHF', 'COPD', 'CKD', 'Behavioral Health / SUD', 'High-Risk Maternity',
  'SDOH / Community Resource Support', 'Weight & Nutrition Management', 'Smoking Cessation',
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

export function buildProgramEnrollments(cases: CmCaseRec[]): CmProgramEnrollment[] {
  const out: CmProgramEnrollment[] = [];
  cases.forEach((c, i) => {
    const count = slotCountFor(i);
    const used = new Set<number>();
    for (let k = 0; k < count; k++) {
      let idx = (i * 17 + k * 23 + 5) % CARE_PROGRAMS.length;
      let guard = 0;
      while (used.has(idx) && guard < CARE_PROGRAMS.length) { idx = (idx + 3) % CARE_PROGRAMS.length; guard++; }
      used.add(idx);
      const program = CARE_PROGRAMS[idx];

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
      out.push({ memberId: c.memberId, program, enrolledDate, status, endDate, disenrollReason });
    }
  });
  return out;
}

// Enrollment membership (who's in what, and when they joined/left) is stable for the session —
// only the case's care manager/queue/status fields ever mutate — so this can be built once here,
// the same treatment CM_CASE_POOL itself gets in cm-case-pool.ts.
export const CM_PROGRAM_ENROLLMENTS: CmProgramEnrollment[] = buildProgramEnrollments(CM_CASE_POOL);
