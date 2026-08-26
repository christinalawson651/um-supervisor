// Inter-Rater Reliability — a real IRR review record model, replacing the old boolean
// irrSampledOf/irrAgreeOf stand-ins. This follows the standard UM IRR administration pattern
// (NCQA/URAC-style): a stratified sample of decided cases gets an independent blind
// re-determination from a secondary reviewer/auditor; every disagreement gets a discrepancy
// reason code; and repeated disagreements from the same original reviewer escalate into a
// corrective action that itself has an open/closed lifecycle. That structure — not just a raw
// agreement percentage — is what an accreditation surveyor actually asks to see.
//
// There's still no real secondary-reviewer system behind this demo, so which cases get sampled,
// what the independent redetermination comes out to, and which reason/action get attached are all
// deterministic functions of the authorization ID (same "Live rollup*" pattern as everywhere else
// in this file) — but the RECORD SHAPE below is what a real IRR log needs to carry.
import { CaseRec, Decision, CASE_POOL } from './case-pool';
import { TODAY, MD_REVIEWERS } from './case-fields';

export type DiscrepancyReason =
  | 'Criteria Misapplication' | 'Clinical Judgment Variance' | 'Missing Information at Time of Review' | 'Documentation Gap';
export const DISCREPANCY_REASONS: DiscrepancyReason[] = [
  'Criteria Misapplication', 'Clinical Judgment Variance', 'Missing Information at Time of Review', 'Documentation Gap',
];

export type CorrectiveActionTier = 'None' | 'Coaching Note' | 'Retraining Assigned';
export type CorrectiveActionStatus = 'Open' | 'Closed';

// The org's own policy choice, not a fixed NCQA/URAC number — NCQA/URAC require that a
// methodology and threshold be DEFINED and FOLLOWED, not any one universal percentage.
export const IRR_TARGET_PCT = 90;
// A single sampled case tells you nothing about a reviewer's overall consistency — this is the
// minimum sample size before a reviewer's rate is reported as pass/fail rather than "insufficient
// sample," same guard the old code applied ad hoc (sampled >= 3).
export const MIN_SAMPLE_PER_REVIEWER = 3;

export interface IrrReviewRecord {
  authId: string;
  reviewer: string;                 // original nurse/reviewer
  originalDecision: Decision;
  reviewDate: string;                // ISO — proxy for when the original determination was made
  auditor: string;                   // secondary/blind reviewer
  irrReviewDate: string;             // ISO — when the blind re-review happened
  irrDetermination: Decision;        // the auditor's independent redetermination
  agree: boolean;
  discrepancyReason: DiscrepancyReason | null;
  correctiveAction: CorrectiveActionTier;
  correctiveActionStatus: CorrectiveActionStatus | null;
  correctiveActionDate: string | null;
}

function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }
function addDays(base: Date, days: number): Date { const d = new Date(base); d.setDate(d.getDate() + days); return d; }
function capToday(d: Date): Date { return d.getTime() > TODAY.getTime() ? TODAY : d; }

function isSampled(c: CaseRec): boolean {
  // Auto-approved decisions have no human reviewer to test against, and there's no one to compare
  // an auditor's redetermination to if the case was never actually reviewed by a person.
  if (c.tags.includes('auto') || c.nurse === '—') return false;
  const n = Number(c.authId.slice(-2));
  // Stratified toward denials/partials — the real-world audit focus, since those carry the most
  // appeal/compliance risk.
  return c.decision === 'Denied' || c.decision === 'Partial' ? n % 5 < 2 : n % 10 === 0;
}
function agreesOf(c: CaseRec): boolean {
  const n = Number(c.authId.slice(-2)) % 100;
  return c.decision === 'Denied' || c.decision === 'Partial' ? n >= 5 : n >= 1;
}
function redeterminationFor(c: CaseRec, agree: boolean): Decision {
  if (agree) return c.decision as Decision;
  const pool: Decision[] = (['Approved', 'Denied', 'Partial'] as Decision[]).filter((d) => d !== c.decision);
  return pool[Number(c.authId.slice(-2)) % pool.length];
}
function discrepancyReasonFor(c: CaseRec): DiscrepancyReason {
  const seed = (Number(c.authId.slice(-2)) * 7 + 3) % 100;
  if (seed < 35) return 'Criteria Misapplication';
  if (seed < 65) return 'Clinical Judgment Variance';
  if (seed < 85) return 'Missing Information at Time of Review';
  return 'Documentation Gap';
}

export function buildIrrReviews(cases: CaseRec[]): IrrReviewRecord[] {
  const sampled = cases.filter((c) => c.phase === 'decided' && isSampled(c));

  // Pass 1 — sample selection, independent redetermination, discrepancy coding.
  const draft = sampled.map((c) => {
    const n = Number(c.authId.slice(-2));
    const agree = agreesOf(c);
    const submitted = new Date(`${c.submitted}T00:00:00`);
    const irrReviewDate = capToday(addDays(submitted, 3 + (n % 12)));
    return {
      authId: c.authId, reviewer: c.nurse, originalDecision: c.decision as Decision, reviewDate: c.submitted,
      auditor: MD_REVIEWERS[n % MD_REVIEWERS.length], irrReviewDate: isoDate(irrReviewDate),
      irrDetermination: redeterminationFor(c, agree), agree,
      discrepancyReason: agree ? null : discrepancyReasonFor(c),
    };
  });

  // Pass 2 — corrective action tier is a function of HOW MANY disagreements a reviewer has across
  // the whole sample (a pattern), not any single case in isolation — one miss gets a coaching
  // note, a repeated pattern escalates to formal retraining.
  const disagreementCountByReviewer = new Map<string, number>();
  draft.forEach((r) => { if (!r.agree) disagreementCountByReviewer.set(r.reviewer, (disagreementCountByReviewer.get(r.reviewer) ?? 0) + 1); });

  return draft.map((r, i): IrrReviewRecord => {
    if (r.agree) {
      return { ...r, correctiveAction: 'None', correctiveActionStatus: null, correctiveActionDate: null };
    }
    const n = Number(r.authId.slice(-2));
    const reviewerDisagreements = disagreementCountByReviewer.get(r.reviewer) ?? 1;
    const correctiveAction: CorrectiveActionTier = reviewerDisagreements >= 2 ? 'Retraining Assigned' : 'Coaching Note';
    const correctiveActionStatus: CorrectiveActionStatus = (i * 13 + n) % 100 < 65 ? 'Closed' : 'Open';
    const correctiveActionDate = isoDate(capToday(addDays(new Date(`${r.irrReviewDate}T00:00:00`), 2 + (n % 9))));
    return { ...r, correctiveAction, correctiveActionStatus, correctiveActionDate };
  });
}

// Sample membership/outcomes are stable for the session (only mutable case fields are
// queue/nurse/status, none of which this generator reads), so build once — same treatment
// CASE_POOL itself gets.
export const UM_IRR_REVIEWS: IrrReviewRecord[] = buildIrrReviews(CASE_POOL);
