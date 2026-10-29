// Shared, derived case attributes used across every tab's tables and drill-downs
// (single source of truth so "LOB", "Service Category", and "Urgency" mean the same thing everywhere).
import { CaseRec, DX_BY_PROCEDURE, DiagnosisCode } from './case-pool';

// BHP — Florida and Arizona pilot scope (FINAL BHP FOR PILOT, sheet "FL_AZ_Pilot only_FINAL").
// Every path sits under Centene > HealthPlan. States are branches; products and risk populations
// below them. A case belongs to one leaf plan; its LOB is derived from that plan, so the plan
// filter and every "by LOB" view always agree.
export type BhpLevel = 'state' | 'product' | 'risk';
export interface BhpNode { id: string; name: string; parent: string | null; level: BhpLevel; lob?: string; }
export const BHP: BhpNode[] = [
  { id: 'BW', name: 'Arizona', parent: null, level: 'state' },
  { id: 'BWMP', name: 'Market Place', parent: 'BW', level: 'product', lob: 'ACA Exchange' },
  { id: 'BWMPHM', name: 'HMO', parent: 'BWMP', level: 'risk' },
  { id: 'BWMD', name: 'Medicaid', parent: 'BW', level: 'product', lob: 'Medicaid' },
  { id: 'BWMDAZ', name: 'RBHA Only', parent: 'BWMD', level: 'risk' },
  { id: 'BWMDSM', name: 'SMI Integrated', parent: 'BWMD', level: 'risk' },
  { id: 'BWMDN9', name: 'State Only', parent: 'BWMD', level: 'risk' },
  { id: 'BWMH', name: 'Medicaid AHCCCS Complete Care', parent: 'BW', level: 'product', lob: 'Medicaid' },
  { id: 'BWALTD', name: 'Medicaid Duals', parent: 'BW', level: 'product', lob: 'Medicaid' },
  { id: 'FL', name: 'Florida', parent: null, level: 'state' },
  { id: 'FLCW', name: 'Child Welfare', parent: 'FL', level: 'product', lob: 'Medicaid' },
  { id: 'FLHK', name: 'Healthy Kids', parent: 'FL', level: 'product', lob: 'Medicaid' },
  { id: 'FLHI', name: 'HIV AIDS', parent: 'FL', level: 'product', lob: 'Medicaid' },
  { id: 'FLLF', name: 'LTC-LF', parent: 'FL', level: 'product', lob: 'Medicaid' },
  ...[10, 11, 9].map((i) => ({ id: `FLLFH${i}`, name: `Little Havana R${i}`, parent: 'FLLF', level: 'risk' as BhpLevel })),
  ...[1, 10, 11, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => ({ id: `FLLFR${i}`, name: `Region ${i}`, parent: 'FLLF', level: 'risk' as BhpLevel })),
  { id: 'FLMP', name: 'Market Place', parent: 'FL', level: 'product', lob: 'ACA Exchange' },
  { id: 'FLMD', name: 'Medicaid', parent: 'FL', level: 'product', lob: 'Medicaid' },
  { id: 'FLSMFC', name: 'SMI Foster Care', parent: 'FL', level: 'product', lob: 'Medicaid' },
  { id: 'FLSMMD', name: 'SMI Medicaid', parent: 'FL', level: 'product', lob: 'Medicaid' },
  { id: 'FLSI', name: 'SSI', parent: 'FL', level: 'product', lob: 'Medicaid' },
];
export const BHP_BY: Record<string, BhpNode> = Object.fromEntries(BHP.map((n) => [n.id, n]));
export const bhpChildren = (id: string | null) => BHP.filter((n) => n.parent === id);
export const bhpIsLeaf = (id: string) => !BHP.some((n) => n.parent === id);
export const BHP_LEAVES = BHP.filter((n) => bhpIsLeaf(n.id)).map((n) => n.id);
/** Leaf plans under (or equal to) a node. */
export const bhpLeavesUnder = (id: string): string[] => bhpIsLeaf(id) ? [id] : bhpChildren(id).flatMap((c) => bhpLeavesUnder(c.id));
export const bhpStateOf = (id: string): string => { let n = BHP_BY[id]; while (n.parent) n = BHP_BY[n.parent]; return n.name; };
/** Path below the state, e.g. "LTC-LF › Region 3". */
export const bhpRelPath = (id: string): string => { const p: string[] = []; let n: BhpNode | undefined = BHP_BY[id]; while (n && n.parent) { p.unshift(n.name); n = BHP_BY[n.parent]; } return p.join(' › '); };
export const bhpPath = (id: string): string => `Centene › HealthPlan › ${bhpStateOf(id)} › ${bhpRelPath(id)}`;
/** LOB of a plan: the nearest ancestor product that carries one. */
export const lobOfPlan = (id: string): string => { let n: BhpNode | undefined = BHP_BY[id]; while (n && !n.lob) n = n.parent ? BHP_BY[n.parent] : undefined; return n?.lob ?? 'Medicaid'; };
// Weighted so the big Medicaid products carry most of the volume, as they do in the pilot.
const PLAN_WEIGHT: Record<string, number> = { FLMD: 10, BWMH: 7, BWMDAZ: 5, FLMP: 5, FLSI: 4, BWALTD: 4, BWMDSM: 3, FLSMMD: 3, FLHK: 3, BWMPHM: 3, BWMDN9: 2, FLCW: 2, FLSMFC: 2, FLHI: 2 };
const PLAN_POOL = BHP_LEAVES.flatMap((id) => Array(PLAN_WEIGHT[id] ?? 1).fill(id) as string[]);
/** The pilot plan an authorization belongs to — deterministic per authId. */
export function bhpOf(authId: string): string {
  const n = Number(authId.replace(/\D/g, '')) || 0;
  return PLAN_POOL[(n * 37 + Math.floor(n / 7)) % PLAN_POOL.length];
}

export const LOBS = ['Medicaid', 'ACA Exchange'];
export function lobOf(authId: string): string { return lobOfPlan(bhpOf(authId)); }

/** A plan scope is 'all' / undefined, one LOB name or plan code, or a list of LOB names and/or
 *  plan codes (empty list = all). The top-bar plan filter passes plan codes; Reports passes LOBs. */
export type PlanScope = string | string[] | undefined;
export function inPlanScope(authId: string, scope: PlanScope): boolean {
  if (!scope || scope === 'all') return true;
  const list = Array.isArray(scope) ? scope : [scope];
  return list.length === 0 || list.includes(bhpOf(authId)) || list.includes(lobOf(authId));
}
/** For records that carry only a LOB (CM cases, notices): in scope if any selected plan has that LOB. */
export function lobInPlanScope(lob: string, scope: PlanScope): boolean {
  if (!scope || scope === 'all') return true;
  const list = Array.isArray(scope) ? scope : [scope];
  return list.length === 0 || list.some((s) => s === lob || (BHP_BY[s] && lobOfPlan(s) === lob));
}

// Named "Service Category" (not "Program") so it doesn't collide with CM's own Program concept
// (care-management program enrollment) — these are unrelated ideas that happen to share a word.
export const SERVICE_CATEGORIES = ['Inpatient', 'Outpatient', 'Behavioral Health', 'Pharmacy', 'DME / Home Health'];
export function serviceCategoryOf(c: CaseRec): string {
  if (c.serviceType === 'Inpatient') return 'Inpatient';
  if (c.serviceType === 'Behavioral') return 'Behavioral Health';
  const h = Number(c.authId.slice(-1)) % 3;
  return h === 0 ? 'Pharmacy' : h === 1 ? 'DME / Home Health' : 'Outpatient';
}

/** Primary diagnosis behind the request — correlated with procedure (a knee replacement doesn't
 *  get a cardiac dx), one of 2 plausible ICD-10-CM codes per procedure, picked deterministically
 *  per authId so the same case always shows the same diagnosis. */
export function dxOf(c: CaseRec): DiagnosisCode {
  const options = DX_BY_PROCEDURE[c.procedure] ?? DX_BY_PROCEDURE['MRI Brain w/ Contrast'];
  return options[Number(c.authId.slice(-1)) % options.length];
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

/** Full authorization lifecycle status — broader than `c.status` (the raw queue name for pending
 *  cases, or decision label for decided ones): pending queues collapse into the stage a supervisor
 *  actually thinks in (e.g. Clinical Review + Concurrent Review are both "In Clinical Review").
 *  Draft/Withdrawn/Expired aren't modeled in this demo (no case ever enters those states) — see the
 *  field guide. */
export const AUTH_STATUSES = ['Submitted', 'In Clinical Review', 'In MD Review', 'Pended — RFI', 'Pended — OON Review', 'Approved', 'Auto-Approved', 'Denied', 'Partial Approval'];
const PENDING_STATUS_MAP: Record<string, string> = {
  'Intake': 'Submitted',
  'Clinical Review': 'In Clinical Review',
  'Concurrent Review': 'In Clinical Review',
  'MD Review': 'In MD Review',
  'Pending P2P': 'In MD Review',
  'RFI Pending': 'Pended — RFI',
  'OON Review': 'Pended — OON Review',
};
export function authStatusOf(c: CaseRec): string {
  return c.phase === 'decided' ? c.status : (PENDING_STATUS_MAP[c.status] ?? c.status);
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

// ---- Out-of-Network resolution — every 'oon'-tagged case (the OON Review queue) resolves one of
// three ways: a Continuity of Care allowance (member already has an established relationship with
// this provider), a Single Case Agreement (a one-time negotiated rate for this specific case), or a
// standard OON exception (no CoC/SCA basis, just approved as out-of-network). Both the resolution
// and its reason are deterministic per authId — not stored fields, same pattern as every other
// derived attribute here. ----
export type OonResolution = 'Continuity of Care' | 'Single Case Agreement' | 'Standard Exception';
export function oonResolutionOf(c: CaseRec): OonResolution | null {
  if (!c.tags.includes('oon')) return null;
  const n = Number(c.authId.slice(-1));
  if (n % 3 === 0) return 'Continuity of Care';
  if (n % 3 === 1) return 'Single Case Agreement';
  return 'Standard Exception';
}
export const COC_REASONS = [
  'Newly enrolled member — active course of treatment',
  'Provider terminated from network — ongoing treatment',
  'Pregnancy — second or third trimester',
  'Terminal illness — end-of-life care',
  'Post-operative care — recent surgery',
];
export const SCA_REASONS = [
  'No in-network provider available for this service',
  'Specialized care not available in-network',
  'Provider network gap in member\'s service area',
  'Negotiated rate lower than standard OON cost-share',
];
export const STANDARD_OON_REASONS = [
  'Emergency / urgent need — no time to redirect to network',
  'Member self-referred out-of-network',
  'Administrative exception — plan-level override',
];
export function oonReasonOf(c: CaseRec): string | null {
  const resolution = oonResolutionOf(c);
  if (!resolution) return null;
  const n = Number(c.authId.slice(-2));
  if (resolution === 'Continuity of Care') return COC_REASONS[n % COC_REASONS.length];
  if (resolution === 'Single Case Agreement') return SCA_REASONS[n % SCA_REASONS.length];
  return STANDARD_OON_REASONS[n % STANDARD_OON_REASONS.length];
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

// ---- Provider & Network Insights — provider-level metadata, distinct from per-case fields above.
// These are fixed attributes of the provider/facility itself (specialty, network status), not
// derived per-case, so they live in a lookup keyed by provider name rather than a authId-hash fn. ----
export interface ProviderMeta {
  specialty: string;
  kind: 'Individual' | 'Facility';
  networkStatus: 'In-Network' | 'Out-of-Network' | 'Delegated' | 'Exception';
  /** Plan-designated strategic-partner tag — a business/relationship call (high referral volume,
   *  key market presence), independent of the performance-driven Gold Card status below. */
  vip: boolean;
}
export const PROVIDER_META: Record<string, ProviderMeta> = {
  'Dr. Sarah Mitchell': { specialty: 'Orthopedic Surgery', kind: 'Individual', networkStatus: 'In-Network', vip: false },
  'Dr. James Parker': { specialty: 'Cardiology', kind: 'Individual', networkStatus: 'In-Network', vip: false },
  'Dr. Emily Chen': { specialty: 'Behavioral Health', kind: 'Individual', networkStatus: 'In-Network', vip: false },
  'Memorial Orthopedic Group': { specialty: 'Orthopedic Surgery', kind: 'Facility', networkStatus: 'In-Network', vip: true },
  'Regional Heart Center': { specialty: 'Cardiology', kind: 'Facility', networkStatus: 'Delegated', vip: false },
  'Coastal Neurology Associates': { specialty: 'Neurology', kind: 'Facility', networkStatus: 'Out-of-Network', vip: true },
};
export function providerMetaOf(name: string): ProviderMeta {
  return PROVIDER_META[name] ?? { specialty: 'General', kind: 'Individual', networkStatus: 'In-Network', vip: false };
}
/** Deterministic provider-level avg response time (days) to information requests — a stable
 *  attribute of the provider, not derived per-case like everything else in this file. */
export function providerResponseDaysOf(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 97;
  return 1 + (h % 4); // 1-4 days
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
// The clock lives in its own leaf module — see clock.ts for why — and is re-exported here so
// every existing `from './case-fields'` import keeps working.
export { TODAY, TODAY_ISO, TODAY_LONG } from './clock';
import { TODAY } from './clock';

export function daysAgo(dateStr: string): number {
  const d = new Date(`${dateStr}T00:00:00`);
  return Math.round((TODAY.getTime() - d.getTime()) / 86400000);
}

/** End of the shell's date span in days before today (0 = today). Set by Lookback so the
 *  data-layer derivations, which take only `withinDays` (the start), also honour the end. */
export const SPAN_END = { daysAgo: 0 };
/** A yyyy-mm-dd date inside the span: `withinDays` back to SPAN_END. undefined = no date filter. */
export function inWindow(dateStr: string, withinDays?: number): boolean {
  if (withinDays === undefined) return true;
  const d = daysAgo(dateStr);
  return d <= withinDays && d >= SPAN_END.daysAgo;
}

// ---- WFM queues for the pilot (no Medicare): 16 general + 7 specialized ----
// Not every combination of attributes gets a queue: queues exist only where the combination is a
// real team assignment, specialty boundary or operational need; finer precision comes from task
// attributes and worker proficiencies. General queues are per market unless a regional team covers
// them; specialized queues may be national or per market.
// A pending case's workflow stage (c.status) is unchanged; on top of it every pending case is
// routed to one WFM queue. Assignment filters stack: BHP (the shell's Plans filter), Specialty,
// Urgency, Role and State — AND across filters, OR within one.
export type WfmRole = 'L1 Nurse Reviewer' | 'L2 Physician Reviewer' | 'Correspondence' | 'Intake Coordinator';
export interface WfmQueue { id: string; name: string; type: 'General' | 'Specialized'; spec: string[]; roles: WfmRole[]; setting: 'IP' | 'OP' | 'IP/OP'; product: 'Medicaid' | 'Marketplace' | 'Medicaid/Marketplace'; scope: string; flag?: string; }
const PH = 'Physical Health', BH = 'Behavioral Health';
const L1: WfmRole[] = ['L1 Nurse Reviewer'], L2: WfmRole[] = ['L2 Physician Reviewer'], CORR: WfmRole[] = ['Correspondence'];
const MARKET = 'Per market', SPEC_SCOPE = 'National or per market';
const q = (id: string, name: string, type: WfmQueue['type'], spec: string[], roles: WfmRole[], setting: WfmQueue['setting'], product: WfmQueue['product'], scope: string, flag?: string): WfmQueue =>
  ({ id, name, type, spec, roles, setting, product, scope, ...(flag ? { flag } : {}) });
export const WFM_QUEUES: WfmQueue[] = [
  // L1 / L2 Physical Health: one queue per setting covering both products
  ...(['L1', 'L2'] as const).flatMap((lv) => (['IP', 'OP'] as const).map((set) =>
    q(`${lv}-PH-${set}`, `${lv} - PH - ${set} - Medicaid/Marketplace`, 'General', [PH], lv === 'L1' ? L1 : L2, set, 'Medicaid/Marketplace', MARKET))),
  // L1 / L2 Behavioral Health: split by setting and product
  ...(['L1', 'L2'] as const).flatMap((lv) => (['IP', 'OP'] as const).flatMap((set) => (['Medicaid', 'Marketplace'] as const).map((prod) =>
    q(`${lv}-BH-${set}-${prod}`, `${lv} - BH - ${set} - ${prod}`, 'General', [BH], lv === 'L1' ? L1 : L2, set, prod, MARKET)))),
  // Correspondence: PH is outpatient, BH is inpatient
  ...(['Medicaid', 'Marketplace'] as const).map((prod) => q(`Corr-PH-OP-${prod}`, `Corr - PH - OP - ${prod}`, 'General', [PH], CORR, 'OP', prod, MARKET)),
  ...(['Medicaid', 'Marketplace'] as const).map((prod) => q(`Corr-BH-IP-${prod}`, `Corr - BH - IP - ${prod}`, 'General', [BH], CORR, 'IP', prod, MARKET)),
  // Specialized
  q('PH-Transplant', 'PH - IP/OP - Transplant', 'Specialized', [PH, 'Transplant'], [...L1, ...L2], 'IP/OP', 'Medicaid/Marketplace', SPEC_SCOPE),
  q('BH-ABA', 'BH - ABA', 'Specialized', [BH, 'ABA'], [...L1, ...L2], 'OP', 'Medicaid/Marketplace', SPEC_SCOPE),
  q('BH-Psych', 'BH - Psych testing', 'Specialized', [BH, 'Psych Testing'], [...L1, ...L2], 'OP', 'Medicaid/Marketplace', 'Multiple markets'),
  q('IP-NICU', 'IP - NICU', 'Specialized', [PH, 'NICU'], [...L1, ...L2], 'IP', 'Medicaid/Marketplace', SPEC_SCOPE),
  q('IP-PAC', 'IP - PAC', 'Specialized', [PH, 'PAC'], [...L1, ...L2], 'IP', 'Medicaid/Marketplace', SPEC_SCOPE),
  q('Intake-Esc', 'Intake Escalation (inside Zyter)', 'Specialized', [PH, BH], ['Intake Coordinator'], 'IP/OP', 'Medicaid/Marketplace', SPEC_SCOPE),
  q('Corr-Exception', 'Correspondence Approval Fallout/Exception Queue', 'Specialized', [PH, BH], CORR, 'IP/OP', 'Medicaid/Marketplace', SPEC_SCOPE),
];
/** Medicare queues — not considered for the pilot. Listed for reference only; no work routes to them. */
export const WFM_NOT_IN_PILOT = [
  'L1 - PH - IP - Medicare', 'L1 - PH - OP - Medicare', 'L1 - BH - IP - Medicare', 'L1 - BH - OP - Medicare',
  'L2 - PH - IP - Medicare', 'L2 - PH - OP - Medicare', 'L2 - BH - IP - Medicare', 'L2 - BH - OP - Medicare',
  'Corr - PH - OP - Medicare', 'Corr - BH - IP - Medicare',
];
export const WFM_SPECIALTIES = [PH, BH, 'Transplant', 'ABA', 'Psych Testing', 'NICU', 'PAC'];
export const WFM_ROLES: WfmRole[] = ['L1 Nurse Reviewer', 'L2 Physician Reviewer', 'Correspondence', 'Intake Coordinator'];
export const WFM_STATES = ['FL', 'AZ'];
export const WFM_URGENCIES = ['Expedited', 'Standard'];

/** Who can take WFM work: role, specialty proficiencies and licensed states. The RNs are the
 *  Workload roster (their load is live from DashboardData); the rest carry their own load here. */
export interface WfmStaff { name: string; role: WfmRole; skills: string[]; states: string[]; active?: number; cap?: number; }
export const WFM_STAFF: WfmStaff[] = [
  { name: 'Maria Gonzalez, RN', role: 'L1 Nurse Reviewer', skills: [PH, 'NICU', 'PAC'], states: ['FL'] },
  { name: 'Andrew Mitchell, RN', role: 'L1 Nurse Reviewer', skills: [PH, 'Transplant', 'PAC'], states: ['FL', 'AZ'] },
  { name: 'Jessica Williams, RN', role: 'L1 Nurse Reviewer', skills: [PH, BH], states: ['FL'] },
  { name: 'Sarah Mitchell, RN', role: 'L1 Nurse Reviewer', skills: [BH, 'ABA', 'Psych Testing'], states: ['FL', 'AZ'] },
  { name: 'Rachel Foster, RN', role: 'L1 Nurse Reviewer', skills: [PH, BH], states: ['AZ'] },
  { name: 'Emily Chen, RN', role: 'L1 Nurse Reviewer', skills: [PH, 'NICU', 'Transplant'], states: ['FL', 'AZ'] },
  { name: 'Robert Kim, RN', role: 'L1 Nurse Reviewer', skills: [BH, 'ABA'], states: ['AZ'] },
  { name: 'Dr. Alan Reyes, MD', role: 'L2 Physician Reviewer', skills: [PH, 'Transplant', 'NICU', 'PAC'], states: ['FL', 'AZ'], active: 14, cap: 20 },
  { name: 'Dr. Priya Shah, MD', role: 'L2 Physician Reviewer', skills: [BH, 'ABA', 'Psych Testing'], states: ['FL', 'AZ'], active: 11, cap: 20 },
  { name: 'Dr. Mark Webb, DO', role: 'L2 Physician Reviewer', skills: [PH, BH, 'PAC'], states: ['FL'], active: 16, cap: 20 },
  { name: 'Tanya Brooks', role: 'Correspondence', skills: [PH, BH], states: ['FL', 'AZ'], active: 22, cap: 40 },
  { name: 'Luis Ortega', role: 'Correspondence', skills: [PH, BH], states: ['FL'], active: 30, cap: 40 },
  { name: 'Megan Hall', role: 'Intake Coordinator', skills: [PH, BH], states: ['FL', 'AZ'], active: 18, cap: 35 },
  { name: 'Omar Haddad', role: 'Intake Coordinator', skills: [PH, BH], states: ['AZ'], active: 12, cap: 35 },
];
/** Can this person work this queue? Right role, and the queue's specialty (the specialized one
 *  when it has one, else PH or BH). State is checked per case, against the case's plan state. */
export function wfmEligible(s: WfmStaff, q: WfmQueue): boolean {
  if (!q.roles.includes(s.role)) return false;
  const special = q.spec.filter((x) => x !== PH && x !== BH);
  return special.length ? special.every((x) => s.skills.includes(x)) : q.spec.some((x) => s.skills.includes(x));
}
/** FL or AZ — the state the case's BHP plan sits under. */
export const stateCodeOf = (authId: string): string => (bhpStateOf(bhpOf(authId)) === 'Arizona' ? 'AZ' : 'FL');

/** The WFM queue a pending case is routed to. Deterministic per case. */
export function wfmQueueOf(c: CaseRec): string {
  const n = Number(c.authId.replace(/\D/g, '')) || 0;
  const health = c.serviceType === 'Behavioral' ? 'BH' : 'PH';
  const product = lobOf(c.authId) === 'ACA Exchange' ? 'Marketplace' : 'Medicaid';
  if (c.procedure === 'NICU Stay') return 'IP-NICU';
  if (c.status === 'Intake' && (c.tags.includes('atRisk') || c.tags.includes('breached'))) return 'Intake-Esc';
  if (c.serviceType === 'Inpatient' && n % 29 === 0) return 'PH-Transplant';
  if (c.tags.includes('concurrent') && n % 4 === 0) return 'IP-PAC';
  if (health === 'BH' && n % 3 === 0) return 'BH-ABA';
  if (health === 'BH' && n % 5 === 0) return 'BH-Psych';
  if (n % 97 === 0) return 'Corr-Exception';
  // Correspondence: physical health letters sit in the OP queue, behavioral health in the IP queue.
  if (c.status !== 'Intake' && n % 13 === 0) return health === 'PH' ? `Corr-PH-OP-${product}` : `Corr-BH-IP-${product}`;
  const level = c.status === 'MD Review' || c.status === 'Pending P2P' ? 'L2' : 'L1';
  // Behavioral partial hospitalization (PHP) is facility-based, so it routes to the BH inpatient queues.
  const setting = c.serviceType === 'Inpatient' || c.procedure === 'Behavioral Health PHP' ? 'IP' : 'OP';
  return health === 'PH' ? `${level}-PH-${setting}` : `${level}-BH-${setting}-${product}`;
}
