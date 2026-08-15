// Intake & Assessment SLA's own vocabulary — kept separate from cm-case-pool.ts so the referral
// funnel (which includes referrals that never became a case) doesn't get tangled with the active
// caseload's fields. cm-case-pool.ts imports the enums below for the fields it needs; this file
// never imports back from there except for the CmCaseRec type used by the two pure predicates at
// the bottom, so there's no import cycle.
import { TODAY, LOBS } from './case-fields';
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
// survivors. "Source" here is the intake CHANNEL a referral arrived through, not who originated it.
export type ReferralSource = 'Fax' | 'Provider Portal' | 'Call' | 'UM Referral';
export const REFERRAL_SOURCES: ReferralSource[] = ['Fax', 'Provider Portal', 'Call', 'UM Referral'];
// 'Pending' = future work — received recently enough that no triage decision has been made yet,
// so it's still reassignable/balanceable. The other three are past work — already decided, kept
// as read-only history (that's also why an already-Accepted referral has no bearing on whether
// it's reassignable; only its Pending-ness does).
export type ReferralStatus = 'Pending' | 'Accepted' | 'CM Declined' | 'Member Declined';
// A referral is never in a case-lifecycle stage like "Assessment Scheduled" — that only exists
// once it's Accepted and has become a case (CmCaseRec.stage). While still Pending, this is the
// operational reason it hasn't moved: just-arrived-and-fine, or stuck on one of two specific
// blockers. Null once a decision (Accepted/Declined) has been made — the reason no longer applies.
export type ReferralPendReason = 'Pending Intake' | 'Missing Information' | 'Missing Eligibility';

// The clinical/programmatic reason a member was referred — independent of source (the intake
// CHANNEL) and pendReason (an operational blocker). Length 6 is deliberate: distinct from every
// other length-4 enum on this record (source, lob) so a plain affine function of `i` can't
// accidentally bijection-correlate reason with them the way the original LOB generator did.
export type ReferralReason = 'Post-Discharge Follow-Up' | 'High-Risk Care Coordination' | 'Disease Management' | 'Behavioral Health Integration' | 'SDOH / Community Referral' | 'Complex Case Management';
export const REFERRAL_REASONS: ReferralReason[] = ['Post-Discharge Follow-Up', 'High-Risk Care Coordination', 'Disease Management', 'Behavioral Health Integration', 'SDOH / Community Referral', 'Complex Case Management'];

// Intake Coordinators handle referral COMPLETENESS (OCR corrections, missing-field follow-up,
// basic non-clinical checks) before a Care Manager makes the clinical accept/decline call — a
// distinct, non-clinical pool from CARE_MANAGERS (cm-case-pool.ts). Kept local to this file (no
// import from cm-case-pool.ts) since Intake Coordinators only ever touch referrals, never the
// active caseload — importing CARE_MANAGERS here would create the exact import cycle this file's
// header comment already avoids.
export const INTAKE_COORDINATORS: string[] = ['Priya Shah', 'Connor Blake', 'Natalie Osei', 'Tobias Reed', 'Wendy Park'];

export interface ReferralIntakeRec {
  id: string; member: string; source: ReferralSource; status: ReferralStatus;
  reason: ReferralReason;                 // why the member was referred — set at intake, never changes
  pendReason: ReferralPendReason | null;  // only meaningful while status === 'Pending'
  // Who's currently working this referral while it's Pending — usually an Intake Coordinator, but
  // some clients have a Care Manager doing their own intake, so this isn't restricted to the
  // INTAKE_COORDINATORS roster; it just holds whichever name was assigned.
  intakeCoordinator: string | null;
  careManager: string | null;        // set only once accepted (the clinical decision) — see CmData.reassignReferral
  received: string; lob: string;
}

function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }
function addDays(base: Date, days: number): Date { const d = new Date(base); d.setDate(d.getDate() + days); return d; }

const REFERRAL_COUNT = 62; // ~2 referrals/day over a 30-day lookback — a believable intake volume
const REF_FIRST = ['Angela', 'Brian', 'Carla', 'Derek', 'Elena', 'Frank', 'Gina', 'Harold', 'Isabel', 'Jacob', 'Kayla', 'Leon', 'Monica', 'Nathan', 'Olivia'];
const REF_LAST = ['Vasquez', 'Reyes', 'Bennett', 'Coleman', 'Fitzgerald', 'Ortega', 'Simmons', 'Bishop', 'Navarro', 'Whitfield', 'Grant', 'Castillo'];

function buildReferralIntake(): ReferralIntakeRec[] {
  const out: ReferralIntakeRec[] = [];
  for (let i = 0; i < REFERRAL_COUNT; i++) {
    const seed = (i * 31 + 13) % 100;
    const source = REFERRAL_SOURCES[(i * 7 + 2) % REFERRAL_SOURCES.length];
    const daysAgo = 1 + (seed % 30);
    // Anything received in the last 3 days hasn't been triaged yet (Pending — future work).
    // Older referrals have already been decided: most accepted (that's why the active caseload
    // exists at all), a minority declined by CM (didn't meet program criteria), and a smaller
    // minority declined by the member themselves once contacted.
    const status: ReferralStatus = daysAgo <= 3 ? 'Pending' : seed < 78 ? 'Accepted' : seed < 92 ? 'CM Declined' : 'Member Declined';
    // Most Pending referrals are just newly arrived and otherwise fine; a minority are stuck on a
    // specific blocker — most often something missing from intake, less often an eligibility check
    // that hasn't cleared yet.
    const pendReason: ReferralPendReason | null = status !== 'Pending' ? null : seed < 60 ? 'Pending Intake' : seed < 85 ? 'Missing Information' : 'Missing Eligibility';
    const member = `${REF_FIRST[i % REF_FIRST.length]} ${REF_LAST[(i * 5 + 2) % REF_LAST.length]}`;
    // Same decorrelation as cm-case-pool.ts: LOBS and REFERRAL_SOURCES are both length 4, so a
    // plain affine function of `i` alone would perfectly correlate every source with one LOB.
    const lob = LOBS[(i * 11 + Math.floor(i / 4) * 5 + 6) % LOBS.length];
    // Anything received today/yesterday hasn't been picked up by an Intake Coordinator yet
    // (still sitting brand-new); everything older has already had a completeness pass, regardless
    // of where it ended up (Pending awaiting CM decision, or already Accepted/Declined).
    const intakeCoordinator = daysAgo <= 1 ? null : INTAKE_COORDINATORS[(i * 9 + 4) % INTAKE_COORDINATORS.length];
    const reason = REFERRAL_REASONS[(i * 13 + 5) % REFERRAL_REASONS.length];
    out.push({ id: `REF-${1000 + i}`, member, source, status, reason, pendReason, intakeCoordinator, careManager: null, received: isoDate(addDays(TODAY, -daysAgo)), lob });
  }
  return out;
}

export const CM_REFERRAL_INTAKE: ReferralIntakeRec[] = buildReferralIntake();

// Referral intake TAT — same fresh/dueSoon/overdue shape as the case-lifecycle SLA bands
// (slaBandOf) and queue-age bands (queueBandOf) elsewhere, just measured in days-since-received
// instead of hours-in-queue. The 3-day window matches the generator's own definition of "Pending"
// (daysAgo <= 3) — every currently-Pending referral is by construction within this window, so
// "overdue" here means the oldest slice of that population, not an unrelated external deadline.
export type ReferralTatBand = 'onTrack' | 'dueSoon' | 'overdue';
export function referralTatBandOf(r: ReferralIntakeRec): ReferralTatBand {
  const days = Math.round((TODAY.getTime() - new Date(`${r.received}T00:00:00`).getTime()) / 86400000);
  return days >= 3 ? 'overdue' : days === 2 ? 'dueSoon' : 'onTrack';
}

/** Consent renewal due within 30 days (or already past due) — same "at risk" framing as SLA bands elsewhere. */
export function consentAtRisk(c: CmCaseRec): boolean {
  const days = Math.round((new Date(`${c.consentExpiresDate}T00:00:00`).getTime() - TODAY.getTime()) / 86400000);
  return days <= 30;
}

/** Assessment turnaround within 5 days of assignment counts as TAT-adherent. */
export function tatAdherent(c: CmCaseRec): boolean {
  return c.assessmentTatDays <= 5;
}
