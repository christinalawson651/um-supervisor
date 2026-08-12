// CM's equivalent of case-pool.ts — a deterministic, RNG-free generated caseload so the Care
// Management module's Workforce & Caseload tab (and, next, its other tabs) has a real dataset to
// aggregate/flag/drill into, instead of the hand-authored 5-row static array it had before.
import { TODAY } from './case-fields';

export interface CareManagerMeta { name: string; discipline: string; }
export const CARE_MANAGERS: CareManagerMeta[] = [
  { name: 'Sara Nguyen, RN', discipline: 'Complex Care' },
  { name: 'David Patel, MSW', discipline: 'Behavioral Health' },
  { name: 'Maria Torres, RN', discipline: 'Transitional Care' },
  { name: 'James Wong, PharmD', discipline: 'Medication Mgmt' },
  { name: 'Angela Ruiz, RN', discipline: 'Complex Care' },
];

export const CM_STAGES = ['New Referral', 'Assessment Scheduled', 'Care Plan Development', 'Active Monitoring', 'Care Plan Review Due'];

export type RiskLevel = 'Low' | 'Moderate' | 'High' | 'Critical';
export type Acuity = 'Low' | 'Medium' | 'High';

export interface CmCaseRec {
  memberId: string;
  member: string;
  dx: string;
  program: string;       // = care manager's discipline
  careManager: string;
  riskScore: number;     // 1.0 - 9.9
  riskLevel: RiskLevel;
  acuity: Acuity;
  cost: number;          // annualized $ estimate
  stage: string;         // one of CM_STAGES
  received: string;      // ISO date — referral/enrollment date
  slaDueDate: string;    // ISO date — next SLA milestone due
  tags: string[];        // 'highRisk' | 'highAcuity' | 'highCost' | 'slaAtRisk'
}

const FIRST = ['James', 'Maria', 'Robert', 'Linda', 'Michael', 'Patricia', 'David', 'Barbara', 'William', 'Elizabeth', 'Richard', 'Jennifer', 'Joseph', 'Susan', 'Thomas', 'Jessica', 'Charles', 'Karen', 'Daniel', 'Nancy', 'Mark', 'Lisa', 'Paul', 'Betty', 'Steven', 'Sandra', 'Andrew', 'Ashley', 'Kenneth', 'Donna'];
const LAST = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson', 'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker'];
const DX_POOL = ['ESRD on dialysis', 'Breast cancer', 'Congestive heart failure', 'High-risk pregnancy', 'COPD, severe', 'Type 2 diabetes', 'Chronic kidney disease', 'Major depressive disorder', 'Asthma, uncontrolled', 'Post-stroke rehabilitation', 'Sickle cell disease', 'Rheumatoid arthritis', 'Hypertension, uncontrolled', 'Substance use disorder', 'Multiple sclerosis', 'Bipolar disorder', 'Cirrhosis', "Parkinson's disease", 'Chronic pain syndrome', 'Obesity, morbid'];

// Risk-score shift per discipline (in score units, not raw seed units) — Complex Care and
// Transitional Care caseloads skew sicker than Medication Mgmt, matching real-world case mix.
// Small values because the base distribution below is already concentrated toward Low/Moderate;
// a larger shift here would push most of a discipline's caseload into High/Critical.
const DISCIPLINE_RISK_BIAS: Record<string, number> = { 'Complex Care': 0.7, 'Transitional Care': 0.3, 'Behavioral Health': 0.2, 'Medication Mgmt': -0.6 };

// Target active caseload per care manager — preserves the same operational scale the CM
// dashboard has always shown (141 total), so this doesn't feel like a discontinuous jump.
const ACTIVE_PER_CM = [34, 28, 31, 22, 26];

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
      out.push({
        memberId: `MBR${(100000 + i * 7).toString().slice(0, 6)}`,
        member: `${FIRST[i % FIRST.length]} ${LAST[(i * 7 + 3) % LAST.length]}`,
        dx: DX_POOL[(i * 5 + 2) % DX_POOL.length],
        program: cm.discipline,
        careManager: cm.name,
        riskScore, riskLevel, acuity, cost, stage, received, slaDueDate, tags,
      });
    }
  });
  return out;
}

export const CM_CASE_POOL: CmCaseRec[] = buildActive();
