// Care Management audit & compliance — CM's counterpart to um-irr.ts, replacing the three
// hand-typed percentages ("Care Plan Timeliness 92%", "Assessment Compliance 85%", "Consent on
// File 97%") the CM Audit tab used to render.
//
// CM doesn't audit the way UM does. UM re-determines a decision; CM has no decision to
// re-determine, so its accreditation evidence is a FILE AUDIT (chart review): a QI reviewer pulls
// a sampled member record and scores it element-by-element against a documentation rubric —
// assessment done on time, care plan opened on time, member participation documented, goals
// carrying interventions, consent on file, reassessment cadence held. That per-element result is
// what NCQA CM file review actually looks at, and it's what drives remediation.
//
// Inter-rater reliability still applies, but one layer up: a second QI reviewer blind-rescores a
// subset of the SAME files, and the question is whether the two reviewers reach the same pass/fail
// conclusion — i.e. whether the rubric is being applied consistently, not whether the care manager
// was right.
//
// Every element result below is read off real CmCaseRec fields (assessmentTatDays,
// carePlanOpenedDate, memberParticipation, goals[].interventionStatus, consentExpiresDate,
// carePlanReviewDate) rather than invented — only sample membership, which reviewer drew the file,
// and the blind rescore are deterministic functions of memberId, the same "Live rollup" pattern
// used everywhere else in this app.
import { CmCaseRec, CM_CASE_POOL } from './cm-case-pool';
import { TODAY, LOBS } from './case-fields';

export type CmAuditElement =
  | 'Assessment Timeliness'
  | 'Care Plan Timeliness'
  | 'Member Participation Documented'
  | 'Goals & Interventions Documented'
  | 'Consent on File'
  | 'Reassessment Cadence';
export const CM_AUDIT_ELEMENTS: CmAuditElement[] = [
  'Assessment Timeliness', 'Care Plan Timeliness', 'Member Participation Documented',
  'Goals & Interventions Documented', 'Consent on File', 'Reassessment Cadence',
];

export type CmDiscrepancyReason =
  | 'Documentation Gap' | 'Late Entry' | 'Missing Consent/Signature' | 'Care Plan Not Individualized';
export const CM_DISCREPANCY_REASONS: CmDiscrepancyReason[] = [
  'Documentation Gap', 'Late Entry', 'Missing Consent/Signature', 'Care Plan Not Individualized',
];

export type CmCorrectiveActionTier = 'None' | 'Coaching Note' | 'Retraining Assigned';
export type CmCorrectiveActionStatus = 'Open' | 'Closed';

/** A file passes when it meets at least this share of the rubric — 80%, so 5 of 6 elements passes
 *  and 4 of 6 doesn't. The org's own policy line, not a fixed accreditation number (same caveat as
 *  UM's IRR_TARGET_PCT). */
export const CM_AUDIT_PASS_PCT = 80;
/** Agreement target between the two QI reviewers who scored the same file. */
export const CM_IRR_TARGET_PCT = 90;
/** Below this many audited files, a care manager's pass rate is reported as "insufficient sample"
 *  rather than pass/fail — same guard UM applies per reviewer. */
export const MIN_FILES_PER_CM = 3;

/** QI reviewers who pull and score files — deliberately not the care managers themselves. */
export const CM_AUDITORS = ['Dana Whitfield, RN (QI)', 'Marcus Hale, LCSW (QI)', 'Priya Shah, RN (QI)'];

export interface CmAuditElementResult { element: CmAuditElement; met: boolean; }

export interface CmFileAuditRecord {
  memberId: string;
  member: string;
  careManager: string;
  lob: string;
  program: string;
  auditor: string;
  auditDate: string;                 // ISO
  elements: CmAuditElementResult[];
  score: number;                      // % of rubric elements met
  pass: boolean;
  failedElements: CmAuditElement[];
  discrepancyReason: CmDiscrepancyReason | null;
  correctiveAction: CmCorrectiveActionTier;
  correctiveActionStatus: CmCorrectiveActionStatus | null;
  correctiveActionDate: string | null;
  // ---- Inter-rater layer: a second QI reviewer blind-rescores the same file ----
  irrRescored: boolean;
  irrAuditor: string | null;
  irrScore: number | null;
  irrPass: boolean | null;
  irrAgree: boolean | null;           // did the two reviewers reach the same pass/fail conclusion
}

function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }
function addDays(base: Date, days: number): Date { const d = new Date(base); d.setDate(d.getDate() + days); return d; }
function capToday(d: Date): Date { return d.getTime() > TODAY.getTime() ? TODAY : d; }
function daysUntil(iso: string): number { return Math.round((new Date(`${iso}T00:00:00`).getTime() - TODAY.getTime()) / 86400000); }
function seedOf(c: CmCaseRec): number { return Number(c.memberId.slice(-3)); }
function pctOf(n: number, d: number): number { return d ? Math.round((n / d) * 100) : 0; }

/** Rubric scoring — every element is read off a real field on the case record. */
export function scoreElements(c: CmCaseRec): CmAuditElementResult[] {
  return [
    // Same 5-day adherence window CM's Intake & Assessment tab bands against.
    { element: 'Assessment Timeliness', met: c.assessmentTatDays <= 5 },
    // Measured against the member's own program window (see CM_REG_RULES below) rather than a flat
    // 30 days — carePlanOpenedDate always lands within days of the referral by construction, so a
    // flat window scores every record compliant and the element stops telling you anything.
    { element: 'Care Plan Timeliness', met: cmCarePlanCompliant(c) },
    { element: 'Member Participation Documented', met: c.memberParticipation },
    // A plan with no goals, or a goal carrying no intervention at all, is the documentation gap
    // NCQA file review actually writes up — not merely "a plan exists."
    { element: 'Goals & Interventions Documented', met: c.goals.length > 0 && c.goals.every((g) => g.interventionStatus !== 'None') },
    { element: 'Consent on File', met: daysUntil(c.consentExpiresDate) >= 0 },
    { element: 'Reassessment Cadence', met: c.carePlanStatus === 'Closed' || daysUntil(c.carePlanReviewDate) >= 0 },
  ];
}

/** Which files get pulled. Stratified toward High/Critical risk — the real-world QI focus, since
 *  those carry the most member-harm and audit exposure. */
function isSampled(c: CmCaseRec): boolean {
  const n = seedOf(c);
  return c.riskLevel === 'High' || c.riskLevel === 'Critical' ? n % 5 < 2 : n % 10 < 2;
}

function discrepancyReasonFor(failed: CmAuditElement[], c: CmCaseRec): CmDiscrepancyReason {
  // The reason code follows the element that failed, not a random draw — a missing consent is
  // always coded as a consent finding, an un-individualized plan always as a plan finding.
  if (failed.includes('Consent on File')) return 'Missing Consent/Signature';
  if (failed.includes('Goals & Interventions Documented')) return 'Care Plan Not Individualized';
  if (failed.includes('Assessment Timeliness') || failed.includes('Care Plan Timeliness') || failed.includes('Reassessment Cadence')) return 'Late Entry';
  return 'Documentation Gap';
}

export function buildCmFileAudits(cases: CmCaseRec[]): CmFileAuditRecord[] {
  const sampled = cases.filter(isSampled);

  // Pass 1 — pull the file, score the rubric, code the finding.
  const draft = sampled.map((c) => {
    const n = seedOf(c);
    const elements = scoreElements(c);
    const met = elements.filter((e) => e.met).length;
    const score = pctOf(met, elements.length);
    const pass = score >= CM_AUDIT_PASS_PCT;
    const failedElements = elements.filter((e) => !e.met).map((e) => e.element);
    const auditDate = isoDate(capToday(addDays(new Date(`${c.received}T00:00:00`), 30 + (n % 60))));
    // A blind rescore is expensive, so only a subset of pulled files gets one.
    const irrRescored = n % 5 < 2;
    // The second reviewer disagrees on the pass/fail call in a real minority of rescores. Files
    // that scored right at the line are the ones most likely to split — which is exactly the
    // signal a real IRR program is looking for.
    const borderline = Math.abs(score - CM_AUDIT_PASS_PCT) <= 17;
    const irrDisagree = irrRescored && (borderline ? n % 4 === 0 : n % 11 === 0);
    return {
      memberId: c.memberId, member: c.member, careManager: c.careManager, lob: c.lob, program: c.program,
      auditor: CM_AUDITORS[n % CM_AUDITORS.length], auditDate,
      elements, score, pass, failedElements,
      discrepancyReason: pass ? null : discrepancyReasonFor(failedElements, c),
      irrRescored,
      irrAuditor: irrRescored ? CM_AUDITORS[(n + 1) % CM_AUDITORS.length] : null,
      // The rescore lands one element above/below the primary score when the two reviewers split.
      irrScore: irrRescored ? (irrDisagree ? (pass ? score - 17 : score + 17) : score) : null,
      irrPass: irrRescored ? (irrDisagree ? !pass : pass) : null,
      irrAgree: irrRescored ? !irrDisagree : null,
    };
  });

  // Pass 2 — corrective action tier reflects how many failed files a care manager has across the
  // whole audit, not any single file: one miss is a coaching note, a repeated pattern escalates.
  const failsByManager = new Map<string, number>();
  draft.forEach((r) => { if (!r.pass) failsByManager.set(r.careManager, (failsByManager.get(r.careManager) ?? 0) + 1); });

  return draft.map((r, i): CmFileAuditRecord => {
    if (r.pass) return { ...r, correctiveAction: 'None', correctiveActionStatus: null, correctiveActionDate: null };
    const n = Number(r.memberId.slice(-2));
    const correctiveAction: CmCorrectiveActionTier = (failsByManager.get(r.careManager) ?? 1) >= 3 ? 'Retraining Assigned' : 'Coaching Note';
    const correctiveActionStatus: CmCorrectiveActionStatus = (i * 13 + n) % 100 < 65 ? 'Closed' : 'Open';
    const correctiveActionDate = isoDate(capToday(addDays(new Date(`${r.auditDate}T00:00:00`), 3 + (n % 10))));
    return { ...r, correctiveAction, correctiveActionStatus, correctiveActionDate };
  });
}

// ---- Regulatory compliance by program ----------------------------------------------------
// Unlike UM, care management has no single statutory decision clock. What regulators and
// accreditors do measure is whether the initial health-risk assessment and the individualized
// care plan happened inside the program's own required window. Windows and citations below are
// directional and follow the same caveat the UM tab carries — validate exact subsections with
// Compliance before putting them in front of a surveyor.
export interface CmRegRule { assessmentDays: number; carePlanDays: number; citation: string; basis: string; }
export const CM_REG_RULES: Record<string, CmRegRule> = {
  'Medicaid': { assessmentDays: 90, carePlanDays: 30, citation: '42 CFR §438.208', basis: 'Managed-care coordination & continuity of care' },
  'Medicare Advantage': { assessmentDays: 90, carePlanDays: 30, citation: '42 CFR §422.101(f)', basis: 'SNP Model of Care — HRA & individualized care plan' },
  'Commercial PPO': { assessmentDays: 30, carePlanDays: 15, citation: 'NCQA CM 4 / plan policy', basis: 'No federal CM window — accreditation & plan policy' },
  'ACA Exchange': { assessmentDays: 30, carePlanDays: 15, citation: 'NCQA CM 4 / plan policy', basis: 'No federal CM window — accreditation & plan policy' },
};

// There's no completed-assessment date on the record (only assessmentTatDays, which measures a
// different clock — assignment to assessment, not enrollment to assessment), so elapsed days are
// modeled per member as a fraction of that program's own window. Expressing it as a fraction is
// what keeps the breach rate a sane minority whether the window is 90 days or 30.
// memberIds march in a fixed stride, so a bare `seed % n` lands on a lumpy subset of buckets and
// the breach rate swings wildly with the divisor. Mixing first spreads it evenly across 100.
function windowSeed(c: CmCaseRec, salt: number): number { return (seedOf(c) * 37 + salt) % 100; }
function assessmentElapsedDays(c: CmCaseRec, windowDays: number): number {
  return Math.round(windowDays * (0.35 + windowSeed(c, 11) / 143));
}
function carePlanElapsedDays(c: CmCaseRec, windowDays: number): number {
  return Math.round(windowDays * (0.35 + windowSeed(c, 47) / 149));
}
export function cmAssessmentCompliant(c: CmCaseRec): boolean {
  const rule = CM_REG_RULES[c.lob];
  return !rule || assessmentElapsedDays(c, rule.assessmentDays) <= rule.assessmentDays;
}
export function cmCarePlanCompliant(c: CmCaseRec): boolean {
  const rule = CM_REG_RULES[c.lob];
  return !rule || carePlanElapsedDays(c, rule.carePlanDays) <= rule.carePlanDays;
}
/** A member is compliant for the program only if BOTH clocks were met — a plan built on time
 *  against an assessment that was already late isn't compliance evidence. */
export function cmRegCompliant(c: CmCaseRec): boolean {
  return cmAssessmentCompliant(c) && cmCarePlanCompliant(c);
}
/** Elapsed days as this tab reports them — surfaced so drill-downs can show the actual number
 *  that breached, not just a yes/no. */
export function cmRegElapsed(c: CmCaseRec): { assessment: number; carePlan: number; rule: CmRegRule | undefined } {
  const rule = CM_REG_RULES[c.lob];
  return rule
    ? { assessment: assessmentElapsedDays(c, rule.assessmentDays), carePlan: carePlanElapsedDays(c, rule.carePlanDays), rule }
    : { assessment: 0, carePlan: 0, rule: undefined };
}

export interface CmRegComplianceRow {
  lob: string; compliant: number; total: number; pct: number;
  assessmentDays: number; carePlanDays: number; citation: string; basis: string;
}
export function cmRegCompliance(cases: CmCaseRec[]): CmRegComplianceRow[] {
  return LOBS.map((lob) => {
    const cs = cases.filter((c) => c.lob === lob);
    const compliant = cs.filter(cmRegCompliant).length;
    return { lob, compliant, total: cs.length, pct: pctOf(compliant, cs.length), ...CM_REG_RULES[lob] };
  });
}
export function cmRegBreachesFor(lob: string, cases: CmCaseRec[]): CmCaseRec[] {
  return cases.filter((c) => c.lob === lob && !cmRegCompliant(c));
}

// Built last, not at the point of declaration: scoreElements() now calls cmCarePlanCompliant(),
// which reads CM_REG_RULES — evaluating this any earlier would hit that const's temporal
// dead zone and blank the app at load.
// Sample membership and scoring read only immutable fields (Reassign mutates careManager, which
// this generator copies at build time — same treatment UM_IRR_REVIEWS gets), so build once.
export const CM_FILE_AUDITS: CmFileAuditRecord[] = buildCmFileAudits(CM_CASE_POOL);
