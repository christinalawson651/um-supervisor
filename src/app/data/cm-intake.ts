// Intake & Assessment SLA's own vocabulary — kept separate from cm-case-pool.ts so the referral
// funnel (which includes referrals that never became a case) doesn't get tangled with the active
// caseload's fields. cm-case-pool.ts imports the enums below for the fields it needs; this file
// never imports back from there except for the CmCaseRec type used by the two pure predicates at
// the bottom, so there's no import cycle.
import { TODAY } from './case-fields';
import type { CmCaseRec } from './cm-case-pool';

// "Case Type" per the real intake wizard's own dropdown (Case Type field, required).
export type CaseType = 'Care Coordination' | 'Case Management' | 'Disability' | 'Disease Management';
export const CASE_TYPES: CaseType[] = ['Care Coordination', 'Case Management', 'Disability', 'Disease Management'];

export type ConsentType = 'HIPAA Authorization' | 'Program Enrollment' | 'ROI' | 'Verbal';
export const CONSENT_TYPES: ConsentType[] = ['HIPAA Authorization', 'Program Enrollment', 'ROI', 'Verbal'];

export type AssessmentType = 'HRA' | 'SDOH Screening' | 'KDQOL-36' | 'Care Plan Review';
export const ASSESSMENT_TYPES: AssessmentType[] = ['HRA', 'SDOH Screening', 'KDQOL-36', 'Care Plan Review'];

// The referral FUNNEL — distinct from the active caseload (CM_CASE_POOL), since an active case is
// by definition an already-accepted referral. This models the fuller pipeline including referrals
// that were declined, so "by source" and "by approval/denial" reflect real intake volume, not just
// survivors.
export type ReferralSource = 'UM Referral' | 'Health Plan' | 'PCP/Provider' | 'ER/Hospital' | 'Self/Family';
export const REFERRAL_SOURCES: ReferralSource[] = ['UM Referral', 'Health Plan', 'PCP/Provider', 'ER/Hospital', 'Self/Family'];
export type ReferralStatus = 'Accepted' | 'CM Declined' | 'Member Declined';

export interface ReferralIntakeRec { id: string; source: ReferralSource; status: ReferralStatus; received: string; }

function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }
function addDays(base: Date, days: number): Date { const d = new Date(base); d.setDate(d.getDate() + days); return d; }

const REFERRAL_COUNT = 62; // ~2 referrals/day over a 30-day lookback — a believable intake volume

function buildReferralIntake(): ReferralIntakeRec[] {
  const out: ReferralIntakeRec[] = [];
  for (let i = 0; i < REFERRAL_COUNT; i++) {
    const seed = (i * 31 + 13) % 100;
    const source = REFERRAL_SOURCES[(i * 7 + 2) % REFERRAL_SOURCES.length];
    // Most referrals are accepted (that's why the active caseload exists at all) — a minority get
    // declined by CM (didn't meet program criteria) and a smaller minority are declined by the
    // member themselves once contacted.
    const status: ReferralStatus = seed < 78 ? 'Accepted' : seed < 92 ? 'CM Declined' : 'Member Declined';
    const daysAgo = 1 + (seed % 30);
    out.push({ id: `REF-${1000 + i}`, source, status, received: isoDate(addDays(TODAY, -daysAgo)) });
  }
  return out;
}

export const CM_REFERRAL_INTAKE: ReferralIntakeRec[] = buildReferralIntake();

/** Consent renewal due within 30 days (or already past due) — same "at risk" framing as SLA bands elsewhere. */
export function consentAtRisk(c: CmCaseRec): boolean {
  const days = Math.round((new Date(`${c.consentExpiresDate}T00:00:00`).getTime() - TODAY.getTime()) / 86400000);
  return days <= 30;
}

/** Assessment turnaround within 5 days of assignment counts as TAT-adherent. */
export function tatAdherent(c: CmCaseRec): boolean {
  return c.assessmentTatDays <= 5;
}
