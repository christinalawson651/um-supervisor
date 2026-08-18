// CM's equivalent of case-pool.ts — a deterministic, RNG-free generated caseload so the Care
// Management module's Workforce & Caseload tab (and, next, its other tabs) has a real dataset to
// aggregate/flag/drill into, instead of the hand-authored 5-row static array it had before.
import { TODAY, LOBS } from './case-fields';
import { CaseType, CASE_TYPES, ConsentType, CONSENT_TYPES, AssessmentType, ASSESSMENT_TYPES } from './cm-intake';

export interface CareManagerMeta { name: string; discipline: string; team: string; }
export const CARE_MANAGERS: CareManagerMeta[] = [
  { name: 'Sara Nguyen, RN', discipline: 'Complex Care', team: 'Complex Care Team' },
  { name: 'David Patel, MSW', discipline: 'Behavioral Health', team: 'Integrated Care Team' },
  { name: 'Maria Torres, RN', discipline: 'Transitional Care', team: 'Integrated Care Team' },
  { name: 'James Wong', discipline: 'Medication Mgmt', team: 'Pharmacy & Medication Team' },
  { name: 'Angela Ruiz, RN', discipline: 'Complex Care', team: 'Complex Care Team' },
  { name: 'Kevin Brooks, RN', discipline: 'Transitional Care', team: 'Integrated Care Team' },
];

// Case lifecycle stage — the member's overall journey (owned by the Intake & Assessment SLA and
// Care Plan & Outcomes tabs, not Workforce & Caseload). Kept here as shared infra for when those
// tabs get the same treatment; Workforce & Caseload no longer renders cards from this.
export const CM_STAGES = ['Newly Accepted', 'Assessment Scheduled', 'Care Plan Development', 'Active Monitoring', 'Care Plan Review Due'];

// Operational work queues — typical CM staffing queues: where actionable, unclaimed work is
// sitting right now, independent of a member's overall lifecycle stage. This is what
// Workforce & Caseload actually manages (staffing/workload), same role UM's 7 auth queues play.
export const CM_QUEUES = ['New Referral Queue', 'Outreach Queue', 'Reassessment Queue', 'Escalation Queue', 'Discharge Follow-Up Queue', 'Documentation Queue'];

export type RiskLevel = 'Low' | 'Moderate' | 'High' | 'Critical';
export type Acuity = 'Low' | 'Medium' | 'High';

// Care Plan & Outcomes vocabulary — a care plan is modeled as fields directly on CmCaseRec (one
// plan per case, matching this app's existing "flat fields, not a separate historical entity"
// convention for consent/assessment/outreach) rather than a separate CarePlanRec collection. A
// case that's `Closed` still keeps its plan's dates/goals visible (read-only history), same
// pattern as a Declined/Accepted referral staying visible after its decision.
export type CarePlanStatus = 'Open' | 'Closed';
export type GoalStatus = 'Not Started' | 'In Progress' | 'At Risk' | 'Achieved';
// Length 3 (not 4) is deliberate — distinct from GoalStatus and every other length-4 field on this
// record (lob, caseType, consentType, assessmentType) so a plain affine function of `i` can't
// bijection-correlate intervention coverage with any of them the way the original LOB bug did.
export type InterventionStatus = 'None' | 'Active' | 'Completed';
export interface CarePlanGoal { id: string; description: string; status: GoalStatus; interventionStatus: InterventionStatus; }

// Which authored template built this plan — 'Custom / Other' means it was hand-built rather than
// started from one of the condition-specific standard templates. Length 5 (not 4) so a plain
// affine function of `i` can't bijection-correlate template choice with lob/caseType/consentType/
// assessmentType, same guard as InterventionStatus's length-3 choice above.
export type CarePlanTemplate = 'CHF Standard' | 'Diabetes Standard' | 'COPD Standard' | 'Behavioral Health Standard' | 'Custom / Other';
export const CARE_PLAN_TEMPLATES: CarePlanTemplate[] = ['CHF Standard', 'Diabetes Standard', 'COPD Standard', 'Behavioral Health Standard', 'Custom / Other'];

// How this case's CURRENT care manager came to own it — independent of whether it has an
// active work item queued right now. 'Queue Draw' = pulled from a shared queue; the two Direct
// variants never sat in a shared queue at all (Smart = system/AI routing rule, Manual = a
// supervisor or intake coordinator hand-picked the care manager).
export type AssignmentMethod = 'Queue Draw' | 'Direct — Smart' | 'Direct — Manual';

export interface CmCaseRec {
  memberId: string;
  member: string;
  dx: string;
  lob: string;            // one of LOBS — so the shared top-bar LOB filter has something real to scope by
  program: string;       // = care manager's discipline
  careManager: string;
  riskScore: number;     // 1.0 - 9.9
  riskLevel: RiskLevel;
  acuity: Acuity;
  cost: number;          // annualized $ estimate
  stage: string;         // one of CM_STAGES — lifecycle, not workforce queue
  received: string;      // ISO date — referral/enrollment date
  slaDueDate: string;    // ISO date — next SLA milestone due
  queue: string | null;  // one of CM_QUEUES, or null = no actionable item queued right now
  queueAgeH: number;     // hours sitting in that queue — only meaningful when queue is set
  queueBreached: boolean;
  assignmentMethod: AssignmentMethod;
  caseType: CaseType;
  consentType: ConsentType;
  consentExpiresDate: string;   // ISO date — consentAtRisk() in cm-intake.ts bands this
  assessmentType: AssessmentType;
  assessmentTatDays: number;    // days from assignment to completed assessment — tatAdherent() bands this
  outreachAttempts: number;
  outreachSuccessful: boolean;
  utrLetterSent: boolean;       // sent once outreach repeatedly fails to reach the member
  tags: string[];        // 'highRisk' | 'highAcuity' | 'highCost' | 'slaAtRisk'
  // ---- Care Plan & Outcomes ----
  carePlanStatus: CarePlanStatus;
  carePlanOpenedDate: string;          // ISO date
  carePlanClosedDate: string | null;   // ISO date — set only when carePlanStatus === 'Closed'
  carePlanReviewDate: string;          // ISO date — next review due; distinct from slaDueDate (that's the shared intake-SLA milestone, this is care-plan-cadence specific)
  carePlanReopened: boolean;           // reopened at least once after a prior closure
  memberParticipation: boolean;        // documented member agreement/participation on file
  goals: CarePlanGoal[];               // empty array = "no goals documented"
  carePlanTemplate: CarePlanTemplate;
  smartLanguageCompliant: boolean;     // goal/intervention language documented meets SMART criteria
}

const FIRST = ['James', 'Maria', 'Robert', 'Linda', 'Michael', 'Patricia', 'David', 'Barbara', 'William', 'Elizabeth', 'Richard', 'Jennifer', 'Joseph', 'Susan', 'Thomas', 'Jessica', 'Charles', 'Karen', 'Daniel', 'Nancy', 'Mark', 'Lisa', 'Paul', 'Betty', 'Steven', 'Sandra', 'Andrew', 'Ashley', 'Kenneth', 'Donna'];
const LAST = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson', 'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker'];
const DX_POOL = ['ESRD on dialysis', 'Breast cancer', 'Congestive heart failure', 'High-risk pregnancy', 'COPD, severe', 'Type 2 diabetes', 'Chronic kidney disease', 'Major depressive disorder', 'Asthma, uncontrolled', 'Post-stroke rehabilitation', 'Sickle cell disease', 'Rheumatoid arthritis', 'Hypertension, uncontrolled', 'Substance use disorder', 'Multiple sclerosis', 'Bipolar disorder', 'Cirrhosis', "Parkinson's disease", 'Chronic pain syndrome', 'Obesity, morbid'];
const GOAL_DESCRIPTIONS = ['Medication adherence', 'Daily weight monitoring', 'Smoking cessation', 'Fluid management adherence', 'Post-discharge follow-up visit', 'Diabetes self-management education', 'Fall prevention', 'Depression screening follow-up'];

// Risk-score shift per discipline (in score units, not raw seed units) — Complex Care and
// Transitional Care caseloads skew sicker than Medication Mgmt, matching real-world case mix.
// Small values because the base distribution below is already concentrated toward Low/Moderate;
// a larger shift here would push most of a discipline's caseload into High/Critical.
const DISCIPLINE_RISK_BIAS: Record<string, number> = { 'Complex Care': 0.7, 'Transitional Care': 0.3, 'Behavioral Health': 0.2, 'Medication Mgmt': -0.6 };

// Target active caseload per care manager — preserves the same operational scale the CM
// dashboard has always shown (now 161 total with Kevin Brooks added to Integrated Care Team,
// so PTO redistribution has a real 3-person team to split across, not just one teammate).
const ACTIVE_PER_CM = [34, 28, 31, 22, 26, 20];

function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }
function addDays(base: Date, days: number): Date { const d = new Date(base); d.setDate(d.getDate() + days); return d; }

function buildActive(): CmCaseRec[] {
  const out: CmCaseRec[] = [];
  let i = 0;
  CARE_MANAGERS.forEach((cm, cmIdx) => {
    const count = ACTIVE_PER_CM[cmIdx];
    for (let j = 0; j < count; j++, i++) {
      const seedRaw = (i * 37 + 11) % 100;
      // Power transform (not a uniform 1-9.9 spread) so the baseline caseload concentrates in
      // Low/Moderate with a lighter tail into High/Critical — matches real case-mix shape and
      // keeps the Needs-Attention-style flag rates a minority, not close to half the caseload.
      const base = 1 + Math.pow(seedRaw / 100, 1.8) * 9;
      const bias = DISCIPLINE_RISK_BIAS[cm.discipline] ?? 0;
      const riskScore = Math.round(Math.max(1, Math.min(9.9, base + bias)) * 10) / 10;
      const riskLevel: RiskLevel = riskScore >= 8 ? 'Critical' : riskScore >= 6.5 ? 'High' : riskScore >= 4 ? 'Moderate' : 'Low';
      const acuity: Acuity = riskScore >= 7.5 ? 'High' : riskScore >= 5 ? 'Medium' : 'Low';
      const cost = Math.round(3000 + riskScore * 9500 + (seedRaw % 41) * 850);
      // LOBS and CASE_TYPES/CONSENT_TYPES are both length 4, so a plain affine function of `i`
      // alone would be a pure bijection of i%4 — perfectly correlating LOB with those fields
      // (e.g. every Medicaid case landing on the same case type). The `Math.floor(i/4)` term
      // shifts the mapping every 4 records so LOB actually varies within each case-type/consent
      // group instead of tracking it 1:1.
      const lob = LOBS[(i * 17 + Math.floor(i / 4) * 7 + 4) % LOBS.length];
      const stage = CM_STAGES[(i * 3 + cmIdx) % CM_STAGES.length];
      const receivedDaysAgo = 5 + (seedRaw % 240);
      const received = isoDate(addDays(TODAY, -receivedDaysAgo));
      // Overdue is a deliberate minority (~7.5%) — matches the low single-digit SLA-at-risk rates
      // this dashboard has always shown, not a blanket third of the caseload.
      const slaOffset = ((i * 13 + 5) % 40) - 3;
      const slaDueDate = isoDate(addDays(TODAY, slaOffset));
      const tags: string[] = [];
      if (riskLevel === 'High' || riskLevel === 'Critical') tags.push('highRisk');
      if (acuity === 'High') tags.push('highAcuity');
      if (cost >= 100000) tags.push('highCost');
      if (slaOffset < 0) tags.push('slaAtRisk');
      // A minority of the caseload has an actionable item queued right now — most members are
      // steady-state active monitoring with nothing currently waiting on staff.
      const hasQueueWork = (seedRaw % 100) < 45;
      const queue = hasQueueWork ? CM_QUEUES[(i * 5 + 3) % CM_QUEUES.length] : null;
      const queueAgeH = 6 + (seedRaw % 90);
      const queueBreached = hasQueueWork && i % 17 === 0;
      // How this member's current care manager came to own them, not whether work is queued
      // right now — most caseloads build up from the shared intake queue over time (55%), with a
      // system routing rule placing a sizable minority directly (30%) and a supervisor/intake
      // coordinator hand-assigning the rest (15%).
      const methodSeed = (i * 53 + 17) % 100;
      const assignmentMethod: AssignmentMethod = methodSeed < 55 ? 'Queue Draw' : methodSeed < 85 ? 'Direct — Smart' : 'Direct — Manual';
      const caseType = CASE_TYPES[(i * 7 + 2) % CASE_TYPES.length];
      const consentType = CONSENT_TYPES[(i * 9 + 5) % CONSENT_TYPES.length];
      // A minority of consents are due for renewal soon/overdue — same "minority at risk" shape as
      // SLA/queue breach rates elsewhere, not a blanket third of the caseload.
      const consentSeed = (i * 19 + 3) % 100;
      const consentExpiresDate = isoDate(addDays(TODAY, consentSeed < 12 ? -((consentSeed * 3) % 20) : 15 + (consentSeed % 320)));
      const assessmentType = ASSESSMENT_TYPES[(i * 11 + 6) % ASSESSMENT_TYPES.length];
      // TAT mostly lands within the 5-day adherence window; a minority runs long.
      const tatSeed = (i * 29 + 8) % 100;
      const assessmentTatDays = tatSeed < 80 ? 1 + (tatSeed % 5) : 6 + (tatSeed % 9);
      const outreachAttempts = 1 + (seedRaw % 5);
      const outreachSuccessful = outreachAttempts <= 3;
      const utrLetterSent = !outreachSuccessful && i % 3 === 0;
      // Care Plan & Outcomes — opened shortly after the case's own received date; most plans are
      // still Open, a real minority (~22%) already Closed, so Closure Rate/Duration have something
      // beyond zero to report on.
      const cpSeed = (i * 41 + 19) % 100;
      const carePlanStatus: CarePlanStatus = cpSeed < 78 ? 'Open' : 'Closed';
      const openedDaysAgo = Math.max(1, receivedDaysAgo - (2 + (seedRaw % 4)));
      const carePlanOpenedDate = isoDate(addDays(TODAY, -openedDaysAgo));
      const durationDays = 20 + ((i * 31 + 7) % 180); // closed plans ran 20-200 days
      const carePlanClosedDate = carePlanStatus === 'Closed' ? isoDate(addDays(TODAY, -Math.max(0, openedDaysAgo - durationDays))) : null;
      // Review-date offset: a deliberate minority land overdue (<0) — same "minority at risk"
      // shape as consentExpiresDate/slaOffset above, not a blanket third of the caseload.
      const reviewSeed = (i * 23 + 9) % 100;
      const reviewOffset = reviewSeed < 15 ? -(1 + (reviewSeed % 12)) : (reviewSeed % 45) - 5;
      const carePlanReviewDate = isoDate(addDays(TODAY, reviewOffset));
      const carePlanReopened = (i * 47 + 13) % 100 < 9;
      const memberParticipation = (i * 59 + 21) % 100 < 85;
      // A real minority of plans have no goals documented at all; the rest carry 1-4.
      const goalCountSeed = (i * 61 + 27) % 100;
      const goalCount = goalCountSeed < 8 ? 0 : 1 + (goalCountSeed % 4);
      const goals: CarePlanGoal[] = Array.from({ length: goalCount }, (_, gi) => {
        const gStatusSeed = (i * 7 + gi * 5 + 3) % 4;
        const status = (['Not Started', 'In Progress', 'At Risk', 'Achieved'] as GoalStatus[])[gStatusSeed];
        // Intervention coverage gap is a real minority (~10%), not half the goal list.
        const iSeed = (i * 17 + gi * 7 + 2) % 100;
        const interventionStatus: InterventionStatus = iSeed < 10 ? 'None' : iSeed < 55 ? 'Active' : 'Completed';
        return { id: `${i}-G${gi}`, description: GOAL_DESCRIPTIONS[(i * 3 + gi * 2 + 1) % GOAL_DESCRIPTIONS.length], status, interventionStatus };
      });
      // Decorrelated with the length-4 fields above via the floor(i/5) term, same guard as lob/caseType.
      const carePlanTemplate = CARE_PLAN_TEMPLATES[(i * 19 + Math.floor(i / 5) * 3 + 4) % CARE_PLAN_TEMPLATES.length];
      // SMART-language documentation is a quality gap, not a majority failure — most plans meet it.
      const smartLanguageCompliant = (i * 31 + 17) % 100 >= 24;
      out.push({
        memberId: `MBR${(100000 + i * 7).toString().slice(0, 6)}`,
        member: `${FIRST[i % FIRST.length]} ${LAST[(i * 7 + 3) % LAST.length]}`,
        dx: DX_POOL[(i * 5 + 2) % DX_POOL.length],
        lob, program: cm.discipline,
        careManager: cm.name,
        riskScore, riskLevel, acuity, cost, stage, received, slaDueDate, queue, queueAgeH, queueBreached, assignmentMethod,
        caseType, consentType, consentExpiresDate, assessmentType, assessmentTatDays, outreachAttempts, outreachSuccessful, utrLetterSent, tags,
        carePlanStatus, carePlanOpenedDate, carePlanClosedDate, carePlanReviewDate, carePlanReopened, memberParticipation, goals,
        carePlanTemplate, smartLanguageCompliant,
      });
    }
  });
  return out;
}

export const CM_CASE_POOL: CmCaseRec[] = buildActive();
