// Shared, derived case attributes used across every tab's tables and drill-downs
// (single source of truth so "LOB", "Service Category", and "Urgency" mean the same thing everywhere).
import { CaseRec } from './case-pool';

export const LOBS = ['Medicaid', 'Medicare Advantage', 'Commercial PPO', 'ACA Exchange'];
export function lobOf(authId: string): string { return LOBS[Number(authId.slice(-2)) % LOBS.length]; }

// Named "Service Category" (not "Program") so it doesn't collide with CM's own Program concept
// (care-management program enrollment) — these are unrelated ideas that happen to share a word.
export const SERVICE_CATEGORIES = ['Inpatient', 'Outpatient', 'Behavioral Health', 'Pharmacy', 'DME / Home Health'];
export function serviceCategoryOf(c: CaseRec): string {
  if (c.serviceType === 'Inpatient') return 'Inpatient';
  if (c.serviceType === 'Behavioral') return 'Behavioral Health';
  const h = Number(c.authId.slice(-1)) % 3;
  return h === 0 ? 'Pharmacy' : h === 1 ? 'DME / Home Health' : 'Outpatient';
}

export type AuthType = 'IP' | 'OP' | 'RX';
export function authTypeOf(c: CaseRec): AuthType {
  if (c.serviceType === 'Inpatient') return 'IP';
  if (serviceCategoryOf(c) === 'Pharmacy') return 'RX';
  return 'OP';
}

export function tatStatus(c: CaseRec): 'On Track' | 'At Risk' | 'Breached' {
  return c.tags.includes('onTrack') ? 'On Track' : c.tags.includes('atRisk') ? 'At Risk' : c.tags.includes('breached') ? 'Breached' : 'On Track';
}

export function urgencyOf(c: CaseRec): 'Expedited' | 'Standard' {
  return c.tags.includes('expedited') ? 'Expedited' : 'Standard';
}

// ---- MD Reviewer — the internal medical director who handled a decision requiring MD/peer-to-peer
// review. Distinct from `c.provider` (the ordering/treating provider who submitted the request). ----
export const MD_REVIEWERS = ['Dr. Patel', 'Dr. Nguyen', 'Dr. Rivera'];
export function mdReviewerOf(c: CaseRec): string | null {
  if (!c.tags.includes('mdReview') && !c.tags.includes('p2p')) return null;
  return MD_REVIEWERS[Number(c.authId.slice(-2)) % MD_REVIEWERS.length];
}

// ---- Determination reason codes — mirrors the real UM determination workflow, where every
// approve/deny/partial requires picking a structured reason code before confirming (not just free text).
export interface DeterminationCode { code: string; label: string; category: 'Admission' | 'Clinical' | 'Administrative'; }

export const APPROVAL_CODES: DeterminationCode[] = [
  { code: 'AP-AD-01', label: 'Admission medically necessary', category: 'Admission' },
  { code: 'AP-AD-02', label: 'Meets inpatient admission criteria', category: 'Admission' },
  { code: 'AP-CL-01', label: 'Meets clinical criteria', category: 'Clinical' },
  { code: 'AP-CL-02', label: 'Medical necessity established', category: 'Clinical' },
  { code: 'AP-CL-03', label: 'Guideline-supported', category: 'Clinical' },
  { code: 'AP-AM-01', label: 'Auto-approved (criteria met)', category: 'Administrative' },
  { code: 'AP-AM-02', label: 'Covered benefit', category: 'Administrative' },
];

export const DENIAL_CODES: DeterminationCode[] = [
  { code: 'AD-01', label: 'Admission not medically necessary', category: 'Admission' },
  { code: 'AD-02', label: 'Alternate level of care available', category: 'Admission' },
  { code: 'AD-03', label: 'Observation more appropriate than inpatient', category: 'Admission' },
  { code: 'CL-01', label: 'Does not meet clinical criteria', category: 'Clinical' },
  { code: 'CL-02', label: 'Experimental / Investigational', category: 'Clinical' },
  { code: 'CL-03', label: 'Insufficient clinical documentation', category: 'Clinical' },
  { code: 'CL-04', label: 'Non-compliance with treatment plan', category: 'Clinical' },
  { code: 'AM-01', label: 'Non-covered service / benefit', category: 'Administrative' },
  { code: 'AM-02', label: 'Eligibility / benefit exhausted', category: 'Administrative' },
  { code: 'AM-03', label: 'Untimely filing / authorization', category: 'Administrative' },
  { code: 'AM-04', label: 'Duplicate request', category: 'Administrative' },
];

/** The reason code behind a determination — Approved cases get an approval code (auto-approved
 *  cases always land on AP-AM-01, matching the real "Auto-approved (criteria met)" code); Denied
 *  and Partial cases get a denial code (Partial = why the un-approved portion was cut). */
export function determinationReasonOf(c: CaseRec): DeterminationCode | null {
  if (c.phase !== 'decided') return null;
  if (c.decision === 'Approved') {
    if (c.tags.includes('auto')) return APPROVAL_CODES.find((d) => d.code === 'AP-AM-01')!;
    const pool = APPROVAL_CODES.filter((d) => d.code !== 'AP-AM-01');
    return pool[Number(c.authId.slice(-2)) % pool.length];
  }
  return DENIAL_CODES[Number(c.authId.slice(-2)) % DENIAL_CODES.length];
}

/** Criteria review outcome ("X of Y met") behind every determination — deterministic per case and
 *  correlated with the decision (Approved ≈ full match, Denied/Partial show a real gap). */
export function criteriaStatusOf(c: CaseRec): { met: number; total: number } {
  const total = 3 + (Number(c.authId.slice(-1)) % 5); // 3..7
  if (c.decision === 'Denied') {
    const unmet = 1 + (Number(c.authId.slice(-2)) % Math.max(1, total - 1));
    return { met: Math.max(0, total - unmet), total };
  }
  if (c.decision === 'Partial') return { met: total - 1, total };
  return { met: total, total };
}

/** Composite score for the Case Explorer's "Sort: Urgency" control — expedited & SLA-risk float to the top. */
export function urgencyScore(c: CaseRec): number {
  let score = 0;
  if (c.tags.includes('expedited')) score += 1000;
  if (c.tags.includes('breached')) score += 500;
  else if (c.tags.includes('atRisk')) score += 250;
  if (c.phase === 'pending' && c.tags.includes('unassigned')) score += 100;
  return score + c.tatH;
}

// ---------------------------------------------------------------------------------------------
// Intake & Documentation Quality — all deterministic per authId (same pattern as mdReviewerOf/
// determinationReasonOf above), not stored fields on CaseRec, so nothing else has to change shape.
// ---------------------------------------------------------------------------------------------

/** How the request arrived. */
export const INTAKE_CHANNELS = ['Fax', 'Portal', 'Phone', 'EDI', 'Email'];
export function intakeChannelOf(c: CaseRec): string {
  return INTAKE_CHANNELS[Number(c.authId.slice(-2)) % INTAKE_CHANNELS.length];
}

/** How the request was routed to a queue/reviewer. Late correlates with the case already being
 *  at-risk or breached — routing delay is a real contributor to those, not an unrelated stat. */
export type RoutingStatus = 'Smart' | 'Manual' | 'Late';
export function routingStatusOf(c: CaseRec): RoutingStatus {
  if (c.tags.includes('atRisk') || c.tags.includes('breached')) return 'Late';
  return Number(c.authId.slice(-2)) % 3 === 0 ? 'Manual' : 'Smart';
}

/** Duplicate submission detection — only ~9% of pending work is ever flagged; resolved/unresolved
 *  only means anything for cases that are actually flagged as duplicates. */
export function isDuplicateOf(c: CaseRec): boolean { return Number(c.authId.slice(-2)) % 11 === 0; }
export function duplicateResolvedOf(c: CaseRec): boolean { return Number(c.authId.slice(-1)) % 2 === 0; }

/** Missing-information category — broader than missingFieldOf() (Clinical Justification, Provider
 *  NPI, etc. in dashboard-data.ts's Top Missing Fields table): this groups by *where* the gap is
 *  (the intake form itself vs. clinicals vs. the provider record), for the Intake tab's own panel. */
export type MissingInfoCategory = 'Intake Form — Illegible' | 'Intake Form — Missing Fields' | 'Clinicals Missing' | 'Provider Info Missing' | 'None';
export function missingInfoCategoryOf(c: CaseRec): MissingInfoCategory {
  if (!c.tags.includes('incompleteDoc')) return 'None';
  const cats: MissingInfoCategory[] = ['Intake Form — Illegible', 'Intake Form — Missing Fields', 'Clinicals Missing', 'Provider Info Missing'];
  return cats[Number(c.authId.slice(-2)) % cats.length];
}

/** Review timing — when the request was submitted relative to the service, distinct from
 *  authTypeOf()'s IP/OP/RX service type. Concurrent Review tracks the existing 'concurrent' tag
 *  exactly (inpatient stays already under continued-stay review) so the two views never disagree. */
export type ReviewType = 'Pre-Auth' | 'Concurrent Review' | 'Retro';
export function reviewTypeOf(c: CaseRec): ReviewType {
  if (c.tags.includes('concurrent')) return 'Concurrent Review';
  return Number(c.authId.slice(-2)) % 9 === 0 ? 'Retro' : 'Pre-Auth';
}

/** Provider-side data issues — Out of Network reuses the existing 'oon' tag (same cases the OON
 *  Review queue and Provider tab already track) rather than inventing a second, disagreeing flag. */
export type ProviderIssue = 'None' | 'Incomplete' | 'Out of Network';
export function providerIssueOf(c: CaseRec): ProviderIssue {
  if (c.tags.includes('oon')) return 'Out of Network';
  return Number(c.authId.slice(-2)) % 8 === 0 ? 'Incomplete' : 'None';
}

/** Automated intake processing outcome — only meaningful for cases still sitting in the Intake
 *  queue itself (freshly submitted, not yet triaged); everything past Intake processed normally. */
export type IntakeProcessingStatus = 'Completed' | 'Failed' | 'No Shell Created';
export function intakeProcessingStatusOf(c: CaseRec): IntakeProcessingStatus {
  if (!c.tags.includes('intake')) return 'Completed';
  const n = Number(c.authId.slice(-2));
  if (n % 12 === 0) return 'No Shell Created';
  if (n % 7 === 0) return 'Failed';
  return 'Completed';
}

/** Which UM benefit category the case falls under — IP/OP/RX are all "Medical"; Behavioral Health
 *  is the separate, non-medical track. Distinct from authTypeOf() (which folds Behavioral into OP). */
export type IntakeCategory = 'IP' | 'OP' | 'RX' | 'Behavioral Health';
export function intakeCategoryOf(c: CaseRec): IntakeCategory {
  if (serviceCategoryOf(c) === 'Behavioral Health') return 'Behavioral Health';
  if (serviceCategoryOf(c) === 'Pharmacy') return 'RX';
  return c.serviceType === 'Inpatient' ? 'IP' : 'OP';
}

/** RFIs can be sent at any stage of the auth cycle, not just from a dedicated RFI queue — this is
 *  which stage actually triggered the request. The Intake tab's "Needing RFI" should only count
 *  ones that originated at Intake, not ones raised later during clinical/MD/concurrent review. */
export type RfiOriginStage = 'Intake' | 'Clinical Review' | 'MD Review' | 'Concurrent Review';
const RFI_ORIGINS: RfiOriginStage[] = ['Intake', 'Clinical Review', 'MD Review', 'Concurrent Review'];
export function rfiOriginStageOf(c: CaseRec): RfiOriginStage {
  return RFI_ORIGINS[Number(c.authId.slice(-2)) % RFI_ORIGINS.length];
}

// ---- Age in queue (shared by Workforce's age bars and the case pool's own return-to-queue logic) ----
export function ageH(authId: string): number { return 6 + (Number(authId.slice(-2)) % 90); }
export function bandOf(authId: string, breached: boolean): 'fresh' | 'day2' | 'over48' | 'breach' {
  if (breached) return 'breach';
  const h = ageH(authId);
  return h < 24 ? 'fresh' : h < 48 ? 'day2' : 'over48';
}

// ---- Shared "now" for every lookback/date calculation, so the case pool's dates and the
// Lookback filter always agree on what "today" means (matches DashboardData.today). ----
export const TODAY = new Date(2026, 6, 17); // Friday, July 17, 2026
export function daysAgo(dateStr: string): number {
  const d = new Date(`${dateStr}T00:00:00`);
  return Math.round((TODAY.getTime() - d.getTime()) / 86400000);
}
