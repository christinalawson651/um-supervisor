// A generated pool of authorization records that backs every metric drill-down.
// Deterministic (no RNG) so the demo shows the same data on every load.

export type Decision = 'Approved' | 'Denied' | 'Partial' | 'Pending';

export interface CaseRec {
  authId: string;
  member: string;
  procedure: string;
  serviceType: 'Inpatient' | 'Outpatient' | 'Behavioral';
  decision: Decision;
  status: string;
  nurse: string;
  submitted: string;
  tatH: number;
  cost: number;
  phase: 'pending' | 'decided';
  tags: string[];
}

const FIRST = ['Patricia', 'Michael', 'Jennifer', 'Robert', 'Susan', 'Daniel', 'Maria', 'James', 'Sana', 'Angela',
  'Carlos', 'Nicole', 'Linda', 'Sean', 'Rina', 'Thomas', 'Katherine', 'Antonio', 'Beth', 'Hector',
  'Sarah', 'Grace', 'David', 'Emily', 'John', 'Olivia', 'Noah', 'Emma', 'Liam', 'Ava'];
const LAST = ['Adams', 'Brown', 'Clark', 'Davis', 'Evans', 'Foster', 'Garcia', 'Harris', 'Ibrahim', 'Johnson',
  'Kim', 'Lopez', 'Martin', 'Nguyen', 'O’Brien', 'Patel', 'Quinn', 'Reed', 'Silva', 'Thompson',
  'Underwood', 'Valdez', 'Williams', 'Young', 'Zhang', 'Bennett', 'Carter', 'Diaz', 'Ellis', 'Fisher'];

interface Proc { name: string; type: CaseRec['serviceType']; cost: number; tat: number; }
const PROCS: Proc[] = [
  { name: 'Total Knee Replacement',  type: 'Inpatient',  cost: 42000,  tat: 2.4 },
  { name: 'Lumbar Fusion',           type: 'Inpatient',  cost: 68000,  tat: 2.9 },
  { name: 'Hip Replacement',         type: 'Inpatient',  cost: 46000,  tat: 2.6 },
  { name: 'Cardiac Bypass (CABG)',   type: 'Inpatient',  cost: 285000, tat: 4.1 },
  { name: 'Spinal Fusion (3-level)', type: 'Inpatient',  cost: 127000, tat: 3.4 },
  { name: 'Bariatric Surgery',       type: 'Inpatient',  cost: 58000,  tat: 3.1 },
  { name: 'NICU Stay',               type: 'Inpatient',  cost: 198000, tat: 6.0 },
  { name: 'MRI Brain w/ Contrast',   type: 'Outpatient', cost: 2400,   tat: 0.4 },
  { name: 'MRI Lumbar Spine',        type: 'Outpatient', cost: 2600,   tat: 0.8 },
  { name: 'CT Abdomen',              type: 'Outpatient', cost: 3200,   tat: 1.2 },
  { name: 'Cardiac Catheterization', type: 'Outpatient', cost: 18500,  tat: 1.9 },
  { name: 'Colonoscopy',             type: 'Outpatient', cost: 2100,   tat: 0.6 },
  { name: 'Physical Therapy (12v)',  type: 'Outpatient', cost: 1800,   tat: 0.3 },
  { name: 'Cataract Surgery',        type: 'Outpatient', cost: 4200,   tat: 0.5 },
  { name: 'Chemotherapy Cycle',      type: 'Outpatient', cost: 34000,  tat: 1.8 },
  { name: 'Echocardiogram',          type: 'Outpatient', cost: 2800,   tat: 1.4 },
  { name: 'Sleep Study',             type: 'Outpatient', cost: 3600,   tat: 2.0 },
  { name: 'Behavioral Health IOP',   type: 'Behavioral', cost: 9600,   tat: 2.2 },
  { name: 'Behavioral Health PHP',   type: 'Behavioral', cost: 14500,  tat: 2.5 },
];
const NURSES = ['Maria Gonzalez, RN', 'Jessica Williams, RN', 'Andrew Mitchell, RN',
  'Sarah Mitchell, RN', 'Emily Chen, RN', 'Robert Kim, RN'];

// simple deterministic date within July 2026
function dateFor(i: number): string {
  const day = 4 + (i % 9); // 4..12
  return `2026-07-${String(day).padStart(2, '0')}`;
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
    for (let k = 0; k < q.count; k++, i++) {
      const p = PROCS[(i * 3 + 1) % PROCS.length];
      const tags = ['pending', q.tag];
      if (q.tag === 'rfi') { tags.push('incompleteDoc'); if (k < 8) tags.push('paused'); }
      if (q.tag === 'mdReview' || q.tag === 'p2p') tags.push('mdReview');
      if (q.tag === 'intake' && k < 8) tags.push('unassigned');       // 8 unassigned
      if (i % 21 === 0 && tags.filter((t) => t === 'atRisk').length === 0) tags.push('atRisk'); // ~12 at risk
      const nurse = tags.includes('unassigned') ? '—' : NURSES[i % NURSES.length];
      out.push({
        authId: `AUTH-${4000 + i}`,
        member: member(i),
        procedure: p.name, serviceType: p.type,
        decision: 'Pending',
        status: q.status,
        nurse,
        submitted: dateFor(i),
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

    // TAT buckets across decided: 186 on track / 42 at risk / 19 breached
    if (j < 186) tags.push('onTrack');
    else if (j < 228) tags.push('atRisk');
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
      submitted: dateFor(j),
      tatH: vary(p.tat, j, 0.4),
      cost: vary(p.cost, j, p.cost * 0.05),
      phase: 'decided',
      tags,
    });
  }
  return out;
}

export const CASE_POOL: CaseRec[] = [...buildPending(), ...buildDecided()];
