// AI oversight — the evidence layer behind "how do you know the model is right, and what happens
// when a clinician disagrees with it?"
//
// This is deliberately separate from the operational AI surfaces elsewhere in the app (the
// next-best-action cards on the AI / NextGen tabs). Those help a supervisor work the queue. This
// file answers the audit question instead: for every determination the model touched, what did it
// recommend, how confident was it, what did the clinician actually decide, and when they diverged,
// why. Everything on the AI Oversight tab and in the AI Oversight report is computed from here.
//
// Same deterministic, RNG-free construction as the rest of the demo data: the same authorization
// always produces the same recommendation, score and outcome, so the calibration curve and the
// concordance rate are identical on every load.
import { CASE_POOL, CaseRec, Decision } from './case-pool';
import { TODAY, lobOf, MD_REVIEWERS } from './case-fields';

export type AiRecommendation = 'Approved' | 'Denied' | 'Partial' | 'Escalate';
/** Outcome vocabulary is Symphony's, not this app's invention: a determination is auto-cleared,
 *  accepted by the reviewer, overridden by them, or pended for a human with a reason. Two audit
 *  surfaces describing the same run in different words is the thing that loses an auditor.
 *
 *  Pending is deliberately NOT one of these. In Symphony a pend is a queue state — the flow stopped
 *  and asked for a human — and the determination still resolves afterwards. Modelling it as a fourth
 *  outcome made the two mutually exclusive, so a pended case could never also be recorded as
 *  overridden, and the pend-reason mix came out with an empty category. It is its own attribute. */
export type AiOutcome = 'Auto-cleared' | 'Accepted' | 'Overridden';

/** Why a determination is waiting on a human — Symphony's Monitor taxonomy. */
export type PendReason = 'Potential denial' | 'Low confidence' | 'Insufficient info';
export const PEND_REASONS: PendReason[] = ['Potential denial', 'Low confidence', 'Insufficient info'];
export type ConfidenceBand = '<70' | '70–79' | '80–89' | '90–94' | '95+';
export const CONFIDENCE_BANDS: ConfidenceBand[] = ['<70', '70–79', '80–89', '90–94', '95+'];

/** Structured override reasons. Free text is not enough for an auditor: a reason code is what lets
 *  you tell "the model is wrong about this population" from "the clinical picture changed after
 *  the model scored it", and only the first of those is a model problem. */
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
/** Which reasons indicate a MODEL problem rather than a legitimate clinical divergence. This split
 *  is the whole point of coding the reason — an override rate on its own says nothing. */
export const MODEL_ATTRIBUTABLE: OverrideReason[] = [
  'Criteria not applicable to this presentation',
  'Comorbidity not weighted by the model',
];

/** The org's own governance thresholds. Not a regulatory number — there isn't one yet for
 *  machine-influenced UM decisions — so these are the lines this program committed to and is
 *  measured against, which is what an AI-governance reviewer asks to see. */
export const AI_TARGETS = {
  concordancePct: 90,
  maxCalibrationDeviationPts: 5,
  maxOverrideRatePct: 15,
  minBandSample: 20,
};

export interface AiDecisionRecord {
  authId: string;
  member: string;
  lob: string;
  procedure: string;
  reviewer: string;              // the clinician who owned the determination
  scoredDate: string;            // ISO — when the model scored it
  decidedDate: string;           // ISO — when the determination was recorded
  modelVersion: string;
  criteriaSet: string;           // the policy/criteria the model applied, with version
  recommendation: AiRecommendation;
  confidence: number;            // 0–100
  band: ConfidenceBand;
  finalDecision: Decision;
  concordant: boolean;           // recommendation matched the final determination
  outcome: AiOutcome;
  overrideReason: OverrideReason | null;
  overriddenBy: string | null;
  autoCleared: boolean;
  ruleVersion: string | null;    // set only for auto-cleared determinations
  pended: boolean;
  pendReason: PendReason | null;
  // ---- agentic run telemetry, mirroring Symphony's run ledger ----
  agentsCompleted: number;
  agentsTotal: number;
  modelsUsed: string;            // e.g. "sonnet x4 · haiku · opus"
  panel: boolean;                // a multi-model panel adjudicated this one
  tokens: number;
  cost: number;                  // USD, inference spend for the run
  latencySec: number;
}

function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }
function addDays(base: Date, days: number): Date { const d = new Date(base); d.setDate(d.getDate() + days); return d; }
function capToday(d: Date): Date { return d.getTime() > TODAY.getTime() ? TODAY : d; }
function pctOf(n: number, d: number): number { return d ? Math.round((n / d) * 100) : 0; }

export function bandOf(confidence: number): ConfidenceBand {
  if (confidence < 70) return '<70';
  if (confidence < 80) return '70–79';
  if (confidence < 90) return '80–89';
  if (confidence < 95) return '90–94';
  return '95+';
}
/** Midpoint the band is effectively claiming, used as the predicted value on the calibration
 *  curve. A band claiming 92% should be right about 92% of the time. */
export function bandClaim(b: ConfidenceBand): number {
  return b === '<70' ? 65 : b === '70–79' ? 75 : b === '80–89' ? 85 : b === '90–94' ? 92 : 97;
}

/** The model's version history, so a determination can be tied to the exact model that produced
 *  it — the same requirement configuration changes already carry. */
export const MODEL_VERSIONS = [
  { version: 'clinical-rec v4.2', from: '2026-05-18', to: null as string | null, note: 'Current — retrained on 18 months of decided authorizations' },
  { version: 'clinical-rec v4.1', from: '2026-01-06', to: '2026-05-17', note: 'Added comorbidity weighting for cardiac and oncology' },
  { version: 'clinical-rec v4.0', from: '2025-08-11', to: '2026-01-05', note: 'First release scoring inpatient alongside outpatient' },
];
function modelVersionFor(iso: string): string {
  const v = MODEL_VERSIONS.find((m) => iso >= m.from && (m.to === null || iso <= m.to));
  return v?.version ?? MODEL_VERSIONS[MODEL_VERSIONS.length - 1].version;
}

/** A spread function over the case's full identity rather than the two digits of its auth id.
 *  Confidence bands are themselves a permutation of those two digits, so anything else derived from
 *  them lands in the same clusters — which is how a band ended up at a flat 100%. Hashing the
 *  procedure and member in as well gives each band a sample that actually scatters. */
function spread100(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) h = ((h ^ seed.charCodeAt(i)) * 0x01000193) >>> 0;
  return h % 100;
}

function otherDecision(d: Decision, seed: number): AiRecommendation {
  const pool: AiRecommendation[] = (['Approved', 'Denied', 'Partial'] as AiRecommendation[]).filter((x) => x !== d);
  return pool[seed % pool.length];
}

/** Why a clinician overrode. Attribution is not random: overrides in the over-confident band skew
 *  model-attributable, because that is precisely what over-confidence looks like on the floor — the
 *  model stating a high score on a case whose criteria do not really fit. Elsewhere the reasons are
 *  spread, and most are legitimate clinical divergence rather than a model defect. */
function overrideReasonFor(c: CaseRec, band: ConfidenceBand): OverrideReason {
  const h = spread100(`${c.authId}|${c.member}|reason`);
  if (band === '95+' && h % 3 < 2) return MODEL_ATTRIBUTABLE[h % MODEL_ATTRIBUTABLE.length];
  return OVERRIDE_REASONS[h % OVERRIDE_REASONS.length];
}

function buildAiDecisions(cases: CaseRec[]): AiDecisionRecord[] {
  return cases.filter((c) => c.phase === 'decided').map((c): AiDecisionRecord => {
    const n = Number(c.authId.slice(-2));
    const spread = (n * 37 + 11) % 100;
    const autoCleared = c.tags.includes('auto');

    // Auto-cleared determinations only fire when the model is very sure. Reviewed cases are right-skewed
    // with a real low tail, which is what a production scorer actually looks like — most cases easy,
    // a small band genuinely hard.
    const confidence = autoCleared
      ? 96 + (n % 4)
      : spread < 6 ? 66 + (spread % 4)
      : spread < 18 ? 74 + (spread % 6)
      : 84 + (spread % 16);
    // Each retrain moved the scorer forward a little, so the older model eras score marginally
    // lower — otherwise mean confidence is a flat line across every month, which reads as synthetic.
    const era = modelVersionFor(isoDate(capToday(addDays(new Date(`${c.submitted}T00:00:00`), 1))));
    const confidenceAdj = era.endsWith('v4.0') ? -3 : era.endsWith('v4.1') ? -2 : 0;
    const scored = Math.max(60, Math.min(99, confidence + confidenceAdj));
    const band = bandOf(scored);

    // Calibration is the point of this dataset, so agreement is generated against the score rather
    // than independently of it. The shape is deliberately the one real scorers tend to have: modest
    // UNDER-confidence through the middle of the range, and genuine OVER-confidence at the ceiling,
    // where a model is confidently wrong. That gives the tab an actual finding to discuss instead
    // of a clean sweep, and it is the finding that matters — a 97% score you cannot lean on.
    // The 94 ceiling is deliberate: no band should read 100%, because a band that never disagrees
    // is a sign the measurement is broken, not that the model is perfect.
    const claimed = band === '95+' ? scored - 12 : Math.min(94, scored + 6);
    const agreeSeed = spread100(`${c.authId}|${c.procedure}|${c.member}|agree`);
    const concordant = agreeSeed < claimed;

    const submitted = new Date(`${c.submitted}T00:00:00`);
    const scoredDate = isoDate(capToday(addDays(submitted, 1)));
    const decidedDate = isoDate(capToday(addDays(submitted, 3 + (n % 4))));
    const finalDecision = c.decision as Decision;

    // Precedence matters: an auto-cleared determination never had a reviewer, and a pended one is
    // waiting on a human rather than having been accepted or overridden.
    const outcome: AiOutcome = autoCleared ? 'Auto-cleared' : concordant ? 'Accepted' : 'Overridden';

    // Why the flow stopped and asked for a human, in Symphony's taxonomy. A determination can be
    // pended and still end up accepted or overridden — the pend is what happened on the way, not
    // the result. Order matters: a case heading somewhere adverse is flagged as a potential denial
    // even when the score is also soft, because that is what a reviewer needs to know first.
    const adverse = finalDecision === 'Denied' || finalDecision === 'Partial';
    // Precedence is clinical, not cosmetic: a missing document blocks the assessment outright, so
    // it outranks everything; an adverse direction needs a clinician regardless of the score; and a
    // soft score is the residual reason. A reviewed case matching none of the three was routine —
    // it went to a human without the flow flagging anything, so it is not a pend.
    const insufficientInfo = c.tags.includes('rfi') || c.tags.includes('incompleteDoc');
    const lowConfidence = scored < 80;
    const pended = !autoCleared && (insufficientInfo || adverse || lowConfidence);
    const pendReason: PendReason | null = !pended ? null
      : insufficientInfo ? 'Insufficient info'
      : adverse ? 'Potential denial'
      : 'Low confidence';
    const reviewer = autoCleared ? '—' : scored < 70 ? MD_REVIEWERS[n % MD_REVIEWERS.length] : c.nurse;

    // A panel is convened when one pass is not enough — an adverse direction or a soft score. That
    // is what drives the extra model, the extra tokens and the extra cost per case.
    const panel = !autoCleared && (adverse || scored < 85);
    const modelsUsed = autoCleared ? 'sonnet x4 · haiku' : panel ? 'sonnet x4 · haiku · opus' : 'sonnet x4 · haiku';
    const runSeed = spread100(`${c.authId}|${c.member}|run`);
    // Anchored to the volumes Symphony's own run ledger shows: ~36-40k tokens on an auto-cleared
    // case, ~60-65k where a panel is convened, and cost tracking tokens rather than being invented
    // independently of them.
    const tokens = autoCleared ? 35800 + runSeed * 42 : panel ? 58500 + runSeed * 68 : 44200 + runSeed * 55;
    const cost = Math.round((tokens / 1000) * (panel ? 0.0063 : 0.0042) * 100) / 100;
    const latencySec = Math.round((autoCleared ? 13.2 : panel ? 16.9 : 14.8) * 10 + (runSeed % 22)) / 10;

    return {
      authId: c.authId, member: c.member, lob: lobOf(c.authId), procedure: c.procedure,
      reviewer, scoredDate, decidedDate,
      modelVersion: modelVersionFor(scoredDate),
      criteriaSet: `${c.procedure} — criteria set v${2 + (n % 3)}.0`,
      recommendation: pended ? 'Escalate' : concordant ? (finalDecision as AiRecommendation) : otherDecision(finalDecision, n),
      confidence: scored, band, finalDecision, concordant, outcome, pended,
      overrideReason: outcome === 'Overridden' ? overrideReasonFor(c, band) : null,
      overriddenBy: outcome === 'Overridden' ? c.nurse : null,
      autoCleared,
      ruleVersion: autoCleared ? `RULE-AUTOCLEAR-v${3 + (n % 2)}.1` : null,
      pendReason,
      agentsCompleted: 10, agentsTotal: 10,
      modelsUsed, panel, tokens, cost, latencySec,
    };
  });
}

export const AI_DECISIONS: AiDecisionRecord[] = buildAiDecisions(CASE_POOL);

/** Everything the AI Oversight tab reports, in one place so the tab and the report can never
 *  disagree — the same rule the audit rollups follow. */
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
  concordant: number; concordancePct: number;
  overridden: number; overrideRatePct: number;
  pended: number; pendedPctOfVolume: number;
  modelAttributable: number;
  meanConfidence: number;
  // ---- run telemetry, in Symphony's terms ----
  tokens: number; tokensPerCase: number;
  inferenceSpend: number; avgCostPerCase: number;
  avgLatencySec: number; panelRatePct: number;
}
export function aiSummary(rows: AiDecisionRecord[]): AiSummary {
  const reviewed = rows.filter((r) => !r.autoCleared);
  const concordant = rows.filter((r) => r.concordant).length;
  const overridden = rows.filter((r) => r.outcome === 'Overridden');
  const pended = rows.filter((r) => r.pended).length;
  const tokens = rows.reduce((s, r) => s + r.tokens, 0);
  const spend = rows.reduce((s, r) => s + r.cost, 0);
  return {
    total: rows.length, reviewed: reviewed.length,
    autoCleared: rows.length - reviewed.length, autoClearedPct: pctOf(rows.length - reviewed.length, rows.length),
    concordant, concordancePct: pctOf(concordant, rows.length),
    overridden: overridden.length, overrideRatePct: pctOf(overridden.length, reviewed.length),
    pended, pendedPctOfVolume: pctOf(pended, rows.length),
    modelAttributable: overridden.filter((r) => r.overrideReason && MODEL_ATTRIBUTABLE.includes(r.overrideReason)).length,
    meanConfidence: rows.length ? Math.round(rows.reduce((s, r) => s + r.confidence, 0) / rows.length) : 0,
    tokens, tokensPerCase: rows.length ? Math.round(tokens / rows.length) : 0,
    inferenceSpend: Math.round(spend * 100) / 100,
    avgCostPerCase: rows.length ? Math.round((spend / rows.length) * 100) / 100 : 0,
    avgLatencySec: rows.length ? Math.round((rows.reduce((s, r) => s + r.latencySec, 0) / rows.length) * 10) / 10 : 0,
    panelRatePct: pctOf(rows.filter((r) => r.panel).length, rows.length),
  };
}

export interface PendReasonRow { reason: PendReason; count: number; pct: number; }
/** What is waiting on a human, and why — the same breakdown Symphony's Monitor leads with. */
export function pendMix(rows: AiDecisionRecord[]): PendReasonRow[] {
  const pended = rows.filter((r) => r.pended);
  return PEND_REASONS.map((reason) => {
    const count = pended.filter((r) => r.pendReason === reason).length;
    return { reason, count, pct: pctOf(count, pended.length) };
  }).sort((a, b) => b.count - a.count);
}

export interface ModelMixRow { modelsUsed: string; panel: boolean; runs: number; tokensPerCase: number; avgCost: number; avgLatencySec: number; concordancePct: number; }
/** Cost and agreement by the model set that actually ran. A panel costs more per case; this is
 *  where you see whether it buys anything. */
export function modelMix(rows: AiDecisionRecord[]): ModelMixRow[] {
  return [...new Set(rows.map((r) => `${r.modelsUsed}|${r.panel}`))].map((key) => {
    const [modelsUsed, panelFlag] = key.split('|');
    const mine = rows.filter((r) => r.modelsUsed === modelsUsed && String(r.panel) === panelFlag);
    return {
      modelsUsed, panel: panelFlag === 'true', runs: mine.length,
      tokensPerCase: Math.round(mine.reduce((s, r) => s + r.tokens, 0) / mine.length),
      avgCost: Math.round((mine.reduce((s, r) => s + r.cost, 0) / mine.length) * 100) / 100,
      avgLatencySec: Math.round((mine.reduce((s, r) => s + r.latencySec, 0) / mine.length) * 10) / 10,
      concordancePct: pctOf(mine.filter((r) => r.concordant).length, mine.length),
    };
  }).sort((a, b) => b.runs - a.runs);
}

export interface CalibrationRow {
  band: ConfidenceBand; n: number; claimed: number; observed: number; deviation: number;
  adequate: boolean; verdict: 'Calibrated' | 'Overconfident' | 'Underconfident' | 'Insufficient sample';
}
/** The reliability check: does a band claiming 92% actually agree 92% of the time? A deviation
 *  beyond the governance tolerance is the evidence that a confidence score is or isn't trustworthy
 *  — which is exactly what "what evidence supports their reliability" is asking for. */
export function calibration(rows: AiDecisionRecord[]): CalibrationRow[] {
  return CONFIDENCE_BANDS.map((band) => {
    const mine = rows.filter((r) => r.band === band);
    const claimed = bandClaim(band);
    const observed = pctOf(mine.filter((r) => r.concordant).length, mine.length);
    const deviation = observed - claimed;
    const adequate = mine.length >= AI_TARGETS.minBandSample;
    const verdict: CalibrationRow['verdict'] = !adequate
      ? 'Insufficient sample'
      : deviation < -AI_TARGETS.maxCalibrationDeviationPts ? 'Overconfident'
      : deviation > AI_TARGETS.maxCalibrationDeviationPts ? 'Underconfident' : 'Calibrated';
    return { band, n: mine.length, claimed, observed, deviation, adequate, verdict };
  });
}

export interface DriftPoint { month: string; n: number; meanConfidence: number; concordancePct: number; modelVersion: string; }
/** Concordance and mean confidence by month. Drift shows up here before it shows up anywhere a
 *  member would notice it. */
export function drift(rows: AiDecisionRecord[]): DriftPoint[] {
  const byMonth = new Map<string, AiDecisionRecord[]>();
  rows.forEach((r) => {
    const m = r.decidedDate.slice(0, 7);
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m)!.push(r);
  });
  return [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, rs]) => ({
    month, n: rs.length,
    meanConfidence: Math.round(rs.reduce((s, r) => s + r.confidence, 0) / rs.length),
    concordancePct: pctOf(rs.filter((r) => r.concordant).length, rs.length),
    modelVersion: modelVersionFor(rs[0].decidedDate),
  }));
}

export interface OverrideReasonRow { reason: OverrideReason; count: number; modelAttributable: boolean; }
export function overrideReasons(rows: AiDecisionRecord[]): OverrideReasonRow[] {
  const overridden = rows.filter((r) => r.outcome === 'Overridden');
  return OVERRIDE_REASONS
    .map((reason) => ({ reason, count: overridden.filter((r) => r.overrideReason === reason).length, modelAttributable: MODEL_ATTRIBUTABLE.includes(reason) }))
    .sort((a, b) => b.count - a.count);
}

export interface ReviewerConcordanceRow { reviewer: string; scored: number; agreed: number; pct: number; overrides: number; adequate: boolean; }
/** Per-clinician agreement with the model. A reviewer far below the group isn't necessarily wrong —
 *  they may be catching what the model misses — which is why this reads as a signal to look at,
 *  never as a score to manage someone by. */
export function reviewerConcordance(rows: AiDecisionRecord[]): ReviewerConcordanceRow[] {
  const reviewed = rows.filter((r) => !r.autoCleared && r.reviewer !== '—');
  return [...new Set(reviewed.map((r) => r.reviewer))]
    .map((reviewer) => {
      const mine = reviewed.filter((r) => r.reviewer === reviewer);
      const agreed = mine.filter((r) => r.concordant).length;
      return {
        reviewer, scored: mine.length, agreed, pct: pctOf(agreed, mine.length),
        overrides: mine.filter((r) => r.outcome === 'Overridden').length,
        adequate: mine.length >= AI_TARGETS.minBandSample,
      };
    })
    .sort((a, b) => a.pct - b.pct);
}

export interface GroupConcordanceRow { key: string; n: number; concordancePct: number; overrideRatePct: number; }
export function concordanceBy(rows: AiDecisionRecord[], pick: (r: AiDecisionRecord) => string): GroupConcordanceRow[] {
  return [...new Set(rows.map(pick))]
    .map((key) => {
      const mine = rows.filter((r) => pick(r) === key);
      const reviewed = mine.filter((r) => !r.autoCleared);
      return {
        key, n: mine.length,
        concordancePct: pctOf(mine.filter((r) => r.concordant).length, mine.length),
        overrideRatePct: pctOf(mine.filter((r) => r.outcome === 'Overridden').length, reviewed.length),
      };
    })
    .sort((a, b) => a.concordancePct - b.concordancePct);
}
