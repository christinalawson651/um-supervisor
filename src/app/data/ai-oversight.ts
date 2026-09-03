// AI oversight — the evidence layer behind "how do you know the model is right, and what happens
// when a clinician disagrees with it?"
//
// Vocabulary, scales and gates here follow Symphony Studio's Monitor views rather than this app's
// own invention. Symphony is the system actually making these determinations, so a second audit
// surface describing the same run in different words is the thing that loses an auditor. From
// Monitor → ML Ops: decision agreement, groundedness, convergence, confidence on a 0–1 scale, the
// four confidence bands, the ≥ 0.80 auto-approve gate, the < 0.70 auto-pend gate, the five named
// LLM agents, and the three investigation flags.
//
// What this file adds that ML Ops does not have is the audit question rather than the engineering
// one: is the confidence score CALIBRATED — does a band claiming 0.90 actually agree 90% of the
// time — who overrode, why, and was it the model's fault or a legitimate clinical divergence.
// Symphony's own Audit view traces a single determination; this is the population behind it.
//
// Deterministic and RNG-free like the rest of the demo data: the same authorization always
// produces the same run, so every figure is identical on each load.
import { CASE_POOL, CaseRec, Decision } from './case-pool';
import { TODAY, lobOf, MD_REVIEWERS } from './case-fields';

export type AiRecommendation = 'Approved' | 'Denied' | 'Partial' | 'Escalate';
/** What became of the determination. Pending is deliberately not one of these — in Symphony a pend
 *  is a queue state, the flow stopping to ask for a human, and the determination still resolves
 *  afterwards. It is carried as its own attribute. */
export type AiOutcome = 'Auto-cleared' | 'Accepted' | 'Overridden';

/** Why the flow stopped and asked for a human — Symphony's Monitor taxonomy. */
export type PendReason = 'Potential denial' | 'Low confidence' | 'Insufficient info';
export const PEND_REASONS: PendReason[] = ['Potential denial', 'Low confidence', 'Insufficient info'];

/** What ML Ops flags for investigation. */
export type InvestigationFlag = 'low confidence' | 'panel split' | 'ungrounded verdict';
export const INVESTIGATION_FLAGS: InvestigationFlag[] = ['low confidence', 'panel split', 'ungrounded verdict'];

export type OverrideReason =
  | 'Additional clinical received after scoring'
  | 'Criteria not applicable to this presentation'
  | 'Member-specific circumstance'
  | 'Comorbidity not weighted by the model'
  | 'Peer-to-peer changed the clinical picture'
  | 'Policy interpretation differs';
export const OVERRIDE_REASONS: OverrideReason[] = [
  'Additional clinical received after scoring',
  'Criteria not applicable to this presentation',
  'Member-specific circumstance',
  'Comorbidity not weighted by the model',
  'Peer-to-peer changed the clinical picture',
  'Policy interpretation differs',
];
/** Which reasons indicate a MODEL problem rather than legitimate clinical divergence. An override
 *  rate on its own says nothing; this split is what makes it interpretable. */
export const MODEL_ATTRIBUTABLE: OverrideReason[] = [
  'Criteria not applicable to this presentation',
  'Comorbidity not weighted by the model',
];

/** The bundle promotion date moves with the clock — a config that says it was promoted eleven
 *  weeks ago should still say that next month. */
function bundlePromotedIso(): string {
  const d = new Date(TODAY); d.setDate(d.getDate() - 88);
  return d.toISOString().slice(0, 10);
}

/** What is serving live — Symphony's Production Config panel. */
export const PRODUCTION_CONFIG = {
  workflow: 'Prior Authorization v0.2.0',
  bundle: 'Med-necessity bundle: Grounding-tuned',
  bundlePromoted: bundlePromotedIso(),
  model: 'claude-sonnet-4-6',
  autoApproveGate: 0.80,
  autoPendGate: 0.70,
};

/** The five LLM agents in the flow, with the P95 latency and error rate Symphony's ML Ops reports.
 *  Held here rather than derived: per-agent telemetry is measured by the runtime, not inferred from
 *  a case pool, and inventing it per-case would misrepresent where it comes from. */
export const AGENTS = [
  { agent: 'extractor', p95Sec: 3.4, errorPct: 0.6 },
  { agent: 'policy_checker', p95Sec: 5.1, errorPct: 0.3 },
  { agent: 'clinical_rationale', p95Sec: 4.8, errorPct: 0.2 },
  { agent: 'decision_maker', p95Sec: 2.2, errorPct: 0.1 },
  { agent: 'letter_generator', p95Sec: 3.9, errorPct: 0.4 },
];

/** Governance thresholds. The two gates are Symphony's, serving live. The rest are this program's
 *  own policy lines — there is no regulatory number yet for machine-influenced UM decisions, so
 *  what an AI-governance reviewer asks for is the line you committed to and are measured against. */
export const AI_TARGETS = {
  decisionAgreementPct: 90,
  groundednessPct: 90,
  convergencePct: 80,
  maxCalibrationDeviationPts: 5,
  maxOverrideRatePct: 15,
  /** A confidence band below this is reported as insufficient sample, never as calibrated or not.
   *  Symphony's bands hold thousands of determinations; a band holding thirty will swing ten points
   *  on sampling alone, and a swing that size read as a finding would send someone chasing noise. */
  minBandSample: 40,
  /** Reviewers get a lower floor — a clinician with a dozen scored determinations is a meaningful
   *  read on that person, where a confidence band with a dozen is not a meaningful read on a model.
   *  The two are different questions and do not share a threshold. */
  minReviewerSample: 12,
  autoApproveGate: PRODUCTION_CONFIG.autoApproveGate,
  autoPendGate: PRODUCTION_CONFIG.autoPendGate,
};

/** Symphony's four confidence bands, on its 0–1 scale. */
export type ConfidenceBand = '0.90–1.00' | '0.80–0.90' | '0.70–0.80' | '< 0.70';
export const CONFIDENCE_BANDS: ConfidenceBand[] = ['0.90–1.00', '0.80–0.90', '0.70–0.80', '< 0.70'];
export function bandOf(confidence: number): ConfidenceBand {
  if (confidence >= 0.90) return '0.90–1.00';
  if (confidence >= 0.80) return '0.80–0.90';
  if (confidence >= 0.70) return '0.70–0.80';
  return '< 0.70';
}
/** What the band is effectively claiming, as a percentage — the predicted value on the calibration
 *  curve. A band claiming 0.95 should be right about 95% of the time. */
export function bandClaim(b: ConfidenceBand): number {
  return b === '0.90–1.00' ? 95 : b === '0.80–0.90' ? 85 : b === '0.70–0.80' ? 75 : 60;
}

export interface AiDecisionRecord {
  authId: string;
  member: string;
  lob: string;
  procedure: string;
  reviewer: string;
  scoredDate: string;
  decidedDate: string;
  workflowVersion: string;
  bundle: string;
  model: string;
  criteriaSet: string;
  recommendation: AiRecommendation;
  confidence: number;              // 0–1, Symphony's scale
  band: ConfidenceBand;
  finalDecision: Decision;
  agreed: boolean;                 // recommendation matched the final determination
  outcome: AiOutcome;
  overrideReason: OverrideReason | null;
  overriddenBy: string | null;
  autoCleared: boolean;
  pended: boolean;
  pendReason: PendReason | null;
  // ---- run telemetry, mirroring Symphony's run ledger and ML Ops gates ----
  agentsCompleted: number;
  agentsTotal: number;
  modelsUsed: string;
  panel: boolean;
  converged: boolean;              // the panel reached one answer; false is a "panel split"
  groundedMet: number;             // grounding checks passed
  groundedTotal: number;
  grounded: boolean;
  flags: InvestigationFlag[];
  tokens: number;
  cost: number;
  latencySec: number;
}

function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }
function addDays(base: Date, days: number): Date { const d = new Date(base); d.setDate(d.getDate() + days); return d; }
function capToday(d: Date): Date { return d.getTime() > TODAY.getTime() ? TODAY : d; }
function pctOf(n: number, d: number): number { return d ? Math.round((n / d) * 100) : 0; }

/** A spread over the case's full identity. Confidence bands are themselves a function of the auth
 *  id's digits, so anything else derived from those digits lands in the same clusters — which once
 *  put an entire band at a flat 100%. Hashing procedure and member in as well makes each band's
 *  sample actually scatter. */
function hash32(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) h = ((h ^ seed.charCodeAt(i)) * 0x01000193) >>> 0;
  return h;
}
function spread100(seed: string): number { return hash32(seed) % 100; }
/** A finer draw for the agreement decision. At 100 buckets a band holding 45 determinations was
 *  quantising badly — one band came out 14 points off its own claim purely as an artefact, which
 *  competes with the real calibration finding for a reviewer's attention. */
function spread1000(seed: string): number { return hash32(seed) % 1000; }

function otherDecision(d: Decision, seed: number): AiRecommendation {
  const pool: AiRecommendation[] = (['Approved', 'Denied', 'Partial'] as AiRecommendation[]).filter((x) => x !== d);
  return pool[seed % pool.length];
}

/** Overrides in the top band skew model-attributable, because that is what over-confidence looks
 *  like on the floor — a high score on a case whose criteria do not really fit. */
function overrideReasonFor(c: CaseRec, band: ConfidenceBand): OverrideReason {
  const h = spread100(`${c.authId}|${c.member}|reason`);
  if (band === '0.90–1.00' && h % 3 < 2) return MODEL_ATTRIBUTABLE[h % MODEL_ATTRIBUTABLE.length];
  return OVERRIDE_REASONS[h % OVERRIDE_REASONS.length];
}

function buildAiDecisions(cases: CaseRec[]): AiDecisionRecord[] {
  return cases.filter((c) => c.phase === 'decided').map((c): AiDecisionRecord => {
    const n = Number(c.authId.slice(-2));

    // Confidence is shaped to Symphony's own published distribution — roughly 34% at 0.90+, 32% in
    // 0.80–0.90, 20% in 0.70–0.80 and 14% below the pend gate, which averages out to the 0.84 its
    // ML Ops view reports.
    const cs = spread100(`${c.authId}|${c.member}|conf`);
    const confidence = cs < 34 ? Math.round((0.90 + (cs % 10) / 100) * 100) / 100
      : cs < 66 ? Math.round((0.80 + (cs % 10) / 100) * 100) / 100
      : cs < 86 ? Math.round((0.70 + (cs % 10) / 100) * 100) / 100
      : Math.round((0.45 + (cs % 25) / 100) * 100) / 100;
    const band = bandOf(confidence);

    // Calibration is the point of this dataset, so agreement is generated against the score rather
    // than independently of it. The shape is the one real scorers tend to have: modest UNDER-
    // confidence through the middle, and genuine OVER-confidence at the ceiling, where a model is
    // confidently wrong. That is the finding worth having — a 0.95 you cannot lean on.
    // A flat boost across the lower bands overshot: the 0.70–0.80 band came out 16 points above
    // its own claim, which reads as a generator artefact rather than as under-confidence. A modest,
    // even +4 keeps the middle and bottom calibrated and leaves exactly one finding — the ceiling.
    const claimedPct = band === '0.90–1.00'
      ? Math.round(confidence * 100) - 8
      : Math.min(96, Math.round(confidence * 100) + 4);
    const agreeSeed = spread1000(`${c.authId}|${c.procedure}|${c.member}|agree`);
    const agreed = agreeSeed < claimedPct * 10;

    const submitted = new Date(`${c.submitted}T00:00:00`);
    const scoredDate = isoDate(capToday(addDays(submitted, 1)));
    const decidedDate = isoDate(capToday(addDays(submitted, 3 + (n % 4))));
    const finalDecision = c.decision as Decision;
    const adverse = finalDecision === 'Denied' || finalDecision === 'Partial';

    // Symphony's gates, serving live: at or above 0.80 a determination is eligible to auto-clear,
    // below 0.70 it is auto-pended. Eligibility is not the whole story — an adverse direction or
    // missing clinical still stops the flow regardless of how sure the model is.
    const insufficientInfo = c.tags.includes('rfi') || c.tags.includes('incompleteDoc');
    const lowConfidence = confidence < PRODUCTION_CONFIG.autoPendGate;
    const gateEligible = confidence >= PRODUCTION_CONFIG.autoApproveGate;
    // The gate IS the rule — nothing else decides it. Requiring a pre-existing 'auto' tag on the
    // case as well held auto-clear down to 23% of volume against Symphony's 34%, and misrepresented
    // where the decision comes from.
    const autoCleared = gateEligible && !adverse && !insufficientInfo;
    const pended = !autoCleared && (insufficientInfo || adverse || lowConfidence);
    // Precedence is clinical: a missing document blocks assessment outright, an adverse direction
    // needs a clinician regardless of the score, a soft score is the residual reason.
    const pendReason: PendReason | null = !pended ? null
      : insufficientInfo ? 'Insufficient info'
      : adverse ? 'Potential denial'
      : 'Low confidence';

    const outcome: AiOutcome = autoCleared ? 'Auto-cleared' : agreed ? 'Accepted' : 'Overridden';
    const reviewer = autoCleared ? '—' : lowConfidence ? MD_REVIEWERS[n % MD_REVIEWERS.length] : c.nurse;

    // A panel is convened when one pass is not enough — an adverse direction or a soft score.
    const panel = !autoCleared && (adverse || confidence < 0.85);
    const runSeed = spread100(`${c.authId}|${c.member}|run`);
    // Convergence ~83%, matching ML Ops. Only a panel can split; a single pass has nothing to
    // disagree with.
    const converged = !panel || runSeed % 100 >= 17;
    // Groundedness ~90%: the verdict is supported by the source it cites. A panel runs four checks,
    // a single pass three.
    const groundedTotal = panel ? 4 : 3;
    const groundedMet = spread100(`${c.authId}|${c.member}|ground`) < 90 ? groundedTotal : groundedTotal - 1;
    const grounded = groundedMet === groundedTotal;

    const flags: InvestigationFlag[] = [];
    if (lowConfidence) flags.push('low confidence');
    if (panel && !converged) flags.push('panel split');
    if (!grounded) flags.push('ungrounded verdict');

    const modelsUsed = panel ? 'sonnet x4 · haiku · opus' : 'sonnet x4 · haiku';
    // Anchored to Symphony's run ledger: ~36–40k tokens on an auto-cleared case, ~60–65k where a
    // panel is convened, with cost tracking tokens rather than invented alongside them.
    const tokens = autoCleared ? 33900 + runSeed * 39 : panel ? 55100 + runSeed * 63 : 41800 + runSeed * 51;
    const cost = Math.round((tokens / 1000) * (panel ? 0.0063 : 0.0042) * 100) / 100;
    // Tuned so the P95 lands near Symphony's 14.2s. The mean matters far less than the tail here —
    // a tail latency is what an operations reviewer actually asks about.
    const latencySec = Math.round((autoCleared ? 11.8 : panel ? 13.6 : 12.7) * 10 + (runSeed % 19)) / 10;

    return {
      authId: c.authId, member: c.member, lob: lobOf(c.authId), procedure: c.procedure,
      reviewer, scoredDate, decidedDate,
      workflowVersion: PRODUCTION_CONFIG.workflow,
      bundle: PRODUCTION_CONFIG.bundle,
      model: PRODUCTION_CONFIG.model,
      criteriaSet: `${c.procedure} — criteria set v${2 + (n % 3)}.0`,
      recommendation: lowConfidence ? 'Escalate' : agreed ? (finalDecision as AiRecommendation) : otherDecision(finalDecision, n),
      confidence, band, finalDecision, agreed, outcome,
      overrideReason: outcome === 'Overridden' ? overrideReasonFor(c, band) : null,
      overriddenBy: outcome === 'Overridden' ? c.nurse : null,
      autoCleared, pended, pendReason,
      agentsCompleted: AGENTS.length, agentsTotal: AGENTS.length,
      modelsUsed, panel, converged, groundedMet, groundedTotal, grounded, flags,
      tokens, cost, latencySec,
    };
  });
}

export const AI_DECISIONS: AiDecisionRecord[] = buildAiDecisions(CASE_POOL);

export function aiScope(lob?: string, withinDays?: number): AiDecisionRecord[] {
  return AI_DECISIONS.filter((r) => {
    if (lob && lob !== 'all' && r.lob !== lob) return false;
    if (withinDays !== undefined) {
      const d = Math.round((TODAY.getTime() - new Date(`${r.decidedDate}T00:00:00`).getTime()) / 86400000);
      if (d < 0 || d > withinDays) return false;
    }
    return true;
  });
}

export interface AiSummary {
  total: number; reviewed: number; autoCleared: number; autoClearedPct: number;
  agreed: number; decisionAgreementPct: number;
  groundednessPct: number; convergencePct: number; panelRuns: number;
  overridden: number; overrideRatePct: number;
  pended: number; pendedPctOfVolume: number;
  modelAttributable: number;
  avgConfidence: number;
  flagged: number;
  tokens: number; tokensPerCase: number;
  inferenceSpend: number; avgCostPerCase: number;
  p95LatencySec: number; panelRatePct: number;
}
export function aiSummary(rows: AiDecisionRecord[]): AiSummary {
  const reviewed = rows.filter((r) => !r.autoCleared);
  const agreed = rows.filter((r) => r.agreed).length;
  const overridden = rows.filter((r) => r.outcome === 'Overridden');
  const panelRuns = rows.filter((r) => r.panel);
  const tokens = rows.reduce((s, r) => s + r.tokens, 0);
  const spend = rows.reduce((s, r) => s + r.cost, 0);
  // P95, not the mean — a tail latency is what an operations reviewer asks about, and it is what
  // Symphony's ML Ops reports.
  const lat = rows.map((r) => r.latencySec).sort((a, b) => a - b);
  const p95 = lat.length ? lat[Math.min(lat.length - 1, Math.floor(lat.length * 0.95))] : 0;
  return {
    total: rows.length, reviewed: reviewed.length,
    autoCleared: rows.length - reviewed.length, autoClearedPct: pctOf(rows.length - reviewed.length, rows.length),
    agreed, decisionAgreementPct: pctOf(agreed, rows.length),
    groundednessPct: pctOf(rows.filter((r) => r.grounded).length, rows.length),
    convergencePct: pctOf(panelRuns.filter((r) => r.converged).length, panelRuns.length),
    panelRuns: panelRuns.length,
    overridden: overridden.length, overrideRatePct: pctOf(overridden.length, reviewed.length),
    pended: rows.filter((r) => r.pended).length, pendedPctOfVolume: pctOf(rows.filter((r) => r.pended).length, rows.length),
    modelAttributable: overridden.filter((r) => r.overrideReason && MODEL_ATTRIBUTABLE.includes(r.overrideReason)).length,
    avgConfidence: rows.length ? Math.round((rows.reduce((s, r) => s + r.confidence, 0) / rows.length) * 100) / 100 : 0,
    flagged: rows.filter((r) => r.flags.length > 0).length,
    tokens, tokensPerCase: rows.length ? Math.round(tokens / rows.length) : 0,
    inferenceSpend: Math.round(spend * 100) / 100,
    avgCostPerCase: rows.length ? Math.round((spend / rows.length) * 100) / 100 : 0,
    p95LatencySec: p95, panelRatePct: pctOf(panelRuns.length, rows.length),
  };
}

export interface BandRow { band: ConfidenceBand; n: number; pct: number; }
/** Symphony's confidence distribution, on its bands. */
export function confidenceDistribution(rows: AiDecisionRecord[]): BandRow[] {
  return CONFIDENCE_BANDS.map((band) => {
    const n = rows.filter((r) => r.band === band).length;
    return { band, n, pct: pctOf(n, rows.length) };
  });
}

export interface CalibrationRow {
  band: ConfidenceBand; n: number; claimed: number; observed: number; deviation: number;
  adequate: boolean; verdict: 'Calibrated' | 'Overconfident' | 'Underconfident' | 'Insufficient sample';
}
/** The reliability check ML Ops does not do: does a band claiming 0.95 actually agree 95% of the
 *  time? A confidence distribution shows how often the model is sure; only this shows whether being
 *  sure means anything. */
export function calibration(rows: AiDecisionRecord[]): CalibrationRow[] {
  return CONFIDENCE_BANDS.map((band) => {
    const mine = rows.filter((r) => r.band === band);
    const claimed = bandClaim(band);
    const observed = pctOf(mine.filter((r) => r.agreed).length, mine.length);
    const deviation = observed - claimed;
    const adequate = mine.length >= AI_TARGETS.minBandSample;
    const verdict: CalibrationRow['verdict'] = !adequate
      ? 'Insufficient sample'
      : deviation < -AI_TARGETS.maxCalibrationDeviationPts ? 'Overconfident'
      : deviation > AI_TARGETS.maxCalibrationDeviationPts ? 'Underconfident' : 'Calibrated';
    return { band, n: mine.length, claimed, observed, deviation, adequate, verdict };
  });
}

export interface DriftPoint { month: string; n: number; avgConfidence: number; agreementPct: number; groundednessPct: number; }
/** Symphony's drift watch, on the three series it tracks: agreement, groundedness and confidence.
 *  A sustained drop is the early signal to re-test and recalibrate. */
export function drift(rows: AiDecisionRecord[]): DriftPoint[] {
  const byMonth = new Map<string, AiDecisionRecord[]>();
  rows.forEach((r) => {
    const m = r.decidedDate.slice(0, 7);
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m)!.push(r);
  });
  return [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, rs]) => ({
    month, n: rs.length,
    avgConfidence: Math.round((rs.reduce((s, r) => s + r.confidence, 0) / rs.length) * 100) / 100,
    agreementPct: pctOf(rs.filter((r) => r.agreed).length, rs.length),
    groundednessPct: pctOf(rs.filter((r) => r.grounded).length, rs.length),
  }));
}

export interface PendReasonRow { reason: PendReason; count: number; pct: number; }
export function pendMix(rows: AiDecisionRecord[]): PendReasonRow[] {
  const pended = rows.filter((r) => r.pended);
  return PEND_REASONS.map((reason) => {
    const count = pended.filter((r) => r.pendReason === reason).length;
    return { reason, count, pct: pctOf(count, pended.length) };
  }).sort((a, b) => b.count - a.count);
}

export interface FlagRow { flag: InvestigationFlag; count: number; pct: number; }
/** What the gates flagged for investigation — Symphony's three. */
export function flagMix(rows: AiDecisionRecord[]): FlagRow[] {
  return INVESTIGATION_FLAGS.map((flag) => {
    const count = rows.filter((r) => r.flags.includes(flag)).length;
    return { flag, count, pct: pctOf(count, rows.length) };
  }).sort((a, b) => b.count - a.count);
}

export interface OverrideReasonRow { reason: OverrideReason; count: number; modelAttributable: boolean; }
export function overrideReasons(rows: AiDecisionRecord[]): OverrideReasonRow[] {
  const overridden = rows.filter((r) => r.outcome === 'Overridden');
  return OVERRIDE_REASONS
    .map((reason) => ({ reason, count: overridden.filter((r) => r.overrideReason === reason).length, modelAttributable: MODEL_ATTRIBUTABLE.includes(reason) }))
    .sort((a, b) => b.count - a.count);
}

export interface ReviewerAgreementRow { reviewer: string; scored: number; agreed: number; pct: number; overrides: number; adequate: boolean; }
/** Per-clinician agreement with the model. A reviewer below the group is not necessarily wrong —
 *  they may be catching what the model misses — so this reads as a signal to look at, never as a
 *  score to manage someone by. */
export function reviewerConcordance(rows: AiDecisionRecord[]): ReviewerAgreementRow[] {
  const reviewed = rows.filter((r) => !r.autoCleared && r.reviewer !== '—');
  return [...new Set(reviewed.map((r) => r.reviewer))]
    .map((reviewer) => {
      const mine = reviewed.filter((r) => r.reviewer === reviewer);
      const agreed = mine.filter((r) => r.agreed).length;
      return {
        reviewer, scored: mine.length, agreed, pct: pctOf(agreed, mine.length),
        overrides: mine.filter((r) => r.outcome === 'Overridden').length,
        adequate: mine.length >= AI_TARGETS.minReviewerSample,
      };
    })
    .sort((a, b) => a.pct - b.pct);
}

export interface GroupAgreementRow { key: string; n: number; concordancePct: number; overrideRatePct: number; }
export function concordanceBy(rows: AiDecisionRecord[], pick: (r: AiDecisionRecord) => string): GroupAgreementRow[] {
  return [...new Set(rows.map(pick))]
    .map((key) => {
      const mine = rows.filter((r) => pick(r) === key);
      const reviewed = mine.filter((r) => !r.autoCleared);
      return {
        key, n: mine.length,
        concordancePct: pctOf(mine.filter((r) => r.agreed).length, mine.length),
        overrideRatePct: pctOf(mine.filter((r) => r.outcome === 'Overridden').length, reviewed.length),
      };
    })
    .sort((a, b) => a.concordancePct - b.concordancePct);
}

export interface ModelMixRow { modelsUsed: string; panel: boolean; runs: number; tokensPerCase: number; avgCost: number; avgLatencySec: number; agreementPct: number; }
export function modelMix(rows: AiDecisionRecord[]): ModelMixRow[] {
  return [...new Set(rows.map((r) => `${r.modelsUsed}|${r.panel}`))].map((key) => {
    const [modelsUsed, panelFlag] = key.split('|');
    const mine = rows.filter((r) => r.modelsUsed === modelsUsed && String(r.panel) === panelFlag);
    return {
      modelsUsed, panel: panelFlag === 'true', runs: mine.length,
      tokensPerCase: Math.round(mine.reduce((s, r) => s + r.tokens, 0) / mine.length),
      avgCost: Math.round((mine.reduce((s, r) => s + r.cost, 0) / mine.length) * 100) / 100,
      avgLatencySec: Math.round((mine.reduce((s, r) => s + r.latencySec, 0) / mine.length) * 10) / 10,
      agreementPct: pctOf(mine.filter((r) => r.agreed).length, mine.length),
    };
  }).sort((a, b) => b.runs - a.runs);
}
