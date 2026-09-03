// A generated pool of authorization records that backs every metric drill-down.
// Deterministic (no RNG) so the demo shows the same data on every load.
import { ageH } from './case-fields';
import { TODAY } from './clock';

export type Decision = 'Approved' | 'Denied' | 'Partial' | 'Pending';

export interface CaseRec {
  authId: string;
  member: string;
  procedure: string;
  serviceType: 'Inpatient' | 'Outpatient' | 'Behavioral';
  decision: Decision;
  status: string;
  nurse: string;
  provider: string;
  submitted: string;
  tatH: number;
  cost: number;
  phase: 'pending' | 'decided';
  tags: string[];
}

// same roster used on the Provider & Network Insights tab, so a case's provider
// always matches a name a supervisor would recognize from that tab
export const PROVIDERS = [
  'Dr. Sarah Mitchell', 'Dr. James Parker', 'Dr. Emily Chen',
  'Memorial Orthopedic Group', 'Regional Heart Center', 'Coastal Neurology Associates',
];
export const NPI_BY_PROVIDER: Record<string, string> = {
  'Dr. Sarah Mitchell': '1234567890', 'Dr. James Parker': '0987654321', 'Dr. Emily Chen': '1122334455',
  'Memorial Orthopedic Group': '5544332211', 'Regional Heart Center': '6677889900', 'Coastal Neurology Associates': '1133557799',
};

const FIRST = ['Patricia', 'Michael', 'Jennifer', 'Robert', 'Susan', 'Daniel', 'Maria', 'James', 'Sana', 'Angela',
  'Carlos', 'Nicole', 'Linda', 'Sean', 'Rina', 'Thomas', 'Katherine', 'Antonio', 'Beth', 'Hector',
  'Sarah', 'Grace', 'David', 'Emily', 'John', 'Olivia', 'Noah', 'Emma', 'Liam', 'Ava'];
const LAST = ['Adams', 'Brown', 'Clark', 'Davis', 'Evans', 'Foster', 'Garcia', 'Harris', 'Ibrahim', 'Johnson',
  'Kim', 'Lopez', 'Martin', 'Nguyen', 'O’Brien', 'Patel', 'Quinn', 'Reed', 'Silva', 'Thompson',
  'Underwood', 'Valdez', 'Williams', 'Young', 'Zhang', 'Bennett', 'Carter', 'Diaz', 'Ellis', 'Fisher'];

interface Proc { name: string; type: CaseRec['serviceType']; cost: number; tat: number; guideline: string; }
const PROCS: Proc[] = [
  { name: 'Total Knee Replacement',  type: 'Inpatient',  cost: 42000,  tat: 2.4, guideline: 'XYZ 2024' },
  { name: 'Lumbar Fusion',           type: 'Inpatient',  cost: 68000,  tat: 2.9, guideline: 'ABCD A-0420' },
  { name: 'Hip Replacement',         type: 'Inpatient',  cost: 46000,  tat: 2.6, guideline: 'XYZ 2024' },
  { name: 'Cardiac Bypass (CABG)',   type: 'Inpatient',  cost: 285000, tat: 4.1, guideline: 'XYZ 2024' },
  { name: 'Spinal Fusion (3-level)', type: 'Inpatient',  cost: 127000, tat: 3.4, guideline: 'ABCD A-0420' },
  { name: 'Bariatric Surgery',       type: 'Inpatient',  cost: 58000,  tat: 3.1, guideline: 'ABCD A-0103' },
  { name: 'NICU Stay',               type: 'Inpatient',  cost: 198000, tat: 6.0, guideline: 'AIM Guidelines' },
  { name: 'MRI Brain w/ Contrast',   type: 'Outpatient', cost: 2400,   tat: 0.4, guideline: 'AIM Guidelines' },
  { name: 'MRI Lumbar Spine',        type: 'Outpatient', cost: 2600,   tat: 0.8, guideline: 'AIM Guidelines' },
  { name: 'CT Abdomen',              type: 'Outpatient', cost: 3200,   tat: 1.2, guideline: 'AIM Guidelines' },
  { name: 'Cardiac Catheterization', type: 'Outpatient', cost: 18500,  tat: 1.9, guideline: 'XYZ 2024' },
  { name: 'Colonoscopy',             type: 'Outpatient', cost: 2100,   tat: 0.6, guideline: 'ABCD A-0103' },
  { name: 'Physical Therapy (12v)',  type: 'Outpatient', cost: 1800,   tat: 0.3, guideline: 'ABCD A-0103' },
  { name: 'Cataract Surgery',        type: 'Outpatient', cost: 4200,   tat: 0.5, guideline: 'XYZ 2024' },
  { name: 'Chemotherapy Cycle',      type: 'Outpatient', cost: 34000,  tat: 1.8, guideline: 'AIM Guidelines' },
  { name: 'Echocardiogram',          type: 'Outpatient', cost: 2800,   tat: 1.4, guideline: 'AIM Guidelines' },
  { name: 'Sleep Study',             type: 'Outpatient', cost: 3600,   tat: 2.0, guideline: 'AIM Guidelines' },
  { name: 'Behavioral Health IOP',   type: 'Behavioral', cost: 9600,   tat: 2.2, guideline: 'LOCUS Criteria' },
  { name: 'Behavioral Health PHP',   type: 'Behavioral', cost: 14500,  tat: 2.5, guideline: 'LOCUS Criteria' },
];
export const GUIDELINE_BY_PROCEDURE: Record<string, string> = Object.fromEntries(PROCS.map((p) => [p.name, p.guideline]));

// ---- Diagnosis (ICD-10-CM) — every procedure maps to 2 clinically plausible diagnosis codes;
// which of the 2 a given case gets is picked deterministically per authId (same pattern as every
// other derived field), not stored on CaseRec itself — see dxOf() in case-fields.ts. ----
export interface DiagnosisCode { code: string; description: string; }
export const DX_BY_PROCEDURE: Record<string, DiagnosisCode[]> = {
  'Total Knee Replacement':  [{ code: 'M17.11', description: 'Unilateral primary osteoarthritis, right knee' }, { code: 'M17.12', description: 'Unilateral primary osteoarthritis, left knee' }],
  'Lumbar Fusion':           [{ code: 'M51.36', description: 'Other intervertebral disc degeneration, lumbar region' }, { code: 'M43.16', description: 'Spondylolisthesis, lumbar region' }],
  'Hip Replacement':         [{ code: 'M16.11', description: 'Unilateral primary osteoarthritis, right hip' }, { code: 'M16.12', description: 'Unilateral primary osteoarthritis, left hip' }],
  'Cardiac Bypass (CABG)':   [{ code: 'I25.10', description: 'Atherosclerotic heart disease of native coronary artery, without angina pectoris' }, { code: 'I25.110', description: 'Atherosclerotic heart disease of native coronary artery with unstable angina pectoris' }],
  'Spinal Fusion (3-level)': [{ code: 'M43.16', description: 'Spondylolisthesis, lumbar region' }, { code: 'M48.06', description: 'Spinal stenosis, lumbar region' }],
  'Bariatric Surgery':       [{ code: 'E66.01', description: 'Morbid (severe) obesity due to excess calories' }, { code: 'E66.9', description: 'Obesity, unspecified' }],
  'NICU Stay':               [{ code: 'P07.30', description: 'Preterm newborn, unspecified weeks of gestation' }, { code: 'P07.14', description: 'Extremely low birth weight newborn, 750-999 grams' }],
  'MRI Brain w/ Contrast':   [{ code: 'G43.909', description: 'Migraine, unspecified, not intractable, without status migrainosus' }, { code: 'R51.9', description: 'Headache, unspecified' }],
  'MRI Lumbar Spine':        [{ code: 'M54.50', description: 'Low back pain, unspecified' }, { code: 'M51.26', description: 'Other intervertebral disc displacement, lumbar region' }],
  'CT Abdomen':              [{ code: 'R10.9', description: 'Unspecified abdominal pain' }, { code: 'K92.2', description: 'Gastrointestinal hemorrhage, unspecified' }],
  'Cardiac Catheterization': [{ code: 'I25.10', description: 'Atherosclerotic heart disease of native coronary artery, without angina pectoris' }, { code: 'I20.9', description: 'Angina pectoris, unspecified' }],
  'Colonoscopy':             [{ code: 'K63.5', description: 'Polyp of colon' }, { code: 'Z12.11', description: 'Encounter for screening for malignant neoplasm of colon' }],
  'Physical Therapy (12v)':  [{ code: 'M25.561', description: 'Pain in right knee' }, { code: 'M54.50', description: 'Low back pain, unspecified' }],
  'Cataract Surgery':        [{ code: 'H25.11', description: 'Age-related nuclear cataract, right eye' }, { code: 'H25.12', description: 'Age-related nuclear cataract, left eye' }],
  'Chemotherapy Cycle':      [{ code: 'C50.911', description: 'Malignant neoplasm of unspecified site of right female breast' }, { code: 'C34.90', description: 'Malignant neoplasm of unspecified part of bronchus or lung' }],
  'Echocardiogram':          [{ code: 'I50.9', description: 'Heart failure, unspecified' }, { code: 'I48.91', description: 'Unspecified atrial fibrillation' }],
  'Sleep Study':             [{ code: 'G47.33', description: 'Obstructive sleep apnea (adult) (pediatric)' }, { code: 'G47.00', description: 'Insomnia, unspecified' }],
  'Behavioral Health IOP':   [{ code: 'F33.1', description: 'Major depressive disorder, recurrent, moderate' }, { code: 'F41.1', description: 'Generalized anxiety disorder' }],
  'Behavioral Health PHP':   [{ code: 'F31.81', description: 'Bipolar II disorder' }, { code: 'F43.10', description: 'Post-traumatic stress disorder, unspecified' }],
};
export const DX_CODES: DiagnosisCode[] = Object.values(DX_BY_PROCEDURE).flat()
  .filter((d, i, arr) => arr.findIndex((x) => x.code === d.code) === i)
  .sort((a, b) => a.code.localeCompare(b.code));

// Fuller description behind each short guideline code — shown as hover detail wherever the terse
// code (e.g. "XYZ 2024") is displayed on its own without room for the full name.
export const GUIDELINE_DETAIL: Record<string, string> = {
  'XYZ 2024': 'XYZ Medical Necessity Criteria, 2024 Edition — inpatient surgical & procedural admission criteria',
  'ABCD A-0420': 'ABCD Clinical Guideline A-0420 — spinal & orthopedic surgical medical necessity criteria',
  'ABCD A-0103': 'ABCD Clinical Guideline A-0103 — outpatient procedural medical necessity criteria',
  'AIM Guidelines': 'AIM Specialty Health Guidelines — advanced imaging & diagnostic appropriateness criteria',
  'LOCUS Criteria': 'LOCUS (Level of Care Utilization System) — behavioral health level-of-care criteria',
};
export const NURSES = ['Maria Gonzalez, RN', 'Jessica Williams, RN', 'Andrew Mitchell, RN',
  'Sarah Mitchell, RN', 'Emily Chen, RN', 'Robert Kim, RN'];

// ---- Real dates, anchored on TODAY, so the Lookback filter (Today/7 days/30 days/QTD) has an
// actual date range to slice — instead of every case falling in the same fixed window. ----
function isoDate(daysAgoVal: number): string {
  const d = new Date(TODAY);
  d.setDate(d.getDate() - daysAgoVal);
  return d.toISOString().slice(0, 10);
}
// Pending work skews recent (that's what "pending" means) and stays within 30 days, matching the
// 30-day default lookback so the un-filtered baseline count (247) never silently changes.
function pendingDaysAgo(i: number): number {
  const r = i % 20;
  if (r < 3) return i % 2;         // ~15% submitted today or yesterday
  if (r < 8) return 2 + (i % 6);   // ~25% within the last week
  return 8 + (i % 22);             // remainder spread across the rest of the 30-day window
}
// Decided work is spread across a full trailing quarter so Today/7 days/30 days/QTD each show a
// meaningfully different (and realistically growing) decided volume.
function decidedDaysAgo(j: number): number {
  return j % 90;
}
function member(i: number): string {
  return `${LAST[i % LAST.length]}, ${FIRST[(i * 7 + 3) % FIRST.length]}`;
}
function vary(base: number, i: number, spread: number): number {
  const d = ((i % 5) - 2) * spread; // -2..+2 * spread
  return Math.max(0, Math.round((base + d) * 100) / 100);
}

// ---- Pending population (247), distributed across the six queues ----
const PENDING_QUEUES: { status: string; count: number; tag: string }[] = [
  { status: 'Intake',            count: 42, tag: 'intake' },
  { status: 'Clinical Review',   count: 68, tag: 'clinical' },
  { status: 'MD Review',         count: 23, tag: 'mdReview' },
  { status: 'RFI Pending',       count: 31, tag: 'rfi' },
  { status: 'OON Review',        count: 15, tag: 'oon' },
  { status: 'Concurrent Review', count: 38, tag: 'concurrent' },
  { status: 'Pending P2P',       count: 30, tag: 'p2p' },
];

function buildPending(): CaseRec[] {
  const out: CaseRec[] = [];
  let i = 0;
  for (const q of PENDING_QUEUES) {
    const startI = i;

    // Precompute which k-indices in this queue are unclaimed (available to pull), sampled evenly
    // across the queue's age range — not picked by arithmetic coincidence — so every queue shows a
    // believable spread across the age bars instead of a small sample landing 100% in one band.
    // Paused RFI cases are excluded (blocked on the provider, not up for grabs).
    const returnedKs = new Set<number>();
    if (q.tag !== 'intake') {
      const eligible: number[] = [];
      for (let k = 0; k < q.count; k++) { if (!(q.tag === 'rfi' && k < 8)) eligible.push(k); }
      const byAge = [...eligible].sort((a, b) => ageH(`AUTH-${4000 + startI + a}`) - ageH(`AUTH-${4000 + startI + b}`));
      const target = Math.max(1, Math.round(q.count * 0.15));
      for (let n = 0; n < target && byAge.length; n++) {
        returnedKs.add(byAge[Math.floor((n * byAge.length) / target)]);
      }
    }

    for (let k = 0; k < q.count; k++, i++) {
      const p = PROCS[(i * 3 + 1) % PROCS.length];
      const tags = ['pending', q.tag];
      if (q.tag === 'rfi') { tags.push('incompleteDoc'); if (k < 8) tags.push('paused'); }
      if (q.tag === 'mdReview' || q.tag === 'p2p') tags.push('mdReview');

      // Every queue holds some unclaimed work available for any nurse to pull next: brand-new
      // submissions (Intake only) or authorizations returned to the queue — either the nurse sent
      // it back, or it auto-returned after sitting too long without action.
      if (q.tag === 'intake' && k < 8) tags.push('unassigned');              // never claimed yet
      else if (returnedKs.has(k)) tags.push('returned');                    // returned to queue

      if (i % 21 === 0 && tags.filter((t) => t === 'atRisk').length === 0) tags.push('atRisk'); // ~12 at risk
      tags.push(i % 7 === 0 ? 'expedited' : 'standard');              // ~14% expedited, matches decided ratio
      const inQueue = tags.includes('unassigned') || tags.includes('returned');
      const nurse = inQueue ? '—' : NURSES[i % NURSES.length];
      out.push({
        authId: `AUTH-${4000 + i}`,
        member: member(i),
        procedure: p.name, serviceType: p.type,
        decision: 'Pending',
        status: q.status,
        nurse,
        provider: PROVIDERS[(i * 3 + 2) % PROVIDERS.length],
        submitted: isoDate(pendingDaysAgo(i)),
        tatH: vary(p.tat, i, 0.3),
        cost: vary(p.cost, i, p.cost * 0.05),
        phase: 'pending',
        tags,
      });
    }
  }
  // exactly 3 breached among pending
  [5, 120, 210].forEach((idx) => out[idx] && out[idx].tags.push('breached'));
  return out;
}

// ---- Decided population (247): 153 approved / 44 denied / 50 partial ----
function buildDecided(): CaseRec[] {
  const out: CaseRec[] = [];
  for (let j = 0; j < 247; j++) {
    const i = 1000 + j;
    const p = PROCS[(j * 5 + 2) % PROCS.length];
    let decision: Decision; let status: string; const tags: string[] = [];
    if (j < 153) { decision = 'Approved'; status = 'Approved'; }
    else if (j < 197) { decision = 'Denied'; status = 'Denied'; }
    else { decision = 'Partial'; status = 'Partial Approval'; }

    if (decision === 'Approved' && j < 94) { status = 'Auto-Approved'; tags.push('auto'); } // 94 auto
    if (j % 6 === 0) tags.push('mdReview');   // ~41 md review
    if (j % 14 === 0) tags.push('p2p');       // ~17 p2p
    if (decision !== 'Approved') tags.push('appeal');

    // TAT buckets across decided: 232 on track / 12 at risk / 3 breached (matches KPI strip)
    if (j < 232) tags.push('onTrack');
    else if (j < 244) tags.push('atRisk');
    else { tags.push('breached'); }

    // review priority: 34 expedited / 213 standard
    tags.push(j < 34 ? 'expedited' : 'standard');

    if (j % 9 === 0) tags.push('incompleteDoc'); // ~27 incomplete docs

    out.push({
      authId: `AUTH-${4300 + j}`,
      member: member(i),
      procedure: p.name, serviceType: p.type,
      decision, status,
      nurse: tags.includes('auto') ? '—' : NURSES[j % NURSES.length],
      provider: PROVIDERS[(j * 5 + 1) % PROVIDERS.length],
      submitted: isoDate(decidedDaysAgo(j)),
      tatH: vary(p.tat, j, 0.4),
      cost: vary(p.cost, j, p.cost * 0.05),
      phase: 'decided',
      tags,
    });
  }
  return out;
}

export const CASE_POOL: CaseRec[] = [...buildPending(), ...buildDecided()];
